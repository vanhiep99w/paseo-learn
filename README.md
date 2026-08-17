# Paseo Learn — Governed Multi-Agent Role Packs

Bộ cấu hình và policy để vận hành **Codex, Pi và Claude Code** như một nhóm
multi-agent có phân vai dưới sự điều phối của
[Paseo](https://paseo.sh).

Repository này không phải ứng dụng runtime. Nó cung cấp:

- role prompts và skills;
- policy enforcement và tool allowlists;
- role-gated facade trên public Paseo CLI;
- installer cho từng agent CLI;
- Agent Profiles và model-routing policy;
- tài liệu kiến trúc, vận hành và kiểm thử.

> Bắt đầu từ [`wiki/quickstart.md`](wiki/quickstart.md) nếu cần hiểu đầy đủ cấu
> trúc repository và nơi sở hữu từng policy.

## Mô hình bốn role

| Role | Trách nhiệm | Authority mặc định |
|---|---|---|
| **Lead** | Phân rã task, chọn route, giao việc, tổng hợp bằng chứng và accept/reject | Điều phối; không viết product code mặc định |
| **Worker** | Implement trong scope được giao | Chỉ được write/commit/push khi V3 Task Brief của turn hiện tại cấp quyền |
| **Reviewer** | Review độc lập candidate SHA hoặc working diff | Behavioral read-only |
| **Supervisor** | Quan sát governance và recovery | Allowlist tối thiểu; chỉ có một recovery path được gate |

Các role có thể chạy với quyền filesystem/network rộng, nhưng **capability không
phải authority**. Authority đến từ role contract, hard policy và V3 Task Brief.

## Ba active packs

| Pack | Runtime | Role home |
|---|---|---|
| [`codex-orchestration/`](codex-orchestration/) | `codex app-server` | `CODEX_HOME` riêng cho từng role |
| [`pi-orchestration/`](pi-orchestration/) | `pi --mode rpc` | `PI_CODING_AGENT_DIR` riêng cho từng role |
| [`claude-orchestration/`](claude-orchestration/) | Claude Code headless/SDK | `CLAUDE_CONFIG_DIR` riêng cho từng role |

Pack cũ trong [`tai-lieu-tham-khao/`](tai-lieu-tham-khao/) được giữ làm tài liệu
tham khảo, không phải active install target.

## Các invariant chính

### Tiếng Việt là ngôn ngữ giao tiếp mặc định

Mọi response cho Human và mọi prompt/message/report/review/handoff giữa các
agent phải dùng tiếng Việt. Code, command, path, identifier, protocol field,
log/error được quote và machine-readable token giữ nguyên. Human có thể chỉ định
ngôn ngữ khác cho một output cụ thể.

### Paseo là control plane duy nhất

Lead/Supervisor delegate qua role-gated `$PASEO_TEAM_CLI`. Facade gọi public
Paseo CLI và giữ parent/workspace qua `PASEO_AGENT_ID`; nó không gọi MCP hoặc
daemon API trực tiếp. Mọi subagent bắt buộc dùng cùng workspace hiện tại của
Lead; wrapper từ chối workspace/worktree flags và workspace management. Raw
`paseo`, MCP, native subagents và task database riêng đều bị cấm.
Worker/Reviewer không có orchestration authority.

### V3 Task Brief là authority channel

Mọi prompt giao cho Worker/Reviewer phải chứa block:

```text
PASEO_TEAM_TASK_V3_BEGIN
...
PASEO_TEAM_TASK_V3_END
```

Brief thiếu marker, malformed, dùng V1/V2, hoặc không cấp authority rõ ràng sẽ
resolve fail-closed về read-only. Canonical templates:

- [`pi-orchestration/templates/TASK_BRIEF_V3.md`](pi-orchestration/templates/TASK_BRIEF_V3.md)
- [`claude-orchestration/templates/TASK_BRIEF_V3.md`](claude-orchestration/templates/TASK_BRIEF_V3.md)

Installer copy template vào role home của Lead; Lead không cần và không được
quét toàn bộ `$HOME` để tìm source checkout.

### No silent fallback

Trước mỗi agent, Lead phải chạy:

```text
paseo-team providers → paseo-team models → paseo-team run → paseo-team inspect
```

`run` bắt buộc exact provider/model và thinking. Provider, model, thinking hoặc
mode không khớp `inspect` sẽ bị `BLOCKED`; không inherit daemon default. Agent
Profiles chỉ là preset để Human launch, không phải routing input của Lead CLI.

### Same-family routing mặc định

- Pi Lead mặc định gọi `pi-worker`, `pi-reviewer`, …
- Claude Lead mặc định gọi `claude-worker`, `claude-reviewer`, …
- Codex Lead mặc định gọi `codex-worker`, `codex-reviewer`, …

Cross-family routing chỉ hợp lệ khi Human chỉ định rõ provider family cho
delegation đó. Nếu same-family provider unavailable, Lead phải báo:

```text
BLOCKED: CROSS_FAMILY_ROUTE_REQUIRES_HUMAN
```

thay vì tự chuyển family.

## Cài đặt nhanh

### Yêu cầu chung

- Node.js trên `PATH`;
- Paseo **v0.4.0+**;
- daemon đang chạy;
- agent CLI và authentication tương ứng đã được cấu hình.

Kiểm tra cơ bản:

```bash
node --version
paseo --version
paseo status
```

### Chọn pack

macOS/Linux:

```bash
./install                 # interactive
./install pi              # chỉ Pi
./install claude          # chỉ Claude Code
./install codex           # chỉ Codex
./install all             # Codex → Pi → Claude
```

Windows PowerShell hoặc Command Prompt:

```powershell
.\install.cmd
.\install.cmd pi
.\install.cmd all --dry-run --force
```

Entry point portable dùng chung trên mọi OS:

```bash
node install.mjs pi --dry-run
```

Nếu installer phát hiện pack-owned file khác bản trong repository, review rồi
chạy:

```bash
# macOS/Linux
./install pi --dry-run --force
./install pi --force

# Windows
.\install.cmd pi --dry-run --force
.\install.cmd pi --force
```

Installer backup file bị thay thế, preserve Human-owned Agent Profiles và không
tự restart daemon. Khi nâng từ bản MCP sang CLI-only, dùng `--force` để retire
launcher/`mcp.json` cũ và thay provider config sau khi đã review dry-run.
Trên Windows, installer dùng `PATHEXT`, cài `paseo-team.cmd`, dùng junction cho
shared directories và hard link (hoặc copy fallback khi khác volume) cho shared
credential files; không yêu cầu Bash hay Windows Developer Mode.

Sau khi các agent đang chạy đã an toàn:

```bash
paseo daemon restart
paseo provider ls --json
```

Hướng dẫn riêng từng pack:

- [`pi-orchestration/README.md`](pi-orchestration/README.md)
- [`claude-orchestration/README.md`](claude-orchestration/README.md)
- [`codex-orchestration/README.md`](codex-orchestration/README.md)

## Agent Profiles

Pi và Claude installers merge bốn managed profiles. Pi xác minh và pin route
role-specific (`Lead = GPT-5.6 Sol/high`;
`Worker/Reviewer/Supervisor = GPT-5.6 Luna/max`),
trong khi Claude tiếp tục dùng model/default thinking được discover trên host:

```text
paseo-learn:<pack>:lead:host-default
paseo-learn:<pack>:worker:host-default
paseo-learn:<pack>:reviewer:host-default
paseo-learn:<pack>:supervisor:host-default
```

Managed profile có màu theo role bằng tên identity palette mà Paseo hỗ trợ:

| Role | Icon | Color |
|---|---|---|
| Lead | `compass` | `blue` |
| Worker | `hammer` | `amber` |
| Reviewer | `search` | `violet` |
| Supervisor | `eye` | `red` |

Human-owned profiles được giữ nguyên. Managed profile drift làm installer dừng;
`--force` chỉ thay managed IDs thuộc pack. Codex Agent Profiles vẫn được Human
quản lý thủ công.

Chi tiết: [`docs/agent-profiles.md`](docs/agent-profiles.md).

## Cấu trúc repository

```text
.
├── install                         # root installer dispatcher
├── codex-orchestration/            # Codex role pack
├── pi-orchestration/               # Pi role pack + policy extension
├── claude-orchestration/           # Claude role pack + policy hooks
├── docs/                           # long-form architecture/operations docs
├── wiki/                           # repository orientation và pack maps
├── test/                           # active-pack policy/routing tests
└── tai-lieu-tham-khao/             # archived/reference implementation
```

## Kiểm thử thay đổi

Focused active-pack checks:

```bash
node test/cli-orchestration.test.mjs
node test/agent-profile-routing.test.mjs
node test/active-policy.test.mjs
node test/codex-policy.test.mjs
node test/language-policy.test.mjs

node --check pi-orchestration/install.mjs
node --check claude-orchestration/install.mjs
node --check codex-orchestration/install.mjs

git diff --check
```

Preview installer trước khi ghi host config:

```bash
./install pi --dry-run --force
./install claude --dry-run --force
./install codex --dry-run --force
```

## Tài liệu chính

- [`wiki/quickstart.md`](wiki/quickstart.md) — định hướng repository và change map.
- [`wiki/architecture.md`](wiki/architecture.md) — role boundaries và enforcement model.
- [`docs/agent-profiles.md`](docs/agent-profiles.md) — Agent Profiles, persistence và validation cycle.
- [`docs/model-routing.md`](docs/model-routing.md) — strict model routing và runtime evidence.
- [`docs/multi-host.md`](docs/multi-host.md) — routing qua nhiều Paseo daemon.
- [`wiki/packs/pi-orchestration.md`](wiki/packs/pi-orchestration.md) — Pi pack internals.
- [`wiki/packs/claude-orchestration.md`](wiki/packs/claude-orchestration.md) — Claude pack internals.
- [`wiki/packs/codex-orchestration.md`](wiki/packs/codex-orchestration.md) — Codex pack internals.

## Giới hạn bảo mật

Tool allowlists, prompts và hooks là behavioral boundaries, không phải OS-level
sandbox hoặc server-side ACL hoàn chỉnh. Chỉ vận hành các pack trên máy và
repository tin cậy; không xem full-access runtime là quyền thực hiện merge,
deploy, force-push, xóa dữ liệu hoặc hành động external khi Human chưa cấp quyền.
