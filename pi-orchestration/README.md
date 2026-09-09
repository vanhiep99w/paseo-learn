# Pi SLP role pack

Installs `pi-lead`, `pi-peer`, `pi-supervisor` for Paseo.

- **Lead** owns topology, integration evidence and verdict.
- **Peer** has one V3 assignment: `engineer`, `scout`, `architect`, `reviewer`,
  or `shadow`. Only `engineer + MODE: write + OWNED_SCOPE` can mutate.
- **Supervisor** observes for Human and has only a recovery-gated MCP surface.

The Pi extension `shared/paseo-team-policy.ts` enforces active tools and
current-turn authority. Peers receive no Paseo MCP; no native subagents,
worktrees, force-push, amend or deploy. `reviewer` is a Peer disposition, not a
provider.

No Beads or fallback tracker is installed. Assignment and handback in Paseo
messages are work state.

```bash
./install pi --dry-run
./install pi --force
node test/active-policy.test.mjs
```

`--force` migrates managed legacy `pi-worker`/`pi-reviewer` provider/profile
state. Old role homes are intentionally left inert.

Uninstall is dry-run by default:

```bash
./uninstall pi
./uninstall pi --apply
```

Normal uninstall preserves `~/.pi-paseo`; add
`--force --purge-role-homes` only when role-local state is disposable.
