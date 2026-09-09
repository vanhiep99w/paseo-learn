# Pack: pi-orchestration

Pi implements the three-role SLP contract through role-scoped
`PI_CODING_AGENT_DIR` homes and `shared/paseo-team-policy.ts`.

| Provider | Home | Capability |
|---|---|---|
| `pi-lead` | `~/.pi-paseo/lead` | Paseo MCP through `pi-role-app-server` |
| `pi-peer` | `~/.pi-paseo/peer` | No Paseo MCP; V3 disposition/mode policy |
| `pi-supervisor` | `~/.pi-paseo/supervisor` | Minimal monitoring/recovery MCP allowlist |

Canonical Peer prompt: `profiles/peer/AGENTS.md`. Its current-turn V3 brief
must include `DISPOSITION`; only `engineer + MODE: write + OWNED_SCOPE` enables
`write`/`edit`/`bash`. `scout`, `architect`, `reviewer`, and `shadow` are read
only. The extension also blocks Peer MCP, Paseo CLI orchestration, native
worktree mutation, force-push, amend and deployment.

Lead behavior: `profiles/lead/AGENTS.md` and
`profiles/lead/skills/paseo-team-lead/SKILL.md`. Canonical assignment template:
`templates/TASK_BRIEF.md`.

Installer: `install.mjs`. It migrates only managed Worker/Reviewer provider and
profile entries to `pi-peer` with `--force`; legacy role homes are retained
inert. No Beads or fallback tracker is installed.

Validation:

```bash
node --check pi-orchestration/install.mjs
node test/active-policy.test.mjs
./install pi --dry-run --force
```
