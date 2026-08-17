import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = path.resolve(import.meta.dirname, "..");
const read = (relative) => readFileSync(path.join(repo, relative), "utf8");

const help = spawnSync(process.execPath, [path.join(repo, "install.mjs"), "--help"], {
	cwd: repo,
	encoding: "utf8",
});
assert.equal(help.status, 0, help.stderr);
assert.match(help.stdout, /install\.cmd/);
assert.match(help.stdout, /codex\|pi\|claude\|all/);

const invalid = spawnSync(process.execPath, [path.join(repo, "install.mjs"), "unknown"], {
	cwd: repo,
	encoding: "utf8",
});
assert.equal(invalid.status, 2);
assert.match(invalid.stderr, /unknown target/);

assert.match(read("install"), /exec node .*install\.mjs/);
assert.match(read("install.cmd"), /node "%~dp0install\.mjs" %\*/);

const cmdLaunchers = [
	"pi-orchestration/bin/paseo-team.cmd",
	"claude-orchestration/bin/paseo-team.cmd",
	"codex-orchestration/bin/paseo-team.cmd",
];
for (const file of cmdLaunchers) {
	const source = read(file);
	assert.match(source, /paseo-team\.mjs/);
	assert.match(source, /%\*/);
}
assert.equal(read(cmdLaunchers[0]), read(cmdLaunchers[1]));
assert.equal(read(cmdLaunchers[0]), read(cmdLaunchers[2]));

for (const file of [
	"pi-orchestration/install.mjs",
	"claude-orchestration/install.mjs",
	"codex-orchestration/install.mjs",
]) {
	const source = read(file);
	assert.match(source, /process\.platform === "win32"/, `${file} must detect Windows`);
	assert.match(source, /paseo-team\.cmd/, `${file} must install the Windows facade`);
	assert.match(source, /paseo-team\.mjs/, `${file} must install the Node payload`);
}
for (const file of ["pi-orchestration/install.mjs", "claude-orchestration/install.mjs"]) {
	assert.match(read(file), /PATHEXT/, `${file} must discover .cmd\/.exe binaries`);
}
assert.match(read("pi-orchestration/install.mjs"), /"junction"/);
assert.match(read("pi-orchestration/install.mjs"), /await link\(source, target\)/);
assert.match(read("claude-orchestration/install.mjs"), /await link\(source, target\)/);
assert.match(read("codex-orchestration/install.mjs"), /await link\(source, target\)/);

const piPolicy = read("pi-orchestration/shared/paseo-team-policy.ts");
assert.match(piPolicy, /\$env:PASEO_TEAM_CLI/);
assert.match(piPolicy, /%PASEO_TEAM_CLI%/);
const codexHooks = JSON.parse(read("codex-orchestration/shared/paseo-team-policy/hooks.json"));
assert.match(codexHooks.hooks.PreToolUse[0].matcher, /PowerShell/);

console.log("[paseo-team] cross-platform installer tests passed");
