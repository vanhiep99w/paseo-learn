# Claude Code orchestration pack — CLI-only

Pack bốn role `claude-lead`, `claude-worker`, `claude-reviewer`,
`claude-supervisor` chạy dưới Paseo. Orchestration dùng wrapper role-gated
`$PASEO_HOME/bin/paseo-team`; không role nào nhận Paseo MCP.

## Cài đặt

```bash
./install claude --dry-run
./install claude

# Windows PowerShell / cmd.exe
.\install.cmd claude --dry-run
.\install.cmd claude

# Portable
node install.mjs claude --dry-run
```

Installer tạo role homes dưới `~/.claude-paseo/`, copy policy hooks và wrapper,
merge custom providers/Agent Profiles, đặt `daemon.mcp.injectIntoAgents=false`,
và không restart daemon.

Tất cả custom providers dùng `command: ["claude"]`; không còn launcher
`--mcp-config`.

## Role matrix

| Provider | Vai trò | Orchestration |
|---|---|---|
| `claude-lead` | decomposition, routing, acceptance | facade Lead |
| `claude-worker` | implementation theo V3 brief | bị từ chối |
| `claude-reviewer` | independent plan/read-only review | bị từ chối |
| `claude-supervisor` | governance | observe/send + gated Lead recovery |

`PreToolUse`/`UserPromptSubmit` hooks chặn native Agent/Task, raw `paseo`, MCP,
write ngoài authority, và wrapper use trái role. Supervisor chỉ được một lệnh
wrapper đơn giản, không shell chaining.

## Lệnh orchestration

```bash
$PASEO_TEAM_CLI providers
$PASEO_TEAM_CLI models claude-worker
$PASEO_TEAM_CLI run --provider claude-worker/<provider>/<model> --thinking high -- '<V3 brief>'
$PASEO_TEAM_CLI inspect <agent-id>
$PASEO_TEAM_CLI send <agent-id> -- '<full V3 follow-up>'
$PASEO_TEAM_CLI notify-each <agent-id> [<agent-id> ...]
```

## Kiểm tra

```bash
node --check claude-orchestration/shared/paseo-team-policy/*.mjs
node test/active-policy.test.mjs
node test/cli-orchestration.test.mjs
./install claude --dry-run
```

Chi tiết: [`../wiki/packs/claude-orchestration.md`](../wiki/packs/claude-orchestration.md).
