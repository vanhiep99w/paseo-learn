# pi-orchestration — Paseo role pack cho Pi

Bộ 4 role profile chạy **Paseo + Pi**, song song với
[`codex-orchestration/`](../codex-orchestration) nhưng dùng Pi thay cho Codex.
Kiến trúc tôn trọng đặc thù Pi: **Pi không có MCP built-in** (cần
`pi-mcp-adapter`), **không có sandbox mode** (ranh giới hành vi bằng instruction
+ tool policy), và cấu hình role qua **`PI_CODING_AGENT_DIR`** (tương đương
`CODEX_HOME` của Codex).

Ngày kiểm chứng runtime: Pi 0.84.1, Paseo CLI/daemon 0.2.5, pi-mcp-adapter
2.21.0, Linux.

## 1. Triết lý và điểm khác với codex-orchestration

| Khía cạnh | codex-orchestration | pi-orchestration |
|---|---|---|
| Agent CLI | `codex app-server` | `pi --mode rpc` |
| Cấu hình role | `CODEX_HOME/<role>/config.toml` | `PI_CODING_AGENT_DIR/<role>/` (AGENTS.md + settings.json + mcp.json) |
| Role instructions | `developer_instructions` (TOML) | `AGENTS.md` (context file toàn cục) |
| Sandbox | `danger-full-access` + `approval_policy=never` | Pi không có sandbox — ranh giới bằng instruction + extension |
| MCP chọn lọc | launcher thêm `-c mcp_servers.paseo.url=…` | launcher set `PASEO_MCP_URL`; role `mcp.json` đọc qua `${PASEO_MCP_URL}` |
| Allowlist tool MCP (supervisor) | `enabled_tools` trong config MCP | `includeTools` trong `mcp.json` |
| Enforcement cứng | KHÔNG (chỉ instruction + enabled_tools) | THÊM extension `setActiveTools` + backstop `tool_call` (lớp cứng pi) |

Cả hai cùng nguyên lý: **capability ≠ authority**, **không silent fallback**, và
Paseo là control plane duy nhất.

## 2. Bộ 4 role

| Paseo provider | Role (`PASEO_PI_ROLE`) | Có Paseo MCP? | Mục đích |
|---|---|---|---|
| `pi-lead` | `lead` | Có (đầy đủ, qua launcher) | phân rã, giao việc, nghiệm thu |
| `pi-worker` | `worker` | Không | implement trong scope của Task Brief |
| `pi-reviewer` | `reviewer` | Không | review candidate SHA / working diff, read-only |
| `pi-supervisor` | `supervisor` | Có (allowlist `includeTools`) | quan sát governance / recovery |

Worker/Reviewer không nhận Paseo MCP: không có launcher (`command: ["pi"]`) và
`mcp.json` của chúng không có entry `paseo`. Chỉ Lead/Supervisor chạy qua
`pi-role-app-server`, launcher set `PASEO_MCP_URL` (agent-scoped) khi có
`PASEO_AGENT_ID`.

## 3. Resource riêng từng profile (đặc trưng chính)

Mỗi role có một `PI_CODING_AGENT_DIR` riêng (`~/.pi-paseo/<role>/`) chứa:

```
~/.pi-paseo/<role>/
├── AGENTS.md          # role system prompt (= developer_instructions)
├── settings.json      # bật extension/skill/package cho role này
├── mcp.json           # lead/supervisor: paseo server; worker/reviewer: không có
├── extensions/        # → symlink paseo-team-policy.ts (shared)
├── skills/            # skill riêng của role (vd: lead có paseo-team-lead)
├── prompts/           # prompt template riêng của role
├── auth.json   ─┐
├── npm/        ─┼─→ symlink về ~/.pi/agent/ (dùng chung credential + pi-mcp-adapter + catalog)
├── git/        ─┤
└── models.json ─┘
```

→ Bạn gắn skill/tool riêng cho từng role bằng cách thêm vào `skills/` /
`extensions/` / `prompts/` của role đó (hoặc vào `settings.json`). Credential và
package store dùng chung nên không phải login hay `pi install` lại mỗi role.

## 4. Cài tự động

Yêu cầu:

```bash
command -v pi
command -v paseo
pi install npm:pi-mcp-adapter   # nếu chưa có
pi                              # /login lần đầu để có ~/.pi/agent/auth.json
```

Xem trước thay đổi:

```bash
./install pi --dry-run
```

Cài:

```bash
./install pi
```

Installer:

1. Tạo 4 role home trong `~/.pi-paseo`, mỗi home có `AGENTS.md`, `settings.json`,
   `mcp.json` (lead/supervisor), `skills/`, `prompts/`.
2. Symlink `extensions/paseo-team-policy.ts` (file chung) vào mỗi role.
3. Symlink `auth.json`, `npm/`, `git/`, `models.json` về `~/.pi/agent/`.
4. Copy launcher vào `$PASEO_HOME/bin` (mặc định `~/.paseo/bin`).
5. Merge 4 provider vào `~/.paseo/config.json`, đặt
   `daemon.mcp.injectIntoAgents = false`, chỉ cấp Paseo MCP cho Lead/Supervisor
   qua env `PASEO_MCP_ACCESS` + launcher.
6. Merge `~/.paseo/orchestration-preferences.json` (hướng discovery, không pin model).
7. Backup JSON trước khi thay đổi. **Không restart Paseo daemon.**

Nếu file/provider cùng tên đã có nội dung khác, installer fail closed. Đọc diff
rồi chạy lại với `--force` (backup trước khi ghi đè).

## 5. Cài thủ công

```bash
PI_ROLES=~/.pi-paseo
for role in lead worker reviewer supervisor; do
  mkdir -p $PI_ROLES/$role/{extensions,skills,prompts}
  cp pi-orchestration/profiles/$role/AGENTS.md        $PI_ROLES/$role/
  cp pi-orchestration/profiles/$role/settings.json    $PI_ROLES/$role/
  [ -f pi-orchestration/profiles/$role/mcp.json ] && \
    cp pi-orchestration/profiles/$role/mcp.json       $PI_ROLES/$role/
  cp -R pi-orchestration/profiles/$role/skills/.      $PI_ROLES/$role/skills/ 2>/dev/null || true
  ln -sf "$(pwd)/pi-orchestration/shared/paseo-team-policy.ts" $PI_ROLES/$role/extensions/
  ln -sf ~/.pi/agent/auth.json   $PI_ROLES/$role/auth.json
  ln -sf ~/.pi/agent/npm         $PI_ROLES/$role/npm
  ln -sf ~/.pi/agent/git         $PI_ROLES/$role/git
  [ -f ~/.pi/agent/models.json ] && ln -sf ~/.pi/agent/models.json $PI_ROLES/$role/models.json
done
mkdir -p ~/.paseo/bin
cp pi-orchestration/bin/pi-role-app-server ~/.paseo/bin/
chmod 755 ~/.paseo/bin/pi-role-app-server
```

Merge [`config/paseo.providers.example.json`](./config/paseo.providers.example.json)
vào `~/.paseo/config.json`, thay `__PASEO_HOME__` và `__PI_ROLES_HOME__` bằng
absolute path.

## 6. Refresh Paseo

Thay đổi custom provider có thể cần daemon reload/restart (restart sẽ dừng toàn
bộ agent đang chạy):

```bash
paseo daemon restart   # chỉ sau khi agent hiện tại đã an toàn
```

## 7. Verify

```bash
# Launcher
~/.paseo/bin/pi-role-app-server --version
bash -n ~/.paseo/bin/pi-role-app-server

# Role home mà Paseo thực sự dùng
PI_CODING_AGENT_DIR=~/.pi-paseo/lead pi --version

# Paseo providers/models
paseo provider ls --json
paseo provider models pi-lead --json
paseo provider models pi-worker --json

# Extension load (passive, không cần LLM) — chạy pi với role unset
pi -e ./shared/paseo-team-policy.ts --version
```

Trong một agent thật, dùng `/team-role` và `/team-tools` (do extension đăng ký)
để xem role hiện tại, workerMode và allow/deny policy.

## 8. Dùng trong Paseo Desktop

1. Thêm thư mục project vào Paseo Desktop dưới dạng workspace local.
2. Tạo agent mới, chọn provider `pi-lead`.
3. Chọn model + thinking từ catalog (dùng `list_models` discovery, không đoán).
4. Nhập yêu cầu thật. Không cần boilerplate về Worker/Reviewer/worktree — profile
   đã chứa policy đó.
5. Lead tự tạo Worker và Reviewer. Một writer tại một thời điểm; worktree chỉ khi
   Human yêu cầu.

Thiết lập role mặc định:

| Role | Provider | Khi nào dùng |
|---|---|---|
| Lead | `pi-lead` | phân rã + nghiệm thu |
| Worker | `pi-worker` | bounded write trong workspace hiện tại |
| Reviewer | `pi-reviewer` | review SHA/diff, độc lập |
| Supervisor | `pi-supervisor` | tùy chọn, không cần cho flow 1 Lead–1 Worker |

## 9. MCP và ranh giới role

Config đặt:

```json
"daemon": { "mcp": { "enabled": true, "injectIntoAgents": false } }
```

`injectIntoAgents` là daemon-wide. Bộ profile vì vậy tắt auto-injection rồi đặt
`PASEO_MCP_ACCESS=lead|supervisor` trên đúng hai custom provider. Launcher
`pi-role-app-server` lấy `PASEO_AGENT_ID` và `PASEO_AGENT_CWD` do Paseo export,
gắn MCP URL động với `callerAgentId`:

```
pi-lead        Paseo MCP đầy đủ
pi-supervisor  Paseo MCP với includeTools allowlist
pi-worker      không có Paseo MCP
pi-reviewer    không có Paseo MCP
```

`PASEO_AGENT_ID` phải do Paseo export cho custom provider pi (giống codex). Nếu
một phiên Paseo không export nó, launcher để `PASEO_MCP_URL` unset → role
`mcp.json` fail-closed lúc connect thay vì mạo danh agent khác. Nếu daemon bật
bearer authentication, truyền secret qua env `PASEO_MCP_BEARER_TOKEN` và thêm
`"bearerTokenEnv": "PASEO_MCP_BEARER_TOKEN"` vào `mcp.json` của lead/supervisor.

> Giới hạn: Pi không có sandbox. Mọi role đều có filesystem/network đầy đủ.
> Extension + `includeTools` là **capability exposure / behavioral boundary**,
> không phải ACL server-side chống process local cố tình gọi HTTP endpoint.
> Chỉ dùng trên máy/repo tin cậy.

## 10. Model routing (đơn giản, no silent fallback)

Khác pi-pack cũ (4 lớp phức tạp), bộ này đơn giản như codex: model/thinking chọn
lúc `create_agent` qua discovery, không pin vào profile.

Chu trình bắt buộc của Lead cho mỗi `create_agent`:

1. `list_providers` → verify role provider tồn tại + healthy.
2. `list_models` → verify exact model ID tồn tại.
3. Tạo agent với provider string `<role-provider>/<pi-provider>/<model-id>` +
   `settings.thinkingOptionId`. Không bao giờ bỏ model để inherit default.
4. `get_agent_status` → so khớp `snapshot.runtimeInfo.model` /
   `runtimeInfo.thinkingOptionId`. Lệch/thiếu → `BLOCKED: MODEL_RESOLUTION_MISMATCH`.

Runtime identity của chính agent: inspect bash-tool env `PI_PROVIDER` /
`PI_MODEL` / `PI_REASONING_LEVEL` — đừng suy ra từ prompt.

## 11. Cấu trúc thư mục

```
pi-orchestration/
├── bin/
│   └── pi-role-app-server                 # launcher: chọn lọc inject MCP
├── config/
│   └── paseo.providers.example.json       # 4 provider pi-* + injectIntoAgents=false
├── profiles/
│   ├── lead/        { AGENTS.md, settings.json, mcp.json, skills/paseo-team-lead/ }
│   ├── worker/      { AGENTS.md, settings.json }
│   ├── reviewer/    { AGENTS.md, settings.json }
│   └── supervisor/  { AGENTS.md, settings.json, mcp.json (includeTools) }
├── shared/
│   └── paseo-team-policy.ts               # extension enforcement cứng (4 role)
├── templates/
│   └── TASK_BRIEF_V3.md                   # canonical V3 brief + parser rules
└── install.mjs  (trong pi-orchestration/; chạy qua ./install pi ở repo root, song song codex-orchestration/install.mjs)
```

## 12. Troubleshooting

### Provider không xuất hiện
- `jq . ~/.paseo/config.json` (hoặc `cat`), kiểm tra absolute wrapper path.
- Refresh provider; chỉ `paseo daemon restart` sau khi agent hiện tại an toàn.

### Lead không thấy `mcp` tool / không spawn được agent
- Kiểm tra `PI_CODING_AGENT_DIR` của lead có `mcp.json` với entry `paseo`.
- Kiểm tra `pi-mcp-adapter` có trong `~/.pi/agent/npm` (symlink vào role).
- Kiểm tra `PASEO_AGENT_ID` được export (launcher log khi `PASEO_MCP_URL` set).
- Nếu Lead dùng `paseo run`/`paseo wait` qua shell → đó là dấu hiệu không nhận
  được agent-scoped MCP; Lead phải dùng `mcp({tool:"create_agent", ...})` với
  `notifyOnFinish=true`.

### Worker/Reviewer vẫn thấy `mcp` tool
- Extension KHÔNG giấu tool `mcp` khỏi worker/reviewer (pi-mcp-adapter đăng ký
  nó). Thay vào đó: (a) tool_call backstop chặn mọi lệnh `mcp` của worker/reviewer,
  và (b) `mcp.json` của chúng không có server `paseo` nên không có gì để gọi.
  Dùng `/team-tools` để xác nhận trạng thái active/inactive.

### Role home không tìm thấy
```bash
find ~/.pi-paseo -maxdepth 2 -name AGENTS.md -print
echo "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"
```

## 13. Phát triển

Type-check extension (TypeScript stripping của Node 25 chạy thẳng `.ts`):

```bash
node --check pi-orchestration/shared/paseo-team-policy.ts
```

Smoke-load extension không cần LLM (role unset → passive):

```bash
PASEO_PI_ROLE=lead pi -e ./pi-orchestration/shared/paseo-team-policy.ts -p "/team-role"
```

Trong một agent thật, `/team-role` in role + workerMode + policy; `/team-tools`
ghi toàn bộ tool registry ra `~/.pi/team-tools.txt`.

## 14. Nguồn

- [Paseo orchestration](https://paseo.sh/docs/orchestration)
- [Paseo MCP reference](https://paseo.sh/docs/mcp)
- [Paseo custom providers](https://paseo.sh/docs/custom-providers)
- [Pi docs](https://pi.dev) · [pi-mcp-adapter](https://github.com/badlogic/pi-mono)
- Bộ song song: [`codex-orchestration/`](../codex-orchestration) + hướng dẫn
  [`docs/codex-profiles-paseo-guide-vi.md`](../docs/codex-profiles-paseo-guide-vi.md)
