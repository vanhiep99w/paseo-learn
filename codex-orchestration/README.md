# Codex SLP role pack

Installs `codex-lead`, `codex-peer`, `codex-supervisor` for Paseo.

Lead owns topology, integration evidence and verdict. Peer takes one V3
assignment with `engineer`, `scout`, `architect`, `reviewer`, or `shadow`
disposition. Only `engineer + MODE: write + OWNED_SCOPE` can mutate. Supervisor
observes for Human and has a recovery-gated MCP surface only.

`paseo-peer.config.toml` plus Codex hooks re-parse current-turn authority and
block Peer MCP, native subagents, worktrees, force-push, amend and deploy.
Reviewer is a Peer disposition, not a provider.

No Beads or fallback tracker is installed. Paseo assignment and handback
messages are work state.

```bash
./install codex --dry-run
./install codex --force
node test/codex-policy.test.mjs
```

`--force` migrates managed legacy `codex-worker`/`codex-reviewer` providers.
Old role homes/config files remain inert.

Uninstall is dry-run by default:

```bash
./uninstall codex
./uninstall codex --apply
```

Normal uninstall preserves `~/.codex-paseo`; add
`--force --purge-role-homes` only when role-local state is disposable.
