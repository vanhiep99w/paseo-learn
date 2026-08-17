# Pi orchestration pack — CLI-only

Pack bốn role `pi-lead`, `pi-worker`, `pi-reviewer`, `pi-supervisor` chạy dưới
Paseo. Paseo là control plane duy nhất; orchestration đi qua wrapper
`$PASEO_HOME/bin/paseo-team`, không qua MCP.

## Cài đặt

```bash
pi                 # /login nếu cần
./install pi --dry-run
./install pi
```

Installer tạo các role home dưới `~/.pi-paseo/`, cài policy extension và
`paseo-team`, merge custom providers/Agent Profiles, đặt
`daemon.mcp.injectIntoAgents=false`, và không restart daemon.

`pi-mcp-adapter` không còn là dependency của pack.

## Role matrix

| Provider | Vai trò | Orchestration |
|---|---|---|
| `pi-lead` | decomposition, routing, acceptance | toàn bộ facade được Lead cho phép |
| `pi-worker` | implementation theo V3 brief | bị từ chối |
| `pi-reviewer` | review read-only | bị từ chối |
| `pi-supervisor` | governance | observe/send + gated Lead recovery |

Wrapper yêu cầu `PASEO_AGENT_ID`, nên agent con tạo qua CLI vẫn giữ parent và
workspace mặc định. Lead/Supervisor phải dùng `$PASEO_TEAM_CLI`; raw `paseo`,
MCP và native subagents bị policy chặn.

## Lệnh orchestration

```bash
$PASEO_TEAM_CLI providers
$PASEO_TEAM_CLI models pi-worker
$PASEO_TEAM_CLI run --provider pi-worker/<provider>/<model> --thinking high -- '<V3 brief>'
$PASEO_TEAM_CLI inspect <agent-id>
$PASEO_TEAM_CLI send <agent-id> -- '<full V3 follow-up>'
$PASEO_TEAM_CLI notify-each <agent-id> [<agent-id> ...]
$PASEO_TEAM_CLI wait <agent-id>
```

Agent Profiles chỉ là preset để Human launch trong app; Lead CLI luôn discover
provider/model/thinking rồi post-verify bằng `inspect`. Installer pin Pi Lead vào
`openai-codex/gpt-5.6-sol` + `high`; Worker/Reviewer/Supervisor vào
`openai-codex/gpt-5.6-luna` + `max`.

## Kiểm tra

```bash
node --check pi-orchestration/shared/paseo-team-policy.ts
node test/active-policy.test.mjs
node test/cli-orchestration.test.mjs
./install pi --dry-run
```

Chi tiết kiến trúc: [`../wiki/packs/pi-orchestration.md`](../wiki/packs/pi-orchestration.md).
