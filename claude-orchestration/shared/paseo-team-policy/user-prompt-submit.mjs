#!/usr/bin/env node

/**
 * user-prompt-submit.mjs — Claude Code UserPromptSubmit hook entry.
 *
 * Registered in each role's settings.json as:
 *   "UserPromptSubmit": [{ "hooks": [{ "type": "command",
 *                                      "command": "node \"${CLAUDE_CONFIG_DIR}/hooks/user-prompt-submit.mjs\"" }] }]
 *
 * This is the Claude Code analog of the Pi extension's `before_agent_start`
 * brief re-parse. Every user prompt (including each `send_agent_prompt` from
 * the Lead, and the initial create_agent prompt) fires this hook. We parse the
 * strict V3 marker block out of the prompt and persist it to a per-session
 * state file; pre-tool-use.mjs reads it to derive the worker's authority for
 * the current turn. This makes write authority non-sticky across turns — a turn
 * without a valid V3 brief resolves read-only.
 *
 * The hook never blocks; it only records state. (Parsing failures are stored as
 * a malformed brief → read-only downstream.)
 */

import { readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseTaskBrief, serializeBrief } from "./brief.mjs";

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
	const safe = String(sessionId ?? "default").replace(/[^A-Za-z0-9_-]/g, "_");
	return path.join(stateDir(), `brief-${safe}.json`);
}

async function main() {
	const raw = await readStdin();
	let event = {};
	try {
		event = raw.trim() ? JSON.parse(raw) : {};
	} catch {
		// Cannot read the prompt — leave existing state untouched and allow.
		process.exit(0);
	}

	// Claude Code UserPromptSubmit payload carries the submitted text in `prompt`.
	const prompt = typeof event.prompt === "string" ? event.prompt : "";
	const brief = parseTaskBrief(prompt);
	const sessionId = event.session_id ?? "default";

	await mkdir(stateDir(), { recursive: true });
	await writeFile(
		statePath(sessionId),
		`${JSON.stringify(serializeBrief(brief))}\n`,
		"utf8",
	);
	process.exit(0);
}

main().catch((error) => {
	// Recording state must never block the agent.
	process.stderr.write(
		`paseo-team-policy (user-prompt-submit): ${error?.message ?? error}\n`,
	);
	process.exit(0);
});
