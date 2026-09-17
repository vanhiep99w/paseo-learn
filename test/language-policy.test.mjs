import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");
const read = (file) => readFileSync(path.join(repo, file), "utf8");

const sourceRolePrompts = [
  "pi-orchestration/profiles/lead/AGENTS.md",
  "pi-orchestration/profiles/peer/AGENTS.md",
  "pi-orchestration/profiles/supervisor/AGENTS.md",
  "claude-orchestration/profiles/lead/CLAUDE.md",
  "claude-orchestration/profiles/peer/CLAUDE.md",
  "claude-orchestration/profiles/supervisor/CLAUDE.md",
  "codex-orchestration/profiles/paseo-lead.config.toml",
  "codex-orchestration/profiles/paseo-peer.config.toml",
  "codex-orchestration/profiles/paseo-supervisor.config.toml",
];
for (const file of sourceRolePrompts) {
  const text = read(file);
  assert.match(text, /PASEO_LEARN_SLP 1\.0/);
  assert.match(text, /Paseo/);
  assert.match(text, /Use Vietnamese for Human-facing and agent-to-agent communication/);
  assert.doesNotMatch(text, /Demonthorn Agent Orchestration Deep Dive|Giáo Án Herdr|daemon-pinned/);
}

for (const file of sourceRolePrompts.filter((file) => /lead/i.test(file))) {
  const text = read(file);
  assert.match(text, /smallest useful topology/);
  assert.match(text, /ACCEPT.*REOPEN.*REJECT.*UNKNOWN/s);
  assert.match(text, /Do not poll unchanged state/);
  assert.match(text, /known evidence, open questions, non-goals/i);
  assert.match(text, /reconcile (its evidence|premise\/evidence)/);
  assert.match(text, /drift invalidates/);
  assert.match(text, /Human decisions required/);
}

for (const file of sourceRolePrompts.filter((file) => /peer/i.test(file))) {
  const text = read(file);
  assert.match(text, /Disposition behavior/);
  assert.match(text, /engineer[\s\S]*scout[\s\S]*architect[\s\S]*reviewer[\s\S]*shadow/i);
  assert.match(text, /Decision\/dependency required/);
  assert.match(text, /Never self-accept/);
  assert.match(text, /SUPPORTED/);
  assert.match(text, /PARTIAL/);
  assert.match(text, /FAILED/);
  assert.match(text, /identify the existing contract/);
  assert.match(text, /DEFECT/);
  assert.match(text, /RISK/);
  assert.match(text, /PREFERENCE/);
  assert.match(text, /UNVERIFIED/);
  assert.match(text, /What would make this conclusion wrong\?/);
}

for (const file of sourceRolePrompts.filter((file) => /supervisor/i.test(file))) {
  const text = read(file);
  assert.match(text, /Missing recovery or replacement authority means observe and advise only/);
  assert.match(text, /SUSPECTED MECHANISM/);
  assert.match(text, /Do not intervene for style preferences/);
  assert.match(text, /never periodically scan unchanged transcripts/);
  assert.match(text, /never direct, question, or assign a Peer/);
  assert.match(text, /Smallest recommendation/);
}
for (const file of ["pi-orchestration/templates/TASK_BRIEF.md", "claude-orchestration/templates/TASK_BRIEF.md"]) {
  const text = read(file);
  assert.match(text, /prose task body[\s\S]{0,100}agent-to-agent follow-up[\s\S]{0,40}Vietnamese/);
  assert.match(text, /DISPOSITION: engineer/);
  assert.match(text, /KNOWN_EVIDENCE/);
  assert.match(text, /OPEN_QUESTIONS/);
  assert.match(text, /NON_GOALS/);
  assert.match(text, /CONTRACT_BOUNDARY/);
  assert.match(text, /SUPPORTED/);
  assert.match(text, /PARTIAL/);
  assert.match(text, /FAILED/);
  assert.match(text, /DEFECT/);
  assert.match(text, /RISK/);
  assert.match(text, /PREFERENCE/);
  assert.match(text, /UNVERIFIED/);
}
assert.match(read("README.md"), /Không dùng Beads/);
assert.match(read("wiki/architecture.md"), /Work state without Beads/);
console.log("[paseo-team] upstream role-prompt and SLP docs tests passed");
