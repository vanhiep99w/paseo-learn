# Architecture & shared concepts

This page is the **canonical home** for the concepts every pack shares. The
per-pack pages ([codex](packs/codex-orchestration.md), [pi](packs/pi-orchestration.md),
[claude](packs/claude-orchestration.md), [reference](packs/reference-pack.md)) link
back here instead of repeating these ideas. Read this before changing any role's
behavior or boundaries.

## The four roles

| Role | Identity | What it must NOT do |
|---|---|---|
| **Lead** | Owns decomposition, delegation, model/host routing, and acceptance. Holds whole-project context. | Write product code by default; create two writers for one scope; merge/deploy. |
| **Worker** (Engineer / Peer) | Executes one bounded task in an owned scope. Independent co-worker, not a function call. | Spawn/coordinate agents; broaden scope; force-push/merge/deploy. |
| **Reviewer** | Independently reviews an exact candidate SHA (or the current working diff) against acceptance criteria. | Edit the candidate; commit; change branches; turn preferences into blockers. |
| **Supervisor** | Governance plane: observes process health, may make small reversible decisions, one gated recovery action. | Edit code; coordinate Peers; accept candidates; merge/push/deploy. |

The Worker may return `REOPEN_REQUEST`, `DEPENDENCY_REQUEST`, or `BLOCKED` when
scope overlaps or acceptance is ambiguous. A brief must never smuggle in a
verdict — it gives objective, constraints, and evidence.

## Vietnamese is the default interaction language

Every user-facing response and every agent-to-agent prompt, message, report,
review, and handoff must be in Vietnamese. Code, commands, paths, identifiers,
protocol field names, quoted logs/errors, and required machine-readable tokens
stay in their original form. An explicit Human request for another language may
override this rule only for the specific requested output. This is a behavioral
contract, not a machine-enforced language detector.

## Paseo is the only control plane

There is no private task database, candidate ledger, or integration engine. An
agent that needs to delegate uses the **Paseo MCP**, reached (for Pi) through the
`mcp` proxy tool from `pi-mcp-adapter`:

```
mcp({ "connect": "paseo" })                 // connect the server
mcp({ "search": "create_agent" })           // discover exact tool name
mcp({ "tool": "create_agent", "args": {} }) // invoke
```

For Codex, the same tools are exposed directly because Paseo injects the MCP
server into the agent. Delegation always goes through
`create_agent` / `send_agent_prompt` with `notifyOnFinish=true`; an agent must
never substitute shell commands like `paseo run`/`paseo send`/`paseo wait`.

Work appears in the Paseo **Subagents track**; cross-workspace subagents stay
under their parent's track.

## Capability is not authority

> Capability is not authority.

All roles run with full filesystem and network access:

- **Codex** profiles set `sandbox_mode = "danger-full-access"` and
  `approval_policy = "never"` (see `codex-orchestration/profiles/paseo-*.config.toml`).
- **Pi** has no sandbox at all (see each `pi-orchestration/profiles/<role>/AGENTS.md`).

Their behavior is bounded by **three instruction/policy layers**, not by a
sandbox: the role system prompt, the per-role tool allowlist, and (Pi only) a
hard `tool_call` backstop. These are **behavioral / capability-exposure
boundaries**, not security sandboxes. Use the packs only on trusted machines and
repos. This is documented explicitly in the codex guide
(`docs/codex-profiles-paseo-guide-vi.md` §2 and §10) and each pi role's `AGENTS.md`.

## The V3 Task Brief is the only authority channel

A Worker's write/commit/push authority is **not** a session property — it is
derived from the **current turn's** strict V3 marker block, re-parsed every turn.
The canonical template is `pi-orchestration/templates/TASK_BRIEF_V3.md` (and
`tai-lieu-tham-khao/templates/TASK_BRIEF_V3.md` in the reference pack).

```
PASEO_TEAM_TASK_V3_BEGIN
TASK_ID: ...
MODE: write | read-only
EDIT_AUTHORITY: allowed | denied      # default follows MODE
COMMIT_AUTHORITY: allowed | denied    # default denied
PUSH_TASK_BRANCH_AUTHORITY: ...       # default denied
FORCE_PUSH_AUTHORITY: denied          # always denied
MERGE_AUTHORITY: denied               # always denied
DEPLOY_AUTHORITY: denied              # always denied
PASEO_TEAM_TASK_V3_END
TASK_BODY_BEGIN
...untrusted prose...
TASK_BODY_END
```

Fail-closed rules enforced by `pi-orchestration/shared/paseo-team-policy.ts`
(and the reference extension `tai-lieu-tham-khao/extensions/paseo-team-policy.ts`):

- No valid V3 block this turn → **read-only**. Write mode never leaks across turns.
- Legacy `PASEO_TEAM_TASK_V1|V2` headers → **always read-only**; their old
  whole-prompt scan was an injection surface and is closed.
- A field outside the allowlist, a duplicate field, or a bad value invalidates
  the whole brief → read-only.
- `EDIT_AUTHORITY: denied` strips write/edit even when `MODE: write`.
- `FORCE_PUSH` / `MERGE` / `DEPLOY` are always denied for workers regardless of
  the brief.

**Push is branch-scoped.** The only permitted push form is exactly
`git push -u origin HEAD:refs/heads/agent/<TASK_ID>`; task branches must be named
`agent/<TASK_ID>`. Force-push in any spelling (`-f`, `-uf`, `--force*`, `+refspec`)
and `commit --amend` are always blocked. (See the policy extension's
`gitAuthorityBlockReason`.)

`OWNED_SCOPE` is a comma-separated list of workspace-relative path roots (`.`
means the whole workspace). Pi and Claude policy layers canonicalize direct file
mutation targets, including symlinks, and block paths outside those roots.
Read-only Pi Workers/Reviewers have no Bash; read-only Claude Workers have shell
calls hook-blocked, while Claude Reviewers run in plan mode. Bash on an authorized
write turn is still a behavioral boundary, not filesystem isolation.

A follow-up `send_agent_prompt` that needs authority must **repeat the full
brief**; a plain correction message silently downgrades the Worker to read-only
for that turn, by design.

## Git SHA is the anchor

The commit SHA is the single point of truth between a writer and a reviewer on
possibly different hosts:

- Candidate review happens on an **exact SHA** in a fresh detached workspace —
  not the Worker's working tree.
- The Reviewer refuses a dirty tree or a SHA that does not match the brief.
- Correction returns to the **original** Engineer, produces a **new** commit (no
  amend, no force-push), and the new SHA is reviewed again.
- Cross-host review requires the Engineer brief to grant both `COMMIT` and
  `PUSH_TASK_BRANCH` authority (see `docs/multi-host.md`).

## Selective MCP injection

All packs disable daemon-wide MCP auto-injection and expose the Paseo MCP only
to Lead and Supervisor:

```jsonc
"daemon": { "mcp": { "enabled": true, "injectIntoAgents": false } }
```

- The provider `command` for Lead/Supervisor is a **launcher** that derives the
  agent-scoped URL from `PASEO_AGENT_ID`:
  `http://127.0.0.1:6767/mcp/agents?callerAgentId=<id>`.
- Worker/Reviewer use the plain CLI and have **no** Paseo MCP entry, so they
  cannot orchestrate.
- The Supervisor's Paseo MCP is further filtered: Codex via `enabled_tools` on
  the MCP server (`codex-orchestration/bin/codex-role-app-server`); Pi via
  `includeTools` in `pi-orchestration/profiles/supervisor/mcp.json`; Claude via
  a `PreToolUse` hook on `mcp__paseo__*` in
  `claude-orchestration/shared/paseo-team-policy/policy.mjs` (Claude Code's MCP
  config has no per-tool field, so the allowlist is hook-enforced).

Known limitation: this is a capability-exposure boundary, not a server-side ACL.
`PASEO_AGENT_ID` is assumed to be exported to custom providers by Paseo (as it is
for Codex); if a Paseo build does not export it, the launcher leaves the URL unset
and the role's MCP fails closed rather than impersonating another agent.

## No silent fallback (Agent Profiles + model routing)

Paseo v0.4.0+ Agent Profiles are optional, host-wide route candidates configured
by the Human. They may pin provider/model/mode/thinking/features because they
live with one daemon's catalog, but they are neither runtime evidence nor role
authority. Profile `notes` are advisory. Pi/Claude installers merge four
namespaced, host-default profiles into `daemon.agentProfiles`, preserving every
Human-owned entry and failing on managed-profile drift unless `--force`. Codex
profiles remain Human-managed. Same-family routing is mandatory by default:
Pi Lead selects `pi-*`, Claude Lead selects `claude-*`, and Codex Lead selects
`codex-*`. Cross-family routing requires an explicit Human request for that
provider family; an unavailable same-family role blocks rather than silently
switching families. See [../docs/agent-profiles.md](../docs/agent-profiles.md).

The mandatory cycle (see the Lead skill,
`pi-orchestration/profiles/lead/skills/paseo-team-lead/SKILL.md`):

1. Choose role/MODEL_CLASS; call `list_profiles` when available and record a
   complete role-matching candidate or the reason none was selected.
2. `list_providers` → role provider exists and is healthy.
3. `list_models` → exact model and thinking option exist. If a profile names
   mode/features, `inspect_provider` validates those fields. Reject stale
   profiles without silently stripping or substituting values.
4. `create_agent` with provider string `<profile.provider>/<profile.model>` (or
   the equivalently validated host-local route), copying profile `modeId`,
   `thinkingOptionId`, and `featureValues` into `settings`. Paseo has no
   `profile` parameter and splits the provider string at the **first** slash, so
   multi-segment model IDs work.
5. `get_agent_status` → compare requested model/thinking/mode/features against
   runtime state. Mismatch or missing evidence →
   `BLOCKED: MODEL_RESOLUTION_MISMATCH`; archive the wrongly-resolved agent.

The Lead owns **observed** routing evidence; Workers only echo the `ASSIGNED_*`
fields and escalate `MODEL_MISMATCH` if they detect a discrepancy — they never
report invented `OBSERVED_*` values and never change their own model. For its own
runtime identity, a write-mode Pi agent can inspect the bash-tool env
`PI_PROVIDER` / `PI_MODEL` / `PI_REASONING_LEVEL`; read-only turns report that
runtime verification was unavailable rather than guessing.

Three silent-fallback traps this design guards against (documented in
`docs/model-routing.md`): Paseo silently clamping an invalid thinking level to
`medium`; `list_models` advertising all thinking levels regardless of support;
and `--model` being a pattern match.

## Why three mechanisms for the same model

Codex, Pi, and Claude Code expose configuration differently, which is why the
packs are not identical:

- Codex has native MCP config and a `config.toml` per `CODEX_HOME`; the role
  prompt lives in `developer_instructions` and there is **no enforcement
  extension** — behavior is instruction + `enabled_tools` only.
- Pi has **no native MCP** (it needs the `pi-mcp-adapter` package) and no
  sandbox; the role prompt lives in `AGENTS.md` (a context file under
  `PI_CODING_AGENT_DIR`), and Pi's strength is the **extension** that hard-enforces
  tool allowlists via `setActiveTools()` plus a `tool_call` backstop.
- Claude Code has native MCP, no sandbox, and a `CLAUDE.md` system prompt per
  `CLAUDE_CONFIG_DIR`; the launcher injects the agent-scoped MCP via
  `--mcp-config`, and its strength is **hooks** (`PreToolUse` /
  `UserPromptSubmit`) that hard-enforce the same policy as the Pi extension
  (without the in-process `setActiveTools()` tool introspection).

The [per-pack pages](packs/codex-orchestration.md) map each concept to the exact
files and symbols that implement it.
