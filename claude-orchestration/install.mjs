#!/usr/bin/env node

/**
 * install.mjs (claude-orchestration) — installer for the Claude Code role pack.
 *
 * Mirrors pi-orchestration/install.mjs, adapted to Claude Code's resource
 * model:
 *   - each role gets its own CLAUDE_CONFIG_DIR under ~/.claude-paseo/<role>/,
 *     holding role-specific CLAUDE.md (system prompt — Claude Code reads
 *     CLAUDE.md, not AGENTS.md), settings.json (permissions + hooks), the
 *     copied policy hooks under hooks/, and (lead) the paseo-team-lead skill;
 *   - credentials (.credentials.json on Linux/Windows) are symlinked from the
 *     default CLAUDE_CONFIG_DIR so every role shares one login. On macOS the
 *     keychain holds credentials, so set ANTHROPIC_API_KEY in the provider env
 *     or run `claude` once per role home instead;
 *   - the role-gated `paseo-team` CLI facade is copied to ~/.paseo/bin;
 *   - four providers (claude-lead/worker/reviewer/supervisor) are merged into
 *     ~/.paseo/config.json with daemon-wide MCP injection disabled;
 *   - four namespaced Agent Profiles are merged without replacing Human-owned
 *     entries; they pin the first/default model advertised by the live Claude
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
	console.error("Usage: node claude-orchestration/install.mjs [--dry-run] [--force]");
	process.exit(2);
}

// This installer lives inside claude-orchestration/, so the pack root is its own
// directory and profiles/ + bin/ + shared/ sit next to it.
const packRoot = path.dirname(fileURLToPath(import.meta.url));
const sourceProfiles = path.join(packRoot, "profiles");
const sourceSharedHooks = path.join(packRoot, "shared", "paseo-team-policy");
const sourceTaskBriefTemplate = path.join(packRoot, "templates", "TASK_BRIEF_V3.md");
const sourceTeamCli = path.join(packRoot, "bin", "paseo-team");

const claudeConfigDir = path.resolve(
	process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), ".claude"),
);
const paseoHome = path.resolve(
	process.env.PASEO_HOME || path.join(homedir(), ".paseo"),
);
const rolesHome = path.resolve(
	process.env.PASEO_CLAUDE_ROLES_HOME || path.join(homedir(), ".claude-paseo"),
);
const paseoBin = path.join(paseoHome, "bin");
const targetTeamCli = path.join(paseoBin, "paseo-team");
const paseoConfigPath = path.join(paseoHome, "config.json");
const preferencesPath = path.join(paseoHome, "orchestration-preferences.json");
const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");

const roles = ["lead", "worker", "reviewer", "supervisor"];
const profileDefaultEnv = "PASEO_CLAUDE_AGENT_PROFILE_DEFAULT_JSON";

const agentProfileSpecs = {
	lead: {
		name: "Claude Lead · Host default",
		icon: "compass",
		color: "blue",
		notes:
			"Use for Claude Lead planning, decomposition, and acceptance. This profile does not grant implementation authority.",
	},
	worker: {
		name: "Claude Worker · Host default",
		icon: "hammer",
		color: "amber",
		notes:
			"Use for bounded Claude Worker implementation after a valid current-turn V3 Task Brief.",
	},
	reviewer: {
		name: "Claude Reviewer · Host default",
		icon: "search",
		color: "violet",
		notes:
			"Use for independent read-only review of an exact candidate SHA or the current working diff.",
	},
	supervisor: {
		name: "Claude Supervisor · Host default",
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
		["provider", "models", "claude", "--thinking", "--json"],
		{ encoding: "utf8", timeout: 60_000 },
	);
	if (result.error) {
		throw new Error(
			`Cannot discover Claude profile model: ${result.error.message}`,
		);
	}
	if (result.status !== 0) {
		throw new Error(
			`Cannot discover Claude profile model: ${(result.stderr || result.stdout || "paseo provider models failed").trim()}`,
		);
	}
	let models;
	try {
		models = JSON.parse(result.stdout);
	} catch (error) {
		throw new Error(`Cannot parse Claude model catalog: ${error.message}`);
	}
	if (!Array.isArray(models) || models.length === 0) {
		throw new Error(
			"Claude model catalog is empty; refusing to create provider-only Agent Profiles",
		);
	}
	const first = models[0];
	return parseAgentProfileDefault(
		{
			model: first.id,
			thinkingOptionId: first.defaultThinkingOptionId ?? undefined,
		},
		"Claude model catalog default",
	);
}

function managedAgentProfiles(profileDefault) {
	return roles.map((role) => ({
		id: `paseo-learn:claude:${role}:host-default`,
		...agentProfileSpecs[role],
		provider: `claude-${role}`,
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

// Claude Code auth env to forward into every claude-* provider. Paseo does NOT
// expand ${VAR} in provider env and does NOT forward the daemon's ambient env to
// spawned provider processes — only the keys declared here reach the spawned
// `claude`. Without these, a spawned agent has no ANTHROPIC_AUTH_TOKEN/API_KEY
// and falls back to ~/.claude/.credentials.json (OAuth), which for custom
// backends (GLM/z.ai via ANTHROPIC_BASE_URL) is usually absent or expired → 401.
// So capture the auth env the installer sees and inject it verbatim. The values
// are written to ~/.paseo/config.json (mode 0600), same as any other provider
// API key. Re-run the installer after rotating a token.
const AUTH_ENV_KEYS = [
	"ANTHROPIC_API_KEY",
	"ANTHROPIC_AUTH_TOKEN",
	"ANTHROPIC_BASE_URL",
	"ANTHROPIC_DEFAULT_HAIKU_MODEL",
	"ANTHROPIC_DEFAULT_SONNET_MODEL",
	"ANTHROPIC_DEFAULT_OPUS_MODEL",
	"ZAI_API_KEY",
];

function authEnv() {
	const out = {};
	for (const k of AUTH_ENV_KEYS) {
		if (process.env[k]) out[k] = process.env[k];
	}
	return out;
}

function providerConfig() {
	const env = (role) => ({
		CLAUDE_CONFIG_DIR: path.join(rolesHome, role),
		PASEO_CLAUDE_ROLE: role,
		PASEO_TEAM_CLI: targetTeamCli,
		...authEnv(),
	});
	return {
		"claude-lead": {
			extends: "claude",
			label: "Claude Lead",
			description:
				"Orchestration owner. Uses the role-gated Paseo CLI; bounded by CLAUDE.md and the policy hooks.",
			command: ["claude"],
			env: env("lead"),
		},
		"claude-worker": {
			extends: "claude",
			label: "Claude Worker",
			description:
				"Bounded implementation agent. No orchestration CLI authority; write/commit/push authority comes only from the current-turn Task Brief.",
			command: ["claude"],
			env: env("worker"),
		},
		"claude-reviewer": {
			extends: "claude",
			label: "Claude Reviewer",
			description:
				"Independent review. No orchestration CLI authority; behaviorally read-only on an exact candidate SHA or the current working diff.",
			command: ["claude"],
			env: env("reviewer"),
		},
		"claude-supervisor": {
			extends: "claude",
			label: "Claude Supervisor",
			description:
				"Governance observer. Uses the role-gated Paseo CLI monitoring/recovery surface.",
			command: ["claude"],
			env: env("supervisor"),
		},
	};
}

const obsoletePreferences = [
	"When list_profiles is available, treat a complete profile whose provider matches the chosen claude role as a human-authored route candidate. Notes are advisory; validate model, thinking, mode, and features through discovery, copy the fields into create_agent, and post-verify runtime state. Never silently repair a stale profile.",
	"Discover provider/model availability on the target Paseo daemon with list_providers/list_models before creating an agent. Pin the exact model and settings.thinkingOptionId via get_agent_status. Never silently fall back.",
];

const defaultPreferences = {
	providers: {
		impl: "claude-worker",
		ui: "claude-worker",
		research: "claude-reviewer",
		planning: "claude-lead",
		audit: "claude-reviewer",
	},
	preferences: [
		"Use claude-lead for decomposition and acceptance, claude-worker for bounded writes in the current workspace, and claude-reviewer for fresh review of an exact candidate SHA when available or the current working diff otherwise.",
		"Use Vietnamese for every user-facing response and every agent-to-agent prompt, message, report, review, and handoff. Preserve code, commands, paths, identifiers, protocol fields, quoted logs/errors, and machine-readable tokens. A specific explicit Human language request overrides this only for that output.",
		"Same-family routing is mandatory by default: a Claude Lead routes to claude-* role providers. Use pi-* or codex-* only when the Human explicitly requests that provider family for the delegation. If the required Claude role is unavailable, block and ask; profile availability or model ranking never authorizes cross-family substitution.",
		"Agent Profiles remain Human launch presets; CLI orchestration does not infer routes from them. Discover provider/model/thinking availability with `paseo-team providers` and `paseo-team models`, pin every value on `paseo-team run`, and post-verify with `paseo-team inspect`. Never silently fall back.",
		"Use only the role-gated `paseo-team` facade for orchestration. Do not call raw `paseo`, MCP, native subagents, or a private task database.",
		"Use the current Paseo workspace by default. Never create a new workspace or worktree unless the Human explicitly requests it. Keep at most one active writer in a shared workspace. Do not use claude-supervisor in ordinary single-task flows.",
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

/** Recursively sync a source directory into target, per file. */
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
 * Create a symlink target -> source, failing closed if a different link/file
 * occupies target (unless --force). source must already exist.
 */
async function installSymlink(source, target, label) {
	if (!(await exists(source))) {
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

	// Role-owned files (CLAUDE.md and settings.json). Orchestration is CLI-only;
	// no role receives an MCP configuration.
	for (const file of ["CLAUDE.md", "settings.json"]) {
		const src = path.join(sourceRole, file);
		if (await exists(src)) {
			const mode = file.endsWith(".json") ? 0o600 : undefined;
			await installOwnedFile(src, path.join(roleHome, file), mode);
		}
	}

	// Install the canonical brief at a deterministic runtime path. The Lead must
	// read $CLAUDE_CONFIG_DIR/templates/TASK_BRIEF_V3.md, never search $HOME.
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

	// Shared policy hooks live in one place; copy them into the role so the
	// settings.json hook command "${CLAUDE_CONFIG_DIR}/hooks/<script>.mjs"
	// resolves. Copying (not symlinking) keeps relative imports intact and
	// survives the source repo moving.
	await installOwnedDir(sourceSharedHooks, path.join(roleHome, "hooks"));

	// Shared credentials: Claude Code on Linux/Windows stores them in
	// CLAUDE_CONFIG_DIR/.credentials.json. Symlink the default dir's file so
	// every role shares one login. Best-effort: on macOS the keychain holds
	// credentials (no file) — set ANTHROPIC_API_KEY in the provider env or run
	// `claude` once per role home.
	await installSymlink(
		path.join(claudeConfigDir, ".credentials.json"),
		path.join(roleHome, ".credentials.json"),
		"credentials",
	);
}

async function checkPrereqs() {
	const problems = [];
	for (const bin of ["claude", "paseo"]) {
		if (!existsSyncSync(await which(bin))) {
			problems.push(`${bin} is not on PATH`);
		}
	}
	const credPath = path.join(claudeConfigDir, ".credentials.json");
	if (!existsSyncSync(credPath)) {
		problems.push(
			`${credPath} not found (role homes will not share a login). On macOS credentials live in the Keychain — set ANTHROPIC_API_KEY in the provider env, or run \`claude\` once per role home.`,
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
		`Agent Profiles: Claude host default ${profileDefault.model}${profileDefault.thinkingOptionId ? ` (${profileDefault.thinkingOptionId})` : ""}`,
	);

	const injectedAuth = Object.keys(authEnv());
	if (injectedAuth.length > 0) {
		console.log(
			`note: forwarding Claude Code auth env (${injectedAuth.join(", ")}) into each claude-* provider. Values are stored literally in ~/.paseo/config.json (mode 0600). Re-run after rotating a token.`,
		);
	} else {
		console.warn(
			"warning: no ANTHROPIC_API_KEY/AUTH_TOKEN/BASE_URL found in this shell's env — spawned claude agents will have no auth and will fall back to ~/.claude/.credentials.json (often expired for custom backends). Export your claude auth env and re-run.",
		);
	}

	for (const role of roles) {
		console.log(`\n== role: ${role} ==`);
		await installRole(role);
	}

	console.log(`\n== role-gated Paseo CLI ==`);
	await installOwnedFile(sourceTeamCli, targetTeamCli, 0o755);
	await retireOwnedFile(path.join(paseoBin, "claude-role-app-server"), "Claude MCP launcher");
	await retireOwnedFile(path.join(paseoBin, "claude-readonly-app-server"), "Claude compatibility launcher");

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
			: "Claude Code profiles installed. Paseo daemon was NOT restarted.",
	);
	console.log("Finish active agents before refreshing/restarting Paseo.");
	console.log("Then verify with: paseo provider ls --json");
	console.log("And: paseo provider models claude-lead --json");
	console.log(
		dryRun
			? "Managed Claude Agent Profiles would be merged; Human-owned profiles would be preserved."
			: "Managed Claude Agent Profiles were merged; Human-owned profiles were preserved.",
	);
	if (problems.length) {
		console.log("\nResolve the warnings above before relying on the pack.");
	}
}

main().catch((error) => {
	console.error(`claude-orchestration install: ${error.message}`);
	process.exit(1);
});
