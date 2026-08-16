#!/usr/bin/env node

/**
 * install.mjs (pi-orchestration) — installer for the Pi role pack.
 *
 * Mirrors codex-orchestration/install.mjs, adapted to Pi's resource model:
 *   - each role gets its own PI_CODING_AGENT_DIR under ~/.pi-paseo/<role>/,
 *     holding role-specific AGENTS.md (system prompt), settings.json, mcp.json,
 *     skills/, prompts/ and a symlinked policy extension;
 *   - the policy extension is first copied into a stable path under PASEO_HOME,
 *     so installed roles do not depend on the source checkout remaining put;
 *   - credentials and the package store (auth.json, npm/, git/, models.json)
 *     are symlinked from ~/.pi/agent so every role shares auth and the
 *     pi-mcp-adapter package, while keeping role resources isolated;
 *   - the launcher pi-role-app-server is copied to ~/.paseo/bin;
 *   - four providers (pi-lead/worker/reviewer/supervisor) are merged into
 *     ~/.paseo/config.json with daemon.mcp.injectIntoAgents=false;
 *   - four namespaced Agent Profiles are merged without replacing Human-owned
 *     entries; they pin the first/default model advertised by the live Pi
 *     catalog and fail closed on managed-profile conflicts unless --force;
 *   - ~/.paseo/orchestration-preferences.json is merged as fallback routing.
 *
 * The installer never restarts the Paseo daemon and backs up JSON first.
 */

import {
	chmod,
	copyFile,
	lstat,
	mkdir,
	readFile,
	readdir,
	readlink,
	rename,
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
const sourceLauncher = path.join(packRoot, "bin", "pi-role-app-server");

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
const targetLauncher = path.join(paseoBin, "pi-role-app-server");
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
const profileDefaultEnv = "PASEO_PI_AGENT_PROFILE_DEFAULT_JSON";

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

function parseAgentProfileDefault(value, source) {
	let parsed;
	try {
		parsed = typeof value === "string" ? JSON.parse(value) : value;
	} catch (error) {
		throw new Error(`${source} is not valid JSON: ${error.message}`);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error(`${source} must be a JSON object`);
	}
	const model = typeof parsed.model === "string" ? parsed.model.trim() : "";
	if (!model) {
		throw new Error(`${source}.model must be a non-empty string`);
	}
	const thinkingOptionId =
		typeof parsed.thinkingOptionId === "string"
			? parsed.thinkingOptionId.trim()
			: "";
	return { model, ...(thinkingOptionId ? { thinkingOptionId } : {}) };
}

function discoverAgentProfileDefault() {
	if (process.env[profileDefaultEnv]) {
		return parseAgentProfileDefault(
			process.env[profileDefaultEnv],
			profileDefaultEnv,
		);
	}
	const result = spawnSync(
		"paseo",
		["provider", "models", "pi", "--thinking", "--json"],
		{ encoding: "utf8", timeout: 60_000 },
	);
	if (result.error) {
		throw new Error(`Cannot discover Pi profile model: ${result.error.message}`);
	}
	if (result.status !== 0) {
		throw new Error(
			`Cannot discover Pi profile model: ${(result.stderr || result.stdout || "paseo provider models failed").trim()}`,
		);
	}
	let models;
	try {
		models = JSON.parse(result.stdout);
	} catch (error) {
		throw new Error(`Cannot parse Pi model catalog: ${error.message}`);
	}
	if (!Array.isArray(models) || models.length === 0) {
		throw new Error("Pi model catalog is empty; refusing to create provider-only Agent Profiles");
	}
	const first = models[0];
	return parseAgentProfileDefault(
		{
			model: first.id,
			thinkingOptionId: first.defaultThinkingOptionId ?? undefined,
		},
		"Pi model catalog default",
	);
}

function managedAgentProfiles(profileDefault) {
	return roles.map((role) => ({
		id: `paseo-learn:pi:${role}:host-default`,
		...agentProfileSpecs[role],
		provider: `pi-${role}`,
		model: profileDefault.model,
		...(profileDefault.thinkingOptionId
			? { thinkingOptionId: profileDefault.thinkingOptionId }
			: {}),
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
	});
	return {
		"pi-lead": {
			extends: "pi",
			label: "Pi Lead",
			description:
				"Orchestration owner. Gets full Paseo MCP via the launcher; bounded by AGENTS.md and the policy extension.",
			command: [targetLauncher],
			env: { ...env("lead"), PASEO_MCP_ACCESS: "lead" },
		},
		"pi-worker": {
			extends: "pi",
			label: "Pi Worker",
			description:
				"Bounded implementation agent. No Paseo MCP; write authority comes only from the current-turn Task Brief.",
			command: ["pi"],
			env: env("worker"),
		},
		"pi-reviewer": {
			extends: "pi",
			label: "Pi Reviewer",
			description:
				"Independent review. No Paseo MCP; behaviorally read-only on an exact candidate SHA or the current working diff.",
			command: ["pi"],
			env: env("reviewer"),
		},
		"pi-supervisor": {
			extends: "pi",
			label: "Pi Supervisor",
			description:
				"Governance observer. Gets a read-only allowlist of Paseo MCP tools; instruction-gated recovery only.",
			command: [targetLauncher],
			env: { ...env("supervisor"), PASEO_MCP_ACCESS: "supervisor" },
		},
	};
}

const defaultPreferences = {
	providers: {
		impl: "pi-worker",
		ui: "pi-worker",
		research: "pi-reviewer",
		planning: "pi-lead",
		audit: "pi-reviewer",
	},
	preferences: [
		"Use pi-lead for decomposition and acceptance, pi-worker for bounded writes in the current workspace, and pi-reviewer for fresh review of an exact candidate SHA when available or the current working diff otherwise.",
		"Same-family routing is mandatory by default: a Pi Lead routes to pi-* role providers. Use claude-* or codex-* only when the Human explicitly requests that provider family for the delegation. If the required Pi role is unavailable, block and ask; profile availability or model ranking never authorizes cross-family substitution.",
		"When list_profiles is available, treat a complete profile whose provider matches the chosen pi role as a human-authored route candidate. Notes are advisory; validate model, thinking, mode, and features through discovery, copy the fields into create_agent, and post-verify runtime state. Never silently repair a stale profile.",
		"Discover provider/model availability on the target Paseo daemon with list_providers/list_models before creating an agent. Pin the exact model and settings.thinkingOptionId via get_agent_status. Never silently fall back.",
		"Use the current Paseo workspace by default. Never create a new workspace or worktree unless the Human explicitly requests it. Keep at most one active writer in a shared workspace. Do not use pi-supervisor in ordinary single-task flows.",
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
			if (!dryRun && mode) await chmod(target, mode);
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
		if (mode) await chmod(target, mode);
	}
	console.log(`${dryRun ? "would install" : "installed"}: ${target}`);
}

/** Recursively sync a source directory into target, per file.
 *  Reuses installOwnedFile semantics: unchanged files skip, differing files
 *  require --force, new files install. This makes re-install idempotent — a
 *  normal `./install pi` after the first run does not fail on existing skill/
 *  prompt dirs, and only blocks when a file the repo owns actually changed.
 *  Files present only in target (user-added) are left untouched. */
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
 * Create a symlink target -> source, failing closed if a different link/file
 * occupies target (unless --force). source must already exist.
 */
async function installSymlink(source, target, label, allowMissingSource = false) {
	if (!(await exists(source)) && !allowMissingSource) {
		console.log(`symlink skipped (${label} missing): ${source}`);
		return;
	}
	try {
		const info = await lstat(target);
		if (info.isSymbolicLink()) {
			const link = await readlink(target);
			if (path.resolve(path.dirname(target), link) === source) {
				console.log(`unchanged: ${target} -> ${source}`);
				return;
			}
		}
		if (!force) {
			throw new Error(
				`Refusing to replace existing ${target}; rerun with --force after review`,
			);
		}
		await backup(target);
		// backup() copies a dir; remove the now-backed-up original so symlink can land.
		if (!dryRun) {
			const { rm } = await import("node:fs/promises");
			await rm(target, { recursive: true, force: true });
		}
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
	if (!dryRun) {
		await mkdir(path.dirname(target), { recursive: true });
		await symlink(source, target);
	}
	console.log(`${dryRun ? "would link" : "linked"}: ${target} -> ${source} (${label})`);
}

async function installRole(role) {
	const sourceRole = path.join(sourceProfiles, role);
	const roleHome = path.join(rolesHome, role);
	if (!(await exists(sourceRole))) {
		throw new Error(`Role source missing: ${sourceRole}`);
	}

	// Role-owned files (AGENTS.md, settings.json, mcp.json when present).
	for (const file of ["AGENTS.md", "settings.json", "mcp.json"]) {
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
	// role shares auth and pi-mcp-adapter while keeping role resources isolated.
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
	const adapterPkg = path.join(
		piAgentDir,
		"npm",
		"node_modules",
		"pi-mcp-adapter",
		"package.json",
	);
	if (!existsSyncSync(adapterPkg)) {
		problems.push(
			"pi-mcp-adapter is not installed in ~/.pi/agent; run `pi install npm:pi-mcp-adapter` first",
		);
	}
	const authPath = path.join(piAgentDir, "auth.json");
	if (!existsSyncSync(authPath)) {
		problems.push(
			`~/.pi/agent/auth.json is missing; run \`pi\` and /login first so role homes can symlink credentials`,
		);
	}
	return problems;
}

/** Resolve a binary via PATH without spawning (best-effort, sync). */
async function which(bin) {
	const { access } = await import("node:fs/promises");
	const PATH = (process.env.PATH || "").split(path.delimiter);
	for (const dir of PATH) {
		const candidate = path.join(dir, bin);
		try {
			await access(candidate, fsConstants.X_OK);
		} catch {
			continue;
		}
		return candidate;
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
	config.daemon.mcp.enabled = true;
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
	// Resolve the exact host model before writing anything. Discovery failure is
	// fatal so an interrupted install cannot leave provider-only profiles behind.
	assertAgentProfilesPaseoVersion();
	const profileDefault = discoverAgentProfileDefault();
	const profiles = managedAgentProfiles(profileDefault);
	const config = await preparePaseoConfig(profiles);
	console.log(
		`Agent Profiles: Pi host default ${profileDefault.model}${profileDefault.thinkingOptionId ? ` (${profileDefault.thinkingOptionId})` : ""}`,
	);

	console.log(`\n== shared policy ==`);
	await installOwnedFile(sourceSharedExt, installedSharedExt, 0o600);

	for (const role of roles) {
		console.log(`\n== role: ${role} ==`);
		await installRole(role);
	}

	console.log(`\n== launcher ==`);
	await installOwnedFile(sourceLauncher, targetLauncher, 0o755);

	console.log(`\n== paseo config ==`);
	await writeJsonAtomic(paseoConfigPath, config);

	console.log(`\n== orchestration preferences ==`);
	const preferences = await readJsonOr(preferencesPath, {
		providers: {},
		preferences: [],
	});
	preferences.providers ??= {};
	preferences.preferences ??= [];
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
