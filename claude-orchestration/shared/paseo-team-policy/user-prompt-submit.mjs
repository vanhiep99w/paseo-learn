#!/usr/bin/env node

/**
 * user-prompt-submit.mjs — Claude Code UserPromptSubmit hook entry.
 *
 * The Worker authority state is replaced atomically on every submitted prompt.
 * A prompt without a valid V3 brief records read-only state. If the hook cannot
 * parse its event or persist the replacement state, it blocks that Worker turn
 * (exit 2) instead of leaving an earlier write grant active.
 */

import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
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
	const key = createHash("sha256").update(String(sessionId ?? "default")).digest("hex");
	return path.join(stateDir(), `brief-${key}.json`);
}

async function storeBrief(sessionId, brief) {
	const dir = stateDir();
	const target = statePath(sessionId);
	const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
	await mkdir(dir, { recursive: true, mode: 0o700 });
	try {
		await writeFile(temp, `${JSON.stringify(serializeBrief(brief))}\n`, {
			encoding: "utf8",
			mode: 0o600,
			flag: "wx",
		});
		await rename(temp, target);
	} finally {
		await rm(temp, { force: true }).catch(() => {});
	}
}

async function main() {
	// Only Worker authority is turn-scoped. Avoid making unrelated roles depend
	// on writable temporary storage.
	if (process.env.PASEO_CLAUDE_ROLE?.trim().toLowerCase() !== "worker") {
		process.exit(0);
	}

	const raw = await readStdin();
	let event;
	try {
		event = raw.trim() ? JSON.parse(raw) : null;
	} catch {
		process.stderr.write(
			"paseo-team-policy: invalid UserPromptSubmit event; blocking Worker turn fail-closed.\n",
		);
		process.exit(2);
	}
	if (typeof event !== "object" || event === null || typeof event.session_id !== "string") {
		process.stderr.write(
			"paseo-team-policy: UserPromptSubmit event has no session_id; blocking Worker turn fail-closed.\n",
		);
		process.exit(2);
	}

	const prompt = typeof event.prompt === "string" ? event.prompt : "";
	await storeBrief(event.session_id, parseTaskBrief(prompt));
	process.exit(0);
}

main().catch((error) => {
	process.stderr.write(
		`paseo-team-policy (user-prompt-submit): could not replace Worker authority state; turn blocked: ${error?.message ?? error}\n`,
	);
	process.exit(2);
});
