# Pack: codex-orchestration (Codex CLI)

The Codex pack runs four governed roles under Paseo with per-role `CODEX_HOME`
directories. Shared concepts are in
[../architecture.md](../architecture.md).

## Role resources

Each role home contains `config.toml`, `hooks.json`, policy hook scripts, and a
shared auth symlink. Profiles use `danger-full-access`; authority comes from
instructions and hooks rather than a sandbox.

| Role | Effective capability | Orchestration |
|---|---|---|
| Lead | full runtime; product writes disabled by default | role-gated `$PASEO_TEAM_CLI` |
| Worker | current-turn V3 authority + `OWNED_SCOPE` | denied |
| Reviewer | behaviorally read-only | denied |
| Supervisor | shell restricted by hook to the facade | monitoring + gated Lead recovery |

All providers use plain `command: ["codex"]`; there is no MCP-injecting
app-server launcher.

## CLI facade

`codex-orchestration/bin/paseo-team` is installed at
`$PASEO_HOME/bin/paseo-team`. Provider env sets `PASEO_TEAM_CLI` and
`PASEO_CODEX_ROLE`. The wrapper requires `PASEO_AGENT_ID`, delegates to the
public Paseo CLI, and enforces exact provider/model + thinking on every spawn.

## Policy hooks

`codex-orchestration/shared/paseo-team-policy/` enforces:

- V3 Task Brief authority and owned scope;
- branch-scoped git push and permanent force-push/merge/deploy denial;
- native-subagent, raw-Paseo, and MCP denial;
- Worker/Reviewer orchestration denial;
- restricted Supervisor wrapper use and recovery shape.

Hook behavior must still be verified against the exact installed Codex version;
this remains a behavioral boundary on a trusted machine.

## Install and validation

```bash
./install codex
node --check codex-orchestration/shared/paseo-team-policy/*.mjs
node test/codex-policy.test.mjs
node test/cli-orchestration.test.mjs
```

The installer creates role homes, copies hooks and the facade, merges providers,
disables daemon-wide MCP injection, preserves Human Agent Profiles, and never
restarts Paseo.
