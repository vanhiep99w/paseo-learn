import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

const repo = path.resolve(import.meta.dirname, "..");
const read = (relativePath) => readFileSync(path.join(repo, relativePath), "utf8");

const roleContracts = [
	...["lead", "worker", "reviewer", "supervisor"].map(
		(role) => `pi-orchestration/profiles/${role}/AGENTS.md`,
	),
	...["lead", "worker", "reviewer", "supervisor"].map(
		(role) => `claude-orchestration/profiles/${role}/CLAUDE.md`,
	),
	...["lead", "worker", "reviewer", "supervisor"].map(
		(role) => `codex-orchestration/profiles/paseo-${role}.config.toml`,
	),
];

for (const file of roleContracts) {
	const source = read(file);
	assert.match(
		source,
		/Use Vietnamese for every user-facing response and every agent-to-agent prompt/,
		`${file} must require Vietnamese for Human and agent communication`,
	);
	assert.match(
		source,
		/Keep code, commands, paths, identifiers,[\s\S]{0,120}machine-readable tokens[\s\S]{0,40}original form/,
		`${file} must preserve technical literals`,
	);
	assert.match(
		source,
		/Human explicitly requests another language/,
		`${file} must retain the explicit Human language override`,
	);
}

for (const file of [
	"pi-orchestration/profiles/lead/skills/paseo-team-lead/SKILL.md",
	"claude-orchestration/profiles/lead/skills/paseo-team-lead/SKILL.md",
	"pi-orchestration/templates/TASK_BRIEF.md",
	"claude-orchestration/templates/TASK_BRIEF.md",
]) {
	const source = read(file);
	assert.match(source, /prose task body[\s\S]{0,100}agent-to-agent follow-up[\s\S]{0,40}Vietnamese/);
	assert.match(source, /marker names, field keys, code,[\s\S]{0,100}(unchanged|original form)/);
}

for (const file of [
	"pi-orchestration/install.mjs",
	"claude-orchestration/install.mjs",
	"codex-orchestration/install.mjs",
]) {
	assert.match(
		read(file),
		/Use Vietnamese for every user-facing response and every agent-to-agent prompt/,
		`${file} must install the language preference`,
	);
}

assert.match(read("README.md"), /Tiếng Việt là ngôn ngữ giao tiếp mặc định/);
assert.match(read("wiki/architecture.md"), /Vietnamese is the default interaction language/);

console.log("[paseo-team] Vietnamese language policy tests passed");
