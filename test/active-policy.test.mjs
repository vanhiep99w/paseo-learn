import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { parseTaskBrief, ownedScopeRoots } from "../claude-orchestration/shared/paseo-team-policy/brief.mjs";
import { blockReasonForTool, ownedScopeBlockReason } from "../claude-orchestration/shared/paseo-team-policy/policy.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const workspace = mkdtempSync(path.join(tmpdir(), "paseo-slp-scope-"));
mkdirSync(path.join(workspace, "src"));
const engineer = parseTaskBrief(`PASEO_TEAM_TASK_V3_BEGIN\nTASK_ID: T-1\nDISPOSITION: engineer\nMODE: write\nOWNED_SCOPE: src\nPASEO_TEAM_TASK_V3_END`);
const reviewer = parseTaskBrief(`PASEO_TEAM_TASK_V3_BEGIN\nTASK_ID: T-2\nDISPOSITION: reviewer\nMODE: read-only\nASSIGNED_CANDIDATE_SHA: abc\nPASEO_TEAM_TASK_V3_END`);
const bad = parseTaskBrief(`PASEO_TEAM_TASK_V3_BEGIN\nTASK_ID: T-3\nDISPOSITION: reviewer\nMODE: write\nOWNED_SCOPE: src\nPASEO_TEAM_TASK_V3_END`);
const simpleEngineer = parseTaskBrief("DISPOSITION: engineer\nViết tài liệu được giao.");
const simpleReviewer = parseTaskBrief("DISPOSITION: reviewer\nReview candidate được giao.");
assert.deepEqual(ownedScopeRoots(engineer), ["src"]);
assert.deepEqual(ownedScopeRoots(simpleEngineer), ["."]);
assert.equal(simpleEngineer.mode, "write");
assert.equal(simpleReviewer.mode, "read-only");
assert.equal(ownedScopeRoots(reviewer), null);
assert.match(bad.malformed.join(" "), /only for DISPOSITION: engineer/);
assert.equal(blockReasonForTool("peer", engineer, "Write", { file_path: "src/a.ts" }, workspace), null);
assert.match(blockReasonForTool("peer", engineer, "Write", { file_path: "README.md" }, workspace), /outside OWNED_SCOPE/);
assert.match(blockReasonForTool("peer", reviewer, "Write", { file_path: "src/a.ts" }, workspace), /read-only/);
assert.match(blockReasonForTool("peer", reviewer, "Bash", { command: "git status" }, workspace), /read-only/);
assert.match(blockReasonForTool("peer", engineer, "mcp__paseo__create_agent", {}, workspace), /cannot use Paseo/);
assert.match(ownedScopeBlockReason(engineer, "README.md", workspace), /outside OWNED_SCOPE/);
assert.equal(blockReasonForTool("peer", simpleEngineer, "Write", { file_path: "README.md" }, workspace), null);

for (const pack of ["pi-orchestration", "claude-orchestration"]) {
  const peer = pack === "pi-orchestration"
    ? path.join(repo, pack, "profiles", "peer", "AGENTS.md")
    : path.join(repo, pack, "profiles", "peer", "CLAUDE.md");
  const text = readFileSync(peer, "utf8");
  assert.match(text, /Contract: PASEO_LEARN_SLP 1\.0/);
  assert.match(text, /Role: Peer|Paseo role transport: Peer/);
  assert.ok(!text.includes("Role: Paseo Worker"));
}

const home = mkdtempSync(path.join(tmpdir(), "paseo-pi-slp-"));
const paseoHome = path.join(home, ".paseo");
mkdirSync(paseoHome, { recursive: true });
writeFileSync(path.join(paseoHome, "config.json"), JSON.stringify({ version: 1, daemon: { agentProfiles: [{ id: "human:keep", provider: "pi", model: "x" }] } }));
const run = spawnSync(process.execPath, [path.join(repo, "pi-orchestration", "install.mjs")], {
  env: { ...process.env, HOME: home, PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent"), PASEO_HOME: paseoHome, PASEO_PI_ROLES_HOME: path.join(home, ".pi-paseo"), PASEO_PI_AGENT_PROFILE_ROUTES_JSON: JSON.stringify({ lead: { model: "fixture/sol", thinkingOptionId: "high" }, peer: { model: "fixture/luna", thinkingOptionId: "max" }, supervisor: { model: "fixture/luna", thinkingOptionId: "max" } }) }, encoding: "utf8",
});
assert.equal(run.status, 0, run.stderr);
const config = JSON.parse(readFileSync(path.join(paseoHome, "config.json"), "utf8"));
assert.deepEqual(Object.keys(config.agents.providers).sort(), ["pi-lead", "pi-peer", "pi-supervisor"]);
assert.equal(config.daemon.agentProfiles.filter((x) => x.id.startsWith("paseo-learn:pi:")).length, 3);
const link = path.join(home, ".pi-paseo", "peer", "extensions", "paseo-team-policy.ts");
assert.ok(readlinkSync(link).includes("paseo-team-policy.ts"));
console.log("[paseo-team] active SLP policy tests passed");
