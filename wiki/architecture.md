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
agent that needs to delegate uses the installed **`paseo-team` CLI facade**. The
facade shells out to the public `paseo` CLI; it does not call MCP or the daemon
API directly. Paseo recognizes the caller through `PASEO_AGENT_ID`, so CLI-created
agents preserve parentage and current-workspace defaults.

```bash
$PASEO_TEAM_CLI providers
$PASEO_TEAM_CLI models pi-worker
$PASEO_TEAM_CLI run --provider pi-worker/openai-codex/model --thinking high -- '<V3 brief>'
$PASEO_TEAM_CLI inspect <agent-id>
$PASEO_TEAM_CLI send <agent-id> -- '<full V3 follow-up>'
```

Raw `paseo`, MCP, provider-native subagents, direct daemon API calls, and private
task databases are forbidden orchestration paths. Work still appears in Paseo's
Subagents track; cross-workspace children remain under their parent.

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

A follow-up through `$PASEO_TEAM_CLI send` that needs authority must **repeat the full
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

## Role-gated CLI facade

Every active pack ships the same executable source at `<pack>/bin/paseo-team`;
installers place it at `$PASEO_HOME/bin/paseo-team` and set
`PASEO_TEAM_CLI` in every role provider. The wrapper requires
`PASEO_AGENT_ID` and exactly one role environment.

- **Lead:** provider/model discovery, workspace lifecycle, spawn, inspect, logs,
  follow-up, completion notification, bounded synchronous wait, and archive.
  `run` requires an exact provider/model route and explicit thinking option.
- **Supervisor:** observation and Lead messaging, plus one recovery-gated
  successor-Lead `run`. Workspace overrides and non-Lead providers are rejected.
- **Worker/Reviewer:** every wrapper command is rejected.

`notify-each <id...>` starts one detached, non-agent Node watcher. It opens
concurrent event waits through the CLI, fetches only each agent's final response
with `logs --tail 1`, bounds response size, and marks it as untrusted data.
Completions within 1.2 seconds are debounced into one prompt; otherwise each
agent wakes the Lead immediately. The final event is
`PASEO_TEAM_BATCH_COMPLETED`, so no extra batch message is needed. Deterministic
state under `$PASEO_HOME/paseo-team-watchers/` prevents duplicate registration.
Leads end their turn after registration; manual waits and polling are forbidden
except one short synchronous task.

The Pi extension and Claude/Codex hooks additionally block raw `paseo`, all MCP
paths, and wrapper use by Worker/Reviewer. Supervisor shell access is restricted
to one simple wrapper invocation without shell control operators. This remains a
behavioral/capability-exposure boundary, not an OS security sandbox.

Daemon-wide MCP injection remains disabled so project or host configuration does
not accidentally expose a second orchestration path. The installers do not need
MCP enabled and do not install role MCP configuration.

## No silent fallback (CLI routing)

Paseo Agent Profiles remain optional Human launch presets. The public CLI does
not expose profiles as an orchestration input, so Leads never infer or copy a
route from them. Installers may still merge namespaced host-default profiles for
the app's Human launch experience; those profiles grant no role authority.

The mandatory CLI cycle is:

1. Choose role/MODEL_CLASS under same-family routing. Cross-family routing needs
   the Human's explicit request.
2. `$PASEO_TEAM_CLI providers` verifies the exact role provider is healthy.
3. `$PASEO_TEAM_CLI models <role-provider>` verifies the exact model and thinking
   option.
4. `$PASEO_TEAM_CLI run` pins `<role-provider>/<provider>/<model-id>`,
   `--thinking`, optional `--mode`, labels, and workspace placement. Omitting the
   model or thinking option is rejected by the wrapper.
5. `$PASEO_TEAM_CLI inspect <agent-id>` verifies observed Provider, Model,
   Thinking, and Mode. Missing or mismatched evidence is
   `BLOCKED: MODEL_RESOLUTION_MISMATCH`; archive the wrong agent.

The Lead owns observed routing evidence. Workers echo `ASSIGNED_*` fields and
report mismatch; they never invent `OBSERVED_*` values or change their model.
There is no silent repair, daemon-default inheritance, or cross-family fallback.

## Why three enforcement mechanisms

The orchestration transport is now identical across packs (`paseo-team` → public
Paseo CLI), but each provider still exposes policy enforcement differently:

- **Codex:** per-role `CODEX_HOME`, developer instructions, and
  `PreToolUse`/`UserPromptSubmit` hooks.
- **Pi:** per-role `PI_CODING_AGENT_DIR`, `AGENTS.md`, and an in-process
  extension using `setActiveTools()` plus a `tool_call` backstop.
- **Claude Code:** per-role `CLAUDE_CONFIG_DIR`, `CLAUDE.md`, permissions, and
  `PreToolUse`/`UserPromptSubmit` hooks.

All three block native subagents and MCP, gate raw Paseo CLI, preserve V3 Task
Brief authority, and expose orchestration only through the same wrapper contract.
