# Paseo Learn — Quickstart

This repository distributes **role packs** that make coding agents (Pi, Codex)
work as a coordinated multi-agent team under [Paseo](https://paseo.sh)
orchestration. It is not a runtime application: it ships **configuration,
policy, prompts, launchers, installers, and design docs**, not server code.

If you have zero context, read this page top-to-bottom. It explains what the
project is, how the three packs relate, and where to go for any change.

## What this is

Paseo launches and supervises existing coding-agent CLIs and lets one agent
delegate work to other providers/models. These role packs turn that capability
into a **governed four-role team**:

| Role | Job | Authority |
|---|---|---|---|
| **Lead** | Decompose tasks, delegate, accept/reject candidates | Orchestration owner; no product code by default |
| **Worker** (a.k.a. Engineer/Peer) | Bounded implementation in an owned scope | Write/commit/push only from the current Task Brief |
| **Reviewer** | Independent review of an exact candidate SHA or working diff | Behaviorally read-only |
| **Supervisor** | Governance observation, recovery | Observe only; one gated lead-recovery action |

Three principles run through everything:

- **Paseo is the only control plane.** Lead/Supervisor reach it through the
  role-gated `paseo-team` facade over the public Paseo CLI. Raw CLI, MCP,
  provider-native subagents, and second task databases are forbidden.
- **Capability ≠ authority.** Agents run with full filesystem/network access;
  their *behavior* is bounded by role prompts, tool allowlists, and a fail-closed
  policy layer — not by a sandbox.
- **No silent fallback.** Models are discovered and verified against runtime
  evidence; a mismatch is `BLOCKED`, not auto-corrected.

See [architecture.md](architecture.md) for the full concept model.

## The packs

The repository contains **three active, parallel packs** plus **one reference
pack**:

| Pack | Agent CLI | Status | Where |
|---|---|---|---|
| `codex-orchestration/` | Codex (`codex app-server`) | committed | [packs/codex-orchestration.md](packs/codex-orchestration.md) |
| `pi-orchestration/` | Pi (`pi --mode rpc`) | committed | [packs/pi-orchestration.md](packs/pi-orchestration.md) |
| `claude-orchestration/` | Claude Code (`claude`) | committed | [packs/claude-orchestration.md](packs/claude-orchestration.md) |
| `tai-lieu-tham-khao/` | Pi (older design) | reference / archived | [packs/reference-pack.md](packs/reference-pack.md) |

The three active packs implement the **same four-role model with different
mechanisms** because each CLI exposes configuration differently:

- **Codex** uses per-role `CODEX_HOME` with a `config.toml` (model + sandbox +
  `developer_instructions`) plus `PreToolUse`/`UserPromptSubmit` hooks. Lead and
  Supervisor orchestrate through the role-gated `paseo-team` CLI facade.
- **Pi** uses per-role `PI_CODING_AGENT_DIR` with an `AGENTS.md` system prompt +
  `settings.json`, **plus** a shared TypeScript extension that hard-enforces
  tool allowlists, V3 Task Brief authority, CLI role gates, and git-push scoping.
- **Claude Code** uses per-role `CLAUDE_CONFIG_DIR` with a `CLAUDE.md` system
  prompt (Claude Code reads `CLAUDE.md`, not `AGENTS.md`) + `settings.json`
  (permissions + hooks), **plus** Node hooks (`PreToolUse` /
  `UserPromptSubmit`) that enforce the same CLI-only policy as Pi.
  Status: live-verified once on this host (T-1 Lead→Worker→Reviewer flow;
  the `claude` provider is currently available).

`tai-lieu-tham-khao/` is the original Pi role pack ("paseo-pi-team"). It uses a
single shared extension + global MCP injection + a four-layer model-routing
system, and carries the unit tests and CI. It is kept as design reference.

## Install

A single root entry point chooses which pack to install and delegates to that
pack's own installer:

```bash
./install                 # interactive: codex / pi / claude / all
./install pi              # Pi pack only
./install codex           # Codex pack only
./install claude          # Claude Code pack only
./install all             # all three, Codex first
./install pi --dry-run    # preview, write nothing
./install all --force     # overwrite differing files (backs up first)
./install --help
```

Each pack's installer is self-contained inside its folder
(`codex-orchestration/install.mjs`, `pi-orchestration/install.mjs`,
`claude-orchestration/install.mjs`). It backs up JSON before changing it, fails
closed when a target differs (use `--force`), and **never restarts the Paseo
daemon** — you do that yourself after agents are safe.

Prerequisites: the matching agent CLI on PATH, and the pack's auth set up
(`codex login`, or `pi` + `/login` for Pi).

## Task routing

Use this table to jump from a change intent to the owning files. Validation is
the narrowest non-destructive check; broader checks are noted.

| Change intent | Canonical page | Owning source | Focused validation |
|---|---|---|---|
| Change a role's behavior (Codex) | [packs/codex-orchestration.md](packs/codex-orchestration.md) | `codex-orchestration/profiles/paseo-<role>.config.toml` (`developer_instructions`) | `codex --strict-config --profile paseo-<role> doctor --summary` |
| Change a role's behavior (Pi) | [packs/pi-orchestration.md](packs/pi-orchestration.md) | `pi-orchestration/profiles/<role>/AGENTS.md` + `shared/paseo-team-policy.ts` | `node --check pi-orchestration/shared/paseo-team-policy.ts`; `/team-role` in an agent |
| Change a role's behavior (Claude) | [packs/claude-orchestration.md](packs/claude-orchestration.md) | `claude-orchestration/profiles/<role>/CLAUDE.md` + `shared/paseo-team-policy/policy.mjs` | `node --check claude-orchestration/shared/paseo-team-policy/*.mjs`; PreToolUse stdin smoke (see pack README §15) |
| Change the orchestration command surface | [architecture.md](architecture.md#role-gated-cli-facade) | Identical `*/bin/paseo-team` copies + Pi/Claude/Codex policy guards | `node test/cli-orchestration.test.mjs` |
| Change default provider/model preferences | [packs/codex-orchestration.md](packs/codex-orchestration.md) / [packs/pi-orchestration.md](packs/pi-orchestration.md) / [packs/claude-orchestration.md](packs/claude-orchestration.md) | `<pack>/install.mjs` (`providerConfig`, `defaultPreferences`) | `./install <pack> --dry-run` |
| Change Agent Profile routing/install policy | [architecture.md](architecture.md#no-silent-fallback-agent-profiles--model-routing) | `docs/agent-profiles.md` + Pi/Claude `install.mjs` + active Lead prompt/skill | `node test/agent-profile-routing.test.mjs` |
| Change interaction language | [architecture.md](architecture.md#vietnamese-is-the-default-interaction-language) | All active role prompts + Lead skills/templates + installer preferences | `node test/language-policy.test.mjs` |
| Add a per-role skill (Pi) | [packs/pi-orchestration.md](packs/pi-orchestration.md#per-role-resources) | `pi-orchestration/profiles/<role>/skills/` | `PI_CODING_AGENT_DIR=~/.pi-paseo/<role> pi` → skill appears in `/skill:` |
| Add a per-role skill (Claude) | [packs/claude-orchestration.md](packs/claude-orchestration.md) | `claude-orchestration/profiles/<role>/skills/` | `CLAUDE_CONFIG_DIR=~/.claude-paseo/<role> claude` → skill loads |
| Fix/extend model routing (reference pack) | [packs/reference-pack.md](packs/reference-pack.md) | `tai-lieu-tham-khao/scripts/model-routing.mjs` | `node tai-lieu-tham-khao/test/model-routing.test.mjs` |
| Change active Pi/Claude policy or supervisor parity | [architecture.md](architecture.md) | `pi-orchestration/shared/paseo-team-policy.ts`, `claude-orchestration/shared/paseo-team-policy/` | `node test/active-policy.test.mjs` |
| Change policy enforcement (reference pack) | [packs/reference-pack.md](packs/reference-pack.md) | `tai-lieu-tham-khao/extensions/paseo-team-policy.ts` | `node tai-lieu-tham-khao/test/policy.test.mts` |
| Run the whole reference test suite | [packs/reference-pack.md](packs/reference-pack.md#tests-and-ci) | `tai-lieu-tham-khao/test/` | `node test/policy.test.mts && node test/model-routing.test.mjs` |

## Design docs (further reading)

`docs/` holds the long-form design material the packs are built from:

- `docs/codex-profiles-paseo-guide-vi.md` — operational guide for the Codex pack.
- `docs/model-routing.md` — the four-layer model-routing contract and verified
  commands.
- `docs/agent-profiles.md` — Paseo v0.4.0+ host profiles, CLI routing boundary, and the
  profile-aware no-silent-fallback cycle.
- `docs/multi-host.md` — N-host routing and the manual cross-host test plan.
- `docs/implementation-report-model-routing.md` — what was fixed and why.
- `docs/demonthorn-agent-orchestration-deep-dive.md` and
  `docs/paseo-agent-orchestration-architecture-vi.md` — full architecture
  deep-dives (Vietnamese; long).

These are primary sources; the wiki summarizes and links to them rather than
duplicating them.

## Rule loading

Before modifying repository files, read the applicable rule files:

- [wiki/_rules.md](_rules.md) — global Harness rules.
- No section `_rules.md` files exist yet under `wiki/`.

If you are about to edit a pack, also read that pack's wiki page first — it
records the invariants (capability ≠ authority, no silent fallback, V3 brief
authority) that must not be broken. Do not modify any `wiki/**/_rules.md`
outside the approved Harness proposal and apply workflow.

## Backlog

Areas intentionally not documented yet:

- **Reference media in `tai-lieu-tham-khao/`** (`Giáo Án Herdr - First edition.pdf`,
  `orchestration/*.webp`, `Other-mindset.txt`) — supporting lecture/images, not
  code or config; deferred.
- **`tai-lieu-tham-khao/outdate-root-for-herdr.config.toml`** — name marks it
  outdated; deferred until relevance is confirmed.
- **End-to-end live orchestration verification of `pi-orchestration`** — Lead
  and Supervisor role providers have run (`pi-lead`, `pi-supervisor` agents in
  the daemon history), but no `pi-worker`/`pi-reviewer` agent has been created
  through the role providers yet, so the full Lead→Worker→Reviewer flow remains
  unexercised (see [packs/pi-orchestration.md](packs/pi-orchestration.md)).
  By contrast, `claude-orchestration` has run one full T-1 flow
  (see [packs/claude-orchestration.md](packs/claude-orchestration.md)).
- **Host Agent-Profile drift for `claude-orchestration`** — `~/.paseo/config.json`
  currently holds only the four `paseo-learn:pi:*` host-default profiles; the
  `paseo-learn:claude:*` quartet has not been merged on this host. Re-run
  `./install claude` (dry-run first) to close the gap.
