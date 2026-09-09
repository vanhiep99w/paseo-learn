# Architecture & shared concepts

This page is canonical for the active Codex, Pi and Claude packs.

## SLP topology

```text
Human → Lead → Peer (engineer | scout | architect | reviewer | shadow)
           ↑
      Supervisor: Human-governed observation/recovery only
```

| Role | Identity | Boundary |
|---|---|---|
| **Lead** | Owns outcome, topology, integration and engineering verdict | Does not self-accept material work or create two writers for a coupled scope |
| **Peer** | One independent bounded assignment with one disposition | No orchestration, scope expansion, replacement, or acceptance |
| **Supervisor** | Serves Human through governance observation and exact recovery | Not a super-Lead; does not staff product work or direct Peers |

A reviewer is a fresh Peer with `DISPOSITION: reviewer`, not a standing fourth
role. Lead chooses the smallest useful topology: direct tiny work only under
an exact lease; one Engineer Peer for material write; Reviewer Peer only when
independent falsification reduces risk; Supervisor only under a Human mandate.

## Capability is not authority

All packs run on trusted machines and expose broad filesystem/network
capability. Prompt, tool policy and hooks/extensions are behavioral boundaries,
not an OS sandbox or Paseo daemon ACL. Provider/model/mode, status, confidence,
or tool visibility never grants write ownership, external effects, recovery, or
acceptance authority.

## Peer assignment authority

The first non-empty line of every Peer prompt declares its disposition:

```text
DISPOSITION: engineer
```

- `engineer` receives write access to the current workspace for that turn.
- `reviewer`, `scout`, `architect`, `shadow`, or no disposition are read-only.
- A follow-up that needs edit access repeats `DISPOSITION: engineer` as its
  first line; authority is never sticky.
- Force-push, amend, deploy, worktree mutation and native delegation are always
  denied. Peers do not receive Paseo MCP.

Use the optional V3 marker block only when an Engineer needs a narrower
workspace-relative `OWNED_SCOPE`. A malformed V3 block fails closed to
`read-only` rather than falling back to the one-line transport.

The body gives a neutral objective, authority/boundary, evidence, handback and
stop condition. It must not pre-solve a task or smuggle a verdict.

## Work state without Beads

This release intentionally has no Beads integration and **no replacement
tracker**. Paseo is the only delegation/lifecycle plane; the disposition
assignment and Peer handback in Paseo messages are the current work state. Do not create a
private task database, file ledger, issue graph, poller or synchronization
service. This is a deliberate temporary limitation: durable issue identity,
authoritative issue mutation and Beads checkpoints are unavailable.

## Shared-workspace execution

Every child inherits the Lead workspace. No child creates a Paseo workspace or
Git worktree. One writer owns each moving/coupled scope.

For review: wait until Engineer Peer is idle, record Lead-observed HEAD and
working-tree status, start a fresh read-only Reviewer Peer on stable SHA/diff,
then re-read HEAD/status. Drift invalidates review. Corrections return to the
original Engineer under a fresh write brief and the new candidate is reviewed
again. Lead/Human — not a Peer — issues the verdict.

## Paseo control plane and routing

Paseo MCP is injected only into Lead and Supervisor. Peers have no MCP and
cannot create, prompt or monitor agents. Native provider subagents are disabled.

Same-family routing is default (`pi-lead → pi-peer`, etc.). Cross-family routing
needs an explicit Human request; otherwise use
`BLOCKED: CROSS_FAMILY_ROUTE_REQUIRES_HUMAN`. Every spawn validates
`list_profiles` (advisory only), `list_providers`, `list_models` and
`inspect_provider`, pins the exact route/settings, then confirms with
`get_agent_status`. Mismatch is `BLOCKED: MODEL_RESOLUTION_MISMATCH`; no silent
fallback.

## Vietnamese interaction

Human-facing output and agent-to-agent prompts, handbacks and reviews use
Vietnamese by default. Code, commands, paths, identifiers, protocol fields and
quoted technical evidence retain original form. Human can override language for
one named output.
