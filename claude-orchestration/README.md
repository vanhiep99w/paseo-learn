# claude-orchestration — Paseo role pack cho Claude Code

Bộ 4 role profile chạy **Paseo + Claude Code** (Anthropic `claude` CLI), song
song với [`codex-orchestration/`](../codex-orchestration) và
[`pi-orchestration/`](../pi-orchestration). Paseo hỗ trợ provider `claude` native
(`"extends": "claude"`); pack này biến khả năng đó thành một đội 4 role có kiểm
soát.

> **Phân biệt thuật ngữ:** “role profile” trong pack là Claude role home/custom
> provider định nghĩa role. **Paseo Agent Profile** là preset host-local cho
> provider/model/mode/thinking/features; nó không chứa role prompt hay authority.

> **Ngôn ngữ:** mọi response cho Human và mọi giao tiếp giữa các agent dùng
tiếng Việt. Code, command, path, identifier, protocol field và quoted evidence
giữ nguyên; Human có thể yêu cầu ngôn ngữ khác cho một output cụ thể.

Kiến trúc tôn trọng đặc thù Claude Code:

- Claude Code đọc config theo **thư mục** qua biến `CLAUDE_CONFIG_DIR` (tương đương
  `CODEX_HOME` của Codex / `PI_CODING_AGENT_DIR` của Pi). Mỗi role có một thư mục
  riêng (`~/.claude-paseo/<role>/`).
- Claude Code đọc **`CLAUDE.md`** làm system prompt (không phải `AGENTS.md` như
  Codex/Pi). Mỗi role ship một `CLAUDE.md`.
- Claude Code **không có sandbox filesystem**; Lead/Worker dùng
  `permissions.defaultMode: bypassPermissions`, Reviewer dùng `plan`, và ranh
  giới hành vi được bổ sung bằng `permissions.deny` + một
  **lớp policy hooks** (PreToolUse/UserPromptSubmit) — tương đương extension cứng
  của pack Pi.
- MCP của Paseo được inject chọn lọc qua launcher `claude-role-app-server` bằng
  cờ `--mcp-config` (inline JSON), chỉ Lead/Supervisor nhận.

> Trạng thái: **spec-grade**. Cả ba pack đều theo nguyên lý **capability ≠
> authority**, **không silent fallback**, và Paseo là control plane duy nhất. Pack
> này chưa được live-verify trên host đánh giá nếu provider `claude` chưa sẵn có
> (xem `docs/paseo-agent-orchestration-architecture-vi.md` §9.3).

## 1. Triết lý và điểm khác với codex/pi-orchestration

| Khía cạnh | codex-orchestration | pi-orchestration | claude-orchestration |
|---|---|---|---|
| Agent CLI | `codex app-server` | `pi --mode rpc` | `claude` (Agent SDK / headless) |
| Cấu hình role | `CODEX_HOME/<role>/config.toml` | `PI_CODING_AGENT_DIR/<role>/` | `CLAUDE_CONFIG_DIR/<role>/` (CLAUDE.md + settings.json) |
| Role instructions | `developer_instructions` (TOML) | `AGENTS.md` | **`CLAUDE.md`** |
| Sandbox | `danger-full-access` | không có | Lead/Worker `bypassPermissions`; Reviewer `plan` |
| MCP chọn lọc | launcher thêm `-c mcp_servers.paseo.url=…` | launcher set `PASEO_MCP_URL`; `mcp.json` đọc `${PASEO_MCP_URL}` | launcher inject `--mcp-config` JSON (URL agent-scoped) |
| Allowlist MCP (supervisor) | `enabled_tools` (config MCP) | `includeTools` (`mcp.json`) | **hooks PreToolUse** trên `mcp__paseo__*` |
| Enforcement cứng | KHÔNG (instruction + enabled_tools) | extension `setActiveTools` + backstop `tool_call` | **policy hooks** (PreToolUse + UserPromptSubmit) |

Cả ba cùng nguyên lý: **capability ≠ authority**, **không silent fallback**, và
Paseo là control plane duy nhất.

## 2. Bộ 4 role

| Paseo provider | Role (`PASEO_CLAUDE_ROLE`) | Có Paseo MCP? | Mục đích |
|---|---|---|---|
| `claude-lead` | `lead` | Có (đầy đủ, qua launcher) | phân rã, giao việc, nghiệm thu |
| `claude-worker` | `worker` | Không | implement trong scope của Task Brief |
| `claude-reviewer` | `reviewer` | Không | review candidate SHA / working diff, read-only |
| `claude-supervisor` | `supervisor` | Có (5 tool monitoring/recovery qua hooks) | quan sát governance / recovery |

Worker/Reviewer không nhận Paseo MCP: provider của chúng `command: ["claude"]`
(không qua launcher) nên không có `--mcp-config` injected. Chỉ Lead/Supervisor
chạy qua `claude-role-app-server`, launcher build URL agent-scoped khi có
`PASEO_AGENT_ID`.

## 3. Lớp enforcement: policy hooks

Khác pack Codex (instruction-only), pack Claude thêm một **lớp hooks cứng** —
tương đương extension `paseo-team-policy.ts` của pack Pi, port sang Node ESM. Các
script nằm ở `shared/paseo-team-policy/`, được copy vào `hooks/` của mỗi role
home, và `settings.json` đăng ký chúng:

- **`user-prompt-submit.mjs`** (event `UserPromptSubmit`): parse V3 Task Brief từ
  prompt hiện tại, thay state per-session atomically. Đây là tương đương
  `before_agent_start` của Pi — re-derive authority **mỗi turn**. Turn không có
  brief hợp lệ → read-only; event/state lỗi sẽ block Worker turn, không giữ grant cũ.
- **`pre-tool-use.mjs`** (event `PreToolUse`): đọc `tool_name` + `tool_input` từ
  stdin, áp dụng policy fail-closed. Chặn = ghi reason ra stderr + exit 2 (stderr
  được feed lại cho Claude).

Hooks thực thi (port từ extension Pi):

| Cơ chế Pi | Tương đương Claude Code |
|---|---|
| `setActiveTools(allow)` mỗi role | `permissions.allow/deny` + hook PreToolUse per-call |
| `tool_call` backstop | PreToolUse → exit 2 + stderr (hoặc JSON `permissionDecision: deny`) |
| Re-derive V3 brief mỗi `before_agent_start` | UserPromptSubmit (lưu state) + PreToolUse (đọc state) |
| Worker branch-scoped push | PreToolUse trên `Bash`, dùng lại regex `gitAuthorityBlockReason` |
| Reviewer luôn read-only | `defaultMode: plan` + deny write/edit + hook |
| Supervisor `create_agent` arg gate | PreToolUse trên `mcp__paseo__create_agent` |
| MCP target allowlist (`mcpBlockReason`) | PreToolUse trên `mcp__paseo__*` |
| Bash Paseo-CLI guard | PreToolUse trên `Bash` (`callsPaseoCli`) |
| Disable native subagents (`[agents] enabled=false`) | deny `Agent` + matcher/hook chặn cả `Agent`/`Task` |

Khi `PASEO_CLAUDE_ROLE` unset, hook passive (không chặn) — an toàn khi load trong
claude thường. Lead được write/edit chỉ khi `PASEO_TEAM_LEAD_WRITE=1`.

Symbols thuần (port verbatim, unit-testable): `parseTaskBrief`,
`resolveWorkerMode`, `workerGitAuthority`, `gitAuthorityBlockReason`,
`supervisorCreateAgentBlockReason`, `blockReasonForTool`, `detectRole`.

## 4. Resource riêng từng profile

Mỗi role có một `CLAUDE_CONFIG_DIR` riêng (`~/.claude-paseo/<role>/`) chứa:

```
~/.claude-paseo/<role>/
├── CLAUDE.md            # role system prompt (Claude Code đọc CLAUDE.md)
├── settings.json        # permissions + hooks (+ model nếu muốn)
├── hooks/               # các policy hook scripts (copy từ shared/)
├── skills/              # skill riêng (lead có paseo-team-lead)
├── prompts/             # prompt template riêng (nếu có)
├── .credentials.json ── → ~/.claude/.credentials.json (login dùng chung, Linux/Windows)
└── (session state do Claude Code tự tạo)
```

→ Bạn gắn skill/tool riêng cho từng role bằng cách thêm vào `skills/` /
`prompts/` của role đó (hoặc vào `settings.json`). Trên macOS, credentials nằm
trong Keychain — set `ANTHROPIC_API_KEY` trong env provider, hoặc `claude` login
một lần mỗi role home.

## 5. Cài tự động

Yêu cầu:

```bash
command -v claude
paseo --version   # phải là v0.4.0+
paseo status      # daemon phải chạy để query catalog `claude`
claude            # /login lần đầu để có ~/.claude/.credentials.json (Linux/Windows)
```

Xem trước thay đổi:

```bash
./install claude --dry-run
```

Cài:

```bash
./install claude
```

Installer:

1. Tạo 4 role home trong `~/.claude-paseo`, mỗi home có `CLAUDE.md`,
   `settings.json`, `skills/` (lead), và `hooks/` (copy các script policy).
2. Copy `shared/paseo-team-policy/*.mjs` vào `hooks/` của mỗi role.
3. Symlink `~/.claude/.credentials.json` về mỗi role (Linux/Windows) để dùng
   chung login.
4. Copy launcher vào `$PASEO_HOME/bin` (mặc định `~/.paseo/bin`).
5. Query model catalog `claude`, rồi merge 4 provider và 4 namespaced Agent
   Profiles vào `~/.paseo/config.json`; đặt
   `daemon.mcp.injectIntoAgents = false`, chỉ cấp Paseo MCP cho Lead/Supervisor
   qua env `PASEO_MCP_ACCESS` + launcher.
6. Merge `~/.paseo/orchestration-preferences.json` làm fallback routing.
7. Backup JSON trước khi thay đổi. **Không restart Paseo daemon.**

Nếu file/provider cùng tên đã có nội dung khác, installer fail closed. Đọc diff
rồi chạy lại với `--force` (backup trước khi ghi đè).

## 6. Cài thủ công

```bash
CLAUDE_ROLES=~/.claude-paseo
for role in lead worker reviewer supervisor; do
  mkdir -p $CLAUDE_ROLES/$role/{hooks,skills,prompts}
  cp claude-orchestration/profiles/$role/CLAUDE.md      $CLAUDE_ROLES/$role/
  cp claude-orchestration/profiles/$role/settings.json  $CLAUDE_ROLES/$role/
  cp -R claude-orchestration/profiles/$role/skills/.    $CLAUDE_ROLES/$role/skills/ 2>/dev/null || true
  cp claude-orchestration/shared/paseo-team-policy/*.mjs $CLAUDE_ROLES/$role/hooks/
  [ -f ~/.claude/.credentials.json ] && ln -sf ~/.claude/.credentials.json $CLAUDE_ROLES/$role/.credentials.json
done
mkdir -p ~/.paseo/bin
cp claude-orchestration/bin/claude-role-app-server ~/.paseo/bin/
chmod 755 ~/.paseo/bin/claude-role-app-server
```

Merge [`config/paseo.providers.example.json`](./config/paseo.providers.example.json)
vào `~/.paseo/config.json`, thay `__PASEO_HOME__` và `__CLAUDE_ROLES_HOME__` bằng
absolute path.

Regression policy dùng chung từ repo root:

```bash
node test/active-policy.test.mjs
```

## 7. Refresh Paseo

Thay đổi custom provider có thể cần daemon reload/restart (restart sẽ dừng toàn
bộ agent đang chạy):

```bash
paseo daemon restart   # chỉ sau khi agent hiện tại đã an toàn
```

## 8. Verify

```bash
# Launcher
~/.paseo/bin/claude-role-app-server --version
bash -n ~/.paseo/bin/claude-role-app-server

# Role home mà Paseo thực sự dùng
CLAUDE_CONFIG_DIR=~/.claude-paseo/lead claude --version

# Paseo providers/models
paseo provider ls --json
paseo provider models claude-lead --json
paseo provider models claude-worker --json

# Policy hooks (passive, không cần LLM) — chạy với role unset
echo '{"session_id":"x","tool_name":"Read","tool_input":{}}' \
  | node ~/.claude-paseo/worker/hooks/pre-tool-use.mjs; echo "exit=$?"
```

Trong một agent thật, không có `/team-role` như Pi; để kiểm chứng policy, chạy
casual: worker không brief mà Edit → bị chặn (exit 2); reviewer Bash `git push` →
bị chặn; supervisor `mcp__paseo__create_agent` sai shape → bị chặn.

## 9. Dùng trong Paseo Desktop

1. Thêm thư mục project vào Paseo Desktop dưới dạng workspace local.
2. Tạo agent mới, chọn provider `claude-lead`.
3. Chọn model + thinking từ catalog (dùng `list_models` discovery, không đoán).
4. Nhập yêu cầu thật. Không cần boilerplate về Worker/Reviewer/worktree — profile
   đã chứa policy đó.
5. Lead tự tạo Worker và Reviewer. Một writer tại một thời điểm; worktree chỉ khi
   Human yêu cầu.

Thiết lập role mặc định:

| Role | Provider | Khi nào dùng |
|---|---|---|
| Lead | `claude-lead` | phân rã + nghiệm thu |
| Worker | `claude-worker` | bounded write trong workspace hiện tại |
| Reviewer | `claude-reviewer` | review SHA/diff, độc lập |
| Supervisor | `claude-supervisor` | tùy chọn, không cần cho flow 1 Lead–1 Worker |

## 10. MCP và ranh giới role

Config đặt:

```json
"daemon": { "mcp": { "enabled": true, "injectIntoAgents": false } }
```

`injectIntoAgents` là daemon-wide. Pack tắt auto-injection rồi đặt
`PASEO_MCP_ACCESS=lead|supervisor` trên đúng hai custom provider. Launcher
`claude-role-app-server` lấy `PASEO_AGENT_ID` do Paseo export, build URL động với
`callerAgentId`, và inject qua `--mcp-config` JSON:

```
claude-lead        Paseo MCP đầy đủ
claude-supervisor  Paseo MCP + hook ép allowlist 5 tool
claude-worker      không có Paseo MCP
claude-reviewer    không có Paseo MCP
```

`PASEO_AGENT_ID` phải do Paseo export cho custom provider claude (giống codex/pi).
Nếu một phiên Paseo không export nó, launcher không inject gì → role fail-closed
lúc connect thay vì mạo danh agent khác. Nếu daemon bật bearer authentication,
truyền secret qua env `PASEO_MCP_BEARER_TOKEN`; launcher đặt header
`Authorization: Bearer ${PASEO_MCP_BEARER_TOKEN}` (literal, Claude expand — secret
không nằm trong argv).

> Giới hạn: Claude Code không có sandbox thật. Mọi role đều có filesystem/network
> đầy đủ. Hooks + `permissions.deny` là **capability exposure / behavioral
> boundary**, không phải ACL server-side chống process local cố tình gọi HTTP
> endpoint. Chỉ dùng trên máy/repo tin cậy.

## 11. Agent Profile + model routing (no silent fallback)

Paseo v0.4.0+ cung cấp host-wide Agent Profiles. Lead gọi
`mcp__paseo__list_profiles` để đọc các route candidate, nhưng profile không phải
runtime evidence và `notes` không phải authority. Installer query ordered
catalog `claude`, chọn model đầu tiên/default cùng default thinking, rồi merge
bốn managed profiles `paseo-learn:claude:*:host-default` vào
`daemon.agentProfiles`. Human profiles được giữ nguyên; managed profile khác
biệt làm install fail trừ khi có `--force`.

Claude Lead mặc định chỉ route sang `claude-*` (`claude-worker`,
`claude-reviewer`, …). Cross-family như `pi-*` hoặc `codex-*` chỉ được phép khi
Human chỉ định rõ family cho delegation đó; nếu Claude route unavailable thì
Lead block và hỏi, không tự fallback sang family khác.

Chu trình bắt buộc của Lead cho mỗi `create_agent`:

1. Chọn role/MODEL_CLASS; gọi `list_profiles` nếu có. Chỉ chọn profile có
   `provider` đúng role (`claude-worker`, `claude-reviewer`, …) và `model` không
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

Runtime identity của chính agent: Claude Code không expose provider/model qua
shell env như Pi; kiểm chứng qua `get_agent_status` runtimeInfo và các trường
`ASSIGNED_*`, escalate `MODEL_MISMATCH` khi lệch.

## 12. Cấu trúc thư mục

```
claude-orchestration/
├── bin/
│   ├── claude-role-app-server             # launcher: chọn lọc inject MCP qua --mcp-config
│   └── claude-readonly-app-server         # shim tương thích
├── config/
│   └── paseo.providers.example.json       # 4 provider claude-* + injectIntoAgents=false
├── profiles/
│   ├── lead/        { CLAUDE.md, settings.json, skills/paseo-team-lead/ }
│   ├── worker/      { CLAUDE.md, settings.json }
│   ├── reviewer/    { CLAUDE.md, settings.json }
│   └── supervisor/  { CLAUDE.md, settings.json }
├── shared/
│   └── paseo-team-policy/                 # hooks enforcement cứng (4 role)
│       ├── brief.mjs                       # parse V3 brief + worker authority
│       ├── policy.mjs                      # role policy + blockReasonForTool
│       ├── pre-tool-use.mjs                # hook entry: PreToolUse
│       └── user-prompt-submit.mjs          # hook entry: UserPromptSubmit
├── templates/
│   └── TASK_BRIEF_V3.md                   # canonical V3 brief + parser rules
└── install.mjs  (chạy qua ./install claude ở repo root, song song codex/pi)
```

Installer copy template vào đường dẫn runtime cố định
`$CLAUDE_CONFIG_DIR/templates/TASK_BRIEF_V3.md` của Lead. Lead không được quét
`$HOME` bằng `find` để tìm source checkout.

## 13. Troubleshooting

### `find ... TASK_BRIEF_V3.md` bị timeout

Đây là broad filesystem scan, không phải Paseo MCP failure. Cài lại pack rồi
kiểm tra deterministic path:

```bash
./install claude --force
test -f ~/.claude-paseo/lead/templates/TASK_BRIEF_V3.md
```

### Provider không xuất hiện
- `jq . ~/.paseo/config.json` (hoặc `cat`), kiểm tra absolute wrapper path và
  `extends: "claude"`.
- Refresh provider; chỉ `paseo daemon restart` sau khi agent hiện tại an toàn.

### Lead không thấy tool `mcp__paseo__*` / không spawn được agent
- Kiểm tra provider `claude-lead` có `command` là launcher và
  `PASEO_MCP_ACCESS: "lead"`.
- Kiểm tra `PASEO_AGENT_ID` được export (launcher không inject nếu thiếu →
  fail-closed).
- Nếu Lead dùng `paseo run`/`paseo wait` qua shell → đó là dấu hiệu không nhận
  được agent-scoped MCP; Lead phải gọi trực tiếp `mcp__paseo__create_agent` với
  `notifyOnFinish=true`.

### Worker/Reviewer vẫn thấy tool `mcp__paseo__*`
- Không nên: provider của chúng là `["claude"]` (không launcher) nên không có
  `--mcp-config` injected. Nếu thấy, có thể workspace có `.mcp.json` riêng của
  project (không phải do pack). Hook PreToolUse vẫn chặn mọi `mcp__paseo__*` của
  worker/reviewer fail-closed.

### Hook không chặn
- Kiểm tra `CLAUDE_CONFIG_DIR` của role có `settings.json` đăng ký hooks và thư
  mục `hooks/` có 4 file `.mjs`.
- Kiểm tra `PASEO_CLAUDE_ROLE` được set trong env provider (hook passive nếu
  unset).
- Test thủ công: feed JSON stdin vào `hooks/pre-tool-use.mjs` (xem §8).

### Role home không tìm thấy
```bash
find ~/.claude-paseo -maxdepth 2 -name CLAUDE.md -print
echo "${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
```

## 14. Phát triển

Type-check / smoke hook scripts không cần LLM (Node ESM `.mjs`):

```bash
node --check claude-orchestration/shared/paseo-team-policy/*.mjs
# Passive (role unset) — phải exit 0:
echo '{"session_id":"t","tool_name":"Read","tool_input":{}}' \
  | node claude-orchestration/shared/paseo-team-policy/pre-tool-use.mjs
# Worker không brief + Edit — phải exit 2:
echo '{"session_id":"t","tool_name":"Edit","tool_input":{}}' \
  | PASEO_CLAUDE_ROLE=worker node claude-orchestration/shared/paseo-team-policy/pre-tool-use.mjs
```

## 15. Nguồn

- [Paseo orchestration](https://paseo.sh/docs/orchestration)
- [Paseo Claude Code provider](https://paseo.sh/docs/claude-code)
- [Paseo MCP reference](https://paseo.sh/docs/mcp)
- [Paseo custom providers](https://paseo.sh/docs/custom-providers)
- [Claude Code docs](https://code.claude.com/docs) · [Claude Code hooks](https://code.claude.com/docs/en/hooks) · [Claude Code settings](https://code.claude.com/docs/en/settings)
- Bộ song song: [`codex-orchestration/`](../codex-orchestration),
  [`pi-orchestration/`](../pi-orchestration)
