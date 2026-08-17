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
  process.stdout.write(JSON.stringify({ Provider: process.env.FAKE_INSPECT_PROVIDER || "pi-lead" }));
} else if (process.argv[2] === "wait") {
  if (process.argv[3] === "child-b") Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
  process.stdout.write(JSON.stringify({ agentId: process.argv[3], status: "idle", message: "large transcript must be stripped" }));
} else if (process.argv[2] === "logs") {
  const suffix = process.argv[3] === "child-b" ? "x".repeat(7000) : "";
  process.stdout.write("final response from " + process.argv[3] + suffix + "\\n");
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

// One detached non-agent watcher waits concurrently, relays bounded final
// responses as untrusted data, and notifies once per debounce group.
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
assert.equal(notified.completed[0].responseTruncated, false);
assert.equal(notified.completed[1].responseTruncated, true);
const watcherCalls = calls().slice(watcherCallStart);
const waitCalls = watcherCalls.filter((entry) => entry[0] === "wait");
assert.deepEqual(new Set(waitCalls.map((entry) => entry[1])), new Set(["child-a", "child-b"]));
const sendCalls = watcherCalls.filter((entry) => entry[0] === "send");
assert.equal(sendCalls.length, 2);
assert.equal(sendCalls[0][1], "parent-1");
assert.match(sendCalls[0].at(-1), /PASEO_TEAM_AGENT_COMPLETED/);
assert.match(sendCalls[0].at(-1), /final response from child-a/);
assert.match(sendCalls[0].at(-1), /UNTRUSTED_AGENT_RESULTS_JSON_BEGIN/);
assert.match(sendCalls[1].at(-1), /PASEO_TEAM_BATCH_COMPLETED/);
assert.match(sendCalls[1].at(-1), /final response from child-b/);
for (const sendCall of sendCalls) assert.doesNotMatch(sendCall.at(-1), /large transcript/);

const callCount = calls().length;
result = call(
	{ PASEO_PI_ROLE: "lead" },
	["notify-each", "child-a", "child-b"],
);
assert.equal(result.status, 0, result.stderr);
assert.equal(JSON.parse(result.stdout).alreadyRegistered, true);
assert.equal(calls().length, callCount);

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
