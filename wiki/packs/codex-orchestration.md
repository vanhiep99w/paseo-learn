# Pack: codex-orchestration (Codex CLI)

The Codex role pack runs OpenAI's Codex CLI as a four-role team under Paseo. It
is committed at `codex-orchestration/`. Shared concepts live in
[../architecture.md](../architecture.md); this page covers what is specific to
Codex. A Codex role profile/custom provider defines behavior and policy; it is
not a Paseo **Agent Profile**, which is only a host-local runtime-settings
preset.

## How role separation works

Each role gets its own **`CODEX_HOME`** directory (`~/.codex-paseo/<role>/`)
holding a `config.toml`. Paseo's custom provider sets `CODEX_HOME` to that
directory and launches Codex, so each role loads its own model, sandbox, and
`developer_instructions` while sharing one `auth.json` (symlinked back to
`~/.codex/auth.json`).

The four Codex role profiles are the source of role behavior:

| Provider | Profile | Model / thinking | File |
|---|---|---|---|
| `codex-lead` | `paseo-lead` | `gpt-5.6-sol` / `high` | `codex-orchestration/profiles/paseo-lead.config.toml` |
| `codex-worker` | `paseo-worker` | `gpt-5.6-luna` / `max` | `codex-orchestration/profiles/paseo-worker.config.toml` |
| `codex-reviewer` | `paseo-reviewer` | `gpt-5.6-luna` / `max` | `codex-orchestration/profiles/paseo-reviewer.config.toml` |
| `codex-supervisor` | `paseo-supervisor` | `gpt-5.6-luna` / `medium` | `codex-orchestration/profiles/paseo-supervisor.config.toml` |

Each TOML sets `sandbox_mode = "danger-full-access"` and
`approval_policy = "never"`, disables native Codex subagents (`[agents] enabled = false`),
and carries the role's `developer_instructions`. **There is no enforcement
extension** — role behavior is bounded by instructions plus the MCP `enabled_tools`
allowlist (see [../architecture.md](../architecture.md#capability-is-not-authority)).

Why role-specific `CODEX_HOME` instead of `codex --profile`? Codex 0.147.0
rejects `--profile` when the command is `app-server`, which is the interface
Paseo uses. Per-role homes avoid that launcher quirk and keep config + session
state separate. (Documented in `docs/codex-profiles-paseo-guide-vi.md` §1.)

## The launcher: codex-role-app-server

Only **Lead** and **Supervisor** run through `codex-orchestration/bin/codex-role-app-server`.
Worker and Reviewer use plain `codex` because they need no Paseo MCP.

The launcher (`codex-orchestration/bin/codex-role-app-server`):

1. Handles Paseo's `--version` probe (`exec codex --version`).
2. Reads `PASEO_AGENT_ID` / `PASEO_AGENT_CWD` (exported by Paseo).
3. When `PASEO_MCP_ACCESS` is `lead` or `supervisor` and an agent identity is
   present, builds the agent-scoped MCP URL and injects it via Codex `-c`
   overrides: `mcp_servers.paseo.url=...?callerAgentId=<id>`,
   `mcp_servers.paseo.required=true`, and an optional
   `bearer_token_env_var="PASEO_MCP_BEARER_TOKEN"`.
4. For `supervisor`, additionally injects an `enabled_tools` allowlist (the
   monitoring set plus a gated `create_agent`).
5. Refuses to launch if workspace and `CODEX_HOME` overlap (an agent must not
   edit its own role config/credentials).
6. `exec codex <config args> "$@"`, forwarding Paseo's `app-server` args.

`codex-orchestration/bin/codex-readonly-app-server` is a thin compatibility
shim for older Paseo daemons that cached the former provider command; it just
`exec`s the real launcher and applies **no** sandbox of its own.

## Install

`codex-orchestration/install.mjs` is the pack's self-contained installer (the
root `./install codex` delegates to it). It:

1. Copies the four profiles into `$CODEX_HOME` (default `~/.codex`) **and** into
   the four role homes under `~/.codex-paseo/<role>/config.toml`, preserving any
   locally-added `[projects.*]` trust blocks on re-install.
2. Symlinks each role home's `auth.json` to `~/.codex/auth.json` (no secret copy).
3. Copies the launcher to `$PASEO_HOME/bin` (default `~/.paseo/bin`).
4. Merges four `codex-*` providers into `~/.paseo/config.json`, setting
   `daemon.mcp.injectIntoAgents = false` and `PASEO_MCP_ACCESS` on Lead/Supervisor.
5. Merges `~/.paseo/orchestration-preferences.json` with pinned fallback
   defaults (`codex-worker/gpt-5.6-luna` for impl/ui/research/audit,
   `codex-lead/gpt-5.6-sol` for planning) plus the Agent Profile validation
   contract. It does not write `daemon.agentProfiles`; those host-specific,
   whole-list values remain Human-managed.
6. Backs up JSON before changes; never restarts the daemon. Fails closed when a
   target differs unless `--force`.

Provider config shape (see the live merge logic in `providerConfig()`):

- Lead/Supervisor: `command` = the launcher; `env` = `CODEX_HOME` + `PASEO_MCP_ACCESS`.
- Worker/Reviewer: `command` = `["codex"]`; `env` = `CODEX_HOME` only.

## Where to start / what to watch for

- **Change role behavior:** edit the `developer_instructions` in
  `codex-orchestration/profiles/paseo-<role>.config.toml`, then re-run
  `./install codex`. Validate with
  `codex --strict-config --profile paseo-<role> doctor --summary`.
- **Change Supervisor's exposed tools:** edit the `enabled_tools` list in the
  launcher. Keep `create_agent` gated to the lead-recovery shape — the
  Supervisor's instructions (not a sandbox) are what stop other shapes.
- **Model catalog drift:** `gpt-5.6-*` IDs, thinking levels, and saved Agent
  Profiles can become stale. Always discover with `paseo provider models
  codex-<role> --json` before assuming a model exists. Luna does not expose
  `ultra`; Sol does. A Lead must reject an invalid profile rather than silently
  repair it. Codex Lead routes to `codex-*` by default; cross-family requires an
  explicit Human request. (§9 of the codex guide; `docs/agent-profiles.md`.)
- **No security boundary:** full access + instruction-only enforcement means a
  process can still write files or call the local MCP HTTP endpoint directly.
  This is intentional for trusted machines; see [../architecture.md](../architecture.md#capability-is-not-authority).

## Key source references

- `codex-orchestration/profiles/paseo-*.config.toml` — role identity, model, sandbox, instructions.
- `codex-orchestration/bin/codex-role-app-server` — selective MCP injection + supervisor allowlist.
- `codex-orchestration/install.mjs` — `providerConfig()`, `defaultPreferences`, `installRoleConfig()` (preserves `[projects.*]` trust).
- `docs/codex-profiles-paseo-guide-vi.md` — the operational guide this pack follows.
- `docs/agent-profiles.md` — host Agent Profile setup and the mandatory validation cycle.
- `tai-lieu-tham-khao/config/paseo.codex-providers.example.json` — the provider template the installer mirrors.
