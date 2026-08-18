# Paseo Team Task Brief — canonical template

Copy this block into the FIRST lines of every Worker/Reviewer prompt. The policy
parses only the marker block on every turn; malformed or unknown fields resolve
fail-closed to `read-only`. Prose after the end marker never grants authority.

Write the prose task body and every agent-to-agent follow-up in Vietnamese.
Keep marker names, field keys, code, commands, paths, identifiers, and quoted
evidence unchanged.

```text
PASEO_TEAM_TASK_V3_BEGIN
TASK_ID: T-<number>
MODE: write | read-only
OWNED_SCOPE: <workspace-relative-root>, <another-root>  # required only for write; `.` means whole workspace
ASSIGNED_CANDIDATE_SHA: <sha>                           # optional; exact-SHA review only
PASEO_TEAM_TASK_V3_END

TASK_BODY_BEGIN
OBJECTIVE:
  <objective outcome — not the solution>

ACCEPTANCE:
  <precise, checkable completion conditions>

CONSTRAINTS:
  <scope boundaries, non-goals, known evidence>

HANDOFF:
  <files changed, tests, SHA/diff, risks, questions>
TASK_BODY_END
```

## Mode semantics

| Mode | Edit | Commit | Push / merge |
|---|---:|---:|---:|
| `read-only` | denied | denied | denied |
| `write` | allowed inside `OWNED_SCOPE` | allowed | allowed on the current/task branch, including `main` |

`FORCE_PUSH`, `git commit --amend`, and deploy remain globally denied regardless
of mode. The parser still accepts legacy per-operation authority fields for
backward compatibility, but ignores them; `MODE` is the only mutable authority
switch.

## Rules

- `OWNED_SCOPE` is mandatory for `MODE: write`. Absolute paths, `..`, empty
  items, and invalid roots fail closed to read-only.
- A brief must not smuggle in a verdict. State the objective, constraints, and
  evidence — not the solution.
- Every follow-up that needs write authority must repeat the full V3 brief. A
  plain follow-up downgrades the Worker to read-only for that turn.
- Reviewer always uses `MODE: read-only`; it cannot write, commit, push, or
  merge.
