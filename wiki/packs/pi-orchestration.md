# Pack: pi-orchestration (Pi CLI)

The Pi role pack runs the Pi CLI as a four-role team under Paseo. It lives at
`pi-orchestration/` and is committed in the repository. It is
the direct Pi counterpart of [codex-orchestration.md](codex-orchestration.md);
shared concepts are in [../architecture.md](../architecture.md). A Pi role
profile/custom provider defines behavior and enforcement; it is not a Paseo
**Agent Profile**, which is only a host-local runtime-settings preset.

Base policy runtime was first verified with Pi 0.84.1, Paseo 0.2.5, and
pi-mcp-adapter 2.21.0; re-verified on this host with Pi 0.84.2, Paseo 0.4.0,
and pi-mcp-adapter 2.26.0 (`node test/active-policy.test.mjs` passing, all four
`pi-*` providers reported available). Agent Profile routing requires
Paseo v0.4.0+; older daemons continue through explicit discovery and record
`PROFILE_CATALOG_UNAVAILABLE`.

## How role separation works

Each role gets its own **`PI_CODING_AGENT_DIR`** (`~/.pi-paseo/<role>/`). Pi
reads *all* of its resources — system prompt, settings, MCP config, skills,
extensions, credentials — from that directory, so each role has isolated
resources while sharing credentials and the `pi-mcp-adapter` package. This is
the Pi equivalent of Codex's per-role `CODEX_HOME`.

A role home contains:

```
~/.pi-paseo/<role>/
├── AGENTS.md        # role system prompt (Pi loads it as global context)
├── settings.json    # enables extensions/skills/packages for this role
├── mcp.json         # lead/supervisor: the paseo server; worker/reviewer: absent
├── extensions/      # → symlink to stable $PASEO_HOME/packs/pi-orchestration copy
├── skills/          # role-specific skills (lead ships paseo-team-lead)
├── prompts/         # role-specific prompt templates
├── auth.json   ─┐
├── npm/        ─┼─→ symlinks to ~/.pi/agent/ (shared credentials + adapter + catalog)
├── git/        ─┤
└── models.json ─┘
```

### Per-role resources

Because resources are directory-scoped, you can give each role its **own** skills
and tools: drop a skill into `pi-orchestration/profiles/<role>/skills/`, a tool
extension into `extensions/`, or a prompt template into `prompts/`, and the
installer syncs them into that role's home only. The role's `settings.json`
lists what Pi loads for it (`packages: ["npm:pi-mcp-adapter"]`,
`extensions: ["./extensions/paseo-team-policy.ts"]`, `skills: ["./skills"]`).

Role behavior sources:

| Role | System prompt | Enforcement |
|---|---|---|
| lead | `pi-orchestration/profiles/lead/AGENTS.md` | `read`/`bash` + full Paseo MCP + `mcp`/`mcp_script`; write/edit only if `PASEO_TEAM_LEAD_WRITE=1` |
| worker | `pi-orchestration/profiles/worker/AGENTS.md` | read-only turn: `read` only; write turn: `read`/`write`/`edit`/`bash`; direct mutations confined to `OWNED_SCOPE`; no MCP |
| reviewer | `pi-orchestration/profiles/reviewer/AGENTS.md` | strictly `read` only (write/edit/bash revoked); no MCP |
| supervisor | `pi-orchestration/profiles/supervisor/AGENTS.md` | `read` + `mcp` filtered by `includeTools`; no write/edit |

## The hard enforcement layer: paseo-team-policy.ts

Unlike the Codex pack, Pi adds a **shared TypeScript extension** that hard-enforces
role policy: `pi-orchestration/shared/paseo-team-policy.ts`. The installer copies
it to a stable `$PASEO_HOME/packs/pi-orchestration/` path and links every role's
`extensions/` entry there. It reads `PASEO_PI_ROLE` from the provider env and:

- applies a per-role tool allowlist via `setActiveTools()` on `session_start` and
  `before_agent_start`;
- re-derives Worker authority from the **current turn's** V3 brief every turn
  (`parseTaskBrief`, `resolveWorkerMode`, `workerGitAuthority`) and canonicalizes
  direct mutation paths against `OWNED_SCOPE` (`ownedScopeBlockReason`);
- acts as a fail-closed `tool_call` backstop: blocks Worker/Reviewer `mcp` and
  `mcp_script`, classifies MCP proxy targets (`classifyMcpInput`, `mcpBlockReason`),
  gates the Supervisor's single `create_agent` recovery shape
  (`supervisorCreateAgentBlockReason`), scans `mcp_script` for off-allowlist
  tool references, blocks the Paseo CLI from bash, and enforces git authority
  (`gitAuthorityBlockReason` — branch-scoped push, always-deny force-push/amend/merge).

Key exported symbols (pure/testable): `parseTaskBrief`, `ownedScopeRoots`,
`resolveWorkerMode`, `workerGitAuthority`, `ownedScopeBlockReason`,
`gitAuthorityBlockReason`, `policyFor`, `policyWithAuthority`,
`classifyMcpInput`, `mcpBlockReason`, `supervisorCreateAgentBlockReason`. The extension deliberately does **not** inject
the role prompt (the role `AGENTS.md` context file does that); it only restricts.

Debug commands registered by the extension: `/team-role` (role + workerMode +
policy), `/team-tools` (full tool registry → `~/.pi/team-tools.txt`).

## The launcher: pi-role-app-server

Lead and Supervisor run through `pi-orchestration/bin/pi-role-app-server`;
Worker/Reviewer use plain `pi`. The launcher mirrors the Codex one but is simpler
because Pi's MCP config is a file, not CLI overrides:

1. Handles `--version` (`exec pi --version`).
2. When `PASEO_MCP_ACCESS` is `lead`/`supervisor` and `PASEO_AGENT_ID` is present,
   exports `PASEO_MCP_URL=<base>?callerAgentId=<id>` (base overridable via
   `PASEO_MCP_BASE_URL`; bearer token forwarded as `PASEO_MCP_BEARER_TOKEN`).
3. Refuses to launch if workspace and `PI_CODING_AGENT_DIR` overlap.
4. `exec pi "$@"`, forwarding Paseo's `--mode rpc` args.

The role's own `mcp.json` consumes the URL by interpolation
(`"url": "${PASEO_MCP_URL}"`). Because Worker/Reviewer have **no** `paseo` entry
in their `mcp.json`, the launcher gives them nothing to reach even though the
`mcp` proxy tool exists. The Supervisor's `mcp.json`
(`pi-orchestration/profiles/supervisor/mcp.json`) adds the same five-tool
monitoring/recovery allowlist enforced by the extension and Codex launcher.

## Install

`pi-orchestration/install.mjs` (run via `./install pi`):

1. Copies the policy to the stable installed path
   `$PASEO_HOME/packs/pi-orchestration/paseo-team-policy.ts`.
2. Creates four role homes; copies each role's `AGENTS.md`, `settings.json`,
   `mcp.json` (lead/supervisor), mirrors `skills/`/`prompts/`, installs the Lead
   brief at `$PI_CODING_AGENT_DIR/templates/TASK_BRIEF_V3.md`, and links each
   role extension to that stable installed policy copy.
3. Symlinks `auth.json`, `npm/`, `git/`, `models.json` from `~/.pi/agent/` so all
   roles share credentials, the `pi-mcp-adapter` package, and the model catalog.
4. Copies the launcher to `$PASEO_HOME/bin/pi-role-app-server` (mode 0755).
5. Queries the ordered `pi` model catalog and resolves its first/default model
   plus default thinking before writing anything.
6. Merges four `pi-*` providers and four namespaced host-default Agent Profiles
   into `~/.paseo/config.json` with `injectIntoAgents = false`; Human profiles
   are preserved, and managed drift fails unless `--force`.
7. Merges `~/.paseo/orchestration-preferences.json` as fallback routing.
8. Checks prerequisites (`pi`, `paseo`, `pi-mcp-adapter`, `auth.json`), backs up
   JSON, never restarts the daemon. Fails closed on differing targets unless
   `--force`.

## Where to start / what to watch for

- **Language:** all Human-facing and agent-to-agent communication is Vietnamese;
  technical literals and quoted evidence remain unchanged. A Human may request
  another language for one specific output.
- **Change role behavior:** edit `pi-orchestration/profiles/<role>/AGENTS.md` (the
  system prompt) and/or the policy tables in
  `pi-orchestration/shared/paseo-team-policy.ts`. Validate with
  `node --check pi-orchestration/shared/paseo-team-policy.ts` and
  `node test/active-policy.test.mjs`, then `/team-role` inside an agent.
- **Add a role skill:** drop it under `pi-orchestration/profiles/<role>/skills/`
  and re-run `./install pi`. Confirm with
  `PI_CODING_AGENT_DIR=~/.pi-paseo/<role> pi`.
- **Change Supervisor's exposed tools:** edit `includeTools` in
  `pi-orchestration/profiles/supervisor/mcp.json`. The extension's
  `SUPERVISOR_ALLOWED_MCP_TARGETS` must agree.
- **Worker/Reviewer still "see" the `mcp` tool:** that is expected — Pi's adapter
  registers it regardless. The extension blocks every `mcp`/`mcp_script` call for
  them, and their `mcp.json` has no server to reach. `/team-tools` confirms it.
- **Read-only turns:** Reviewer and read-only Worker get `read` only; Bash is
  removed so it cannot mutate indirectly. On write turns, direct `write`/`edit`
  paths are canonicalized against `OWNED_SCOPE`; Bash still remains a behavioral
  boundary rather than filesystem isolation.
- **No sandbox:** Pi has none. Full access + extension + `includeTools` are
  behavioral boundaries, not ACLs (see [../architecture.md](../architecture.md#capability-is-not-authority)).
- **Agent Profiles:** Paseo v0.4.0+ installers create four namespaced profiles
  from the host's first/default `pi` model. Leads call `list_profiles`, then
  still validate with `list_providers`, `list_models`, `inspect_provider`, and
  `get_agent_status`. Pi Lead routes to `pi-*` by default; cross-family requires
  an explicit Human request. A profile never grants authority; see
  `docs/agent-profiles.md`.
- **Partial live verification:** the pack is committed and the Lead/Supervisor
  role providers have run under Paseo (`pi-lead` and `pi-supervisor` agents
  exist in the daemon history), but no `pi-worker`/`pi-reviewer` agent has been
  created through the role providers yet; the enforcement unit logic is
  verified, the full Worker→Reviewer delegation path is not. Treat as beta.

## Key source references

- `pi-orchestration/profiles/<role>/AGENTS.md` — role identity and authority.
- `pi-orchestration/shared/paseo-team-policy.ts` — hard enforcement (all symbols above).
- `pi-orchestration/bin/pi-role-app-server` — selective MCP URL injection.
- `pi-orchestration/profiles/lead/skills/paseo-team-lead/SKILL.md` — Lead workflow + routing cycle.
- `pi-orchestration/templates/TASK_BRIEF_V3.md` — canonical brief template.
- `pi-orchestration/config/paseo.providers.example.json` — provider template.
- `pi-orchestration/README.md` — pack README (Vietnamese).
- `docs/agent-profiles.md` — host Agent Profile setup and the mandatory validation cycle.
