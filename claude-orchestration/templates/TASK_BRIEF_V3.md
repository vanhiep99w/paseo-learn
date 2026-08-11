# Paseo Team Task Brief V3 — canonical template

Copy this block into the FIRST lines of every Worker/Reviewer prompt (read-only
ones included). The authority block sits BETWEEN the markers; the prose task
body goes AFTER the end marker. The policy hooks (UserPromptSubmit +
PreToolUse) parse this strict block on every turn — anything malformed,
duplicated, or outside the allowlist resolves fail-closed to read-only.

```text
PASEO_TEAM_TASK_V3_BEGIN

TASK_ID: T-<number>
PROJECT_ID: <project>
DISPOSITION: <repository-scout|documentation-researcher|solution-architect|engineer|independent-reviewer>
MODE: write | read-only

ASSIGNED_HOST_ID: <host-id>
ASSIGNED_PASEO_PROVIDER: <claude-supervisor|claude-lead|claude-worker|claude-reviewer>
ASSIGNED_MODEL: <provider>/<model-id>                 # exact, from list_models
ASSIGNED_THINKING: <off|low|medium|high|xhigh>        # provider-native effort/thinking
WORKSPACE_REF: <worktree-or-workspace>
AGENT_REF:

EXPECTED_BASE_SHA: <sha>                              # writer preconditions
ASSIGNED_CANDIDATE_SHA: <sha>                         # reviewer only; exact

OWNED_SCOPE: <files>
EXCLUDED_SCOPE: <files>

EDIT_AUTHORITY: allowed | denied                      # default: follows MODE
COMMIT_AUTHORITY: allowed | denied                    # default: denied
PUSH_TASK_BRANCH_AUTHORITY: allowed | denied          # default: denied
FORCE_PUSH_AUTHORITY: denied                          # always denied for workers
MERGE_AUTHORITY: denied                               # always denied for workers
DEPLOY_AUTHORITY: denied                              # always denied

VERIFICATION_PROFILE: <focused-test|independent-review|...>
RETURN_CHANNEL: paseo

PASEO_TEAM_TASK_V3_END

TASK_BODY_BEGIN
OBJECTIVE:
  <what success looks like, in objective terms — not the answer>

SUCCESS_BOUNDARY:
  <the precise, checkable condition that means "done">

KNOWN_EVIDENCE:
  <files read, prior findings, base SHA, test state>

CONSTRAINTS:
  <ownership boundaries, forbidden areas, non-goals>

REQUIRED_HANDOFF:
  <exact artifacts the Lead expects: SHA, diff, test output, clean-tree proof>

QUESTIONS_TO_ANSWER:        # optional, for read-only scouts/architects
  <open questions the Lead needs answered>
TASK_BODY_END
```

## Rules

- A brief must not smuggle in a verdict. State the objective, constraints, and
  evidence — not the solution.
- `MODE: write` is necessary but not sufficient for write/edit: an explicit
  `EDIT_AUTHORITY: denied` strips write/edit even on a write-mode turn.
- `COMMIT_AUTHORITY` and `PUSH_TASK_BRANCH_AUTHORITY` are denied by default;
  grant them only when the task truly needs a stable SHA (e.g. cross-host
  review).
- `FORCE_PUSH_AUTHORITY`, `MERGE_AUTHORITY`, `DEPLOY_AUTHORITY` are always
  `denied` for workers — the hooks ignore any other value.
- When granted, push authority is BRANCH-SCOPED: the only permitted bash form
  is `git push -u origin HEAD:refs/heads/agent/<TASK_ID>` (task branch must be
  named `agent/<TASK_ID>`). Force-push in any spelling is always blocked.
- Every follow-up `send_agent_prompt` that needs authority must repeat the full
  brief. A plain correction message without the markers downgrades the worker
  to read-only for that turn.
- The Reviewer always runs `MODE: read-only`; it ignores write/authority
  fields entirely (the hooks make it behaviorally read-only regardless).
