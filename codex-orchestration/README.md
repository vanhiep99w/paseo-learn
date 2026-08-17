# Codex orchestration pack — CLI-only

Pack bốn role `codex-lead`, `codex-worker`, `codex-reviewer`,
`codex-supervisor` chạy dưới Paseo. Orchestration dùng wrapper role-gated
`$PASEO_HOME/bin/paseo-team`, không dùng MCP hoặc native Codex subagents.

## Cài đặt

```bash
codex login
./install codex --dry-run
./install codex

# Windows PowerShell / cmd.exe
.\install.cmd codex --dry-run
.\install.cmd codex

# Portable
node install.mjs codex --dry-run
```

Installer tạo role homes dưới `~/.codex-paseo/`, copy hooks và wrapper, merge
custom providers, đặt `daemon.mcp.injectIntoAgents=false`, giữ nguyên Human
Agent Profiles, và không restart daemon.

Tất cả providers dùng `command: ["codex"]`; không còn MCP app-server launcher.

## Role matrix

| Provider | Vai trò | Orchestration |
|---|---|---|
| `codex-lead` | decomposition, routing, acceptance | facade Lead |
| `codex-worker` | implementation theo V3 brief | bị từ chối |
| `codex-reviewer` | independent read-only review | bị từ chối |
| `codex-supervisor` | governance | observe/send + gated Lead recovery |

Hooks chặn native subagents, raw `paseo`, MCP, write ngoài authority và wrapper
use trái role. Supervisor shell chỉ được một invocation `$PASEO_TEAM_CLI` không
có control operators.

## Lệnh orchestration

```bash
$PASEO_TEAM_CLI providers
$PASEO_TEAM_CLI models codex-worker
$PASEO_TEAM_CLI run --provider codex-worker/<provider>/<model> --thinking max -- '<V3 brief>'
$PASEO_TEAM_CLI inspect <agent-id>
$PASEO_TEAM_CLI send <agent-id> -- '<full V3 follow-up>'
$PASEO_TEAM_CLI notify-each <agent-id> [<agent-id> ...]
```

## Kiểm tra

```bash
node --check codex-orchestration/shared/paseo-team-policy/*.mjs
node test/codex-policy.test.mjs
node test/cli-orchestration.test.mjs
./install codex --dry-run
```

Chi tiết: [`../wiki/packs/codex-orchestration.md`](../wiki/packs/codex-orchestration.md).
