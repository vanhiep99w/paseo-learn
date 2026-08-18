# Pack: claude-orchestration (Claude Code CLI)

The Claude Code role pack runs Anthropic's `claude` CLI as a four-role team
under Paseo. It lives at `claude-orchestration/` and is the direct Claude
counterpart of [codex-orchestration.md](codex-orchestration.md) and
[pi-orchestration.md](pi-orchestration.md); shared concepts are in
[../architecture.md](../architecture.md). A Claude role profile/custom provider
defines behavior and enforcement; it is not a Paseo **Agent Profile**, which is
only a host-local runtime-settings preset.

Status: **live-verified once, beta**. On this host the `claude` provider is
available (`paseo provider ls`) and the pack has run one full T-1
Lead→Worker→Reviewer flow under Paseo — a `claude-lead` session spawned a
`claude-worker` engineer and a `claude-reviewer` independent reviewer, and the
Lead's five-step checklist completed (trace under `~/.claude-paseo/lead/tasks/`).
On hosts where the `claude` CLI or its provider is unavailable the pack remains
spec-grade (see `docs/paseo-agent-orchestration-architecture-vi.md` §9.3). The
enforcement logic is ported from the Pi pack and unit-smoke-tested
(`node test/active-policy.test.mjs`).

## How role separation works

Each role gets its own **`CLAUDE_CONFIG_DIR`** (`~/.claude-paseo/<role>/`).
Claude Code reads its system prompt, settings, MCP config, skills, and hooks
from that directory, so each role has isolated resources. This is the Claude
Code equivalent of Codex's per-role `CODEX_HOME` and Pi's `PI_CODING_AGENT_DIR`.

A role home contains:

```
~/.claude-paseo/<role>/
├── CLAUDE.md        # role system prompt (Claude Code reads CLAUDE.md, NOT AGENTS.md)
├── settings.json    # permissions (allow/deny, defaultMode) + hooks config
├── hooks/           # copied policy hook scripts (pre-tool-use.mjs, user-prompt-submit.mjs, ...)
├── skills/          # role-specific skills (lead ships paseo-team-lead)
├── prompts/         # role-specific prompt templates
└── .credentials.json → ~/.claude/.credentials.json   # shared login (Linux/Windows)
```

### Per-role resources

Because resources are directory-scoped, you can give each role its **own** skills
and tools: drop a skill into `claude-orchestration/profiles/<role>/skills/`, a
prompt template into `prompts/`, and the installer syncs them into that role's
home only. The role's `settings.json` registers the hooks (`hooks/...`).

Role behavior sources:

| Role | System prompt | Enforcement |
|---|---|---|
| lead | `profiles/lead/CLAUDE.md` | full access + `mcp__paseo__*`; write/edit only if `PASEO_TEAM_LEAD_WRITE=1` |
| worker | `profiles/worker/CLAUDE.md` | shell disabled on read-only turns; direct mutations require write authority and `OWNED_SCOPE`; no MCP |
| reviewer | `profiles/reviewer/CLAUDE.md` | Claude plan mode + explicit write/edit denial + hook; no MCP |
| supervisor | `profiles/supervisor/CLAUDE.md` | Read + `mcp__paseo__*` filtered to five monitoring/recovery tools; no shell or writes |

## The hard enforcement layer: policy hooks

Like the Pi pack's extension, this pack adds a **hard policy layer** — but
expressed as Claude Code **hooks** (Node ESM scripts) instead of a Pi extension
API. The source lives at `claude-orchestration/shared/paseo-team-policy/` and is
copied into each role's `hooks/`. Each role's `settings.json` registers:

- **`UserPromptSubmit`** → `hooks/user-prompt-submit.mjs`: parses the V3 Task
  Brief out of the current prompt and persists it to a per-session state file
  (the Claude Code analog of the Pi extension's `before_agent_start` re-parse).
  State replacement is atomic. A malformed hook event or state-write failure
  blocks the Worker turn, so old write authority cannot leak into it.
- **`PreToolUse`** (matcher
  `(Bash|PowerShell|Edit|Write|MultiEdit|NotebookEdit|Artifact|Agent|Task|mcp__paseo__.*)`)
  → `hooks/pre-tool-use.mjs`: reads `tool_name` + `tool_input` from stdin and
  decides fail-closed. A denial writes the reason to stderr and exits 2 (stderr
  is fed back to the model).

The hooks enforce (ported from `paseo-team-policy.ts`):

- per-role tool policy (worker write only with brief; reviewer/supervisor
  read-only; lead write only with `PASEO_TEAM_LEAD_WRITE=1`);
- read-only Worker turns have no shell; direct file mutation paths on write turns
  are canonicalized (including symlinks) and confined to `OWNED_SCOPE`;
- Worker git authority from the current V3 brief — push/merge gated by
  `MODE: write` (edit/commit/push/merge on the current branch), always-deny
  force-push/amend/deploy;
- Reviewer uses Claude Code plan mode with explicit write/edit denials, while the
  hook independently blocks Git mutations;
- Supervisor no shell; `mcp__paseo__*` limited to the five-tool monitoring/
  recovery allowlist, including gated `create_agent` (claude-lead recovery shape only,
  argument-checked);
- worker/reviewer cannot call `mcp__paseo__*` (no control plane);
- native `Agent`/`Task` subagents blocked for every role (Paseo is the only
  control plane);
- bash Paseo-CLI guard (`paseo run`/`send`/`wait` blocked for worker/reviewer).

Key exported symbols (pure/testable): `parseTaskBrief`, `ownedScopeRoots`,
`resolveWorkerMode`, `workerGitAuthority`, `ownedScopeBlockReason`,
`gitAuthorityBlockReason`, `supervisorCreateAgentBlockReason`,
`blockReasonForTool`, `detectRole`. When
`PASEO_CLAUDE_ROLE` is unset the hook is passive (exit 0).

The one loss vs the Pi extension: hooks cannot enumerate the tool registry
(`getAllTools()`/`setActiveTools()`); they only gate individual calls. The
static `permissions.deny` lists compensate for the coarse tool availability.

## The launcher: claude-role-app-server

Lead and Supervisor run through `claude-orchestration/bin/claude-role-app-server`;
Worker/Reviewer use plain `claude`. The launcher mirrors `pi-role-app-server` /
`codex-role-app-server`:

1. Handles `--version` (`exec claude --version`).
2. Reads `CLAUDE_CONFIG_DIR` (default `~/.claude`).
3. When `PASEO_MCP_ACCESS` is `lead`/`supervisor` and `PASEO_AGENT_ID` +
   `PASEO_AGENT_CWD` are present, builds the agent-scoped MCP URL
   (`${PASEO_MCP_BASE_URL:-http://127.0.0.1:6767/mcp/agents}?callerAgentId=<id>`)
   and injects it via an inline `--mcp-config` JSON. A bearer token is forwarded
   as a header `Authorization: Bearer ${PASEO_MCP_BEARER_TOKEN}` (literal —
   Claude Code expands it, so the secret never enters argv).
4. Refuses to launch if workspace and `CLAUDE_CONFIG_DIR` overlap.
5. `exec claude <args> "$@"`, forwarding Paseo's Agent SDK / headless args.

Because Worker/Reviewer providers use `command: ["claude"]` (no launcher), they
get no `--mcp-config` and therefore no Paseo MCP server. The Supervisor's
five-tool allowlist is enforced by the `PreToolUse` hook (Claude Code's MCP config has no
per-tool `includeTools` field, unlike Pi's `mcp.json`).

## Install

`claude-orchestration/install.mjs` (run via `./install claude`):

1. Creates four role homes; copies each role's `CLAUDE.md`, `settings.json`,
   mirrors `skills/`/`prompts/`, and installs the Lead brief at
   `$CLAUDE_CONFIG_DIR/templates/TASK_BRIEF.md`.
2. Copies `shared/paseo-team-policy/*.mjs` into each role's `hooks/`.
3. Symlinks `~/.claude/.credentials.json` into each role (Linux/Windows) so all
   roles share one login. On macOS (Keychain) it logs a warning — set
   `ANTHROPIC_API_KEY` in the provider env, or run `claude` once per role home.
4. Copies the launcher to `$PASEO_HOME/bin/claude-role-app-server` (mode 0755).
5. Queries the ordered `claude` model catalog and resolves its first/default
   model plus default thinking before writing anything.
6. Merges four `claude-*` providers and four namespaced host-default Agent
   Profiles into `~/.paseo/config.json` with `injectIntoAgents = false`; Human
   profiles are preserved, and managed drift fails unless `--force`.
7. Merges `~/.paseo/orchestration-preferences.json` as fallback routing.
8. Checks prerequisites (`claude`, `paseo`, `.credentials.json`), backs up
   JSON, never restarts the daemon. Fails closed on differing targets unless
   `--force`.

## Where to start / what to watch for

- **Language:** all Human-facing and agent-to-agent communication is Vietnamese;
  technical literals and quoted evidence remain unchanged. A Human may request
  another language for one specific output.
- **Change role behavior:** edit `claude-orchestration/profiles/<role>/CLAUDE.md`
  (the system prompt) and/or the policy in
  `claude-orchestration/shared/paseo-team-policy/policy.mjs`. Validate with
  `node --check` on the hooks plus `node test/active-policy.test.mjs`, then
  re-run `./install claude`.
- **Add a role skill:** drop it under `claude-orchestration/profiles/<role>/skills/`
  and re-run `./install claude`. Confirm with
  `CLAUDE_CONFIG_DIR=~/.claude-paseo/<role> claude`.
- **Change Supervisor's exposed tools:** edit the `SUPERVISOR_ALLOWED_MCP_TARGETS`
  list in `policy.mjs` (the hook enforces it). Keep the Codex launcher and Pi
  supervisor `mcp.json` at the same five-tool contract.
- **Worker/Reviewer "see" `mcp__paseo__*`:** they should not — their provider
  gets no `--mcp-config`. If they do, it is a project `.mcp.json` (not this
  pack); the hook still blocks `mcp__paseo__*` for them fail-closed.
- **No filesystem sandbox:** Lead/Worker use `bypassPermissions`; Reviewer uses
  Claude Code plan mode. Hooks + `permissions.deny` are behavioral boundaries,
  not OS-level ACLs (see
  [../architecture.md](../architecture.md#capability-is-not-authority)).
- **Agent Profiles:** Paseo v0.4.0+ installers create four namespaced profiles
  from the host's first/default `claude` model. Leads call `list_profiles`, then
  still validate with `list_providers`, `list_models`, `inspect_provider`, and
  `get_agent_status`. Claude Lead routes to `claude-*` by default; cross-family
  requires an explicit Human request. A profile never grants authority; see
  `docs/agent-profiles.md`.
- **Live verification status:** one full T-1 Lead→Worker→Reviewer flow has run
  on this host with the `claude` provider available; repeated flows and the
  correction loop (new commit → re-review) are not yet exercised. Treat as beta.
- **Host Agent-Profile drift:** `~/.paseo/config.json` currently holds only the
  four `paseo-learn:pi:*` host-default profiles — the `paseo-learn:claude:*`
  quartet this installer creates has not been merged on this host. Re-run
  `./install claude` (dry-run first) to close the gap.

## Key source references

- `claude-orchestration/profiles/<role>/CLAUDE.md` — role identity and authority.
- `claude-orchestration/shared/paseo-team-policy/{brief,policy}.mjs` — pure policy (all symbols above).
- `claude-orchestration/shared/paseo-team-policy/{pre-tool-use,user-prompt-submit}.mjs` — hook entries.
- `claude-orchestration/bin/claude-role-app-server` — selective MCP injection via `--mcp-config`.
- `claude-orchestration/profiles/lead/skills/paseo-team-lead/SKILL.md` — Lead workflow + routing cycle.
- `claude-orchestration/templates/TASK_BRIEF.md` — canonical brief template.
- `claude-orchestration/config/paseo.providers.example.json` — provider template.
- `claude-orchestration/README.md` — pack README (Vietnamese).
- `docs/agent-profiles.md` — host Agent Profile setup and the mandatory validation cycle.
