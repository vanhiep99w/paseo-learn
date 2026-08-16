#!/usr/bin/env node
/** Codex UserPromptSubmit hook: replace Worker authority state every turn. */
import { createHash } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseTaskBrief, serializeBrief } from "./brief.mjs";
function target(sessionId) { return path.join(tmpdir(), "paseo-codex", `brief-${createHash("sha256").update(String(sessionId ?? "default")).digest("hex")}.json`); }
async function main() {
 if (process.env.PASEO_CODEX_ROLE?.trim().toLowerCase() !== "worker") process.exit(0);
 let event; try { const raw = await new Promise((resolve,reject)=>{let d="";process.stdin.setEncoding("utf8");process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>resolve(d));process.stdin.on("error",reject)}); event=raw.trim()?JSON.parse(raw):null; } catch { process.stderr.write("paseo-team-policy: invalid UserPromptSubmit event; blocking Worker turn fail-closed.\n"); process.exit(2); }
 if (!event || typeof event.session_id !== "string") { process.stderr.write("paseo-team-policy: UserPromptSubmit event has no session_id; blocking Worker turn fail-closed.\n"); process.exit(2); }
 const out=target(event.session_id), dir=path.dirname(out), tmp=`${out}.tmp-${process.pid}`; await mkdir(dir,{recursive:true,mode:0o700}); try { await writeFile(tmp,`${JSON.stringify(serializeBrief(parseTaskBrief(typeof event.prompt === "string" ? event.prompt : "")))}\n`,{encoding:"utf8",mode:0o600,flag:"wx"}); await rename(tmp,out); } finally { await rm(tmp,{force:true}).catch(()=>{}); }
}
main().catch(error=>{process.stderr.write(`paseo-team-policy (user-prompt-submit): ${error?.message ?? error}\n`);process.exit(2)});
