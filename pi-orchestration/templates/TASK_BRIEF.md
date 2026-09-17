# Paseo Peer Assignment

For the normal editable assignment, start the Peer prompt with exactly one line:

```text
DISPOSITION: engineer
```

That grants the Engineer write access to the current workspace for this turn.
Start a reviewer, scout, architect, or shadow prompt with its corresponding
`DISPOSITION`; those assignments are read-only. A prompt with no disposition is
read-only.

Use the V3 template below only when the Engineer needs a narrower `OWNED_SCOPE`.
Missing, legacy, malformed, duplicate, or unknown V3 fields fail closed to
`MODE: read-only`; prose after the end marker never grants V3 scope authority.

Write the prose task body and every agent-to-agent follow-up in Vietnamese.
Keep marker names, field keys, code, commands, paths, identifiers, and quoted
evidence unchanged.

```text
PASEO_TEAM_TASK_V3_BEGIN
TASK_ID: T-<number>
DISPOSITION: engineer | scout | architect | reviewer | shadow
MODE: write | read-only
OWNED_SCOPE: <workspace-relative-root>, <another-root>  # required only for engineer + write; `.` means whole workspace
ASSIGNED_CANDIDATE_SHA: <sha>                           # reviewer: exact stable SHA when available
PASEO_TEAM_TASK_V3_END

TASK_BODY_BEGIN
OBJECTIVE:
  <neutral outcome, never a pre-solved implementation>

KNOWN_EVIDENCE:
  <observed artifacts and facts; separate them from inference>

OPEN_QUESTIONS:
  <premises the Peer may challenge; do not constrain the answer to preferred options>

NON_GOALS:
  <work or outcomes intentionally outside this assignment>

CONTRACT_BOUNDARY:
  <required only for public API, schema/database, auth, permission, or integration changes: existing contract that must hold, or the decision needed to change it>

AUTHORITY_AND_BOUNDARIES:
  <owned/excluded scope, external-effect boundary, stop condition>

EVIDENCE:
  <current artifacts, reproduction, acceptance conditions, material unknowns; classify material premises as SUPPORTED, PARTIAL, or FAILED>

HANDBACK:
  <changed/inspected scope, verification or skips, SHA/diff, risks, what would make this conclusion wrong, lease release>
TASK_BODY_END
```

## Authority rules

| Disposition | Required mode | Mutation |
|---|---:|---|
| `engineer` | `write` or `read-only` | only `write`, only inside `OWNED_SCOPE` |
| `scout` / `architect` / `reviewer` / `shadow` | `read-only` | denied |

- `MODE: write` is valid only for `DISPOSITION: engineer` and valid
  workspace-relative `OWNED_SCOPE`.
- A follow-up that needs authority must repeat the complete V3 brief. A plain
  follow-up becomes read-only by design.
- Force-push, `git commit --amend`, deploy, native subagents, Paseo MCP for a
  Peer, worktree mutation, and scope expansion are always denied.
- There is no Beads or replacement tracker in this phase. The assignment and
  handback in Paseo messages are the work state; do not create a private ledger.
- Reviewer Peer evaluates a stable SHA/diff and reports findings as `DEFECT`,
  `RISK`, `PREFERENCE`, or `UNVERIFIED`; it never patches candidate code,
  redesigns unrelated modules, or claims acceptance.
