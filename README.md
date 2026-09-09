# Paseo Learn — SLP Role Packs

Bộ cấu hình, policy và installer để vận hành Codex, Pi và Claude Code theo
topology **Supervisor – Lead – Peer (SLP)** dưới Paseo.

> Đây là role-pack, không phải Paseo runtime fork. Nó enforce qua provider
> profiles, hooks/extensions và tool exposure; không có immutable native
> RoleBinding/daemon receipts như `paseo-doctrine-downstream`.

## Workflow hiện hành

```text
Human → Lead → Peer (engineer | scout | architect | reviewer | shadow)
           ↑
      Supervisor (Human-governed observation/recovery only)
```

| Role | Trách nhiệm | Không được làm |
|---|---|---|
| Lead | Outcome, topology, integration evidence, engineering verdict | Tự accept material code mình vừa implement; hai writer cùng scope |
| Peer | Một assignment bounded với một disposition | Điều phối agent, mở rộng scope, tự accept |
| Supervisor | Quan sát governance cho Human, recovery Lead có gate | Staff product work, direct Peer, accept result |

`reviewer` là **disposition của Peer**, không còn là provider/role riêng.
`MODE: write` chỉ hợp lệ khi `DISPOSITION: engineer` và có `OWNED_SCOPE`; các
disposition còn lại read-only. Mỗi moving/coupled scope có đúng một write owner.

## Không dùng Beads (tạm thời)

Paseo agent messages, V3 assignment và handback là work state. Không có Beads,
issue tracker fallback, private task database, repository ledger, poller hay
background synchronization service. Điều này giữ Paseo là control plane duy
nhất, nhưng không có durable issue graph/audit checkpoint như downstream tham
chiếu.

## Active packs

| Pack | Provider IDs | Role homes |
|---|---|---|
| `codex-orchestration/` | `codex-lead`, `codex-peer`, `codex-supervisor` | `~/.codex-paseo/<role>` |
| `pi-orchestration/` | `pi-lead`, `pi-peer`, `pi-supervisor` | `~/.pi-paseo/<role>` |
| `claude-orchestration/` | `claude-lead`, `claude-peer`, `claude-supervisor` | `~/.claude-paseo/<role>` |

Install one pack:

```bash
./install pi --dry-run
./install pi --force       # required once when migrating old worker/reviewer state
./install claude --force
./install codex --force
```

Installers remove only legacy managed provider/profile entries when `--force`
is supplied; old role-home directories are left inert to avoid deleting local
credentials or user data. They never restart the daemon.

## Uninstall

Preview removal of one pack or all packs:

```bash
./uninstall pi
./uninstall all --dry-run
```

Apply a normal uninstall:

```bash
./uninstall pi --apply
./uninstall all --apply
```

Normal uninstall removes Paseo Learn provider/Profile entries, matching
preferences, launchers and exact managed files. It preserves role homes such as
`~/.pi-paseo`, `~/.codex-paseo` and `~/.claude-paseo` because they may contain
sessions, credentials or user-added files. Modified managed files are also
preserved unless `--force` is supplied; forced removals are backed up first.

Delete role homes only when their private state is intentionally disposable:

```bash
./uninstall all --apply --force --purge-role-homes
```

The uninstaller does not stop agents or restart Paseo. Finish active agents,
apply the uninstall, then restart the daemon manually.

## Assignment contract

The first non-empty line of every Peer prompt declares the current-turn
disposition:

```text
DISPOSITION: engineer | scout | architect | reviewer | shadow
```

`engineer` is editable for that turn; the other dispositions and a prompt with
no disposition are read-only. A follow-up that needs edit access repeats
`DISPOSITION: engineer` as its first line because authority is never sticky.
Use the task-brief template only when a narrower `OWNED_SCOPE` or a more explicit
evidence contract is useful.

The body contains a neutral objective, boundaries, evidence, handback and stop
condition. It must not pre-solve a solution or smuggle an acceptance verdict.

## Verification

```bash
node test/active-policy.test.mjs
node test/agent-profile-routing.test.mjs
node test/codex-policy.test.mjs
node test/language-policy.test.mjs
node test/uninstall.test.mjs
git diff --check
```

Repository orientation and exact ownership: [`wiki/quickstart.md`](wiki/quickstart.md).
