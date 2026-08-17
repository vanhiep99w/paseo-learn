# Pack: pi-orchestration (Pi CLI)

The Pi pack runs the four governed roles under Paseo with per-role
`PI_CODING_AGENT_DIR` homes. Shared concepts are in
[../architecture.md](../architecture.md).

## Role resources

Each role home contains its own `AGENTS.md`, `settings.json`, skills, prompts,
and the shared `paseo-team-policy.ts` extension. Credentials, package storage,
and model catalog are symlinked from the normal Pi home.

| Role | Effective tools | Orchestration |
|---|---|---|
| Lead | `read`/`bash`; write/edit only with `PASEO_TEAM_LEAD_WRITE=1` | role-gated `$PASEO_TEAM_CLI` |
| Worker | read-only turn: `read`; write turn: bounded write/edit/bash | denied |
| Reviewer | `read` only | denied |
| Supervisor | `read` + Bash restricted to one facade invocation | monitoring + gated Lead recovery |

Pi no longer needs `pi-mcp-adapter` for this pack. No role has `mcp.json`, and
all MCP proxy calls are denied by policy.

## CLI facade

`pi-orchestration/bin/paseo-team` is installed at
`$PASEO_HOME/bin/paseo-team`. Provider env sets `PASEO_TEAM_CLI` and
`PASEO_PI_ROLE`. The wrapper requires `PASEO_AGENT_ID`, uses the public `paseo`
CLI, and enforces the role matrix described in
[Role-gated CLI facade](../architecture.md#role-gated-cli-facade).

All four providers use plain `command: ["pi"]`; no MCP-injecting launcher is
used.

## Hard policy

`pi-orchestration/shared/paseo-team-policy.ts`:

- applies per-role active-tool lists with `setActiveTools()`;
- reparses V3 authority every Worker turn;
- canonicalizes `OWNED_SCOPE` and enforces git authority;
- blocks native subagents, raw `paseo`, MCP, and unauthorized wrapper use;
- restricts Supervisor Bash to a simple wrapper invocation without shell
  control operators.

## Install and validation

```bash
./install pi
node --check pi-orchestration/shared/paseo-team-policy.ts
node test/active-policy.test.mjs
node test/cli-orchestration.test.mjs
```

The installer copies the policy and facade to stable `$PASEO_HOME` paths,
creates role homes, merges providers and Human-facing Agent Profiles, disables
daemon-wide MCP injection, and never restarts Paseo.

The full Pi Lead→Worker→Reviewer live flow remains beta/unverified on this host.
