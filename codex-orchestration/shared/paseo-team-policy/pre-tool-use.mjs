#!/usr/bin/env node
/** Codex PreToolUse hook: deny policy violations with the documented JSON shape. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectRole, blockReasonForTool } from "./policy.mjs";
import { deserializeBrief } from "./brief.mjs";
function statePath(sessionId) { return path.join(tmpdir(), "paseo-codex", `brief-${createHash("sha256").update(String(sessionId ?? "default")).digest("hex")}.json`); }
async function main() {
 const role = detectRole(); if (!role) process.exit(0);
 let event; try { const raw = await new Promise((resolve, reject) => { let d=""; process.stdin.setEncoding("utf8"); process.stdin.on("data", c=>d+=c); process.stdin.on("end",()=>resolve(d)); process.stdin.on("error",reject); }); event = raw.trim() ? JSON.parse(raw) : {}; } catch { process.stderr.write("paseo-team-policy: invalid PreToolUse event; blocking fail-closed.\n"); process.exit(2); }
 let brief = null; try { brief = deserializeBrief(JSON.parse(await readFile(statePath(event.session_id ?? "default"), "utf8"))); } catch (error) { if (error?.code !== "ENOENT") throw error; }
 const reason = blockReasonForTool(role, brief, String(event.tool_name ?? ""), event.tool_input, typeof event.cwd === "string" ? event.cwd : process.cwd());
 if (reason) { process.stdout.write(JSON.stringify({hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:reason}})+"\n"); }
}
main().catch(error => { process.stderr.write(`paseo-team-policy (pre-tool-use): ${error?.message ?? error}\n`); process.exit(2); });
