# Hướng dẫn dùng Codex role profiles với Paseo

Ngày kiểm chứng: 2026-08-07  
Runtime đã kiểm chứng: Codex CLI 0.147.0, Paseo CLI/daemon 0.2.5, Linux

## 1. Bộ profile

| Paseo provider | Codex profile | Model mặc định | Filesystem | Mục đích |
|---|---|---|---|---|
| codex-lead | paseo-lead | gpt-5.6-sol / high | full access | phân rã, giao việc, nghiệm thu |
| codex-worker | paseo-worker | gpt-5.6-luna / max | full access | implement và UI trong scope |
| codex-reviewer | paseo-reviewer | gpt-5.6-luna / max | full access; behavioral read-only | review candidate SHA hoặc working diff |
| codex-supervisor | paseo-supervisor | gpt-5.6-luna / medium | full access | quan sát governance/recovery |

Profile nguồn nằm tại [codex-orchestration/profiles](../codex-orchestration/profiles).

Codex chính thức hỗ trợ file `$CODEX_HOME/<name>.config.toml` và chọn bằng
`--profile <name>` cho runtime command. Tuy nhiên Codex 0.147.0 từ chối
`--profile` khi command là `app-server`, trong khi Paseo dùng chính interface
này.

Vì vậy installer tạo thêm bốn role home:

    ~/.codex-paseo/
      lead/config.toml
      worker/config.toml
      reviewer/config.toml
      supervisor/config.toml

Mỗi Paseo provider đặt `CODEX_HOME` tới role home tương ứng và chạy:

    CODEX_HOME=~/.codex-paseo/worker codex app-server

Mỗi role home symlink `auth.json` về `~/.codex/auth.json`, nhưng giữ config và
session state riêng. Các file profile trong `~/.codex` vẫn dùng được khi chạy
Codex trực tiếp bằng `--profile`.

File `HUONG_DAN_CODEX_PROFILE_PASEO.md` cũ dùng Python để dịch TOML thành nhiều
override `-c`. Không dùng đồng thời hai cách. Bộ mới chọn role-specific
`CODEX_HOME` để giảm launcher logic và đã được test qua Paseo daemon thật.

## 2. Full access và ranh giới instruction

Paseo Codex provider expose ba mode:

- auto: workspace-write với approval mặc định;
- auto-review: workspace-write, approval phù hợp được auto-review;
- full-access: không sandbox/approval.

Bộ cấu hình này cố ý đặt cả bốn role thành `danger-full-access` với
`approval_policy = "never"`. Quyền hệ thống chỉ là capability; authority được
giới hạn bằng `developer_instructions` và Task Brief:

- Lead chỉ điều phối/nghiệm thu, không tự implement mặc định;
- Worker chỉ ghi trong scope của Task Brief;
- Reviewer có runtime full access nhưng hành vi vẫn read-only;
- Supervisor chỉ quan sát và recovery theo gate.

Đây không phải security boundary. Prompt có thể giảm lỗi hành vi nhưng không
ngăn một process ghi file, dùng network hoặc truy cập dữ liệu ngoài workspace.
Chỉ dùng lựa chọn này trên máy/repo tin cậy.

Lead và Supervisor dùng
[codex-role-app-server](../codex-orchestration/bin/codex-role-app-server) để nhận
Paseo MCP có chọn lọc khi `injectIntoAgents=false`. Launcher này không sandbox
filesystem; Worker và Reviewer chạy native `codex` vì không có Paseo MCP.

## 3. Cài tự động

Yêu cầu:

    command -v codex
    command -v paseo
    codex login

Từ root của repo, xem trước thay đổi:

    node ./install-codex-profiles.mjs --dry-run

Cài profile:

    node ./install-codex-profiles.mjs

Installer:

1. Copy bốn profile vào `$CODEX_HOME`, mặc định `~/.codex`.
2. Tạo bốn role home trong `~/.codex-paseo`, mỗi home có `config.toml`.
   Các block `[projects.*]` do Codex thêm cục bộ được giữ nguyên khi cài lại.
3. Symlink role `auth.json` về auth chính; không copy secret.
4. Copy role launcher vào `$PASEO_HOME/bin`, mặc định `~/.paseo/bin`.
5. Merge bốn provider vào `~/.paseo/config.json`, tắt daemon-wide MCP injection
   và chỉ cấp Paseo MCP cho Lead/Supervisor qua provider environment.
6. Tạo/merge `~/.paseo/orchestration-preferences.json`.
7. Backup JSON trước khi thay đổi.
8. Không restart Paseo daemon.

Nếu một profile/provider cùng tên đã có nội dung khác, installer fail closed.
Đọc diff rồi mới chạy:

    node ./install-codex-profiles.mjs --force

`--force` backup file bị ghi đè trước khi cài.

## 4. Cài thủ công

Copy:

    cp codex-orchestration/profiles/*.config.toml ~/.codex/
    mkdir -p ~/.codex-paseo/{lead,worker,reviewer,supervisor}
    cp codex-orchestration/profiles/paseo-lead.config.toml ~/.codex-paseo/lead/config.toml
    cp codex-orchestration/profiles/paseo-worker.config.toml ~/.codex-paseo/worker/config.toml
    cp codex-orchestration/profiles/paseo-reviewer.config.toml ~/.codex-paseo/reviewer/config.toml
    cp codex-orchestration/profiles/paseo-supervisor.config.toml ~/.codex-paseo/supervisor/config.toml
    for role in lead worker reviewer supervisor; do
      ln -s ~/.codex/auth.json ~/.codex-paseo/$role/auth.json
    done
    mkdir -p ~/.paseo/bin
    cp codex-orchestration/bin/codex-role-app-server ~/.paseo/bin/
    chmod 755 ~/.paseo/bin/codex-role-app-server

Merge [paseo.codex-providers.example.json](../tai-lieu-tham-khao/config/paseo.codex-providers.example.json)
vào `~/.paseo/config.json`. Thay `__PASEO_HOME__` và
`__CODEX_ROLES_HOME__` bằng absolute path, ví dụ `/home/alice/.paseo` và
`/home/alice/.codex-paseo`.

Copy hoặc merge
[orchestration-preferences.codex.example.json](../tai-lieu-tham-khao/config/orchestration-preferences.codex.example.json)
vào `~/.paseo/orchestration-preferences.json`.

Không copy đè toàn bộ config Paseo nếu file đã có provider, password, relay,
voice hoặc setting khác.

## 5. Refresh Paseo

Thay đổi custom provider có thể cần daemon reload/restart. Restart sẽ dừng toàn
bộ agent đang chạy.

1. Chờ/stop/archive các agent cần thiết.
2. Trong Paseo UI chọn Settings → Providers → Refresh nếu có.
3. Nếu provider mới vẫn chưa xuất hiện, tự chạy:

       paseo daemon restart

Installer cố ý không làm bước này.

## 6. Verify

### Role-home config mà Paseo thực sự dùng

    CODEX_HOME=~/.codex-paseo/lead codex --strict-config app-server --help
    CODEX_HOME=~/.codex-paseo/worker codex --strict-config app-server --help
    CODEX_HOME=~/.codex-paseo/reviewer codex --strict-config app-server --help
    CODEX_HOME=~/.codex-paseo/supervisor codex --strict-config app-server --help

### Role launcher

    ~/.paseo/bin/codex-role-app-server --version
    CODEX_HOME=~/.codex-paseo/lead \
      PASEO_MCP_ACCESS=lead \
      ~/.paseo/bin/codex-role-app-server app-server --help

    test -x ~/.paseo/bin/codex-role-app-server

### Paseo providers/models

    paseo provider ls --json
    paseo provider models codex-lead --json
    paseo provider models codex-worker --json
    paseo provider models codex-reviewer --json
    paseo provider models codex-supervisor --json

Không đoán model ID. Nếu catalog trên daemon khác ví dụ, dùng ID được discovery.

## 7. Dùng trong Paseo Desktop

1. Mở hoặc thêm thư mục project vào Paseo Desktop dưới dạng workspace local.
2. Trong workspace đó, tạo agent mới và chọn provider `codex-lead`.
3. Chọn model `gpt-5.6-sol`, thinking `high`, mode `full-access`.
4. Nhập trực tiếp yêu cầu thật của công việc. Không cần thêm boilerplate về
   Worker, Reviewer, workspace hay worktree; Lead profile đã chứa policy đó.
5. Lead sẽ tự tạo Worker và Reviewer trong workspace hiện tại. Chỉ một writer
   được hoạt động tại một thời điểm; worktree chỉ được tạo khi Human yêu cầu.

Thiết lập role mặc định trong Desktop:

| Role | Provider | Model | Thinking | Mode |
|---|---|---|---|---|
| Lead | `codex-lead` | `gpt-5.6-sol` | `high` | `full-access` |
| Worker | `codex-worker` | `gpt-5.6-luna` | `max` | `full-access` |
| Reviewer | `codex-reviewer` | `gpt-5.6-luna` | `max` | `full-access` |
| Supervisor | `codex-supervisor` | `gpt-5.6-luna` | `medium` | `full-access` |

Thông thường Human chỉ cần tạo Lead. Worker/Reviewer là child agent do Lead tạo;
không cần tạo thủ công trong Desktop trừ khi đang debug orchestration. Supervisor
là tùy chọn và không cần cho flow một Lead–một Worker thông thường.

## 8. Profile trực tiếp

Các file `$CODEX_HOME/paseo-*.config.toml` vẫn được installer tạo để kiểm tra và
khôi phục cấu hình, nhưng workflow hằng ngày dùng Paseo Desktop nên không cần chạy
Codex profile hay `paseo run` từ terminal.

## 9. Override model/thinking trong Desktop

Model trong profile là mặc định. Khi thật sự cần override, đổi Model và Thinking
trong màn hình tạo agent của Paseo Desktop trước khi bắt đầu session. Không đổi
provider của role và không silently fallback sang model khác.

Snapshot máy kiểm chứng expose:

- gpt-5.6-sol: low, medium, high, xhigh, max, ultra;
- gpt-5.6-terra: low, medium, high, xhigh, max, ultra;
- gpt-5.6-luna: low, medium, high, xhigh, max.

Codex CLI 0.147.0 `--strict-config` đã được kiểm chứng chấp nhận Luna với
`model_reasoning_effort = "max"`. Catalog runtime Paseo vẫn là nguồn quyết định
thinking option hợp lệ; Luna hiện không expose `ultra`.

## 10. MCP và ranh giới role

Config bật:

    daemon.mcp.enabled = true
    daemon.mcp.injectIntoAgents = false

`injectIntoAgents` là daemon-wide, không phải allowlist theo custom provider.
Bộ profile vì vậy tắt auto-injection rồi đặt `PASEO_MCP_ACCESS=lead` hoặc
`PASEO_MCP_ACCESS=supervisor` trên đúng hai custom provider. Wrapper lấy
`PASEO_AGENT_ID` và `PASEO_AGENT_CWD` do Paseo export, không suy ra agent scope
từ working directory của process launcher. Điều này quan trọng vì daemon có thể
khởi động provider từ một thư mục khác workspace của agent. Wrapper gắn MCP URL
động với `callerAgentId`, nhờ đó giữ đúng parent/child ownership:

    codex-lead        Paseo MCP đầy đủ
    codex-supervisor  Paseo MCP với tool allowlist
    codex-worker      không có Paseo MCP
    codex-reviewer    không có Paseo MCP

Supervisor chỉ thấy nhóm tool quan sát, gửi thông báo/prompt và tạo recovery
agent có điều kiện. Codex hỗ trợ `enabled_tools` trực tiếp trong MCP server
configuration; wrapper dùng cơ chế này thay vì chỉ dựa vào prompt.

Nếu daemon bật bearer authentication, chỉ truyền secret cho Lead/Supervisor qua
biến `PASEO_MCP_BEARER_TOKEN`; wrapper sẽ cấu hình
`bearer_token_env_var` mà không ghi token vào command line.

Giới hạn còn lại: Paseo 0.2.5 chưa enforce provider allowlist tại chính endpoint
`/mcp/agents`. Selective injection là capability exposure boundary, chưa phải
server-side ACL chống lại một process local cố tình gọi HTTP endpoint. Khi cần
enforcement mạnh, bổ sung kiểm tra `callerAgentId -> provider` phía daemon và
chỉ chấp nhận `codex-lead`/`codex-supervisor`.

Mọi role đều có filesystem/network full access. MCP vẫn chỉ được expose cho
Lead/Supervisor, nhưng instruction chứ không phải sandbox giới hạn hành vi.

## 11. Troubleshooting

### Provider không xuất hiện

- kiểm tra JSON: `jq . ~/.paseo/config.json`;
- kiểm tra absolute wrapper path;
- refresh provider;
- chỉ restart daemon sau khi agent hiện tại đã an toàn.

### Role launcher không chạy

    command -v codex
    bash -n ~/.paseo/bin/codex-role-app-server
    chmod 755 ~/.paseo/bin/codex-role-app-server

Launcher không cần bubblewrap. Nó chỉ inject Paseo MCP theo role rồi chạy native
Codex; full access đến từ profile và `--mode full-access`.

### Lead gọi `paseo wait` liên tục

Đây là dấu hiệu Lead không nhận được agent-scoped Paseo MCP và đã fallback sang
CLI. Agent tạo bằng `paseo run --background` có thể vẫn mang quan hệ parent/child,
nhưng không đăng ký callback `notifyOnFinish` giống `create_agent` qua MCP.

Kiểm tra command line app-server của Lead phải có override
`mcp_servers.paseo.url=...callerAgentId=<lead-id>`. Với bộ profile này, Lead được
instruct chỉ dùng MCP `create_agent`/`send_agent_prompt`, đặt
`notifyOnFinish=true`, kết thúc turn sau khi giao việc và không dùng Shell
`paseo run`, `paseo send` hoặc `paseo wait` để thay thế.

### Profile hoặc role home không được tìm thấy

    ls -l ~/.codex/paseo-*.config.toml
    find ~/.codex-paseo -maxdepth 2 -name config.toml -print
    echo "${CODEX_HOME:-$HOME/.codex}"

Tên file phải là `paseo-lead.config.toml` khi selector là `paseo-lead`.
Paseo provider không dùng selector này; nó cần
`~/.codex-paseo/lead/config.toml`.

### Strict config lỗi

    codex --strict-config --profile paseo-worker doctor --summary

Codex/Paseo model catalog thay đổi theo phiên bản/account. Discovery lại trước
khi sửa profile.

## 12. Nguồn chính thức

- [OpenAI Codex configuration reference](https://developers.openai.com/codex/config-reference)
- [OpenAI Codex AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- [Paseo Codex provider](https://paseo.sh/docs/codex)
- [Paseo custom providers](https://paseo.sh/docs/custom-providers)
- [Paseo configuration](https://paseo.sh/docs/configuration)
- [Paseo orchestration](https://paseo.sh/docs/orchestration)
