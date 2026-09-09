# Paseo Learn — Quickstart

Paseo Learn ships configuration, prompts, policy, launchers and installers that
turn existing coding CLIs into a governed **Supervisor–Lead–Peer (SLP)** team
under Paseo. It is not a runtime application and does not fork the Paseo daemon.

## Active workflow

| Role | Job | Authority |
|---|---|---|
| Lead | Outcome, topology, integration evidence, engineering verdict | Orchestration owner; no material write by default |
| Peer | One bounded assignment | current-turn `engineer` is editable; other dispositions are read-only |
| Supervisor | Governance observation / exact Lead recovery for Human | Observe only outside a Human recovery lease |

Peer dispositions: `engineer`, `scout`, `architect`, `reviewer`, `shadow`.
The prior Worker and Reviewer roles are retired. A reviewer is now a read-only
Peer disposition. Capability is not authority; one moving/coupled scope has one
write owner; a Lead does not self-accept material work.

## No-Beads phase

Beads is intentionally not installed or emulated. Paseo messages, current-turn
assignments and handbacks are the work state. Do not add a private task database,
repository task file, issue tracker fallback, poller, or second control plane.

## Packs

| Pack | CLI | Providers |
|---|---|---|
| `codex-orchestration/` | Codex | `codex-lead`, `codex-peer`, `codex-supervisor` |
| `pi-orchestration/` | Pi | `pi-lead`, `pi-peer`, `pi-supervisor` |
| `claude-orchestration/` | Claude Code | `claude-lead`, `claude-peer`, `claude-supervisor` |

Install via the root dispatcher:

```bash
./install pi --dry-run
./install pi --force
./install all --force
```

`--force` is required to remove legacy managed Worker/Reviewer provider and
Agent Profile entries. Legacy role homes stay inert so installer migration does
not delete local credentials/data. Installers never restart the daemon.

Uninstall is dry-run by default and preserves role homes:

```bash
./uninstall pi
./uninstall all --apply
```

Only use `./uninstall all --apply --force --purge-role-homes` when role-local
sessions, credentials and user files are intentionally disposable. Uninstall
does not stop agents or restart the daemon.

## Task routing

- Shared role boundaries: [`architecture.md`](architecture.md)
- Pi implementation: [`packs/pi-orchestration.md`](packs/pi-orchestration.md)
- Claude implementation: [`packs/claude-orchestration.md`](packs/claude-orchestration.md)
- Codex implementation: [`packs/codex-orchestration.md`](packs/codex-orchestration.md)

## Rule loading

Before modifying repository files, read [`_rules.md`](_rules.md) and any
applicable section `_rules.md`. Do not modify `wiki/**/_rules.md` outside an
approved Harness proposal/apply workflow.
