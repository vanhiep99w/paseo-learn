# Paseo Learn — Governed Multi-Agent Role Packs

Bộ cấu hình và policy để vận hành **Codex, Pi và Claude Code** như một nhóm
multi-agent có phân vai dưới sự điều phối của
[Paseo](https://paseo.sh).

Repository này không phải ứng dụng runtime. Nó cung cấp:

- role prompts và skills;
- policy enforcement và tool allowlists;
- launcher cho agent-scoped Paseo MCP;
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

### Paseo là control plane duy nhất

Lead delegate qua Paseo MCP (`create_agent`, `send_agent_prompt`,
`get_agent_status`). Không tạo task database hoặc orchestration process riêng.
Worker và Reviewer không nhận Paseo MCP. Supervisor chỉ nhận năm tool monitoring
và recovery đã được allowlist.

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

Trước mỗi `create_agent`, Lead phải kiểm tra:

```text
list_profiles → list_providers → list_models → inspect_provider
              → create_agent → get_agent_status
```

Model, thinking, mode hoặc features không khớp runtime sẽ bị `BLOCKED`, không tự
sửa profile, bỏ field hoặc inherit daemon default.

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

```bash
./install                 # interactive
./install pi              # chỉ Pi
./install claude          # chỉ Claude Code
./install codex           # chỉ Codex
./install all             # Codex → Pi → Claude
```

Xem trước thay đổi:

```bash
./install pi --dry-run
```

Nếu installer phát hiện pack-owned file khác bản trong repository, review rồi
chạy:

```bash
./install pi --dry-run --force
./install pi --force
```

Installer backup file bị thay thế, preserve Human-owned Agent Profiles và không
tự restart daemon.

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

Pi và Claude installers tự discover model đầu tiên/default cùng default thinking
trên host, sau đó merge bốn managed profiles:

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
node test/agent-profile-routing.test.mjs
node test/active-policy.test.mjs

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
