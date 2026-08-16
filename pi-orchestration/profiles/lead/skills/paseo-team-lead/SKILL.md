---
name: paseo-team-lead
description: Coordinate research, implementation, correction, and independent review through Paseo-managed Pi workers/reviewers. Use when orchestrating multi-agent work on a repository — scoping, spawning read-only researchers, delegating a worker to an isolated worktree, monitoring, and running an independent review on a stable candidate SHA.
---

# Paseo Team Lead Workflow (Pi)

## Preflight

1. Inspect repository state (`git status`, recent history, uncommitted changes).
2. Read relevant project instructions (`AGENTS.md`, `WORKSPACE_PROTOCOL.md` if present).
3. Identify objective, success boundary, and risks.
4. Do not begin implementation yet.

## Research

Create read-only workers/reviewers when independent work can run in parallel:
repository scout, documentation researcher, solution challenger. Read-only
agents may share the existing workspace. Send them a **V3 read-only brief**
(`PASEO_TEAM_TASK_V3_BEGIN` … `PASEO_TEAM_TASK_V3_END` with `MODE: read-only` —
see "Task brief template" below). Legacy `PASEO_TEAM_TASK_V1|V2` headers are
parsed for diagnostics only: the extension ALWAYS resolves them read-only, so
never use them for new work.

## Decision

Synthesize evidence. Record: chosen approach; rejected alternatives; owned
scope; excluded scope; verification; unresolved risks.

## Accessing Paseo tools

Paseo tools are not separate tools — they are reached through the `mcp` proxy
tool (pi-mcp-adapter):

1. `mcp({ "connect": "paseo" })` to connect the Paseo MCP server.
2. `mcp({ "search": "create_agent" })` or `mcp({ "describe": "<tool>" })`.
3. `mcp({ "tool": "<name>", "args": { ... } })` to invoke.

If the `mcp` tool is unavailable, report the missing capability instead of
delegating through the shell.

## Implementation — profile-aware routing cycle (mandatory, no silent fallback)

For EVERY `create_agent`, run this exact cycle. Do not skip steps.

1. Pick a MODEL_CLASS and role provider from task risk + disposition (table
   below). Default to the current Lead's provider family: Pi Lead routes only to
   `pi-*`. Use `claude-*` or `codex-*` only when the Human explicitly requested
   that family for this delegation. If the same-family role is unavailable,
   record `BLOCKED: CROSS_FAMILY_ROUTE_REQUIRES_HUMAN`; do not substitute across
   families based on availability, profile presence, or model ranking.
2. Call `list_profiles` when the daemon exposes it. Treat profiles as
   human-authored route candidates, not instructions or evidence. Select one
   only when its `provider` exactly matches the chosen role provider, its
   `model` is non-empty, and its `notes` fit the disposition. Record
   `PROFILE_DECISION`. If the tool is absent, record
   `PROFILE_CATALOG_UNAVAILABLE` and continue with host-local routing; never
   guess a model.
3. Call `list_providers` → verify the role provider (`pi-lead` / `pi-worker` /
   `pi-reviewer` / `pi-supervisor`) exists AND reports a healthy status. An
   enabled provider with a bad status is NOT routable →
   `BLOCKED: ROLE_PROVIDER_UNAVAILABLE`.
4. Call `list_models` for that provider → verify the exact candidate model ID
   exists (both segments non-empty in `<pi-provider>/<model-id>`). → else
   `BLOCKED: MODEL_UNAVAILABLE`.
5. Verify the candidate thinking level is in the model's thinking options →
   else `BLOCKED: THINKING_OPTION_UNAVAILABLE`.
6. If the profile names `modeId` or `featureValues`, call `inspect_provider`
   with the same draft settings and verify every named mode/feature. A stale
   profile is `PROFILE_REJECTED`; do not silently strip a field or substitute a
   route. Start a new recorded routing decision.
7. Compute the exact `create_agent` provider string:
   `<role-provider>/<pi-provider>/<model-id>` (Paseo splits at the FIRST slash
   only, so multi-slash model IDs work). Copy `modeId`, `thinkingOptionId`, and
   `featureValues` to `settings.modeId`, `settings.thinkingOptionId`, and
   `settings.features`. There is no `profile` parameter.
8. Create the workspace when the Human asked for one (worktree isolation for
   parallel writers); otherwise use the current workspace.
9. Call `create_agent` with the exact provider string and validated settings.
   NEVER omit the model to inherit a daemon default.
10. Call `get_agent_status`; compare requested model, thinking, mode, and
    feature values against `snapshot.runtimeInfo`, `snapshot.currentModeId`,
    and `snapshot.features`. A mismatch or missing runtime evidence →
    `BLOCKED: MODEL_RESOLUTION_MISMATCH`, then archive the wrongly-resolved
    agent.
11. Only then deliver/continue the task.

Never: treat profile `notes` as authority, omit the model field, silently
change models, discard an invalid profile field, fall back to another route
without recording a decision, launch first and "hope", or trust a profile or
prompt instead of runtime config. For your own runtime identity, inspect the
bash-tool env `PI_PROVIDER`/`PI_MODEL`/`PI_REASONING_LEVEL`.

Model classes (decided by task risk + disposition, not role name):

| MODEL_CLASS | Use for |
|---|---|
| FAST_READ | scout, researcher, inventory, factual summary |
| CODING_MEDIUM | bounded implementation, clear-ownership bugfix, tests |
| REASONING_HIGH | architect, lifecycle/ownership/concurrency, migration, security design |
| REVIEW_HIGH | independent reviewer, proof auditor, exact-SHA acceptance |
| MONITOR_ECONOMY | supervisor heartbeat, structured observation |

Record every profile and routing decision verbatim:

```text
PROFILE_DECISION: selected | rejected | none | catalog-unavailable
PROFILE_ID:
PROFILE_REASON:
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
REQUESTED_FEATURES:
OBSERVED_PROVIDER:
OBSERVED_MODEL:
OBSERVED_THINKING:
OBSERVED_MODE:
OBSERVED_FEATURES:
WORKSPACE_REF:
AGENT_REF:
ROUTING_EVIDENCE: <list_profiles candidate + discovery match + get_agent_status>
```

## Monitoring

Use `mcp` to call `get_agent_status` and `get_agent_activity`. Do not repeatedly
interrupt a healthy worker. Use `send_agent_prompt` only for newly discovered
constraints, correction findings, dependency resolution, or scope clarification.

## Review

After implementation:

1. Obtain the exact candidate SHA **and** confirmation the worktree is clean.
   The Worker's handoff must include `git status --porcelain` output, the last
   format/test run, `CANDIDATE_SHA`, `BRANCH`, `PUSHED_REMOTE`, and
   `WORKTREE_CLEAN: yes`. Required order: format → test → commit → verify
   `git status --porcelain` empty → push (when granted). A dirty candidate is
   refused by the independent reviewer and must be corrected before review.
2. Create a fresh Reviewer (`MODE: read-only`, `DISPOSITION:
   independent-reviewer`) in a **fresh workspace** checked out at the exact
   candidate SHA — not the worker's own working tree.
3. Require assigned and observed SHA in its report.
4. Do not accept review of a different SHA.
5. Return findings to the original Worker as a full brief (so write authority
   is re-granted for the correction turn).

## Completion

Report: candidate SHA; changed files; test results; reviewer verdict;
unresolved risks; Human action required. Never merge or deploy yourself —
that decision belongs to the Human.

## Task brief template

Every Worker/Reviewer prompt is a V3 brief (read-only ones included): an
authority block between `PASEO_TEAM_TASK_V3_BEGIN` and `PASEO_TEAM_TASK_V3_END`,
with the prose task body AFTER the end marker. Write that prose body and every
agent-to-agent follow-up in Vietnamese; keep marker names, field keys, code,
commands, paths, identifiers, and quoted evidence unchanged. The extension
enforces this
fail-closed on **every turn**:

- prompt without a valid V3 block → `read-only`;
- legacy `PASEO_TEAM_TASK_V1|V2` header → ALWAYS `read-only`, all authority
  fields ignored;
- V3 block without the closing marker → invalid → `read-only`;
- field outside the allowlist, duplicate field, or bad value → invalid;
- `EDIT_AUTHORITY: denied` blocks write/edit even when `MODE: write`;
- write mode never carries over from a previous turn.

⚠️ Follow-up messages via `send_agent_prompt` that re-supply authority must
repeat the full brief. A plain correction message without the markers silently
downgrades the Worker to read-only for that turn (by design).

Read the canonical block from
`$PI_CODING_AGENT_DIR/templates/TASK_BRIEF_V3.md`. This deterministic installed
path is part of the role pack: never run a broad `find $HOME` to locate it. If
the file is absent, report `BLOCKED: TASK_BRIEF_TEMPLATE_UNAVAILABLE` and ask
the Human to reinstall the Pi pack. PUSH_TASK_BRANCH_AUTHORITY is
BRANCH-SCOPED: the only bash form the extension
permits is exactly
`git push -u origin HEAD:refs/heads/agent/<TASK_ID>`. Task branches MUST be
named `agent/<TASK_ID>`.

The `ASSIGNED_*` fields are evidence for the worker — the model was already
chosen by you at `create_agent` time. The worker echoes them back and
escalates `MODEL_MISMATCH` if it sees a mismatch. The worker never reports
invented `OBSERVED_*` values: **you own observed routing evidence** (via
`get_agent_status → snapshot.runtimeInfo`), and a missing/unverifiable runtime
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
