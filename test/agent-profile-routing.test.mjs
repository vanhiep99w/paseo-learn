import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = path.resolve(import.meta.dirname, "..");
for (const file of [
  "codex-orchestration/profiles/paseo-lead.config.toml",
  "pi-orchestration/profiles/lead/AGENTS.md",
  "claude-orchestration/profiles/lead/CLAUDE.md",
]) {
  const text = readFileSync(path.join(repo, file), "utf8");
  assert.match(text, /PASEO_LEARN_SLP 1\.0/);
  assert.match(text, /Paseo (Foundation standing role|role transport):? Lead|Role: Lead/);
  assert.match(text, /Paseo.*only delegation|Use Paseo exclusively|Paseo is the only/i);
}

const home = mkdtempSync(path.join(tmpdir(), "paseo-claude-slp-"));
const paseoHome = path.join(home, ".paseo");
mkdirSync(paseoHome, { recursive: true });
const legacy = {
  version: 1,
  daemon: { agentProfiles: [
    { id: "human:keep", provider: "claude", model: "human" },
    { id: "paseo-learn:claude:worker:host-default", provider: "claude-worker", model: "old" },
    { id: "paseo-learn:claude:reviewer:host-default", provider: "claude-reviewer", model: "old" },
  ] },
  agents: { providers: { "claude-worker": { stale: true }, "claude-reviewer": { stale: true } } },
};
writeFileSync(path.join(paseoHome, "config.json"), JSON.stringify(legacy));
const env = { ...process.env, HOME: home, CLAUDE_CONFIG_DIR: path.join(home, ".claude"), PASEO_HOME: paseoHome, PASEO_CLAUDE_ROLES_HOME: path.join(home, ".claude-paseo"), PASEO_CLAUDE_AGENT_PROFILE_DEFAULT_JSON: JSON.stringify({ model: "fixture/claude", thinkingOptionId: "high" }) };
const first = spawnSync(process.execPath, [path.join(repo, "claude-orchestration", "install.mjs")], { env, encoding: "utf8" });
assert.notEqual(first.status, 0);
assert.match(first.stderr, /Legacy Worker\/Reviewer/);
const forced = spawnSync(process.execPath, [path.join(repo, "claude-orchestration", "install.mjs"), "--force"], { env, encoding: "utf8" });
assert.equal(forced.status, 0, forced.stderr);
const config = JSON.parse(readFileSync(path.join(paseoHome, "config.json"), "utf8"));
assert.deepEqual(Object.keys(config.agents.providers).sort(), ["claude-lead", "claude-peer", "claude-supervisor"]);
assert.equal(config.daemon.agentProfiles[0].id, "human:keep");
assert.deepEqual(config.daemon.agentProfiles.filter((p) => p.id.startsWith("paseo-learn:claude:")).map((p) => p.id).sort(), [
  "paseo-learn:claude:lead:host-default", "paseo-learn:claude:peer:host-default", "paseo-learn:claude:supervisor:host-default",
]);
console.log("[paseo-team] SLP agent-profile routing tests passed");
