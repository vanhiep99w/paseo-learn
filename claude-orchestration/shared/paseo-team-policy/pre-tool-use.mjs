#!/usr/bin/env node

/**
 * pre-tool-use.mjs — Claude Code PreToolUse hook entry.
 *
 * Registered in each role's settings.json as:
 *   "PreToolUse": [{ "matcher": "(Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit|Artifact|Agent|mcp__paseo__.*)",
 *                    "hooks": [{ "type": "command",
 *                                "command": "node \"${CLAUDE_CONFIG_DIR}/hooks/pre-tool-use.mjs\"" }] }]
 *
 * Claude Code feeds the event as JSON on stdin (fields: session_id, tool_name,
 * tool_input, cwd, ...). We read the worker brief from the per-session state
 * file written by user-prompt-submit.mjs, then ask policy.blockReasonForTool.
 * Block = write reason to stderr + exit 2 (stderr is fed back to Claude).
 *
 * When PASEO_CLAUDE_ROLE is unset the hook is passive (exit 0), so it is safe
 * to load in a non-team Claude Code session.
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectRole, blockReasonForTool } from "./policy.mjs";
import { deserializeBrief, serializeBrief } from "./brief.mjs";

/** @returns {Promise<string>} */
function readStdin() {
	return new Promise((resolve, reject) => {
		let data = "";
		process.stdin.setEncoding("utf8");
		process.stdin.on("data", (chunk) => {
			data += chunk;
		});
		process.stdin.on("end", () => resolve(data));
		process.stdin.on("error", reject);
	});
}

function stateDir() {
	return path.join(tmpdir(), "paseo-claude");
}

function statePath(sessionId) {
	// Sanitize the session id into a safe filename component.
	const safe = String(sessionId ?? "default").replace(/[^A-Za-z0-9_-]/g, "_");
	return path.join(stateDir(), `brief-${safe}.json`);
}

async function loadBrief(sessionId) {
	try {
		const text = await readFile(statePath(sessionId), "utf8");
		return deserializeBrief(JSON.parse(text));
	} catch (error) {
		if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") {
			return null; // No brief this turn → fail-closed read-only for workers.
		}
		throw error;
	}
}

async function main() {
	const role = detectRole();
	if (!role) {
		// Not a team role — passive. (PASEO_CLAUDE_ROLE unset.)
		process.exit(0);
	}

	const raw = await readStdin();
	let event = {};
	try {
		event = raw.trim() ? JSON.parse(raw) : {};
	} catch {
		// Unparseable event → fail-closed for write/shell/mcp tools.
		process.stderr.write(
			"paseo-team-policy: could not parse PreToolUse event — blocking fail-closed.\n",
		);
		process.exit(2);
	}

	const sessionId = event.session_id ?? "default";
	const brief = await loadBrief(sessionId);

	const reason = blockReasonForTool(
		role,
		brief,
		String(event.tool_name ?? ""),
		event.tool_input,
	);

	if (reason) {
		process.stderr.write(`${reason}\n`);
		process.exit(2);
	}
	process.exit(0);
}

main().catch((error) => {
	process.stderr.write(`paseo-team-policy (pre-tool-use): ${error?.message ?? error}\n`);
	process.exit(2);
});
