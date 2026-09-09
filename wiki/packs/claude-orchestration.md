# Pack: claude-orchestration

Claude Code implements the three-role SLP contract through role-scoped
`CLAUDE_CONFIG_DIR` homes and copied `UserPromptSubmit`/`PreToolUse` policy
hooks.

| Provider | Home | Capability |
|---|---|---|
| `claude-lead` | `~/.claude-paseo/lead` | Paseo MCP injected by launcher |
| `claude-peer` | `~/.claude-paseo/peer` | No Paseo MCP; V3 disposition/mode policy |
| `claude-supervisor` | `~/.claude-paseo/supervisor` | Minimal monitoring/recovery MCP allowlist |

Peer owns exactly one assignment. `profiles/peer/CLAUDE.md` and the hooks
require V3 `DISPOSITION`; only `engineer + MODE: write + OWNED_SCOPE` can
mutate. `scout`, `architect`, `reviewer`, and `shadow` are non-mutating. Hooks
block Peer MCP/native delegation, worktree mutation, force-push, amend and
deploy.

Lead workflow: `profiles/lead/CLAUDE.md` and its `paseo-team-lead` skill.
Assignment template: `templates/TASK_BRIEF.md`.

`install.mjs` migrates managed Worker/Reviewer provider/profile entries to the
single `claude-peer` identity with `--force`; legacy homes remain inert. No
Beads or replacement tracker is installed.

```bash
node --check claude-orchestration/install.mjs
node test/active-policy.test.mjs
./install claude --dry-run --force
```
