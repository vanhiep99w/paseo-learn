#!/usr/bin/env node

/**
 * install.mjs (pi-orchestration) — installer for the Pi role pack.
 *
 * Mirrors codex-orchestration/install.mjs, adapted to Pi's resource model:
 *   - each role gets its own PI_CODING_AGENT_DIR under ~/.pi-paseo/<role>/,
 *     holding role-specific AGENTS.md (system prompt), settings.json, skills/,
 *     prompts/ and a symlinked policy extension;
 *   - the policy extension is first copied into a stable path under PASEO_HOME,
 *     so installed roles do not depend on the source checkout remaining put;
 *   - credentials and the package store (auth.json, npm/, git/, models.json)
 *     are symlinked from ~/.pi/agent so every role shares auth and the
 *     package store, while keeping role resources isolated;
 *   - the role-gated `paseo-team` CLI facade is copied to ~/.paseo/bin;
 *   - four providers (pi-lead/worker/reviewer/supervisor) are merged into
 *     ~/.paseo/config.json with daemon-wide MCP injection disabled;
 *   - four namespaced Agent Profiles are merged without replacing Human-owned
 *     entries; Lead pins GPT-5.6 Sol/high, while Worker/Reviewer/Supervisor pin
 *     GPT-5.6 Luna/max, validated against the live Pi catalog;
 *   - ~/.paseo/orchestration-preferences.json is merged as fallback routing.
 *
 * The installer never restarts the Paseo daemon and backs up JSON first.
 */

import {
	chmod,
	copyFile,
	link,
	lstat,
	mkdir,
	readFile,
	readdir,
	readlink,
	rename,
	rm,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { constants as fsConstants, existsSync as existsSyncSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const force = args.has("--force");
const allowedArgs = new Set(["--dry-run", "--force"]);
const unknown = [...args].filter((arg) => !allowedArgs.has(arg));

if (unknown.length) {
	console.error(`Unknown option(s): ${unknown.join(", ")}`);
	console.error("Usage: node pi-orchestration/install.mjs [--dry-run] [--force]");
	process.exit(2);
}

// This installer lives inside pi-orchestration/, so the pack root is its own
// directory and profiles/ + bin/ + shared/ sit next to it.
const packRoot = path.dirname(fileURLToPath(import.meta.url));
const sourceProfiles = path.join(packRoot, "profiles");
const sourceSharedExt = path.join(packRoot, "shared", "paseo-team-policy.ts");
const sourceTaskBriefTemplate = path.join(packRoot, "templates", "TASK_BRIEF_V3.md");
const sourceTeamCli = path.join(packRoot, "bin", "paseo-team");
const sourceTeamCliCmd = path.join(packRoot, "bin", "paseo-team.cmd");
const isWindows = process.platform === "win32";

const piAgentDir = path.resolve(
	process.env.PI_CODING_AGENT_DIR || path.join(homedir(), ".pi", "agent"),
);
const paseoHome = path.resolve(
	process.env.PASEO_HOME || path.join(homedir(), ".paseo"),
);
const rolesHome = path.resolve(
	process.env.PASEO_PI_ROLES_HOME || path.join(homedir(), ".pi-paseo"),
);
const paseoBin = path.join(paseoHome, "bin");
const targetTeamCliScript = path.join(
	paseoBin,
	isWindows ? "paseo-team.mjs" : "paseo-team",
);
const targetTeamCli = isWindows
	? path.join(paseoBin, "paseo-team.cmd")
	: targetTeamCliScript;
const installedSharedExt = path.join(
	paseoHome,
	"packs",
	"pi-orchestration",
	"paseo-team-policy.ts",
);
const targetSharedExt = "paseo-team-policy.ts";
const paseoConfigPath = path.join(paseoHome, "config.json");
const preferencesPath = path.join(paseoHome, "orchestration-preferences.json");
const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");

const roles = ["lead", "worker", "reviewer", "supervisor"];
const profileRoutesEnv = "PASEO_PI_AGENT_PROFILE_ROUTES_JSON";
const defaultProfileRoutes = {
	lead: { model: "openai-codex/gpt-5.6-sol", thinkingOptionId: "high" },
	worker: { model: "openai-codex/gpt-5.6-luna", thinkingOptionId: "max" },
	reviewer: { model: "openai-codex/gpt-5.6-luna", thinkingOptionId: "max" },
	supervisor: { model: "openai-codex/gpt-5.6-luna", thinkingOptionId: "max" },
};

const agentProfileSpecs = {
	lead: {
		name: "Pi Lead · Host default",
		icon: "compass",
		color: "blue",
		notes:
			"Use for Pi Lead planning, decomposition, and acceptance. This profile does not grant implementation authority.",
	},
	worker: {
		name: "Pi Worker · Host default",
		icon: "hammer",
		color: "amber",
		notes:
			"Use for bounded Pi Worker implementation after a valid current-turn V3 Task Brief.",
	},
	reviewer: {
		name: "Pi Reviewer · Host default",
		icon: "search",
		color: "violet",
		notes:
			"Use for independent read-only review of an exact candidate SHA or the current working diff.",
	},
	supervisor: {
		name: "Pi Supervisor · Host default",
		icon: "eye",
		color: "red",
		notes:
			"Use only for governance observation or gated Lead recovery, never ordinary task execution.",
	},
};

function assertAgentProfilesPaseoVersion() {
	const result = spawnSync("paseo", ["--version"], {
		encoding: "utf8",
		timeout: 10_000,
		shell: isWindows,
	});
	if (result.error || result.status !== 0) {
		throw new Error("Paseo v0.4.0+ is required to install Agent Profiles");
	}
	const match = result.stdout.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
	if (!match) {
		throw new Error(`Cannot parse Paseo version: ${result.stdout.trim()}`);
	}
	const [, major, minor] = match.map(Number);
	if (major === 0 && minor < 4) {
		throw new Error(
			`Paseo v0.4.0+ is required to install Agent Profiles (found ${result.stdout.trim()})`,
		);
	}
}

function parseAgentProfileRoute(value, source) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${source} must be a JSON object`);
	}
	const model = typeof value.model === "string" ? value.model.trim() : "";
	const thinkingOptionId =
		typeof value.thinkingOptionId === "string"
			? value.thinkingOptionId.trim()
			: "";
	if (!model) throw new Error(`${source}.model must be a non-empty string`);
	if (!thinkingOptionId) {
		throw new Error(`${source}.thinkingOptionId must be a non-empty string`);
	}
	return { model, thinkingOptionId };
}

function parseAgentProfileRoutes(value, source) {
	let parsed;
	try {
		parsed = typeof value === "string" ? JSON.parse(value) : value;
	} catch (error) {
		throw new Error(`${source} is not valid JSON: ${error.message}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${source} must be a JSON object keyed by role`);
	}
	return Object.fromEntries(
		roles.map((role) => [
			role,
			parseAgentProfileRoute(parsed[role], `${source}.${role}`),
		]),
	);
}

function discoverAgentProfileRoutes() {
	if (process.env[profileRoutesEnv]) {
		return parseAgentProfileRoutes(process.env[profileRoutesEnv], profileRoutesEnv);
	}
	const result = spawnSync(
		"paseo",
		["provider", "models", "pi", "--thinking", "--json"],
		{ encoding: "utf8", timeout: 60_000, shell: isWindows },
	);
	if (result.error) {
		throw new Error(`Cannot discover Pi profile models: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(
			`Cannot discover Pi profile models: ${(result.stderr || result.stdout || "paseo provider models failed").trim()}`,
		);
	}
	let models;
	try {
		models = JSON.parse(result.stdout);
	} catch (error) {
		throw new Error(`Cannot parse Pi model catalog: ${error.message}`);
	}
	if (!Array.isArray(models) || models.length === 0) {
		throw new Error("Pi model catalog is empty; refusing to create Agent Profiles");
	}
	const routes = parseAgentProfileRoutes(defaultProfileRoutes, "defaultProfileRoutes");
	for (const [role, route] of Object.entries(routes)) {
		const model = models.find((candidate) => candidate?.id === route.model);
		if (!model) {
			throw new Error(`Pi ${role} Agent Profile model is unavailable: ${route.model}`);
		}
		const options = Array.isArray(model.thinkingOptionIds)
			? model.thinkingOptionIds
			: [];
		if (!options.includes(route.thinkingOptionId)) {
			throw new Error(
				`Pi ${role} Agent Profile thinking option is unavailable: ${route.model}/${route.thinkingOptionId}`,
			);
		}
	}
	return routes;
}

function managedAgentProfiles(profileRoutes) {
	return roles.map((role) => ({
		id: `paseo-learn:pi:${role}:host-default`,
		...agentProfileSpecs[role],
		provider: `pi-${role}`,
		...profileRoutes[role],
	}));
}

function canonicalJson(value) {
	if (Array.isArray(value)) {
		return `[${value.map(canonicalJson).join(",")}]`;
	}
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(",")}}`;
	}
	return JSON.stringify(value);
}

function mergeManagedAgentProfiles(config, desiredProfiles) {
	const current = config.daemon.agentProfiles ?? [];
	if (!Array.isArray(current)) {
		throw new Error("daemon.agentProfiles must be an array");
	}
	const next = structuredClone(current);
	for (const desired of desiredProfiles) {
		const index = next.findIndex((profile) => profile?.id === desired.id);
		if (index === -1) {
			next.push(desired);
			continue;
		}
		if (canonicalJson(next[index]) === canonicalJson(desired)) {
			continue;
		}
		if (!force) {
			throw new Error(
				`Agent Profile ${desired.id} already exists with different config; use --force after review`,
			);
		}
		next[index] = desired;
	}
	config.daemon.agentProfiles = next;
}

function providerConfig() {
	const env = (role) => ({
		PI_CODING_AGENT_DIR: path.join(rolesHome, role),
		PASEO_PI_ROLE: role,
		PASEO_TEAM_CLI: targetTeamCli,
	});
	return {
		"pi-lead": {
			extends: "pi",
			label: "Pi Lead",
			description:
				"Orchestration owner. Uses the role-gated Paseo CLI; bounded by AGENTS.md and the policy extension.",
			command: ["pi"],
			env: env("lead"),
		},
		"pi-worker": {
			extends: "pi",
			label: "Pi Worker",
			description:
				"Bounded implementation agent. No orchestration CLI authority; write authority comes only from the current-turn Task Brief.",
			command: ["pi"],
			env: env("worker"),
		},
		"pi-reviewer": {
			extends: "pi",
			label: "Pi Reviewer",
			description:
				"Independent review. No orchestration CLI authority; behaviorally read-only on an exact candidate SHA or the current working diff.",
			command: ["pi"],
			env: env("reviewer"),
		},
		"pi-supervisor": {
			extends: "pi",
			label: "Pi Supervisor",
			description:
				"Governance observer. Uses the role-gated Paseo CLI monitoring/recovery surface.",
			command: ["pi"],
			env: env("supervisor"),
		},
	};
}

const obsoletePreferences = [
	"Use pi-lead for decomposition and acceptance, pi-worker for bounded writes in the current workspace, and pi-reviewer for fresh review of an exact candidate SHA when available or the current working diff otherwise.",
	"Use the current Paseo workspace by default. Never create a new workspace or worktree unless the Human explicitly requests it. Keep at most one active writer in a shared workspace. Do not use pi-supervisor in ordinary single-task flows.",
	"When list_profiles is available, treat a complete profile whose provider matches the chosen pi role as a human-authored route candidate. Notes are advisory; validate model, thinking, mode, and features through discovery, copy the fields into create_agent, and post-verify runtime state. Never silently repair a stale profile.",
	"Discover provider/model availability on the target Paseo daemon with list_providers/list_models before creating an agent. Pin the exact model and settings.thinkingOptionId via get_agent_status. Never silently fall back.",
];

const defaultPreferences = {
	providers: {
		impl: "pi-worker",
		ui: "pi-worker",
		research: "pi-reviewer",
		planning: "pi-lead",
		audit: "pi-reviewer",
	},
	preferences: [
		"Use pi-lead for decomposition and acceptance, pi-worker for bounded writes, and pi-reviewer for serialized read-only review after the writer is idle. All roles inherit the same current workspace.",
		"Use Vietnamese for every user-facing response and every agent-to-agent prompt, message, report, review, and handoff. Preserve code, commands, paths, identifiers, protocol fields, quoted logs/errors, and machine-readable tokens. A specific explicit Human language request overrides this only for that output.",
		"Same-family routing is mandatory by default: a Pi Lead routes to pi-* role providers. Use claude-* or codex-* only when the Human explicitly requests that provider family for the delegation. If the required Pi role is unavailable, block and ask; profile availability or model ranking never authorizes cross-family substitution.",
		"Agent Profiles remain Human launch presets; CLI orchestration does not infer routes from them. Discover provider/model/thinking availability with `paseo-team providers` and `paseo-team models`, pin every value on `paseo-team run`, and post-verify with `paseo-team inspect`. Never silently fall back.",
		"Use only the role-gated `paseo-team` facade for orchestration. Do not call raw `paseo`, MCP, native subagents, or a private task database.",
		"Every subagent must inherit the Lead current workspace. Never pass workspace/worktree placement flags, call workspace management, or run manual git worktree commands. Serialize Engineer and Reviewer; keep at most one active writer. Do not use pi-supervisor in ordinary single-task flows.",
	],
};

async function readJsonOr(pathname, fallback) {
	try {
		return JSON.parse(await readFile(pathname, "utf8"));
	} catch (error) {
		if (error?.code === "ENOENT") return structuredClone(fallback);
		throw new Error(`Cannot parse ${pathname}: ${error.message}`);
	}
}

async function exists(pathname) {
	try {
		await stat(pathname);
		return true;
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
}

async function backup(pathname) {
	if (!(await exists(pathname))) return null;
	const target = `${pathname}.bak.${stamp}`;
	if (!dryRun) await copyFile(pathname, target, fsConstants.COPYFILE_EXCL);
	console.log(`${dryRun ? "would backup" : "backup"}: ${target}`);
	return target;
}

async function writeJsonAtomic(pathname, value) {
	const text = `${JSON.stringify(value, null, 2)}\n`;
	if (await exists(pathname)) {
		const current = await readFile(pathname, "utf8");
		if (current === text) {
			console.log(`unchanged: ${pathname}`);
			return;
		}
		await backup(pathname);
	}
	if (!dryRun) {
		await mkdir(path.dirname(pathname), { recursive: true });
		const temp = `${pathname}.tmp.${process.pid}`;
		await writeFile(temp, text, { encoding: "utf8", mode: 0o600 });
		await rename(temp, pathname);
	}
	console.log(`${dryRun ? "would update" : "updated"}: ${pathname}`);
}

/** Install a regular file, failing closed unless --force when it differs. */
async function installOwnedFile(source, target, mode) {
	const sourceText = await readFile(source, "utf8");
	if (await exists(target)) {
		const targetText = await readFile(target, "utf8");
		if (targetText === sourceText) {
			console.log(`unchanged: ${target}`);
			if (!dryRun && mode && !isWindows) await chmod(target, mode);
			return;
		}
		if (!force) {
			throw new Error(
				`Refusing to overwrite ${target}; rerun with --force after review`,
			);
		}
		await backup(target);
	}
	if (!dryRun) {
		await mkdir(path.dirname(target), { recursive: true });
		await copyFile(source, target);
		if (mode && !isWindows) await chmod(target, mode);
	}
	console.log(`${dryRun ? "would install" : "installed"}: ${target}`);
}

/** Recursively sync a source directory into target, per file.
 *  Reuses installOwnedFile semantics: unchanged files skip, differing files
 *  require --force, new files install. This makes re-install idempotent — a
 *  normal `./install pi` after the first run does not fail on existing skill/
 *  prompt dirs, and only blocks when a file the repo owns actually changed.
 *  Files present only in target (user-added) are left untouched. */
async function retireOwnedFile(target, label) {
	if (!(await exists(target))) return;
	if (!force) {
		throw new Error(`Obsolete managed ${label} still exists at ${target}; rerun with --force after review`);
	}
	await backup(target);
	if (!dryRun) await rm(target, { force: true });
	console.log(`${dryRun ? "would remove" : "removed"}: ${target} (${label})`);
}

async function installOwnedDir(source, target) {
	if (!(await exists(source))) return;
	await walkSync(source, target);
}

async function walkSync(source, target) {
	for (const entry of await readdir(source, { withFileTypes: true })) {
		if (entry.name === ".gitkeep" || entry.name.startsWith(".bak.")) continue;
		const src = path.join(source, entry.name);
		const dst = path.join(target, entry.name);
		if (entry.isDirectory()) {
			await walkSync(src, dst);
		} else if (entry.isFile()) {
			await installOwnedFile(src, dst);
		}
	}
}

/**
 * Share a role resource without requiring Windows Developer Mode:
 * - POSIX: symlink
 * - Windows directory: junction
 * - Windows file: hard link
 */
async function installSymlink(source, target, label, allowMissingSource = false) {
	const sourceExists = await exists(source);
	if (!sourceExists && !allowMissingSource) {
		console.log(`shared link skipped (${label} missing): ${source}`);
		return;
	}
	const sourceInfo = sourceExists ? await stat(source) : null;
	try {
		const info = await lstat(target);
		if (info.isSymbolicLink()) {
			const currentLink = await readlink(target);
			if (path.resolve(path.dirname(target), currentLink) === source) {
				console.log(`unchanged: ${target} -> ${source}`);
				return;
			}
		}
		if (isWindows && sourceInfo?.isFile() && info.isFile()) {
			const targetInfo = await stat(target);
			if (targetInfo.dev === sourceInfo.dev && targetInfo.ino === sourceInfo.ino) {
				console.log(`unchanged hard link: ${target} -> ${source}`);
				return;
			}
			const [sourceBytes, targetBytes] = await Promise.all([
				readFile(source),
				readFile(target),
			]);
			if (sourceBytes.equals(targetBytes)) {
				console.log(`unchanged shared copy: ${target} <- ${source}`);
				return;
			}
		}
		if (!force) {
			throw new Error(
				`Refusing to replace existing ${target}; rerun with --force after review`,
			);
		}
		const backupTarget = `${target}.bak.${stamp}`;
		if (!dryRun) await rename(target, backupTarget);
		console.log(`${dryRun ? "would backup" : "backup"}: ${backupTarget}`);
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
	let kind = isWindows
		? sourceInfo?.isDirectory() ? "junction" : "hard link"
		: "symlink";
	if (!dryRun) {
		await mkdir(path.dirname(target), { recursive: true });
		if (isWindows && sourceInfo?.isDirectory()) {
			await symlink(source, target, "junction");
		} else if (isWindows) {
			try {
				await link(source, target);
			} catch (error) {
				if (error?.code !== "EXDEV" && error?.code !== "EPERM") throw error;
				await copyFile(source, target);
				kind = "shared copy fallback";
			}
		} else {
			await symlink(source, target);
		}
	}
	console.log(`${dryRun ? `would create ${kind}` : `created ${kind}`}: ${target} -> ${source} (${label})`);
}

async function installRole(role) {
	const sourceRole = path.join(sourceProfiles, role);
	const roleHome = path.join(rolesHome, role);
	if (!(await exists(sourceRole))) {
		throw new Error(`Role source missing: ${sourceRole}`);
	}

	// Retire MCP config managed by older pack versions before installing the
	// CLI-only role resources.
	if (role === "lead" || role === "supervisor") {
		await retireOwnedFile(path.join(roleHome, "mcp.json"), "Pi role MCP config");
	}

	// Role-owned files (AGENTS.md and settings.json).
	for (const file of ["AGENTS.md", "settings.json"]) {
		const src = path.join(sourceRole, file);
		if (await exists(src)) {
			const mode = file.endsWith(".json") ? 0o600 : undefined;
			await installOwnedFile(src, path.join(roleHome, file), mode);
		}
	}

	// Install the canonical brief at a deterministic runtime path. The Lead must
	// read $PI_CODING_AGENT_DIR/templates/TASK_BRIEF_V3.md, never search $HOME.
	if (role === "lead") {
		await installOwnedFile(
			sourceTaskBriefTemplate,
			path.join(roleHome, "templates", "TASK_BRIEF_V3.md"),
		);
	}

	// Role-owned resource dirs (skills/, prompts/) — per-profile resources.
	for (const dir of ["skills", "prompts"]) {
		const src = path.join(sourceRole, dir);
		if (await exists(src)) {
			await installOwnedDir(src, path.join(roleHome, dir));
		}
	}

	// Every role links to the stable installed copy, never to the source checkout.
	// allowMissingSource keeps --dry-run accurate before that copy exists.
	await installSymlink(
		installedSharedExt,
		path.join(roleHome, "extensions", targetSharedExt),
		"policy extension",
		dryRun,
	);

	// Shared credential + package store + model catalog: symlinked so every
	// role shares auth and installed packages while keeping role resources isolated.
	await installSymlink(
		path.join(piAgentDir, "auth.json"),
		path.join(roleHome, "auth.json"),
		"credentials",
	);
	for (const shared of ["npm", "git", "models.json"]) {
		await installSymlink(
			path.join(piAgentDir, shared),
			path.join(roleHome, shared),
			`shared ${shared}`,
		);
	}
}

async function checkPrereqs() {
	const problems = [];
	for (const bin of ["pi", "paseo"]) {
		if (!existsSyncSync(await which(bin))) {
			problems.push(`${bin} is not on PATH`);
		}
	}
	const authPath = path.join(piAgentDir, "auth.json");
	if (!existsSyncSync(authPath)) {
		problems.push(
			`${authPath} is missing; run \`pi\` and /login first so role homes can share credentials`,
		);
	}
	return problems;
}

/** Resolve a binary via PATH, including PATHEXT launchers on Windows. */
async function which(bin) {
	const { access } = await import("node:fs/promises");
	const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
	const extensions = isWindows
		? ["", ...(process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
			.split(";")
			.filter(Boolean)]
		: [""];
	for (const directory of pathEntries) {
		for (const extension of extensions) {
			const candidate = path.join(directory, `${bin}${extension}`);
			try {
				await access(candidate, isWindows ? fsConstants.F_OK : fsConstants.X_OK);
				return candidate;
			} catch {
				// Try the next PATHEXT candidate.
			}
		}
	}
	return "";
}

async function preparePaseoConfig(profiles) {
	const config = await readJsonOr(paseoConfigPath, {
		$schema: "https://paseo.sh/schemas/paseo.config.v1.json",
		version: 1,
	});
	config.version ??= 1;
	config.daemon ??= {};
	config.daemon.mcp ??= {};
	config.daemon.mcp.injectIntoAgents = false;
	mergeManagedAgentProfiles(config, profiles);
	config.agents ??= {};
	config.agents.providers ??= {};
	for (const [id, desired] of Object.entries(providerConfig())) {
		const current = config.agents.providers[id];
		if (
			current &&
			JSON.stringify(current) !== JSON.stringify(desired) &&
			!force
		) {
			throw new Error(
				`Provider ${id} already exists with different config; use --force after review`,
			);
		}
		config.agents.providers[id] = desired;
	}
	return config;
}

async function main() {
	const problems = await checkPrereqs();
	for (const problem of problems) {
		console.warn(`warning: ${problem}`);
	}
	// Resolve and validate every role route before writing anything. Discovery
	// failure is fatal so an interrupted install cannot leave stale profiles.
	assertAgentProfilesPaseoVersion();
	const profileRoutes = discoverAgentProfileRoutes();
	const profiles = managedAgentProfiles(profileRoutes);
	const config = await preparePaseoConfig(profiles);
	console.log("Agent Profiles: Pi role routes");
	for (const role of roles) {
		console.log(
			`  ${role}: ${profileRoutes[role].model} (${profileRoutes[role].thinkingOptionId})`,
		);
	}

	console.log(`\n== shared policy ==`);
	await installOwnedFile(sourceSharedExt, installedSharedExt, 0o600);

	for (const role of roles) {
		console.log(`\n== role: ${role} ==`);
		await installRole(role);
	}

	console.log(`\n== role-gated Paseo CLI ==`);
	await installOwnedFile(sourceTeamCli, targetTeamCliScript, isWindows ? undefined : 0o755);
	if (isWindows) await installOwnedFile(sourceTeamCliCmd, targetTeamCli);
	await retireOwnedFile(path.join(paseoBin, "pi-role-app-server"), "Pi MCP launcher");

	console.log(`\n== paseo config ==`);
	await writeJsonAtomic(paseoConfigPath, config);

	console.log(`\n== orchestration preferences ==`);
	const preferences = await readJsonOr(preferencesPath, {
		providers: {},
		preferences: [],
	});
	preferences.providers ??= {};
	preferences.preferences ??= [];
	preferences.preferences = preferences.preferences.filter(
		(preference) => !obsoletePreferences.includes(preference),
	);
	for (const [category, provider] of Object.entries(
		defaultPreferences.providers,
	)) {
		preferences.providers[category] ??= provider;
	}
	for (const preference of defaultPreferences.preferences) {
		if (!preferences.preferences.includes(preference)) {
			preferences.preferences.push(preference);
		}
	}
	await writeJsonAtomic(preferencesPath, preferences);

	console.log("");
	console.log(
		dryRun
			? "Dry run complete; no files were changed."
			: "Pi profiles installed. Paseo daemon was NOT restarted.",
	);
	console.log("Finish active agents before refreshing/restarting Paseo.");
	console.log("Then verify with: paseo provider ls --json");
	console.log("And: paseo provider models pi-lead --json");
	console.log(
		dryRun
			? "Managed Pi Agent Profiles would be merged; Human-owned profiles would be preserved."
			: "Managed Pi Agent Profiles were merged; Human-owned profiles were preserved.",
	);
	if (problems.length) {
		console.log("\nResolve the warnings above before relying on the pack.");
	}
}

main().catch((error) => {
	console.error(`pi-orchestration install: ${error.message}`);
	process.exit(1);
});
