# Paseo Agent Profiles trong kiến trúc CLI-only

Agent Profiles của Paseo là **preset để Human launch hoặc điều chỉnh agent trong
UI**. Chúng không phải routing input, runtime evidence hay authority channel của
Lead CLI.

## Phân tách trách nhiệm

| Lớp | Trách nhiệm |
|---|---|
| Custom provider (`pi-worker`, `codex-reviewer`, …) | Chọn role home, provider CLI, prompt và policy |
| Agent Profile | Preset host-local cho Human: provider/model/mode/thinking/features |
| `$PASEO_TEAM_CLI` | Discovery, spawn, theo dõi và messaging qua public Paseo CLI |
| V3 Task Brief | Cấp authority cho đúng task và turn |

Profile `notes` không phải instruction. Profile không bao giờ cấp quyền write,
commit, push, orchestration hoặc cross-family routing.

## Lead không route từ profile

Public Paseo CLI không có profile catalog/apply surface tương đương MCP. Vì vậy
Lead của active packs không đọc, chọn hay materialize profile. Chu trình bắt
buộc là:

```text
paseo-team providers
→ paseo-team models <role-provider>
→ paseo-team run --provider <exact-route> --thinking <id>
→ paseo-team inspect <agent-id>
```

`run` từ chối route không có model hoặc thiếu thinking. `inspect` phải khớp
Provider, Model, Thinking và Mode; thiếu hoặc lệch evidence là
`BLOCKED: MODEL_RESOLUTION_MISMATCH`.

Same-family routing vẫn là mặc định. Cross-family chỉ hợp lệ khi Human chỉ định
rõ family cho delegation đó; nếu không, Lead ghi
`BLOCKED: CROSS_FAMILY_ROUTE_REQUIRES_HUMAN`.

## Managed profiles cho Human

`./install pi` và `./install claude` vẫn merge bốn profile host-default:

```text
paseo-learn:<pack>:lead:host-default
paseo-learn:<pack>:worker:host-default
paseo-learn:<pack>:reviewer:host-default
paseo-learn:<pack>:supervisor:host-default
```

Màu role: Lead `blue`, Worker `amber`, Reviewer `violet`, Supervisor `red`.
Codex profiles vẫn do Human quản lý thủ công.

Pi installer pin route theo role và xác minh exact model/thinking trong live
catalog trước khi ghi:

| Pi role | Model | Thinking |
|---|---|---|
| Lead | `openai-codex/gpt-5.6-sol` | `high` |
| Worker | `openai-codex/gpt-5.6-luna` | `max` |
| Reviewer | `openai-codex/gpt-5.6-luna` | `max` |
| Supervisor | `openai-codex/gpt-5.6-luna` | `max` |

Các profile này phục vụ UI launch; chúng không thay đổi CLI routing contract.
Installer cố ý không ghi `modeId`/`featureValues` vào managed defaults để không
override policy trong role home.

## Persistence và conflict policy

`daemon.agentProfiles` dùng **whole-list replacement**. Pi/Claude installers:

- giữ nguyên thứ tự và nội dung mọi profile do Human sở hữu;
- append managed profile còn thiếu;
- chấp nhận managed profile giống manifest;
- fail closed nếu managed profile đã bị sửa;
- chỉ thay managed profile khác biệt với `--force`.

Có thể pin model discovery trong test/offline:

```bash
PASEO_PI_AGENT_PROFILE_ROUTES_JSON='{"lead":{"model":"fixture/sol","thinkingOptionId":"high"},"worker":{"model":"fixture/luna","thinkingOptionId":"max"},"reviewer":{"model":"fixture/luna","thinkingOptionId":"max"},"supervisor":{"model":"fixture/luna","thinkingOptionId":"max"}}' ./install pi
PASEO_CLAUDE_AGENT_PROFILE_DEFAULT_JSON='{"model":"model-id","thinkingOptionId":"high"}' ./install claude
```

## Authority

Áp profile trong UI có thể đổi runtime settings nhưng không thay role prompt,
policy hooks/extensions hoặc V3 Task Brief. Profile không phải trạng thái authority
và không thay thế post-verification bằng `$PASEO_TEAM_CLI inspect`.
