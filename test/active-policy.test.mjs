import assert from "node:assert/strict";
import {
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	readlinkSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import {
	parseTaskBrief,
	ownedScopeRoots,
} from "../claude-orchestration/shared/paseo-team-policy/brief.mjs";
import {
	blockReasonForTool,
	callsGitWorktreeMutation,
	callsPaseoCli,
	callsPaseoTeamCli,
	ownedScopeBlockReason,
	safeSupervisorCliCommand,
} from "../claude-orchestration/shared/paseo-team-policy/policy.mjs";

const repo = path.resolve(import.meta.dirname, "..");
const hookDir = path.join(repo, "claude-orchestration", "shared", "paseo-team-policy");

function brief(scope = "src") {
	return parseTaskBrief([
		"PASEO_TEAM_TASK_V3_BEGIN",
		"TASK_ID: T-1",
		"MODE: write",
		`OWNED_SCOPE: ${scope}`,
		"EDIT_AUTHORITY: allowed",
		"COMMIT_AUTHORITY: denied",
		"PUSH_TASK_BRANCH_AUTHORITY: denied",
		"FORCE_PUSH_AUTHORITY: denied",
		"MERGE_AUTHORITY: denied",
		"DEPLOY_AUTHORITY: denied",
		"PASEO_TEAM_TASK_V3_END",
	].join("\n"));
}

// Native subagent compatibility: both modern Agent and legacy Task are blocked.
assert.match(blockReasonForTool("worker", null, "Agent", {}, repo), /Native subagents/);
assert.match(blockReasonForTool("worker", null, "Task", {}, repo), /Native subagents/);
for (const role of ["lead", "worker", "reviewer", "supervisor"]) {
	const settings = JSON.parse(readFileSync(
		path.join(repo, "claude-orchestration", "profiles", role, "settings.json"),
		"utf8",
	));
	assert.match(settings.hooks.PreToolUse[0].matcher, /Task/);
	if (role === "reviewer") assert.equal(settings.permissions.defaultMode, "plan");
}

// Read-only Worker turns have no shell authority. A write brief with missing
// scope is malformed and therefore cannot unlock shell execution either.
assert.match(
	blockReasonForTool("worker", null, "Bash", { command: "git status" }, repo),
	/read-only/,
);
const missingScope = parseTaskBrief([
	"PASEO_TEAM_TASK_V3_BEGIN",
	"TASK_ID: T-bad",
	"MODE: write",
	"EDIT_AUTHORITY: allowed",
	"PASEO_TEAM_TASK_V3_END",
].join("\n"));
assert.match(
	blockReasonForTool("worker", missingScope, "Bash", { command: "git status" }, repo),
	/read-only/,
);

// OWNED_SCOPE is strict, canonical, and symlink-aware for direct mutations.
const workspace = mkdtempSync(path.join(tmpdir(), "paseo-scope-"));
mkdirSync(path.join(workspace, "src"));
const outside = mkdtempSync(path.join(tmpdir(), "paseo-outside-"));
symlinkSync(outside, path.join(workspace, "src", "escape"));
const parsed = brief("src, docs");
assert.deepEqual(ownedScopeRoots(parsed), ["src", "docs"]);
assert.equal(ownedScopeRoots(brief("../src")), null);
assert.equal(ownedScopeRoots(brief("/tmp/src")), null);
assert.equal(ownedScopeBlockReason(parsed, "src/a.ts", workspace), null);
assert.match(ownedScopeBlockReason(parsed, "README.md", workspace), /outside OWNED_SCOPE/);
assert.match(ownedScopeBlockReason(parsed, "src/escape/pwned", workspace), /outside the assigned workspace/);
assert.match(blockReasonForTool("worker", parsed, "Artifact", {}, workspace), /verifiable file path/);
assert.equal(
	blockReasonForTool("worker", parsed, "Write", { file_path: "src/a.ts" }, workspace),
	null,
);

// Active orchestration is CLI-only. Injected MCP fails closed, raw shell is
// blocked, and Supervisor shell access is limited to a simple facade call.
assert.match(
	blockReasonForTool("lead", null, "mcp__paseo__list_agents", {}, repo),
	/CLI-only/,
);
assert.match(
	blockReasonForTool("supervisor", null, "mcp__paseo__list_agents", {}, repo),
	/CLI-only/,
);
assert.equal(callsGitWorktreeMutation("git worktree add --detach /tmp/review HEAD"), true);
assert.equal(callsGitWorktreeMutation("git worktree list"), false);
assert.match(
	blockReasonForTool("lead", null, "Bash", { command: "git worktree add /tmp/review HEAD" }, repo),
	/Workspace\/worktree mutation is disabled/,
);
assert.equal(callsPaseoCli("$PASEO_CLI run task"), true);
assert.equal(callsPaseoCli("\"$PASEO_CLI\" run task"), true);
assert.equal(callsPaseoCli("& $env:PASEO_CLI run task"), true);
assert.equal(callsPaseoCli("%PASEO_CLI% run task"), true);
assert.equal(callsPaseoTeamCli("$PASEO_TEAM_CLI inspect abc"), true);
assert.equal(callsPaseoTeamCli("\"$PASEO_TEAM_CLI\" inspect abc"), true);
assert.equal(callsPaseoTeamCli("& $env:PASEO_TEAM_CLI inspect abc"), true);
assert.equal(callsPaseoTeamCli("\"%PASEO_TEAM_CLI%\" inspect abc"), true);
assert.equal(callsPaseoTeamCli("C:\\Paseo\\bin\\paseo-team.cmd inspect abc"), true);
assert.equal(safeSupervisorCliCommand("$PASEO_TEAM_CLI inspect abc"), true);
assert.equal(safeSupervisorCliCommand("& $env:PASEO_TEAM_CLI inspect abc"), true);
assert.equal(safeSupervisorCliCommand("$PASEO_TEAM_CLI inspect abc; rm -rf x"), false);
assert.equal(
	blockReasonForTool("supervisor", null, "Bash", { command: "$PASEO_TEAM_CLI inspect abc" }, repo),
	null,
);
assert.match(
	blockReasonForTool("supervisor", null, "Bash", { command: "git status" }, repo),
	/restricted/,
);
const piPolicySource = readFileSync(
	path.join(repo, "pi-orchestration", "shared", "paseo-team-policy.ts"),
	"utf8",
);
assert.match(piPolicySource, /allow: \["read", "bash"\]/);
assert.match(piPolicySource, /GIT_WORKTREE_MUTATION_RE/);
assert.equal(existsSync(path.join(repo, "pi-orchestration", "profiles", "lead", "mcp.json")), false);
assert.equal(existsSync(path.join(repo, "pi-orchestration", "profiles", "supervisor", "mcp.json")), false);

// UserPromptSubmit must replace authority each turn and block malformed state events.
const stateTmp = mkdtempSync(path.join(tmpdir(), "paseo-state-"));
const env = { ...process.env, TMPDIR: stateTmp, PASEO_CLAUDE_ROLE: "worker" };
function runHook(name, event) {
	return spawnSync(process.execPath, [path.join(hookDir, name)], {
		cwd: workspace,
		env,
		input: typeof event === "string" ? event : JSON.stringify(event),
		encoding: "utf8",
	});
}
const sessionId = "scope-test";
assert.equal(runHook("user-prompt-submit.mjs", {
	session_id: sessionId,
	prompt: [
		"PASEO_TEAM_TASK_V3_BEGIN",
		"TASK_ID: T-1",
		"MODE: write",
		"OWNED_SCOPE: src",
		"EDIT_AUTHORITY: allowed",
		"PASEO_TEAM_TASK_V3_END",
	].join("\n"),
}).status, 0);
assert.equal(runHook("pre-tool-use.mjs", {
	session_id: sessionId,
	cwd: workspace,
	tool_name: "Write",
	tool_input: { file_path: "src/a.ts" },
}).status, 0);
assert.equal(runHook("user-prompt-submit.mjs", {
	session_id: sessionId,
	prompt: "plain follow-up without authority",
}).status, 0);
assert.equal(runHook("pre-tool-use.mjs", {
	session_id: sessionId,
	cwd: workspace,
	tool_name: "Write",
	tool_input: { file_path: "src/a.ts" },
}).status, 2);
assert.equal(runHook("user-prompt-submit.mjs", "{not-json" ).status, 2);

// Pi install must link roles to the stable installed copy, not this checkout.
const installHome = mkdtempSync(path.join(tmpdir(), "paseo-install-"));
const installPaseoHome = path.join(installHome, ".paseo");
mkdirSync(installPaseoHome, { recursive: true });
writeFileSync(
	path.join(installPaseoHome, "config.json"),
	JSON.stringify({
		version: 1,
		daemon: {
			agentProfiles: [
				{ id: "human:keep", name: "Human profile", provider: "pi", model: "human/model" },
			],
		},
	}),
);
const install = spawnSync(process.execPath, [
	path.join(repo, "pi-orchestration", "install.mjs"),
], {
	env: {
		...process.env,
		HOME: installHome,
		PI_CODING_AGENT_DIR: path.join(installHome, ".pi", "agent"),
		PASEO_HOME: installPaseoHome,
		PASEO_PI_ROLES_HOME: path.join(installHome, ".pi-paseo"),
		PASEO_PI_AGENT_PROFILE_ROUTES_JSON: JSON.stringify({
			lead: { model: "fixture/sol", thinkingOptionId: "high" },
			worker: { model: "fixture/luna", thinkingOptionId: "max" },
			reviewer: { model: "fixture/luna", thinkingOptionId: "max" },
			supervisor: { model: "fixture/luna", thinkingOptionId: "max" },
		}),
	},
	encoding: "utf8",
});
assert.equal(install.status, 0, install.stderr);
const stablePolicy = path.join(installHome, ".paseo", "packs", "pi-orchestration", "paseo-team-policy.ts");
assert.equal(
	path.resolve(path.dirname(path.join(installHome, ".pi-paseo", "lead", "extensions", "paseo-team-policy.ts")), readlinkSync(path.join(installHome, ".pi-paseo", "lead", "extensions", "paseo-team-policy.ts"))),
	stablePolicy,
);
assert.equal(readFileSync(stablePolicy, "utf8"), readFileSync(path.join(repo, "pi-orchestration", "shared", "paseo-team-policy.ts"), "utf8"));
assert.equal(
	readFileSync(path.join(installHome, ".pi-paseo", "lead", "templates", "TASK_BRIEF_V3.md"), "utf8"),
	readFileSync(path.join(repo, "pi-orchestration", "templates", "TASK_BRIEF_V3.md"), "utf8"),
);
const installedConfig = JSON.parse(
	readFileSync(path.join(installPaseoHome, "config.json"), "utf8"),
);
assert.equal(installedConfig.daemon.agentProfiles[0].id, "human:keep");
assert.equal(installedConfig.daemon.mcp.enabled, undefined);
assert.equal(installedConfig.daemon.mcp.injectIntoAgents, false);
assert.equal(installedConfig.agents.providers["pi-lead"].command[0], "pi");
assert.match(installedConfig.agents.providers["pi-lead"].env.PASEO_TEAM_CLI, /paseo-team$/);
assert.ok(existsSync(path.join(installPaseoHome, "bin", "paseo-team")));
const piManagedProfiles = installedConfig.daemon.agentProfiles.filter((profile) =>
	profile.id.startsWith("paseo-learn:pi:"),
);
assert.equal(piManagedProfiles.length, 4);
const piRoleColors = {
	lead: "blue",
	worker: "amber",
	reviewer: "violet",
	supervisor: "red",
};
for (const profile of piManagedProfiles) {
	const role = profile.id.split(":")[2];
	assert.equal(profile.color, piRoleColors[role]);
	assert.equal(profile.model, role === "lead" ? "fixture/sol" : "fixture/luna");
	assert.equal(profile.thinkingOptionId, role === "lead" ? "high" : "max");
}

console.log("[paseo-team] active policy tests passed");
