# Pack: codex-orchestration

Codex implements the three-role SLP contract with role-specific `CODEX_HOME`
directories, `developer_instructions`, and policy hooks.

| Provider | Home | Capability |
|---|---|---|
| `codex-lead` | `~/.codex-paseo/lead` | Paseo MCP injected by launcher |
| `codex-peer` | `~/.codex-paseo/peer` | No Paseo MCP; V3 disposition/mode policy |
| `codex-supervisor` | `~/.codex-paseo/supervisor` | Minimal monitoring/recovery MCP allowlist |

`paseo-peer.config.toml` is the canonical Peer contract. Its V3 brief requires
`DISPOSITION`; only `engineer + MODE: write + OWNED_SCOPE` mutates. `scout`,
`architect`, `reviewer`, and `shadow` are read-only. Hooks deny Peer MCP/native
delegation, worktree mutation, force-push, amend and deploy.

`install.mjs` removes legacy managed `codex-worker` and `codex-reviewer`
providers only with `--force`; old Codex role homes/configs remain inert to
avoid deleting local user data. No Beads or substitute tracker is installed.

```bash
node --check codex-orchestration/install.mjs
node test/codex-policy.test.mjs
./install codex --dry-run --force
```
