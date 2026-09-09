#!/usr/bin/env node

import {
	chmod,
	copyFile,
	lstat,
	mkdir,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const target = argv.find((arg) => !arg.startsWith("-"));
const flags = new Set(argv.filter((arg) => arg.startsWith("-")));
const allowedFlags = new Set(["--dry-run", "--apply", "--force", "--purge-role-homes"]);
const unknownFlags = [...flags].filter((flag) => !allowedFlags.has(flag));
const extraTargets = argv.filter((arg) => !arg.startsWith("-")).slice(1);

if (!target || !["codex", "pi", "claude", "all"].includes(target) || unknownFlags.length || extraTargets.length) {
	console.error("Usage: scripts/uninstall.mjs <codex|pi|claude|all> [--dry-run|--apply] [--force] [--purge-role-homes]");
	process.exit(2);
}
if (flags.has("--dry-run") && flags.has("--apply")) {
	console.error("uninstall: choose either --dry-run or --apply");
	process.exit(2);
}
if (flags.has("--purge-role-homes") && !flags.has("--apply")) {
	console.error("uninstall: --purge-role-homes requires --apply");
	process.exit(2);
}
if (flags.has("--purge-role-homes") && !flags.has("--force")) {
	console.error("uninstall: --purge-role-homes also requires --force because it deletes role-local sessions and credentials");
	process.exit(2);
}

const apply = flags.has("--apply");
const force = flags.has("--force");
const purgeRoleHomes = flags.has("--purge-role-homes");
const families = target === "all" ? ["codex", "pi", "claude"] : [target];
const home = path.resolve(process.env.HOME || homedir());
const paseoHome = path.resolve(process.env.PASEO_HOME || path.join(home, ".paseo"));
const codexHome = path.resolve(process.env.CODEX_HOME || path.join(home, ".codex"));
const piAgentDir = path.resolve(process.env.PI_CODING_AGENT_DIR || path.join(home, ".pi", "agent"));
const claudeConfigDir = path.resolve(process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"));
const configPath = path.join(paseoHome, "config.json");
const preferencesPath = path.join(paseoHome, "orchestration-preferences.json");
const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");

const specs = {
	codex: {
		rolesHome: path.resolve(process.env.PASEO_CODEX_ROLES_HOME || path.join(home, ".codex-paseo")),
		launcher: {
			target: path.join(paseoHome, "bin", "codex-role-app-server"),
			source: path.join(repoRoot, "codex-orchestration", "bin", "codex-role-app-server"),
		},
		managedFiles: ["lead", "peer", "supervisor"].map((role) => ({
			target: path.join(codexHome, `paseo-${role}.config.toml`),
			source: path.join(repoRoot, "codex-orchestration", "profiles", `paseo-${role}.config.toml`),
			label: `Codex ${role} global profile`,
		})),
	},
	pi: {
		rolesHome: path.resolve(process.env.PASEO_PI_ROLES_HOME || path.join(home, ".pi-paseo")),
		launcher: {
			target: path.join(paseoHome, "bin", "pi-role-app-server"),
			source: path.join(repoRoot, "pi-orchestration", "bin", "pi-role-app-server"),
		},
		managedFiles: [{
			target: path.join(paseoHome, "packs", "pi-orchestration", "paseo-team-policy.ts"),
			source: path.join(repoRoot, "pi-orchestration", "shared", "paseo-team-policy.ts"),
			label: "installed Pi policy",
		}],
	},
	claude: {
		rolesHome: path.resolve(process.env.PASEO_CLAUDE_ROLES_HOME || path.join(home, ".claude-paseo")),
		launcher: {
			target: path.join(paseoHome, "bin", "claude-role-app-server"),
			source: path.join(repoRoot, "claude-orchestration", "bin", "claude-role-app-server"),
		},
		managedFiles: [],
	},
};

const sharedPreferences = new Set([
	"Use Vietnamese for every user-facing response and every agent-to-agent prompt, message, report, review, and handoff. Preserve code, commands, paths, identifiers, protocol fields, quoted logs/errors, and machine-readable tokens. A specific explicit Human language request overrides this only for that output.",
	"Discover provider/model availability on the target Paseo daemon with list_providers/list_models before creating an agent. Pin the exact model and settings.thinkingOptionId via get_agent_status. Never silently fall back.",
	"Discover provider/model availability on the target Paseo daemon before creating an agent. Never silently fall back.",
]);

function isPackPreference(value, family) {
	if (typeof value !== "string") return false;
	const title = family[0].toUpperCase() + family.slice(1);
	return value.startsWith(`Use ${family}-lead for topology`) ||
		value.startsWith(`Same-family routing is mandatory by default: a ${title} Lead`) ||
		value.startsWith(`When list_profiles is available, treat a complete profile whose provider matches the chosen ${family} role`) ||
		value.startsWith(`For every Peer disposition, use ${family}-peer`) ||
		(value.startsWith("Every subagent must inherit the Lead current workspace") && value.includes(`${family}-supervisor`));
}

async function exists(pathname) {
	try {
		await lstat(pathname);
		return true;
	} catch (error) {
		if (error?.code === "ENOENT") return false;
		throw error;
	}
}

async function readJsonIfPresent(pathname) {
	try {
		const info = await lstat(pathname);
		if (!info.isFile() || info.isSymbolicLink()) {
			throw new Error(`Refusing redirected or non-regular JSON path: ${pathname}`);
		}
		return JSON.parse(await readFile(pathname, "utf8"));
	} catch (error) {
		if (error?.code === "ENOENT") return null;
		if (error?.message?.startsWith("Refusing redirected")) throw error;
		throw new Error(`Cannot parse ${pathname}: ${error.message}`);
	}
}

function mutateConfig(input) {
	if (input === null) return null;
	const config = structuredClone(input);
	const providers = config.agents?.providers;
	if (providers && typeof providers === "object" && !Array.isArray(providers)) {
		for (const family of families) {
			for (const role of ["lead", "peer", "supervisor", "worker", "reviewer"]) {
				delete providers[`${family}-${role}`];
			}
		}
	}
	const profiles = config.daemon?.agentProfiles;
	if (Array.isArray(profiles)) {
		config.daemon.agentProfiles = profiles.filter((profile) => {
			const id = typeof profile?.id === "string" ? profile.id : "";
			return !families.some((family) => id.startsWith(`paseo-learn:${family}:`));
		});
	}
	return config;
}

function hasManagedProviders(config) {
	const providers = config?.agents?.providers;
	if (!providers || typeof providers !== "object" || Array.isArray(providers)) return false;
	return ["codex", "pi", "claude"].some((family) =>
		["lead", "peer", "supervisor", "worker", "reviewer"].some((role) => `${family}-${role}` in providers),
	);
}

function mutatePreferences(input, nextConfig) {
	if (input === null) return null;
	const preferences = structuredClone(input);
	if (preferences.providers && typeof preferences.providers === "object" && !Array.isArray(preferences.providers)) {
		for (const [category, route] of Object.entries(preferences.providers)) {
			if (typeof route !== "string") continue;
			if (families.some((family) => new RegExp(`^${family}-(?:lead|peer|supervisor|worker|reviewer)(?:/|$)`).test(route))) {
				delete preferences.providers[category];
			}
		}
	}
	if (Array.isArray(preferences.preferences)) {
		const removeShared = !hasManagedProviders(nextConfig);
		preferences.preferences = preferences.preferences.filter((value) =>
			!families.some((family) => isPackPreference(value, family)) &&
			!(removeShared && sharedPreferences.has(value)),
		);
	}
	return preferences;
}

function renderJson(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

async function jsonOperation(pathname, current, next, label) {
	if (current === null || renderJson(current) === renderJson(next)) return null;
	return { kind: "json", path: pathname, content: renderJson(next), label };
}

async function managedFileOperation(item) {
	if (!(await exists(item.target))) return null;
	const info = await lstat(item.target);
	if (!info.isFile() || info.isSymbolicLink()) {
		return { kind: "preserve", path: item.target, label: `${item.label}: non-regular or redirected path` };
	}
	let matches = false;
	try {
		matches = (await readFile(item.target)).equals(await readFile(item.source));
	} catch {
		matches = false;
	}
	if (matches) return { kind: "remove", path: item.target, label: item.label };
	return force
		? { kind: "remove-modified", path: item.target, label: item.label }
		: { kind: "preserve", path: item.target, label: `${item.label}: differs from current managed source; rerun with --force after review` };
}

async function backup(pathname) {
	const target = `${pathname}.paseo-learn-uninstall.${stamp}.bak`;
	await copyFile(pathname, target);
	await chmod(target, 0o600);
	return target;
}

async function writeJsonAtomic(operation) {
	await mkdir(path.dirname(operation.path), { recursive: true });
	const backupPath = await backup(operation.path);
	const temp = `${operation.path}.tmp.${process.pid}`;
	await writeFile(temp, operation.content, { encoding: "utf8", mode: 0o600, flag: "wx" });
	await rename(temp, operation.path);
	console.log(`updated: ${operation.path} (backup: ${backupPath})`);
}

function pathIsWithin(root, candidate) {
	const relative = path.relative(root, candidate);
	return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertSafePurgeRoot(root) {
	if (!pathIsWithin(home, root) || root === home || root === path.parse(root).root) {
		throw new Error(`Refusing role-home purge outside the user home: ${root}`);
	}
	for (const protectedPath of [paseoHome, codexHome, piAgentDir, claudeConfigDir, repoRoot]) {
		if (pathIsWithin(protectedPath, root) || pathIsWithin(root, protectedPath)) {
			throw new Error(`Refusing role-home purge overlapping protected path ${protectedPath}: ${root}`);
		}
	}
}

async function purgeOperations(family) {
	const root = specs[family].rolesHome;
	assertSafePurgeRoot(root);
	if (!(await exists(root))) return [];
	const rootInfo = await lstat(root);
	if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
		throw new Error(`Refusing redirected or non-directory role-home root: ${root}`);
	}
	const operations = [];
	for (const role of ["lead", "peer", "supervisor", "worker", "reviewer"]) {
		const rolePath = path.join(root, role);
		if (await exists(rolePath)) operations.push({ kind: "purge", path: rolePath, label: `${family} ${role} role home` });
	}
	return operations;
}

async function main() {
	// Parse all mutable JSON before planning file removals, so invalid config
	// fails before any uninstall side effect.
	const currentConfig = await readJsonIfPresent(configPath);
	const currentPreferences = await readJsonIfPresent(preferencesPath);
	const nextConfig = mutateConfig(currentConfig);
	const nextPreferences = mutatePreferences(currentPreferences, nextConfig);
	const operations = [];
	const configOp = await jsonOperation(configPath, currentConfig, nextConfig, "Paseo providers and Agent Profiles");
	if (configOp) operations.push(configOp);
	const preferencesOp = await jsonOperation(preferencesPath, currentPreferences, nextPreferences, "orchestration preferences");
	if (preferencesOp) operations.push(preferencesOp);

	for (const family of families) {
		const spec = specs[family];
		const launcherOp = await managedFileOperation({ ...spec.launcher, label: `${family} launcher` });
		if (launcherOp) operations.push(launcherOp);
		for (const item of spec.managedFiles) {
			const operation = await managedFileOperation(item);
			if (operation) operations.push(operation);
		}
		if (purgeRoleHomes) operations.push(...await purgeOperations(family));
	}

	console.log(`Paseo Learn uninstall target: ${target}`);
	console.log(`Mode: ${apply ? "apply" : "dry-run"}`);
	if (!purgeRoleHomes) {
		console.log("Role homes are preserved so sessions, credentials, and user-added files remain recoverable.");
	}
	if (operations.length === 0) {
		console.log("Nothing to uninstall.");
		return;
	}

	for (const operation of operations) {
		if (operation.kind === "preserve") {
			console.warn(`preserve: ${operation.path} (${operation.label})`);
			continue;
		}
		if (!apply) {
			console.log(`would ${operation.kind === "json" ? "update" : operation.kind === "purge" ? "purge" : "remove"}: ${operation.path} (${operation.label})`);
			continue;
		}
		if (operation.kind === "json") {
			await writeJsonAtomic(operation);
		} else if (operation.kind === "remove-modified") {
			const backupPath = await backup(operation.path);
			await rm(operation.path, { recursive: true, force: true });
			console.log(`removed modified managed path: ${operation.path} (backup: ${backupPath})`);
		} else if (operation.kind === "remove") {
			await rm(operation.path, { force: true });
			console.log(`removed: ${operation.path}`);
		} else if (operation.kind === "purge") {
			await rm(operation.path, { recursive: true, force: true });
			console.log(`purged: ${operation.path}`);
		}
	}

	if (apply) {
		for (const family of families) {
			if (!purgeRoleHomes) console.log(`preserved role home: ${specs[family].rolesHome}`);
		}
		console.log("Paseo daemon was NOT restarted. Finish active agents, then restart Paseo manually.");
	}
}

main().catch((error) => {
	console.error(`paseo-learn uninstall: ${error.message}`);
	process.exit(1);
});
