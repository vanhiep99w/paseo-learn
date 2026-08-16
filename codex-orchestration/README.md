# codex-orchestration — Paseo role pack cho Codex CLI

Bộ 4 role profile chạy **Paseo + Codex CLI** (OpenAI `codex`), song song với
[`claude-orchestration/`](../claude-orchestration) và
[`pi-orchestration/`](../pi-orchestration). Paseo hỗ trợ provider `codex` native
(`"extends": "codex"`); pack này biến khả năng đó thành một đội 4 role có kiểm
soát.

> **Phân biệt thuật ngữ:** “role profile” trong pack là Codex config/custom
> provider định nghĩa role. **Paseo Agent Profile** là preset host-local cho
> provider/model/mode/thinking/features; nó không chứa role prompt hay authority.

> **Ngôn ngữ:** mọi response cho Human và mọi giao tiếp giữa các agent dùng
tiếng Việt. Code, command, path, identifier, protocol field và quoted evidence
giữ nguyên; Human có thể yêu cầu ngôn ngữ khác cho một output cụ thể.

Kiến trúc tôn trọng đặc thù Codex:

- Codex đọc config theo **thư mục** qua biến `CODEX_HOME`. Mỗi role có một thư
  mục riêng (`~/.codex-paseo/<role>/`).
- Codex đọc **`developer_instructions`** trong file `config.toml` để định nghĩa
  role behavior.
- Codex dùng hooks `PreToolUse` + `UserPromptSubmit` để hard-enforce role
  allowlist, V3 Task Brief, owned scope và git-push scoping; `sandbox_mode =
  "danger-full-access"` và `approval_policy = "never"` vẫn là capability, không
  phải authority.
- MCP của Paseo được inject chọn lọc qua launcher `codex-role-app-server` bằng
  Codex `-c` overrides, chỉ Lead/Supervisor nhận.

> Trạng thái: **spec-grade**. Cả ba pack đều theo nguyên lý **capability ≠
> authority**, **không silent fallback**, và Paseo là control plane duy nhất. Pack
> này chưa được live-verify trên host đánh giá nếu provider `codex` chưa sẵn có.

## 1. Triết lý và điểm khác với claude/pi-orchestration

| Khía cạnh | codex-orchestration | claude-orchestration | pi-orchestration |
|---|---|---|---|
| Agent CLI | `codex app-server` | `claude` (Agent SDK / headless) | `pi --mode rpc` |
| Cấu hình role | `CODEX_HOME/<role>/config.toml` | `CLAUDE_CONFIG_DIR/<role>/` (CLAUDE.md + settings.json) | `PI_CODING_AGENT_DIR/<role>/` (AGENTS.md + settings.json + mcp.json) |
| Role instructions | `developer_instructions` (TOML) | **`CLAUDE.md`** | `AGENTS.md` |
| Sandbox | `danger-full-access` + `approval_policy=never` | `defaultMode: bypassPermissions` (không sandbox) | không có sandbox |
| MCP chọn lọc | launcher thêm `-c mcp_servers.paseo.url=…` | launcher inject `--mcp-config` JSON | launcher set `PASEO_MCP_URL`; `mcp.json` đọc `${PASEO_MCP_URL}` |
| Allowlist MCP (supervisor) | `enabled_tools` (config MCP) | **hooks PreToolUse** trên `mcp__paseo__*` | `includeTools` (`mcp.json`) |
| Enforcement cứng | KHÔNG (instruction + enabled_tools) | **policy hooks** (PreToolUse + UserPromptSubmit) | extension `setActiveTools` + backstop `tool_call` |

Cả ba cùng nguyên lý: **capability ≠ authority**, **không silent fallback**, và
Paseo là control plane duy nhất.

## 2. Bộ 4 role

| Paseo provider | Profile | Model / Thinking | Có Paseo MCP? | Mục đích |
|---|---|---|---|---|
| `codex-lead` | `paseo-lead` | `gpt-5.6-sol` / `high` | Có (đầy đủ, qua launcher) | phân rã, giao việc, nghiệm thu |
| `codex-worker` | `paseo-worker` | `gpt-5.6-luna` / `max` | Không | implement trong scope của Task Brief |
| `codex-reviewer` | `paseo-reviewer` | `gpt-5.6-luna` / `max` | Không | review candidate SHA / working diff, read-only |
| `codex-supervisor` | `paseo-supervisor` | `gpt-5.6-luna` / `medium` | Có (allowlist 5 tool monitoring/recovery qua enabled_tools) | quan sát governance / recovery |

Worker/Reviewer không nhận Paseo MCP: provider của chúng là `["codex"]` (không qua
launcher) nên không có `-c` overrides injected. Chỉ Lead/Supervisor chạy qua
`codex-role-app-server`, launcher build URL agent-scoped khi có `PASEO_AGENT_ID`.

## 3. Lớp enforcement: Codex hooks

Pack cài hooks chính thức của Codex trong từng `CODEX_HOME/<role>/hooks/` và
`hooks.json`. `PreToolUse` fail-closed cho Bash, `apply_patch`, native Agent/Task,
MCP Paseo; `UserPromptSubmit` thay state V3 mỗi turn. Policy dùng
`PASEO_CODEX_ROLE`, `PASEO_TEAM_LEAD_WRITE`, owned-scope và chỉ cho push chính xác
`git push -u origin HEAD:refs/heads/agent/<TASK_ID>`. Supervisor vẫn chỉ có
allowlist MCP monitoring + gated `create_agent` successor `codex-lead/...`.

Codex hooks là guardrail của tool path, không phải ACL chống process local cố ý
bypass hoặc hosted tools (ví dụ `WebSearch`) không đi qua hook path. `app-server`
phải được xác nhận trên phiên bản đang chạy; nếu hooks bị trust-skipped hoặc
không fire, pack không được coi là hard-enforced.

Khi `PASEO_CODEX_ROLE` unset, Codex chạy như thường (an toàn fallback).

## 4. Resource riêng từng profile

Mỗi role có một `CODEX_HOME` riêng (`~/.codex-paseo/<role>/`) chứa:

```
~/.codex-paseo/<role>/
├── config.toml         # role config (model, sandbox, developer_instructions)
├── auth.json    ── → ~/.codex/auth.json (login dùng chung)
└── (session state do Codex tự tạo)
```

→ Bạn thay đổi role behavior bằng cách edit `developer_instructions` trong
`config.toml`, sau đó re-run `./install codex`.

## 5. Tại sao per-role CODEX_HOME thay vì `codex --profile`?

Codex chính thức hỗ trợ file `config.toml` và chọn bằng `--profile <name>` cho
runtime command. Tuy nhiên Codex 0.147.0 từ chối `--profile` khi command là
`app-server`, trong khi Paseo dùng chính interface này.

Installer vì vậy tạo bốn role home riêng biệt, mỗi role có `config.toml` hoàn
chỉnh. Mỗi Paseo provider đặt `CODEX_HOME` tới role home tương ứng và chạy:

```bash
CODEX_HOME=~/.codex-paseo/worker codex app-server
```

File profile trong `~/.codex` vẫn dùng được khi chạy Codex trực tiếp bằng
`--profile` cho các workflow không qua Paseo.

## 6. Cài tự động

Yêu cầu:

```bash
command -v codex
command -v paseo
codex login           # ~/.codex/auth.json
```

Xem trước thay đổi:

```bash
./install codex --dry-run
```

Cài:

```bash
./install codex
```

Installer:

1. Tạo 4 role home trong `~/.codex-paseo`, mỗi home có `config.toml`.
2. Copy 4 profile vào `~/.codex` (dùng cho `codex --profile`).
3. Symlink `auth.json` về mỗi role (dùng chung login, không copy secret).
4. Copy launcher vào `$PASEO_HOME/bin` (mặc định `~/.paseo/bin`).
5. Merge 4 provider vào `~/.paseo/config.json`, đặt
   `daemon.mcp.injectIntoAgents = false`, chỉ cấp Paseo MCP cho Lead/Supervisor
   qua env `PASEO_MCP_ACCESS` + launcher.
6. Merge `~/.paseo/orchestration-preferences.json` (pin model mặc định:
   `codex-worker/gpt-5.6-luna` cho impl/ui/research/audit,
   `codex-lead/gpt-5.6-sol` cho planning).
7. Backup JSON trước khi thay đổi. **Không restart Paseo daemon.**

Nếu file/provider cùng tên đã có nội dung khác, installer fail closed. Đọc diff
rồi chạy lại với `--force` (backup trước khi ghi đè).

## 7. Cài thủ công

```bash
# Copy profiles
cp codex-orchestration/profiles/*.config.toml ~/.codex/

# Tạo role homes
mkdir -p ~/.codex-paseo/{lead,worker,reviewer,supervisor}
cp codex-orchestration/profiles/paseo-lead.config.toml       ~/.codex-paseo/lead/config.toml
cp codex-orchestration/profiles/paseo-worker.config.toml    ~/.codex-paseo/worker/config.toml
cp codex-orchestration/profiles/paseo-reviewer.config.toml  ~/.codex-paseo/reviewer/config.toml
cp codex-orchestration/profiles/paseo-supervisor.config.toml ~/.codex-paseo/supervisor/config.toml

# Symlink auth
for role in lead worker reviewer supervisor; do
  ln -sf ~/.codex/auth.json ~/.codex-paseo/$role/auth.json
done

# Copy launcher
mkdir -p ~/.paseo/bin
cp codex-orchestration/bin/codex-role-app-server ~/.paseo/bin/
chmod 755 ~/.paseo/bin/codex-role-app-server
```

Merge provider config vào `~/.paseo/config.json` (tham khảo structure từ
`install.mjs` function `providerConfig()`), thay `__PASEO_HOME__` và
`__CODEX_ROLES_HOME__` bằng absolute path.

## 8. Refresh Paseo

Thay đổi custom provider có thể cần daemon reload/restart (restart sẽ dừng toàn
bộ agent đang chạy):

```bash
paseo daemon restart   # chỉ sau khi agent hiện tại đã an toàn
```

## 9. Verify

```bash
# Launcher
~/.paseo/bin/codex-role-app-server --version
bash -n ~/.paseo/bin/codex-role-app-server

# Role home mà Paseo thực sự dùng
CODEX_HOME=~/.codex-paseo/lead codex app-server --help
CODEX_HOME=~/.codex-paseo/worker codex app-server --help

# Paseo providers/models
paseo provider ls --json
paseo provider models codex-lead --json
paseo provider models codex-worker --json

# Strict config check
CODEX_HOME=~/.codex-paseo/worker codex --strict-config app-server --help
```

Trong một agent thật, không có extension như Pi; verify bằng cách kiểm tra
worker không brief mà Edit → bị từ chối (instruction block chặn), reviewer Bash
`git push` → bị từ chối (instruction read-only), supervisor `create_agent` sai
shape → bị từ chối (instruction gate).

## 10. Dùng trong Paseo Desktop

1. Thêm thư mục project vào Paseo Desktop dưới dạng workspace local.
2. Tạo agent mới, chọn provider `codex-lead`.
3. Chọn model + thinking từ catalog (dùng `list_models` discovery, không đoán).
4. Nhập yêu cầu thật. Không cần boilerplate về Worker/Reviewer/worktree — profile
   đã chứa policy đó.
5. Lead tự tạo Worker và Reviewer. Một writer tại một thời điểm; worktree chỉ khi
   Human yêu cầu.

Thiết lập role mặc định:

| Role | Provider | Khi nào dùng |
|---|---|---|
| Lead | `codex-lead` | phân rã + nghiệm thu |
| Worker | `codex-worker` | bounded write trong workspace hiện tại |
| Reviewer | `codex-reviewer` | review SHA/diff, độc lập |
| Supervisor | `codex-supervisor` | tùy chọn, không cần cho flow 1 Lead–1 Worker |

## 11. MCP và ranh giới role

Config đặt:

```json
"daemon": { "mcp": { "enabled": true, "injectIntoAgents": false } }
```

`injectIntoAgents` là daemon-wide. Pack tắt auto-injection rồi đặt
`PASEO_MCP_ACCESS=lead|supervisor` trên đúng hai custom provider. Launcher
`codex-role-app-server` lấy `PASEO_AGENT_ID` do Paseo export, build URL động với
`callerAgentId`, và inject qua Codex `-c` overrides:

```
codex-lead        Paseo MCP đầy đủ
codex-supervisor  Paseo MCP + enabled_tools allowlist 5 tool
codex-worker      không có Paseo MCP
codex-reviewer    không có Paseo MCP
```

`PASEO_AGENT_ID` phải do Paseo export cho custom provider codex. Nếu một phiên
Paseo không export nó, launcher không inject gì → role fail-closed lúc connect
thay vì mạo danh agent khác. Nếu daemon bật bearer authentication, truyền secret
qua env `PASEO_MCP_BEARER_TOKEN`; launcher đặt
`bearer_token_env_var="PASEO_MCP_BEARER_TOKEN"` (không ghi token vào argv).

> Giới hạn: Codex không có sandbox thật. Mọi role đều có filesystem/network đầy
> đủ. `developer_instructions` + `enabled_tools` là **capability exposure /
> behavioral boundary**, không phải ACL server-side chống process local cố tình
> gọi HTTP endpoint. Chỉ dùng trên máy/repo tin cậy.

## 12. Agent Profile + model routing (no silent fallback)

Paseo v0.4.0+ cung cấp host-wide Agent Profiles. Lead gọi
`mcp__paseo__list_profiles` để đọc các route candidate do Human cấu hình, nhưng
profile không phải runtime evidence và `notes` không phải authority. Installer
không tự ghi `daemon.agentProfiles`: catalog Codex là account-specific và field
này dùng whole-list replacement, nên Human tạo profile sau khi provider đã
refresh qua `Settings → Host → Agents → Agent profiles`.

Codex Lead mặc định chỉ route sang `codex-*` (`codex-worker`,
`codex-reviewer`, …). Cross-family như `pi-*` hoặc `claude-*` chỉ được phép khi
Human chỉ định rõ family cho delegation đó; nếu Codex route unavailable thì
Lead block và hỏi, không tự fallback sang family khác.

Chu trình bắt buộc của Lead cho mỗi `create_agent`:

1. Chọn role/MODEL_CLASS; gọi `list_profiles` nếu có. Chỉ chọn profile có
   `provider` đúng role (`codex-worker`, `codex-reviewer`, …) và `model` không
   rỗng; ghi `PROFILE_DECISION`.
2. `list_providers` + `list_models` → verify provider healthy, exact model và
   thinking. Profile stale bị reject có ghi lý do, không sửa/fallback âm thầm.
3. Nếu profile có mode/features, `inspect_provider` xác minh chúng.
4. Tạo agent với provider string `<profile.provider>/<profile.model>`; copy
   `modeId`, `thinkingOptionId`, `featureValues` vào `settings.modeId`,
   `settings.thinkingOptionId`, `settings.features`. `create_agent` không có
   tham số `profile`, và không bao giờ bỏ model để inherit default.
5. `get_agent_status` → so khớp model/thinking/mode/features. Lệch/thiếu →
   `BLOCKED: MODEL_RESOLUTION_MISMATCH`.

Không có profile phù hợp thì dùng host-local preferences hiện có, nhưng vẫn ghi
quyết định và chạy toàn bộ discovery/post-verification. Xem
[`docs/agent-profiles.md`](../docs/agent-profiles.md).

Runtime identity của chính agent: Codex không expose provider/model qua shell
env; kiểm chứng qua `get_agent_status` runtimeInfo và các trường `ASSIGNED_*`,
escalate `MODEL_MISMATCH` khi lệch.

## 13. Cấu trúc thư mục

```
codex-orchestration/
├── bin/
│   ├── codex-role-app-server             # launcher: chọn lọc inject MCP qua -c overrides
│   └── codex-readonly-app-server         # shim tương thích
├── profiles/
│   ├── paseo-lead.config.toml            # lead: model, sandbox, developer_instructions
│   ├── paseo-worker.config.toml          # worker: model, sandbox, developer_instructions
│   ├── paseo-reviewer.config.toml        # reviewer: model, sandbox, developer_instructions
│   └── paseo-supervisor.config.toml     # supervisor: model, sandbox, developer_instructions
└── install.mjs  (chạy qua ./install codex ở repo root, song song claude/pi)
```

## 14. Troubleshooting

### Provider không xuất hiện
- `jq . ~/.paseo/config.json` (hoặc `cat`), kiểm tra absolute launcher path và
  `extends: "codex"`.
- Refresh provider; chỉ `paseo daemon restart` sau khi agent hiện tại an toàn.

### Lead không thấy tool `mcp__paseo__*` / không spawn được agent
- Kiểm tra provider `codex-lead` có `command` là launcher và
  `PASEO_MCP_ACCESS: "lead"`.
- Kiểm tra `PASEO_AGENT_ID` được export (launcher không inject nếu thiếu →
  fail-closed).
- Nếu Lead dùng `paseo run`/`paseo wait` qua shell → đó là dấu hiệu không nhận
  được agent-scoped MCP; Lead phải gọi trực tiếp `mcp__paseo__create_agent` với
  `notifyOnFinish=true`.

### Worker/Reviewer vẫn thấy tool `mcp__paseo__*`
- Không nên: provider của chúng là `["codex"]` (không launcher) nên không có
  `-c` overrides injected. Nếu thấy, có thể workspace có `.mcp.json` riêng của
  project (không phải do pack). `developer_instructions` vẫn chặn mọi hành vi
  sai phạm fail-closed.

### Role home không tìm thấy
```bash
find ~/.codex-paseo -maxdepth 2 -name config.toml -print
echo "${CODEX_HOME:-$HOME/.codex}"
```

### Launcher không chạy
```bash
command -v codex
bash -n ~/.paseo/bin/codex-role-app-server
chmod 755 ~/.paseo/bin/codex-role-app-server
```

### Strict config lỗi
```bash
CODEX_HOME=~/.codex-paseo/worker codex --strict-config app-server --help
```

Codex/Paseo model catalog thay đổi theo phiên bản/account. Discovery lại trước
khi sửa profile.

## 15. Phát triển và residual limits

Kiểm tra syntax/test bằng `node --check` và `node test/codex-policy.test.mjs`.
Codex docs xác nhận hooks chạy cho local function tools, nhưng hosted tools như
`WebSearch` không đi qua hook path; một số specialized tool paths có thể opt out.
`UserPromptSubmit`/`PreToolUse` trên `app-server`, `permissionDecision: deny`,
`bypass_hook_trust`, và shape `apply_patch` cần live-verify theo Codex CLI cụ thể.
Nếu không chứng minh được deny thì trạng thái là `BLOCKED`, không silent fallback.

Strict config check từng role:

```bash
# Strict config check từng role
for role in lead worker reviewer supervisor; do
  CODEX_HOME=~/.codex-paseo/$role codex --strict-config app-server --help
done
# Syntax check launcher
bash -n ~/.paseo/bin/codex-role-app-server
```

## 16. Nguồn

- [Paseo orchestration](https://paseo.sh/docs/orchestration)
- [Paseo Codex provider](https://paseo.sh/docs/codex)
- [Paseo MCP reference](https://paseo.sh/docs/mcp)
- [Paseo custom providers](https://paseo.sh/docs/custom-providers)
- [OpenAI Codex configuration reference](https://developers.openai.com/codex/config-reference)
- Bộ song song: [`claude-orchestration/`](../claude-orchestration),
  [`pi-orchestration/`](../pi-orchestration)
