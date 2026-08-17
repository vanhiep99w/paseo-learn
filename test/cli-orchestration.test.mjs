import assert from "node:assert/strict";
import {
	chmodSync,
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

result = spawnSync(process.execPath, [wrappers[0], "providers"], {
	env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, PASEO_PI_ROLE: "lead", PASEO_AGENT_ID: "" },
	encoding: "utf8",
});
assert.equal(result.status, 2);
assert.match(result.stderr, /PASEO_AGENT_ID is required/);

console.log("[paseo-team] CLI orchestration tests passed");
