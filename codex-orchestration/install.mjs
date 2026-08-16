#!/usr/bin/env node

import {
	chmod,
	copyFile,
	lstat,
	mkdir,
	readFile,
	readlink,
	rename,
	stat,
	symlink,
	writeFile,
} from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
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
	console.error("Usage: node codex-orchestration/install.mjs [--dry-run] [--force]");
	process.exit(2);
}

// This installer lives inside codex-orchestration/, so the pack root is its own
// directory and profiles/ + bin/ sit next to it.
const packRoot = path.dirname(fileURLToPath(import.meta.url));
const sourceProfiles = path.join(packRoot, "profiles");
const sourceLauncher = path.join(packRoot, "bin", "codex-role-app-server");
const codexHome = path.resolve(
	process.env.CODEX_HOME || path.join(homedir(), ".codex"),
);
const paseoHome = path.resolve(
	process.env.PASEO_HOME || path.join(homedir(), ".paseo"),
);
const rolesHome = path.resolve(
	process.env.PASEO_CODEX_ROLES_HOME ||
		path.join(homedir(), ".codex-paseo"),
);
const paseoBin = path.join(paseoHome, "bin");
const targetLauncher = path.join(paseoBin, "codex-role-app-server");
const paseoConfigPath = path.join(paseoHome, "config.json");
const preferencesPath = path.join(
	paseoHome,
	"orchestration-preferences.json",
);
const stamp = new Date().toISOString().replaceAll(/[:.]/g, "-");

const profileNames = [
	"paseo-lead",
	"paseo-worker",
	"paseo-reviewer",
	"paseo-supervisor",
];

const roleByProfile = {
	"paseo-lead": "lead",
	"paseo-worker": "worker",
	"paseo-reviewer": "reviewer",
	"paseo-supervisor": "supervisor",
};

function providerConfig() {
	return {
		"codex-lead": {
			extends: "codex",
			label: "Codex Lead",
			description:
				"Full-access orchestration owner governed by developer instructions",
			command: [targetLauncher],
			env: {
				CODEX_HOME: path.join(rolesHome, "lead"),
				PASEO_MCP_ACCESS: "lead",
			},
		},
		"codex-worker": {
			extends: "codex",
			label: "Codex Worker",
			description:
				"Full-access implementation agent bounded by its Task Brief",
			command: ["codex"],
			env: { CODEX_HOME: path.join(rolesHome, "worker") },
		},
		"codex-reviewer": {
			extends: "codex",
			label: "Codex Reviewer",
			description:
				"Full-access runtime with behaviorally read-only review instructions",
			command: ["codex"],
			env: { CODEX_HOME: path.join(rolesHome, "reviewer") },
		},
		"codex-supervisor": {
			extends: "codex",
			label: "Codex Supervisor",
			description:
				"Full-access governance observer with instruction-gated recovery",
			command: [targetLauncher],
			env: {
				CODEX_HOME: path.join(rolesHome, "supervisor"),
				PASEO_MCP_ACCESS: "supervisor",
			},
		},
	};
}

const defaultPreferences = {
	providers: {
		impl: "codex-worker/gpt-5.6-luna",
		ui: "codex-worker/gpt-5.6-luna",
		research: "codex-reviewer/gpt-5.6-luna",
		planning: "codex-lead/gpt-5.6-sol",
		audit: "codex-reviewer/gpt-5.6-luna",
	},
	preferences: [
		"Use codex-lead for decomposition and acceptance, codex-worker for bounded writes in the current workspace, and codex-reviewer for fresh review of an exact candidate SHA when available or the current working diff otherwise.",
		"Use Vietnamese for every user-facing response and every agent-to-agent prompt, message, report, review, and handoff. Preserve code, commands, paths, identifiers, protocol fields, quoted logs/errors, and machine-readable tokens. A specific explicit Human language request overrides this only for that output.",
		"Same-family routing is mandatory by default: a Codex Lead routes to codex-* role providers. Use pi-* or claude-* only when the Human explicitly requests that provider family for the delegation. If the required Codex role is unavailable, block and ask; profile availability or model ranking never authorizes cross-family substitution.",
		"When list_profiles is available, treat a complete profile whose provider matches the chosen codex role as a human-authored route candidate. Notes are advisory; validate model, thinking, mode, and features through discovery, copy the fields into create_agent, and post-verify runtime state. Never silently repair a stale profile.",
		"For impl and ui agents, use codex-worker/gpt-5.6-luna with thinkingOptionId max. Luna max is the required default, not an optional downgrade.",
		"For research and audit agents, use codex-reviewer/gpt-5.6-luna with thinkingOptionId max. Luna max is the required Reviewer default, not an optional downgrade.",
		"Discover provider/model availability on the target Paseo daemon before creating an agent. Never silently fall back.",
		"Use the current Paseo workspace by default. Never create a new workspace or worktree unless the Human explicitly requests it. Keep at most one active writer in a shared workspace. Do not use codex-supervisor in ordinary single-task flows.",
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

function splitProjectTrustTail(text) {
	const lines = text.split("\n");
	const projectIndex = lines.findIndex((line) => /^\[projects\./.test(line));
	if (projectIndex === -1) {
		return { owned: text, projectTrust: "" };
	}
	return {
		owned: `${lines.slice(0, projectIndex).join("\n").trimEnd()}\n`,
		projectTrust: `${lines.slice(projectIndex).join("\n").trimEnd()}\n`,
	};
}

async function installRoleConfig(source, target) {
	const sourceText = await readFile(source, "utf8");
	let projectTrust = "";
	if (await exists(target)) {
		const targetText = await readFile(target, "utf8");
		const split = splitProjectTrustTail(targetText);
		projectTrust = split.projectTrust;
		if (split.owned === sourceText) {
			console.log(
				`unchanged: ${target}${projectTrust ? " (preserved local project trust)" : ""}`,
			);
			return;
		}
		if (!force) {
			throw new Error(
				`Refusing to overwrite ${target}; rerun with --force after review`,
			);
		}
		await backup(target);
	}
	const desired = projectTrust
		? `${sourceText.trimEnd()}\n\n${projectTrust}`
		: sourceText;
	if (!dryRun) {
		await mkdir(path.dirname(target), { recursive: true });
		await writeFile(target, desired, { encoding: "utf8", mode: 0o600 });
	}
	console.log(
		`${dryRun ? "would install" : "installed"}: ${target}${projectTrust ? " (preserved local project trust)" : ""}`,
	);
}

async function installAuthLink(roleHome) {
	const source = path.join(codexHome, "auth.json");
	const target = path.join(roleHome, "auth.json");
	if (!(await exists(source))) {
		console.log(`auth not linked (run codex login first): ${source}`);
		return;
	}
	try {
		const info = await lstat(target);
		if (info.isSymbolicLink()) {
			const link = await readlink(target);
			if (path.resolve(roleHome, link) === source) {
				console.log(`unchanged: ${target} -> ${source}`);
				return;
			}
		}
		throw new Error(
			`Refusing to replace existing role auth path ${target}; inspect it manually`,
		);
	} catch (error) {
		if (error?.code !== "ENOENT") throw error;
	}
	if (!dryRun) {
		await mkdir(roleHome, { recursive: true });
		await symlink(source, target);
	}
	console.log(`${dryRun ? "would link" : "linked"}: ${target} -> ${source}`);
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

async function main() {
	for (const profile of profileNames) {
		const source = path.join(sourceProfiles, `${profile}.config.toml`);
		await installOwnedFile(
			source,
			path.join(codexHome, `${profile}.config.toml`),
		);
		const roleHome = path.join(rolesHome, roleByProfile[profile]);
		await installRoleConfig(source, path.join(roleHome, "config.toml"));
		await installAuthLink(roleHome);
	}
	await installOwnedFile(sourceLauncher, targetLauncher, 0o755);

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
			: "Profiles installed. Paseo daemon was NOT restarted.",
	);
	console.log("Finish active agents before refreshing/restarting Paseo.");
	console.log("Then verify with: paseo provider ls --json");
	console.log("And: paseo provider models codex-lead --json");
	console.log(
		"Then create host Agent Profiles in Settings → Host → Agents; this installer preserves daemon.agentProfiles.",
	);
}

main().catch((error) => {
	console.error(`codex-orchestration install: ${error.message}`);
	process.exit(1);
});
