# Claude Code SLP role pack

Installs `claude-lead`, `claude-peer`, `claude-supervisor` for Paseo.

Lead owns topology, integration evidence and verdict. A Peer has one V3
assignment with `engineer`, `scout`, `architect`, `reviewer`, or `shadow`
disposition; only `engineer + MODE: write + OWNED_SCOPE` can mutate.
Supervisor observes for Human and has a recovery-gated MCP surface only.

The UserPromptSubmit/PreToolUse hooks re-parse Peer authority each turn and
block Peer MCP, native subagents, worktrees, force-push, amend and deploy.
`reviewer` is a Peer disposition, not a provider.

No Beads or fallback tracker is installed. Paseo assignment and handback
messages are work state.

```bash
./install claude --dry-run
./install claude --force
node test/active-policy.test.mjs
```

`--force` migrates managed legacy `claude-worker`/`claude-reviewer` state;
old homes remain inert.

Uninstall is dry-run by default:

```bash
./uninstall claude
./uninstall claude --apply
```

Normal uninstall preserves `~/.claude-paseo`; add
`--force --purge-role-homes` only when role-local state is disposable.
