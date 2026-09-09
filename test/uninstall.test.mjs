import assert from "node:assert/strict";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const repo = path.resolve(import.meta.dirname, "..");
const script = path.join(repo, "scripts", "uninstall.mjs");

function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), "paseo-learn-uninstall-"));
	const home = path.join(root, "home");
	const paseo = path.join(home, ".paseo");
	const codex = path.join(home, ".codex");
	const roleRoots = {
		codex: path.join(home, ".codex-paseo"),
		pi: path.join(home, ".pi-paseo"),
		claude: path.join(home, ".claude-paseo"),
	};
	mkdirSync(path.join(paseo, "bin"), { recursive: true });
	mkdirSync(codex, { recursive: true });
	for (const roleRoot of Object.values(roleRoots)) {
		for (const role of ["lead", "peer", "supervisor"]) {
			mkdirSync(path.join(roleRoot, role), { recursive: true });
			writeFileSync(path.join(roleRoot, role, "private-session.json"), `${role}\n`);
		}
	}
	const config = {
		version: 1,
		daemon: {
			mcp: { enabled: true, injectIntoAgents: false },
			agentProfiles: [
				{ id: "human:keep", provider: "custom" },
				{ id: "paseo-learn:codex:lead:host-default", provider: "codex-lead" },
				{ id: "paseo-learn:pi:peer:host-default", provider: "pi-peer" },
				{ id: "paseo-learn:claude:supervisor:host-default", provider: "claude-supervisor" },
			],
		},
		agents: {
			providers: {
				"human-provider": { label: "keep" },
				"codex-lead": { managed: true },
				"codex-peer": { managed: true },
				"pi-lead": { managed: true },
				"pi-peer": { managed: true },
				"claude-lead": { managed: true },
				"claude-peer": { managed: true },
			},
		},
	};
	const preferences = {
		providers: {
			planning: "codex-lead/gpt-5.6-sol",
			impl: "pi-peer",
			ui: "claude-peer",
			custom: "human-provider/model",
		},
		preferences: [
			"Use codex-lead for topology and acceptance, and codex-peer for one bounded disposition.",
			"Use pi-lead for topology and acceptance, and pi-peer for one bounded disposition.",
			"human preference",
		],
	};
	writeFileSync(path.join(paseo, "config.json"), `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
	writeFileSync(path.join(paseo, "orchestration-preferences.json"), `${JSON.stringify(preferences, null, 2)}\n`, { mode: 0o600 });
	copyFileSync(
		path.join(repo, "codex-orchestration", "bin", "codex-role-app-server"),
		path.join(paseo, "bin", "codex-role-app-server"),
	);
	for (const role of ["lead", "peer", "supervisor"]) {
		copyFileSync(
			path.join(repo, "codex-orchestration", "profiles", `paseo-${role}.config.toml`),
			path.join(codex, `paseo-${role}.config.toml`),
		);
	}
	return { root, home, paseo, codex, roleRoots };
}

function envFor(state) {
	return {
		...process.env,
		HOME: state.home,
		PASEO_HOME: state.paseo,
		CODEX_HOME: state.codex,
		PI_CODING_AGENT_DIR: path.join(state.home, ".pi", "agent"),
		CLAUDE_CONFIG_DIR: path.join(state.home, ".claude"),
		PASEO_CODEX_ROLES_HOME: state.roleRoots.codex,
		PASEO_PI_ROLES_HOME: state.roleRoots.pi,
		PASEO_CLAUDE_ROLES_HOME: state.roleRoots.claude,
	};
}

function run(state, ...args) {
	return spawnSync(process.execPath, [script, ...args], {
		env: envFor(state),
		encoding: "utf8",
	});
}

{
	const state = fixture();
	const configBefore = readFileSync(path.join(state.paseo, "config.json"), "utf8");
	const dryRun = run(state, "codex", "--dry-run");
	assert.equal(dryRun.status, 0, dryRun.stderr);
	assert.match(dryRun.stdout, /would update: .*config\.json/);
	assert.equal(readFileSync(path.join(state.paseo, "config.json"), "utf8"), configBefore);
	assert.ok(existsSync(path.join(state.paseo, "bin", "codex-role-app-server")));

	const applied = run(state, "codex", "--apply");
	assert.equal(applied.status, 0, applied.stderr);
	const config = JSON.parse(readFileSync(path.join(state.paseo, "config.json"), "utf8"));
	assert.deepEqual(Object.keys(config.agents.providers).sort(), ["claude-lead", "claude-peer", "human-provider", "pi-lead", "pi-peer"]);
	assert.deepEqual(config.daemon.agentProfiles.map((profile) => profile.id).sort(), [
		"human:keep",
		"paseo-learn:claude:supervisor:host-default",
		"paseo-learn:pi:peer:host-default",
	]);
	assert.deepEqual(config.daemon.mcp, { enabled: true, injectIntoAgents: false });
	const preferences = JSON.parse(readFileSync(path.join(state.paseo, "orchestration-preferences.json"), "utf8"));
	assert.equal(preferences.providers.planning, undefined);
	assert.equal(preferences.providers.impl, "pi-peer");
	assert.equal(preferences.providers.custom, "human-provider/model");
	assert.ok(!preferences.preferences.some((value) => value.startsWith("Use codex-lead")));
	assert.ok(preferences.preferences.includes("human preference"));
	assert.ok(!existsSync(path.join(state.paseo, "bin", "codex-role-app-server")));
	for (const role of ["lead", "peer", "supervisor"]) {
		assert.ok(!existsSync(path.join(state.codex, `paseo-${role}.config.toml`)));
		assert.ok(existsSync(path.join(state.roleRoots.codex, role, "private-session.json")));
	}
	assert.ok(readdirSync(state.paseo).some((name) => name.startsWith("config.json.paseo-learn-uninstall.")));
}

{
	const state = fixture();
	writeFileSync(path.join(state.paseo, "bin", "codex-role-app-server"), "operator customization\n");
	const applied = run(state, "codex", "--apply");
	assert.equal(applied.status, 0, applied.stderr);
	assert.match(applied.stderr, /preserve: .*codex-role-app-server/);
	assert.equal(readFileSync(path.join(state.paseo, "bin", "codex-role-app-server"), "utf8"), "operator customization\n");
}

{
	const state = fixture();
	const applied = run(state, "all", "--apply", "--force", "--purge-role-homes");
	assert.equal(applied.status, 0, applied.stderr);
	const config = JSON.parse(readFileSync(path.join(state.paseo, "config.json"), "utf8"));
	assert.deepEqual(Object.keys(config.agents.providers), ["human-provider"]);
	assert.deepEqual(config.daemon.agentProfiles, [{ id: "human:keep", provider: "custom" }]);
	for (const root of Object.values(state.roleRoots)) {
		for (const role of ["lead", "peer", "supervisor"]) {
			assert.ok(!existsSync(path.join(root, role)));
		}
	}
}

{
	const state = fixture();
	const launcher = path.join(state.paseo, "bin", "codex-role-app-server");
	writeFileSync(path.join(state.paseo, "config.json"), "{ invalid json\n");
	const failed = run(state, "codex", "--apply");
	assert.notEqual(failed.status, 0);
	assert.ok(existsSync(launcher));
}

console.log("[paseo-team] uninstall tests passed");
