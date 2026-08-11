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
 *   - the launcher claude-role-app-server is copied to ~/.paseo/bin;
 *   - four providers (claude-lead/worker/reviewer/supervisor) are merged into
 *     ~/.paseo/config.json with daemon.mcp.injectIntoAgents=false;
 *   - ~/.paseo/orchestration-preferences.json is merged (discovery-oriented,
 *     no pinned models — Claude model availability is account/plan-specific).
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
const sourceLauncher = path.join(packRoot, "bin", "claude-role-app-server");

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
const targetLauncher = path.join(paseoBin, "claude-role-app-server");
const paseoConfigPath = path.join(paseoHome, "config.json");
const preferencesPath = path.join(paseoHome, "orchestration-preferences.json");
const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");

const roles = ["lead", "worker", "reviewer", "supervisor"];

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
		...authEnv(),
	});
	return {
		"claude-lead": {
			extends: "claude",
			label: "Claude Lead",
			description:
				"Orchestration owner. Gets the full Paseo MCP catalog via the launcher; bounded by CLAUDE.md and the policy hooks.",
			command: [targetLauncher],
			env: { ...env("lead"), PASEO_MCP_ACCESS: "lead" },
		},
		"claude-worker": {
			extends: "claude",
			label: "Claude Worker",
			description:
				"Bounded implementation agent. No Paseo MCP; write/commit/push authority comes only from the current-turn Task Brief.",
			command: ["claude"],
			env: env("worker"),
		},
		"claude-reviewer": {
			extends: "claude",
			label: "Claude Reviewer",
			description:
				"Independent review. No Paseo MCP; behaviorally read-only on an exact candidate SHA or the current working diff.",
			command: ["claude"],
			env: env("reviewer"),
		},
		"claude-supervisor": {
			extends: "claude",
			label: "Claude Supervisor",
			description:
				"Governance observer. Gets a read-only allowlist of Paseo MCP tools; instruction-gated recovery only.",
			command: [targetLauncher],
			env: { ...env("supervisor"), PASEO_MCP_ACCESS: "supervisor" },
		},
	};
}

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
		"Discover provider/model availability on the target Paseo daemon with list_providers/list_models before creating an agent. Pin the exact model and settings.thinkingOptionId via get_agent_status. Never silently fall back.",
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

	// Role-owned files (CLAUDE.md, settings.json). mcp.json is NOT used: the
	// launcher injects the paseo MCP server via an inline --mcp-config JSON.
	for (const file of ["CLAUDE.md", "settings.json"]) {
		const src = path.join(sourceRole, file);
		if (await exists(src)) {
			const mode = file.endsWith(".json") ? 0o600 : undefined;
			await installOwnedFile(src, path.join(roleHome, file), mode);
		}
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

async function main() {
	const problems = await checkPrereqs();
	for (const problem of problems) {
		console.warn(`warning: ${problem}`);
	}

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

	console.log(`\n== launcher ==`);
	await installOwnedFile(sourceLauncher, targetLauncher, 0o755);

	console.log(`\n== paseo config ==`);
	const config = await readJsonOr(paseoConfigPath, {
		$schema: "https://paseo.sh/schemas/paseo.config.v1.json",
		version: 1,
	});
	config.version ??= 1;
	config.daemon ??= {};
	config.daemon.mcp ??= {};
	config.daemon.mcp.enabled = true;
	config.daemon.mcp.injectIntoAgents = false;
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
			: "Claude Code profiles installed. Paseo daemon was NOT restarted.",
	);
	console.log("Finish active agents before refreshing/restarting Paseo.");
	console.log("Then verify with: paseo provider ls --json");
	console.log("And: paseo provider models claude-lead --json");
	if (problems.length) {
		console.log("\nResolve the warnings above before relying on the pack.");
	}
}

main().catch((error) => {
	console.error(`claude-orchestration install: ${error.message}`);
	process.exit(1);
});
