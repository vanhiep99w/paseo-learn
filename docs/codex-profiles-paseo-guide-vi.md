# Hướng dẫn Codex SLP dưới Paseo

Pack Codex hiện dùng ba provider:

| Provider | Role |
|---|---|
| `codex-lead` | Lead: outcome, topology, integration evidence, verdict |
| `codex-peer` | Peer: một bounded assignment với disposition V3 |
| `codex-supervisor` | Supervisor: governance/recovery theo Human lease |

`codex-peer` thay thế `codex-worker` và `codex-reviewer`. Các disposition hợp lệ:
`engineer`, `scout`, `architect`, `reviewer`, `shadow`. Chỉ
`engineer + MODE: write + OWNED_SCOPE` được mutate; reviewer là Peer read-only
trên candidate SHA/diff ổn định.

## Cài đặt và migration

```bash
./install codex --dry-run
./install codex --force
paseo provider ls --json
paseo provider models codex-peer --json
```

`--force` retire managed `codex-worker`/`codex-reviewer` provider entries. Role
homes/config cũ được giữ inert để không xóa local state. Installer không restart
daemon.

## Operating rules

- Paseo là delegation/lifecycle plane duy nhất; native Codex agents, shell
  orchestration, task database, issue ledger và worktree đều không dùng.
- Lead default route là `codex-peer`; cross-family cần Human explicit request.
- Lead validates `list_profiles` (notes advisory), `list_providers`,
  `list_models`, `inspect_provider`, pins the exact route, then readbacks
  `get_agent_status`. No silent fallback.
- Một moving/coupled scope có một writer. Sau engineer idle, start fresh
  reviewer Peer, recheck HEAD/status after review, and route corrections to the
  original engineer using a fresh V3 brief.
- Không dùng Beads hoặc tracker thay thế ở phase này. Assignment/handoff qua
  Paseo messages là work state.

Canonical role configs: `codex-orchestration/profiles/paseo-*.config.toml`.
