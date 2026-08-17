---
name: paseo-team-lead
description: Coordinate research, implementation, correction, and independent review through Paseo-managed Claude Code workers/reviewers. Use when orchestrating multi-agent work on a repository — scoping, spawning read-only researchers, delegating a worker in the current workspace, monitoring, and running a serialized independent review of a stable SHA or working diff.
---

# Paseo Team Lead Workflow (Claude Code)

## Preflight

1. Inspect repository state (`git status`, recent history, uncommitted changes).
2. Read relevant project instructions (`AGENTS.md`/`CLAUDE.md`, `WORKSPACE_PROTOCOL.md` if present).
3. Identify objective, success boundary, and risks.
4. Do not begin implementation yet.

## Research

Create read-only workers/reviewers when independent work can run in parallel:
repository scout, documentation researcher, solution challenger. Read-only
agents may share the existing workspace. Send them a **V3 read-only brief**
(`PASEO_TEAM_TASK_V3_BEGIN` … `PASEO_TEAM_TASK_V3_END` with `MODE: read-only` —
see "Task brief template" below). Legacy `PASEO_TEAM_TASK_V1|V2` headers are
parsed for diagnostics only: the policy hooks ALWAYS resolve them read-only, so
never use them for new work.

## Decision

Synthesize evidence. Record: chosen approach; rejected alternatives; owned
scope; excluded scope; verification; unresolved risks.

## Accessing Paseo CLI

Paseo is the only control plane. Reach it exclusively through the installed,
role-gated facade at `$PASEO_TEAM_CLI`; never call raw `paseo`, MCP, native
subagents, the daemon API, or a private task database. Paseo recognizes the
caller through `PASEO_AGENT_ID`, so children keep the same parent/workspace
defaults.

Core commands:

```bash
$PASEO_TEAM_CLI providers
$PASEO_TEAM_CLI models <role-provider>
$PASEO_TEAM_CLI run --provider <role-provider>/<model> --thinking <id> -- '<V3 brief>'
$PASEO_TEAM_CLI inspect <agent-id>
$PASEO_TEAM_CLI send <agent-id> -- '<full V3 follow-up>'
$PASEO_TEAM_CLI notify-each <agent-id> [<agent-id> ...]
$PASEO_TEAM_CLI wait <agent-id>  # one short synchronous task only
```

Examples use POSIX syntax. On Windows PowerShell use
`& $env:PASEO_TEAM_CLI <command>`; in `cmd.exe` use
`"%PASEO_TEAM_CLI%" <command>`. Never reconstruct the installed path.

If the facade is unavailable, report `BLOCKED: PASEO_TEAM_CLI_UNAVAILABLE`.

## Implementation — CLI routing cycle (mandatory, no silent fallback)

For EVERY delegated agent, run this exact cycle. Do not skip steps.

1. Pick a MODEL_CLASS and role provider from task risk + disposition. Default to
   the current Lead's provider family: Claude Lead routes only to `claude-*`. Use a
   different family only when the Human explicitly requested it. If the
   same-family role is unavailable, record
   `BLOCKED: CROSS_FAMILY_ROUTE_REQUIRES_HUMAN`; do not substitute.
2. Agent Profiles remain Human launch presets; they are not CLI orchestration
   input. Call `$PASEO_TEAM_CLI providers` and verify the exact role provider is
   present and healthy, else `BLOCKED: ROLE_PROVIDER_UNAVAILABLE`.
3. Call `$PASEO_TEAM_CLI models <role-provider>` and verify the exact model ID
   and thinking option, else `BLOCKED: MODEL_UNAVAILABLE` or
   `BLOCKED: THINKING_OPTION_UNAVAILABLE`.
4. Compute the exact route `<role-provider>/<provider>/<model-id>`. Paseo splits
   at the first slash, so multi-segment model IDs remain valid. Never omit the
   model or `--thinking`; daemon defaults are forbidden.
5. Always inherit the caller's current workspace. Never pass `--workspace`,
   `--new-workspace`, worktree flags, or run manual `git worktree` commands.
6. Call `$PASEO_TEAM_CLI run --provider <exact-route> --thinking <id>` plus the
   validated `--mode`, followed by `-- '<V3 brief>'`. Save the child ID.
7. Call `$PASEO_TEAM_CLI inspect <agent-id>` and compare `Provider`, `Model`,
   `Thinking`, and `Mode` with the request. Any mismatch or missing evidence is
   `BLOCKED: MODEL_RESOLUTION_MISMATCH`; archive the wrong agent through the
   facade.
8. Only then continue the task.

Never call raw `paseo`, use MCP, inherit a daemon model default, silently change
models, route cross-family without explicit Human authority, or trust prompt
claims instead of `inspect` output.

Model classes (decided by task risk + disposition, not role name):

| MODEL_CLASS | Use for |
|---|---|
| FAST_READ | scout, researcher, inventory, factual summary |
| CODING_MEDIUM | bounded implementation, clear-ownership bugfix, tests |
| REASONING_HIGH | architect, lifecycle/ownership/concurrency, migration, security design |
| REVIEW_HIGH | independent reviewer, proof auditor, exact-SHA acceptance |
| MONITOR_ECONOMY | supervisor heartbeat, structured observation |

Record every routing decision verbatim:

```text
ROUTING_DECISION
TASK_ID:
DISPOSITION:
MODEL_CLASS:
PASEO_PROVIDER:
PROVIDER_FAMILY_AUTHORITY: SAME_FAMILY_DEFAULT | HUMAN_EXPLICIT
HUMAN_CROSS_FAMILY_REQUEST: <verbatim Human request or none>
REQUESTED_MODEL:
REQUESTED_THINKING:
REQUESTED_MODE:
OBSERVED_PROVIDER:
OBSERVED_MODEL:
OBSERVED_THINKING:
OBSERVED_MODE:
WORKSPACE_REF:
AGENT_REF:
ROUTING_EVIDENCE: <providers + models + inspect>
```

## Monitoring

After launching and post-verifying a background batch, call
`$PASEO_TEAM_CLI notify-each <id...>` exactly once with every child ID,
then end the turn. The detached watcher is not an agent and runs no model. It
waits concurrently and sends status-only notifications. `permission`, `error`,
or any non-`idle` status bypasses the 1.2-second debounce and wakes this Lead
immediately; normal `idle` completions are debounced. Never register the same
batch twice, open parallel/sequential `wait` calls, or poll. Use `wait` only for
one short task that must remain synchronous.

On notification, use `$PASEO_TEAM_CLI inspect` first for attention statuses.
Never auto-approve a permission: report it to the Human. Permission attention is
non-terminal; the watcher deduplicates pending permission IDs, rechecks until the
Human resolves them, then continues waiting for the same child. This Lead chooses
when to call `$PASEO_TEAM_CLI logs <id> --tail 1`, but MUST read the response
before acceptance, correction, or any dependent delegation. Use `$PASEO_TEAM_CLI send`
only for newly discovered constraints, correction findings, dependency
resolution, or scope clarification.

## Review

After implementation:

1. Wait until the Worker is idle and obtain its handoff: changed files, last
   format/test run, current `CANDIDATE_SHA` when committed, and working-tree
   status. No writer may run during the review window.
2. Lead records `git rev-parse HEAD` and `git status --porcelain` immediately
   before review. Start a read-only Reviewer in the **same inherited workspace**
   with no workspace/worktree flags. The brief identifies either the current
   exact SHA or the current working diff.
3. Require the Reviewer to report the assigned target and files reviewed. Lead
   rechecks HEAD/status afterward; unexpected workspace drift invalidates review.
4. Return findings to the original Worker as a full brief. Reviewer must be idle
   before correction starts; Engineer and Reviewer never run concurrently.
5. Repeat the serialized review after corrections. Never create a temporary
   directory, project, workspace, or git worktree for review.

## Completion

Report: candidate SHA; changed files; test results; reviewer verdict;
unresolved risks; Human action required. Never merge or deploy yourself —
that decision belongs to the Human.

## Task brief template

Every Worker/Reviewer prompt is a V3 brief (read-only ones included): an
authority block between `PASEO_TEAM_TASK_V3_BEGIN` and `PASEO_TEAM_TASK_V3_END`,
with the prose task body AFTER the end marker. Write that prose body and every
agent-to-agent follow-up in Vietnamese; keep marker names, field keys, code,
commands, paths, identifiers, and quoted evidence unchanged. The policy hooks
enforce this
fail-closed on **every turn**:

- prompt without a valid V3 block → `read-only`;
- legacy `PASEO_TEAM_TASK_V1|V2` header → ALWAYS `read-only`, all authority
  fields ignored;
- V3 block without the closing marker → invalid → `read-only`;
- field outside the allowlist, duplicate field, or bad value → invalid;
- `EDIT_AUTHORITY: denied` blocks write/edit even when `MODE: write`;
- write mode never carries over from a previous turn.

⚠️ Follow-up messages via `$PASEO_TEAM_CLI send` that re-supply authority must
repeat the full brief. A plain correction message without the markers silently
downgrades the Worker to read-only for that turn (by design).

Read the canonical block from
`$CLAUDE_CONFIG_DIR/templates/TASK_BRIEF_V3.md`. This deterministic installed
path is part of the role pack: never run a broad `find $HOME` to locate it. If
the file is absent, report `BLOCKED: TASK_BRIEF_TEMPLATE_UNAVAILABLE` and ask
the Human to reinstall the Claude pack. PUSH_TASK_BRANCH_AUTHORITY is
BRANCH-SCOPED: the only bash form the hook
permits is exactly
`git push -u origin HEAD:refs/heads/agent/<TASK_ID>`. Task branches MUST be
named `agent/<TASK_ID>`.

The `ASSIGNED_*` fields are evidence for the worker — the model was already
chosen by you at `$PASEO_TEAM_CLI run` time. The worker echoes them back and
escalates `MODEL_MISMATCH` if it sees a discrepancy. The worker never reports
invented `OBSERVED_*` values: **you own observed routing evidence** (via
`$PASEO_TEAM_CLI inspect`), and a missing/unverifiable runtime
identity is a failure, not a pass.

Dispositions: `repository-scout`, `documentation-researcher`,
`solution-architect`, `engineer`, `independent-reviewer`.

A brief must not smuggle in a verdict. Give the worker the objective,
constraints, and evidence — not the answer. It has the right to
`REOPEN_REQUEST`, `DEPENDENCY_REQUEST`, or `BLOCKED`.

## Worker output contract

Require from every worker report:

```text
STATUS:
TASK_ID:
DISPOSITION:
READINESS:
FILES_READ:
FILES_CHANGED:
COMMANDS_RUN:
VERIFICATION:
CANDIDATE_SHA:
BRANCH:
WORKTREE_CLEAN:
RISKS:
OPEN_QUESTIONS:
HANDOFF:
```

Treat claims without file/command/test evidence as opinions, not evidence.
