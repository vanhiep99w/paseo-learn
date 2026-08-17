# Vận hành Codex role pack với Paseo CLI

## Tổng quan

`codex-orchestration/` tạo bốn `CODEX_HOME` độc lập cho Lead, Worker, Reviewer
và Supervisor. Mỗi home chứa `config.toml`, hook manifest/scripts và auth
symlink. Tất cả custom providers chạy native `codex`; không còn launcher inject
MCP.

Paseo là control plane duy nhất. Lead/Supervisor gọi public Paseo CLI qua wrapper
role-gated `$PASEO_HOME/bin/paseo-team`.

## Cài đặt

```bash
codex login
./install codex --dry-run
./install codex
```

Installer:

1. cài role configs vào `~/.codex-paseo/<role>/`;
2. cài hooks và auth links;
3. copy `codex-orchestration/bin/paseo-team` vào `$PASEO_HOME/bin`;
4. merge bốn `codex-*` providers với `PASEO_CODEX_ROLE` và `PASEO_TEAM_CLI`;
5. đặt `daemon.mcp.injectIntoAgents=false` nhưng không yêu cầu MCP enabled;
6. không restart daemon.

## Orchestration

```bash
$PASEO_TEAM_CLI providers
$PASEO_TEAM_CLI models codex-worker
$PASEO_TEAM_CLI run \
  --provider codex-worker/<provider>/<model> \
  --thinking max \
  --mode full-access \
  -- '<V3 brief>'
$PASEO_TEAM_CLI inspect <agent-id>
```

Wrapper bắt buộc `PASEO_AGENT_ID`, exact provider/model và thinking. CLI-created
agent giữ parent và workspace của caller nếu không truyền workspace flag.

Agent Profiles chỉ là Human UI presets. Lead phải discover qua CLI và
post-verify `Provider`, `Model`, `Thinking`, `Mode` bằng `inspect`.

## Role boundaries

- Lead: facade đầy đủ cho discovery, workspace, run/send/wait/inspect/archive.
- Worker/Reviewer: wrapper từ chối mọi orchestration.
- Supervisor: observe/send và recovery Lead được gate theo provider/labels/
  thinking; không được đổi workspace.
- Raw `paseo`, MCP và native Codex subagents bị hooks chặn.

`danger-full-access` là capability, không phải authority. V3 Task Brief, owned
scope và git policy vẫn là boundary hành vi chính.

## Validation

```bash
node --check codex-orchestration/bin/paseo-team
node --check codex-orchestration/shared/paseo-team-policy/*.mjs
node test/codex-policy.test.mjs
node test/cli-orchestration.test.mjs
./install codex --dry-run
```
