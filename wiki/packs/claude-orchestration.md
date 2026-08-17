# Pack: claude-orchestration (Claude Code CLI)

The Claude pack runs four governed roles under Paseo with per-role
`CLAUDE_CONFIG_DIR` homes. Shared concepts are in
[../architecture.md](../architecture.md).

## Role resources

Each role home contains `CLAUDE.md`, `settings.json`, skills/prompts, and copied
`PreToolUse`/`UserPromptSubmit` policy hooks.

| Role | Effective capability | Orchestration |
|---|---|---|
| Lead | full runtime; write/edit gated by `PASEO_TEAM_LEAD_WRITE` | role-gated `$PASEO_TEAM_CLI` |
| Worker | current-turn V3 authority + `OWNED_SCOPE` | denied |
| Reviewer | plan/read-only | denied |
| Supervisor | Read + shell restricted to one facade invocation | monitoring + gated Lead recovery |

No role receives `--mcp-config`. All four providers use plain
`command: ["claude"]`.

## CLI facade

`claude-orchestration/bin/paseo-team` is installed at
`$PASEO_HOME/bin/paseo-team`. Provider env sets `PASEO_TEAM_CLI` and
`PASEO_CLAUDE_ROLE`. The wrapper requires `PASEO_AGENT_ID`, shells out to the
public Paseo CLI, and preserves caller parent/workspace semantics. Every child inherits the Lead workspace; workspace/worktree flags and management commands are rejected. Lead batches
use one detached `notify-each` watcher instead of blocking waits. The watcher
waits concurrently and sends status only without running an LLM. Non-idle
statuses notify immediately; idle completions debounce for 1.2 seconds. The Lead
fetches responses selectively and must inspect permission before asking the
Human—permissions are never auto-approved and do not complete the watched child.

## Hard policy hooks

`claude-orchestration/shared/paseo-team-policy/`:

- replaces Worker authority on every `UserPromptSubmit`;
- gates Bash/PowerShell, writes, native Agent/Task, and any injected MCP tool;
- blocks raw `paseo` and wrapper use by Worker/Reviewer;
- restricts Supervisor shell use to the role-gated facade;
- enforces owned scope and branch-scoped git authority.

## Install and validation

```bash
./install claude
node --check claude-orchestration/shared/paseo-team-policy/*.mjs
node test/active-policy.test.mjs
node test/cli-orchestration.test.mjs
```

The installer creates role homes, copies hooks and the facade, merges providers
and Human-facing Agent Profiles, disables daemon-wide MCP injection, and never
restarts Paseo.

Status: beta; one Lead→Worker→Reviewer flow was previously live-verified. The
CLI-only path requires a fresh E2E verification after installation.
