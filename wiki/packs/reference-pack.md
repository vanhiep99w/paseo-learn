# Reference pack: tai-lieu-tham-khao (paseo-pi-team)

`tai-lieu-tham-khao/` is the original Pi role pack, named **paseo-pi-team**. Its
own `README.md` describes it as reference material kept for orchestration design;
the two active root packs (`codex-orchestration/`, `pi-orchestration/`) are the
ones intended for use. Read this page when you need the **four-layer model
routing system**, the **unit-tested policy extension**, or the original
three-role design.

Shared concepts are in [../architecture.md](../architecture.md); this page covers
what differs from the active packs.

## How it differs from the active packs

| Aspect | Active packs | This reference pack |
|---|---|---|
| Roles | 4 (lead/worker/reviewer/supervisor) | 3 (lead/peer/supervisor); peer = worker\|reviewer via `MODE` |
| MCP injection | `injectIntoAgents=false` + launcher-selective | `injectIntoAgents=true` (global) + extension `setActiveTools` blocks peers |
| Role config | per-role `CODEX_HOME` / `PI_CODING_AGENT_DIR` | one shared extension + prompts under `~/.pi/agent/` |
| Model routing | discovery + no-silent-fallback verify | full **four-layer** system with resolver + preflight |
| Enforcement (Pi) | instruction + `includeTools` + extension | extension only (`setActiveTools` + `tool_call`) |

The 3-role model splits writer and reviewer into one `peer` role whose `MODE`
(write/read-only) and authority fields come from the V3 brief. The active packs
promote these to first-class `worker`/`reviewer` roles instead.

## Role policy extension

`tai-lieu-tham-khao/extensions/paseo-team-policy.ts` is the ancestor of
`pi-orchestration/shared/paseo-team-policy.ts`. It is keyed on `PASEO_PI_ROLE`
(`supervisor | lead | peer`), injects the role prompt from
`tai-lieu-tham-khao/prompts/<role>.md`, applies per-role `setActiveTools`
allowlists, and runs the same fail-closed `tool_call` backstop (MCP target
classification, supervisor `create_agent` argument gate, peer git-push
branch-scoping, bash Paseo-CLI guard). It is the most thoroughly unit-tested
artifact in the repo (see [Tests and CI](#tests-and-ci)).

Role prompts: `tai-lieu-tham-khao/prompts/{lead,peer,supervisor}.md`. The Lead
prompt delegates the workflow to the `paseo-team-lead` skill
(`tai-lieu-tham-khao/skills/paseo-team-lead/SKILL.md`).

## The four-layer model routing system

This is the pack's distinctive machinery (full contract in `docs/model-routing.md`
and `docs/multi-host.md`). Layers, from machine-specific to logical:

1. **Pi model inventory** (per host, never committed): `pi` install, auth, and
   `~/.pi/agent/models.json` for custom providers.
2. **Paseo role profiles** (committed template): the three `extends: "pi"`
   providers in `tai-lieu-tham-khao/config/paseo.providers.example.json`
   (`pi-supervisor`, `pi-lead`, `pi-peer`).
3. **Logical model classes** (committed): `MONITOR_ECONOMY`, `FAST_READ`,
   `CODING_MEDIUM`, `REASONING_HIGH`, `REVIEW_HIGH`.
4. **Host-local route** (never committed): `~/.paseo-pi-team/model-routing.local.json`
   maps each class to `{ paseoProvider, model: "<pi-provider>/<model-id>", thinking }`.

For N-host setups, a single controller-local **cluster routing** file
(`~/.paseo-pi-team/cluster-routing.local.json`, template
`tai-lieu-tham-khao/config/cluster-routing.example.json`) describes every host:
`connection` (local or remote via an env-named `endpointEnv`), `required`,
`capabilities`, `limits` (writers/readers), and per-class `routes`. Endpoint
**values** (pairing offers, `tcp://host:port?password=...`) live only in
environment variables; the files reference them by name and never contain
secrets. `tai-lieu-tham-khao/config/hosts.example.json` is the legacy host
registry superseded by the cluster file.

The decision not to pin models into provider profiles is deliberate: model
catalogs are host-specific, and pinning would duplicate machine-specific secrets
into the repo.

### Scripts

- `tai-lieu-tham-khao/scripts/model-routing.mjs` — the **stateless** resolver:
  validates a route file, composes the exact
  `<role-provider>/<pi-provider>/<model-id>` string, validates against a real
  inventory, compares requested vs observed values, and returns structured
  fail-closed errors. It deliberately never stores lifecycle, holds keys, or
  falls back to another model. CLI: `validate`, `resolve --class <CLASS> --json`.
- `tai-lieu-tham-khao/scripts/preflight.mjs` — host readiness check: node/git/
  paseo/pi versions, daemon, adapter pin, extension + prompts, role providers,
  model inventory, routing-config validity, per-model thinking support, cluster
  contract, endpoint env presence, repo state. `--strict --host-id <id>` is the
  cross-host gate; never prints secret values, only env-var names.

Error codes (all fail-closed, no fallback): `CONFIG_INVALID`,
`ROLE_PROVIDER_UNAVAILABLE`, `MODEL_UNAVAILABLE`, `THINKING_OPTION_UNAVAILABLE`,
`MODEL_RESOLUTION_MISMATCH`, `HOST_ROUTE_UNAVAILABLE`.

## Install (reference pack)

`tai-lieu-tham-khao/scripts/install.sh` / `install.ps1` copy the extension to
`~/.pi/agent/extensions/`, the prompts to `~/.pi/agent/extensions/prompts/`, and
the skill to `~/.pi/agent/skills/`. They **do not** merge `~/.paseo/config.json` —
that is manual, using `paseo.providers.example.json`. This is the older
single-shared-agent-dir model, in contrast to the per-role
`PI_CODING_AGENT_DIR` of the active Pi pack.

## Tests and CI

The pack carries the repo's only automated tests and CI:

- `tai-lieu-tham-khao/test/policy.test.mts` — policy + per-turn lifecycle
  regression for the extension (V3 parsing, write-mode-leak prevention, MCP
  classification, git guards). Run: `node test/policy.test.mts` (Node ≥ 23.6 runs
  `.mts` natively).
- `tai-lieu-tham-khao/test/model-routing.test.mjs` — routing resolver regression.
  Run: `node test/model-routing.test.mjs` (Node ≥ 22).
- `tai-lieu-tham-khao/.github/workflows/ci.yml` — matrix (ubuntu/windows/macOS ×
  Node 22.18/24), runs both tests, `node --check` on the scripts, and a `tsc`
  typecheck of the extension using `tsconfig.ci.json`. It pins
  `@earendil-works/pi-coding-agent@0.83.0` and `@types/node@22.19.19` (the
  extension imports `isToolCallEventType` as a runtime value). Live remote Paseo
  checks are explicitly **manual** (need two real hosts).

Verified compatibility matrix (from `tai-lieu-tham-khao/README.md`): Paseo
0.2.5, Pi 0.83.0, pi-mcp-adapter 2.19.0 (pinned), Node ≥ 22.18.

## Example briefs & templates

- `tai-lieu-tham-khao/templates/TASK_BRIEF_V3.md` — V3 brief template.
- `tai-lieu-tham-khao/templates/WORKSPACE_PROTOCOL.example.md` — per-repo
  `WORKSPACE_PROTOCOL.md` a Lead reads before orchestrating.
- `tai-lieu-tham-khao/examples/{engineer,reviewer,architect,scout}-task.md` and
  `supervisor-observation.md` — concrete briefs/observation templates.

## Key source references

- `tai-lieu-tham-khao/extensions/paseo-team-policy.ts` — policy extension (3-role).
- `tai-lieu-tham-khao/scripts/model-routing.mjs`, `preflight.mjs` — routing + readiness.
- `tai-lieu-tham-khao/config/{model-routing,cluster-routing,hosts}.example.json` — routing templates.
- `tai-lieu-tham-khao/test/{policy.test.mts,model-routing.test.mjs}` — tests.
- `tai-lieu-tham-khao/README.md` — pack README with POC results and compatibility matrix.
- `docs/model-routing.md`, `docs/multi-host.md` — the routing contract.
