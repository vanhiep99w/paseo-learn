import assert from "node:assert/strict";
import {
	chmodSync,
	existsSync,
	mkdtempSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = path.resolve(import.meta.dirname, "..");
const wrappers = [
	"pi-orchestration/bin/paseo-team",
	"claude-orchestration/bin/paseo-team",
	"codex-orchestration/bin/paseo-team",
].map((file) => path.join(repo, file));
const canonical = readFileSync(wrappers[0], "utf8");
for (const wrapper of wrappers.slice(1)) {
	assert.equal(readFileSync(wrapper, "utf8"), canonical, `${wrapper} must match the canonical facade`);
}

const fixture = mkdtempSync(path.join(tmpdir(), "paseo-team-cli-"));
const bin = path.join(fixture, "bin");
const log = path.join(fixture, "calls.jsonl");
mkdirSync(bin);
const fakePaseo = path.join(bin, "paseo");
writeFileSync(fakePaseo, `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.FAKE_PASEO_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
if (process.argv[2] === "inspect") {
  const pending = process.argv[3] === "child-permission" ? [{ id: "perm-1" }] : [];
  process.stdout.write(JSON.stringify({ Provider: process.env.FAKE_INSPECT_PROVIDER || "pi-lead", PendingPermissions: pending }));
} else if (process.argv[2] === "wait") {
  if (process.argv[3] === "child-b") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  let status = "idle";
  if (process.argv[3] === "child-permission" && !fs.existsSync(process.env.FAKE_PERMISSION_STATE)) {
    fs.writeFileSync(process.env.FAKE_PERMISSION_STATE, "seen");
    status = "permission";
  }
  process.stdout.write(JSON.stringify({ agentId: process.argv[3], status, message: "large transcript must be stripped" }));
} else if (process.argv[2] === "logs") {
  process.stdout.write("response that watcher must never fetch\\n");
} else if (process.argv.includes("--quiet")) {
  process.stdout.write("child-123\\n");
} else {
  process.stdout.write("{}\\n");
}
`);
chmodSync(fakePaseo, 0o755);

function call(roleEnv, args, extraEnv = {}) {
	return spawnSync(process.execPath, [wrappers[0], ...args], {
		env: {
			...process.env,
			PATH: `${bin}${path.delimiter}${process.env.PATH}`,
			FAKE_PASEO_LOG: log,
			PASEO_AGENT_ID: "parent-1",
			PASEO_HOME: path.join(fixture, "paseo-home"),
			FAKE_PERMISSION_STATE: path.join(fixture, "permission-state"),
			...roleEnv,
			...extraEnv,
		},
		encoding: "utf8",
	});
}
function calls() {
	return readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map(JSON.parse);
}

let result = call({ PASEO_PI_ROLE: "lead" }, ["providers"]);
assert.equal(result.status, 0, result.stderr);
assert.deepEqual(calls().at(-1), ["provider", "ls", "--json"]);

result = call({ PASEO_PI_ROLE: "lead" }, ["models", "pi-worker"]);
assert.equal(result.status, 0, result.stderr);
assert.deepEqual(calls().at(-1), ["provider", "models", "pi-worker", "--thinking", "--json"]);

result = call({ PASEO_PI_ROLE: "lead" }, [
	"run",
	"--provider", "pi-worker/openai-codex/model-x",
	"--thinking", "high",
	"--mode", "full-access",
	"--label", "task=T-1",
	"--", "PASEO_TEAM_TASK_V3_BEGIN\nTASK_ID: T-1\nPASEO_TEAM_TASK_V3_END",
]);
assert.equal(result.status, 0, result.stderr);
assert.deepEqual(calls().at(-1).slice(0, 4), ["run", "--background", "--quiet", "--provider"]);
assert.ok(calls().at(-1).includes("pi-worker/openai-codex/model-x"));

result = call({ PASEO_PI_ROLE: "lead" }, [
	"run", "--provider", "pi-worker/model", "--", "brief",
]);
assert.equal(result.status, 2);
assert.match(result.stderr, /requires --thinking/);

result = call({ PASEO_PI_ROLE: "lead" }, [
	"run",
	"--provider", "pi-worker/model",
	"--thinking", "high",
	"--new-workspace", "worktree",
	"--", "brief",
]);
assert.equal(result.status, 2);
assert.match(result.stderr, /option "--new-workspace" is not allowed/);

result = call({ PASEO_PI_ROLE: "lead" }, [
	"workspace-create", "--isolation", "local", "--path", "/tmp/other-project",
]);
assert.equal(result.status, 2);
assert.match(result.stderr, /workspace management is disabled/);

result = call({ PASEO_PI_ROLE: "worker" }, ["providers"]);
assert.equal(result.status, 2);
assert.match(result.stderr, /no orchestration authority/);

result = call({ PASEO_PI_ROLE: "supervisor" }, [
	"run",
	"--provider", "pi-worker/model",
	"--thinking", "high",
	"--label", "purpose=recovery",
	"--label", "recovery_for=project-1",
	"--", "recover",
]);
assert.equal(result.status, 2);
assert.match(result.stderr, /pi-lead/);

result = call({ PASEO_PI_ROLE: "supervisor" }, [
	"run",
	"--provider", "pi-lead/openai-codex/model-x",
	"--thinking", "high",
	"--label", "purpose=recovery",
	"--label", "recovery_for=project-1",
	"--", "recover",
]);
assert.equal(result.status, 0, result.stderr);

result = call(
	{ PASEO_PI_ROLE: "supervisor" },
	["send", "lead-1", "--", "observation"],
	{ FAKE_INSPECT_PROVIDER: "pi-worker" },
);
assert.equal(result.status, 2);
assert.match(result.stderr, /only pi-lead/);

// One detached non-agent watcher waits concurrently and sends status-only
// notifications. Lead decides whether and when to fetch each response.
const watcherCallStart = calls().length;
result = call(
	{ PASEO_PI_ROLE: "lead" },
	["notify-each", "child-a", "child-b"],
);
assert.equal(result.status, 0, result.stderr);
const registration = JSON.parse(result.stdout);
assert.equal(registration.state, "watching");
assert.deepEqual(registration.agentIds, ["child-a", "child-b"]);
const watcherState = path.join(
	fixture,
	"paseo-home",
	"paseo-team-watchers",
	`${registration.batchId}.json`,
);
for (let attempt = 0; attempt < 100; attempt += 1) {
	if (existsSync(watcherState)) {
		const state = JSON.parse(readFileSync(watcherState, "utf8"));
		if (state.state === "notified") break;
	}
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
}
const notified = JSON.parse(readFileSync(watcherState, "utf8"));
assert.equal(notified.state, "notified");
assert.equal(notified.mode, "notify-each");
assert.equal(notified.notificationsSent, 2);
assert.equal(notified.notificationFailures, 0);
assert.deepEqual(notified.completed.map(({ agentId, status }) => ({ agentId, status })), [
	{ agentId: "child-a", status: "idle" },
	{ agentId: "child-b", status: "idle" },
]);
const watcherCalls = calls().slice(watcherCallStart);
const waitCalls = watcherCalls.filter((entry) => entry[0] === "wait");
assert.deepEqual(new Set(waitCalls.map((entry) => entry[1])), new Set(["child-a", "child-b"]));
const sendCalls = watcherCalls.filter((entry) => entry[0] === "send");
assert.equal(sendCalls.length, 2);
assert.equal(sendCalls[0][1], "parent-1");
assert.match(sendCalls[0].at(-1), /PASEO_TEAM_AGENT_COMPLETED/);
assert.match(sendCalls[0].at(-1), /RESULTS_JSON/);
assert.match(sendCalls[1].at(-1), /PASEO_TEAM_BATCH_COMPLETED/);
for (const sendCall of sendCalls) {
	assert.doesNotMatch(sendCall.at(-1), /large transcript/);
	assert.doesNotMatch(sendCall.at(-1), /finalResponse|response that watcher/);
}
assert.equal(watcherCalls.some((entry) => entry[0] === "logs"), false);

const callCount = calls().length;
result = call(
	{ PASEO_PI_ROLE: "lead" },
	["notify-each", "child-a", "child-b"],
);
assert.equal(result.status, 0, result.stderr);
assert.equal(JSON.parse(result.stdout).alreadyRegistered, true);
assert.equal(calls().length, callCount);

// Permission/error-like statuses bypass debounce and emit an attention event;
// the watcher never approves the request or fetches its response automatically.
const attentionCallStart = calls().length;
result = call(
	{ PASEO_PI_ROLE: "lead" },
	["notify-each", "child-permission"],
);
assert.equal(result.status, 0, result.stderr);
const attentionRegistration = JSON.parse(result.stdout);
const attentionState = path.join(
	fixture,
	"paseo-home",
	"paseo-team-watchers",
	`${attentionRegistration.batchId}.json`,
);
for (let attempt = 0; attempt < 120; attempt += 1) {
	if (existsSync(attentionState)) {
		const state = JSON.parse(readFileSync(attentionState, "utf8"));
		if (state.state === "notified") break;
	}
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
}
const attention = JSON.parse(readFileSync(attentionState, "utf8"));
assert.equal(attention.state, "notified");
assert.equal(attention.attentionEvents[0].status, "permission");
assert.deepEqual(attention.attentionEvents[0].pendingPermissionIds, ["perm-1"]);
assert.equal(attention.completed[0].status, "idle");
const attentionCalls = calls().slice(attentionCallStart);
const attentionSends = attentionCalls.filter((entry) => entry[0] === "send");
assert.equal(attentionSends.length, 2);
assert.match(attentionSends[0].at(-1), /PASEO_TEAM_AGENT_ATTENTION/);
assert.match(attentionSends[0].at(-1), /không tự approve/);
assert.match(attentionSends[1].at(-1), /PASEO_TEAM_BATCH_COMPLETED/);
assert.equal(attentionCalls.some((entry) => entry[0] === "logs"), false);

result = call(
	{ PASEO_PI_ROLE: "supervisor" },
	["notify-each", "child-a"],
);
assert.equal(result.status, 2);
assert.match(result.stderr, /Lead-only/);

result = spawnSync(process.execPath, [wrappers[0], "providers"], {
	env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PASEO_PI_ROLE: "lead", PASEO_AGENT_ID: "" },
	encoding: "utf8",
});
assert.equal(result.status, 2);
assert.match(result.stderr, /PASEO_AGENT_ID is required/);

console.log("[paseo-team] CLI orchestration tests passed");
