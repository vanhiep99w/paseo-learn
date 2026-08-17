#!/usr/bin/env node

/** Cross-platform dispatcher for the three self-contained role-pack installers. */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const installers = {
	codex: path.join(root, "codex-orchestration", "install.mjs"),
	pi: path.join(root, "pi-orchestration", "install.mjs"),
	claude: path.join(root, "claude-orchestration", "install.mjs"),
};

function usage() {
	console.log(`Usage:
  node install.mjs [codex|pi|claude|all] [--dry-run] [--force]
  ./install [codex|pi|claude|all] [--dry-run] [--force]       # macOS/Linux
  install.cmd [codex|pi|claude|all] [--dry-run] [--force]    # Windows

Targets:
  codex   Install the Codex role pack only.
  pi      Install the Pi role pack only.
  claude  Install the Claude Code role pack only.
  all     Install Codex, Pi, then Claude; stop on first failure.
  (none)  Interactive prompt.

Flags:
  --dry-run   Preview every change; write nothing.
  --force     Replace differing pack-owned files after backing them up.
  -h, --help  Show this help.`);
}

function parseArgs(argv) {
	let target = "";
	const flags = [];
	for (const arg of argv) {
		if (arg === "-h" || arg === "--help") return { help: true, target, flags };
		if (arg === "--dry-run" || arg === "--force") {
			if (!flags.includes(arg)) flags.push(arg);
			continue;
		}
		if (arg.startsWith("-")) throw new Error(`unknown flag ${arg}`);
		if (target) throw new Error(`unexpected extra argument ${JSON.stringify(arg)}`);
		target = arg;
	}
	return { help: false, target, flags };
}

async function chooseTarget() {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		throw new Error("a target is required in non-interactive mode");
	}
	console.log(`
  Paseo role pack installer
  Choose a pack:
    1) codex
    2) pi
    3) claude
    4) all
`);
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	try {
		while (true) {
			const answer = (await rl.question("Select [1-4]: ")).trim().toLowerCase();
			const choices = { "1": "codex", "2": "pi", "3": "claude", "4": "all" };
			const selected = choices[answer] || (["codex", "pi", "claude", "all"].includes(answer) ? answer : "");
			if (selected) return selected;
			console.error("Invalid choice; enter 1-4 or a pack name.");
		}
	} finally {
		rl.close();
	}
}

function runPack(pack, flags) {
	const installer = installers[pack];
	console.log(`\n▶ Installing ${pack} role pack`);
	if (!existsSync(installer)) {
		console.error(`Missing installer: ${installer}`);
		return false;
	}
	const result = spawnSync(process.execPath, [installer, ...flags], {
		cwd: root,
		stdio: "inherit",
		env: process.env,
	});
	if (result.error) {
		console.error(`install: cannot start ${pack} installer: ${result.error.message}`);
		return false;
	}
	return result.status === 0;
}

async function main() {
	let parsed;
	try {
		parsed = parseArgs(process.argv.slice(2));
	} catch (error) {
		console.error(`install: ${error.message}`);
		usage();
		return 2;
	}
	if (parsed.help) {
		usage();
		return 0;
	}
	const target = parsed.target || await chooseTarget();
	if (!Object.hasOwn(installers, target) && target !== "all") {
		console.error(`install: unknown target ${JSON.stringify(target)}`);
		usage();
		return 2;
	}
	const packs = target === "all" ? ["codex", "pi", "claude"] : [target];
	const results = new Map();
	for (const pack of packs) {
		const ok = runPack(pack, parsed.flags);
		results.set(pack, ok ? "ok" : "failed");
		if (!ok) break;
	}

	console.log("\nSummary:");
	for (const pack of packs) console.log(`  ${pack}: ${results.get(pack) || "skipped"}`);
	const failed = [...results.values()].includes("failed");
	if (failed && packs.length > 1) {
		console.log("Stopped before later pack(s) because a prior step failed.");
	}
	if (!failed && !parsed.flags.includes("--dry-run")) {
		console.log("\nPaseo daemon was NOT restarted.");
		console.log("Finish active agents, then: paseo daemon restart");
		console.log("Verify with: paseo provider ls --json");
	}
	return failed ? 1 : 0;
}

try {
	process.exitCode = await main();
} catch (error) {
	console.error(`install: ${error.message}`);
	process.exitCode = 1;
}
