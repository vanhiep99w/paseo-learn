import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = path.resolve(import.meta.dirname, "..");

function read(relativePath) {
	return readFileSync(path.join(repo, relativePath), "utf8");
}

const leadContracts = [
	"codex-orchestration/profiles/paseo-lead.config.toml",
	"pi-orchestration/profiles/lead/AGENTS.md",
	"pi-orchestration/profiles/lead/skills/paseo-team-lead/SKILL.md",
	"claude-orchestration/profiles/lead/CLAUDE.md",
	"claude-orchestration/profiles/lead/skills/paseo-team-lead/SKILL.md",
];

for (const file of leadContracts) {
	const source = read(file);
	assert.match(source, /PASEO_TEAM_CLI/, `${file} must use the role-gated CLI facade`);
	assert.match(source, /Agent Profiles[\s\S]{0,100}Human launch preset/i,
		`${file} must keep profiles out of CLI routing`);
	assert.match(source, /providers/, `${file} must verify provider health`);
	assert.match(source, /models/, `${file} must verify the exact model`);
	assert.match(source, /inspect/, `${file} must post-verify runtime state`);
	assert.match(source, /same-family|same family/i, `${file} must default to its own provider family`);
	assert.match(source, /CROSS_FAMILY_ROUTE_REQUIRES_HUMAN/,
		`${file} must block unauthorized cross-family routing`);
	assert.match(source, /Human[\s\S]{0,40}explicitly[\s\S]{0,20}request/i,
		`${file} must require explicit Human authorization for cross-family routing`);
	assert.match(source, /--thinking/, `${file} must pin thinking instead of inheriting defaults`);
}

const piLeadSkill = read("pi-orchestration/profiles/lead/skills/paseo-team-lead/SKILL.md");
assert.match(piLeadSkill, /\$PI_CODING_AGENT_DIR\/templates\/TASK_BRIEF_V3\.md/);
assert.match(piLeadSkill, /never run a broad `find \$HOME`/);
const claudeLeadSkill = read("claude-orchestration/profiles/lead/skills/paseo-team-lead/SKILL.md");
assert.match(claudeLeadSkill, /\$CLAUDE_CONFIG_DIR\/templates\/TASK_BRIEF_V3\.md/);
assert.match(claudeLeadSkill, /never run a broad `find \$HOME`/);

for (const file of [
	"codex-orchestration/install.mjs",
	"pi-orchestration/install.mjs",
	"claude-orchestration/install.mjs",
]) {
	const source = read(file);
	assert.match(source, /PASEO_TEAM_CLI/, `${file} must install the CLI facade path`);
	assert.match(source, /Same-family routing is mandatory by default/,
		`${file} must install same-family routing preferences`);
	assert.match(source, /Never silently fall back/, `${file} must preserve no-silent-fallback`);
	assert.doesNotMatch(source, /PASEO_MCP_ACCESS/, `${file} must not inject role MCP`);
}

const guide = read("docs/agent-profiles.md");
assert.match(guide, /whole-list\s+replacement/);
assert.match(guide, /giữ nguyên thứ tự và nội dung mọi profile/);
assert.match(guide, /fail closed nếu managed profile đã bị sửa/);
assert.match(guide, /Human launch/i);
assert.match(guide, /CROSS_FAMILY_ROUTE_REQUIRES_HUMAN/);
assert.match(guide, /paseo-team inspect/);

// Claude installer merges four namespaced profiles, preserves Human profiles,
// and refuses to replace a changed managed route without --force.
const installHome = mkdtempSync(path.join(tmpdir(), "paseo-claude-profiles-"));
const paseoHome = path.join(installHome, ".paseo");
mkdirSync(paseoHome, { recursive: true });
writeFileSync(
	path.join(paseoHome, "config.json"),
	JSON.stringify({
		version: 1,
		daemon: {
			agentProfiles: [
				{
					id: "human:keep",
					name: "Human profile",
					provider: "claude",
					model: "human-model",
				},
			],
		},
	}),
);
function runClaudeInstall(model, args = []) {
	return spawnSync(
		process.execPath,
		[path.join(repo, "claude-orchestration", "install.mjs"), ...args],
		{
			env: {
				...process.env,
				HOME: installHome,
				CLAUDE_CONFIG_DIR: path.join(installHome, ".claude"),
				PASEO_HOME: paseoHome,
				PASEO_CLAUDE_ROLES_HOME: path.join(installHome, ".claude-paseo"),
				PASEO_CLAUDE_AGENT_PROFILE_DEFAULT_JSON: JSON.stringify({
					model,
					thinkingOptionId: "high",
				}),
			},
			encoding: "utf8",
		},
	);
}
const firstInstall = runClaudeInstall("fixture/claude-default");
assert.equal(firstInstall.status, 0, firstInstall.stderr);
assert.equal(
	readFileSync(path.join(installHome, ".claude-paseo", "lead", "templates", "TASK_BRIEF_V3.md"), "utf8"),
	read("claude-orchestration/templates/TASK_BRIEF_V3.md"),
);
let installedConfig = JSON.parse(readFileSync(path.join(paseoHome, "config.json"), "utf8"));
assert.equal(installedConfig.daemon.agentProfiles[0].id, "human:keep");
assert.equal(installedConfig.daemon.mcp.enabled, undefined);
assert.equal(installedConfig.daemon.mcp.injectIntoAgents, false);
assert.equal(installedConfig.agents.providers["claude-lead"].command[0], "claude");
assert.match(installedConfig.agents.providers["claude-lead"].env.PASEO_TEAM_CLI, /paseo-team$/);
let managed = installedConfig.daemon.agentProfiles.filter((profile) =>
	profile.id.startsWith("paseo-learn:claude:"),
);
assert.equal(managed.length, 4);
assert.ok(managed.every((profile) => profile.model === "fixture/claude-default"));
const claudeRoleColors = {
	lead: "blue",
	worker: "amber",
	reviewer: "violet",
	supervisor: "red",
};
for (const profile of managed) {
	assert.equal(profile.color, claudeRoleColors[profile.id.split(":")[2]]);
}
// Daemon/schema rewrites may reorder object keys; semantic equality must remain
// idempotent rather than becoming a false managed-profile conflict.
const firstManagedIndex = installedConfig.daemon.agentProfiles.findIndex((profile) =>
	profile.id.startsWith("paseo-learn:claude:"),
);
installedConfig.daemon.agentProfiles[firstManagedIndex] = Object.fromEntries(
	Object.entries(installedConfig.daemon.agentProfiles[firstManagedIndex]).reverse(),
);
writeFileSync(path.join(paseoHome, "config.json"), JSON.stringify(installedConfig));
const idempotentInstall = runClaudeInstall("fixture/claude-default");
assert.equal(idempotentInstall.status, 0, idempotentInstall.stderr);

const conflictingInstall = runClaudeInstall("fixture/claude-next");
assert.notEqual(conflictingInstall.status, 0);
assert.match(conflictingInstall.stderr, /Agent Profile .* different config/);
assert.doesNotMatch(conflictingInstall.stdout, /== role:/);
const forcedInstall = runClaudeInstall("fixture/claude-next", ["--force"]);
assert.equal(forcedInstall.status, 0, forcedInstall.stderr);
installedConfig = JSON.parse(readFileSync(path.join(paseoHome, "config.json"), "utf8"));
assert.equal(installedConfig.daemon.agentProfiles[0].id, "human:keep");
managed = installedConfig.daemon.agentProfiles.filter((profile) =>
	profile.id.startsWith("paseo-learn:claude:"),
);
assert.ok(managed.every((profile) => profile.model === "fixture/claude-next"));

console.log("[paseo-team] agent profile routing tests passed");
