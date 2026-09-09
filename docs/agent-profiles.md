# Agent Profiles and SLP routing

Agent Profiles are Human-owned, host-local route candidates. They are not role
instructions, assignment authority or runtime proof. The active workflow is
three roles: Lead, Peer, Supervisor.

## Managed profiles

Pi and Claude installers manage only these IDs:

```text
paseo-learn:<pack>:lead:host-default
paseo-learn:<pack>:peer:host-default
paseo-learn:<pack>:supervisor:host-default
```

| Role | Provider | Purpose |
|---|---|---|
| Lead | `<family>-lead` | topology, route selection, integration/acceptance |
| Peer | `<family>-peer` | one bounded assignment; V3 disposition chooses engineer/scout/architect/reviewer/shadow |
| Supervisor | `<family>-supervisor` | Human-governed observation/recovery |

The installer preserves all Human profile entries. It refuses to replace a
changed managed profile without `--force`. During migration, `--force` retires
only managed `worker`/`reviewer` profile IDs and custom-provider entries; legacy
role homes are not deleted.

## Mandatory routing cycle

For every child spawn, Lead:

1. Uses same-family `<family>-peer` by default. Cross-family route requires an
   explicit Human request; otherwise `BLOCKED: CROSS_FAMILY_ROUTE_REQUIRES_HUMAN`.
2. Calls `list_profiles` when available. A complete matching profile is a route
   candidate; `notes` are advisory and never authority.
3. Calls `list_providers`, `list_models`, then `inspect_provider` when
   profile route includes mode/features. Exact provider/model/thinking/mode/
   features must be valid; no silent repair/fallback.
4. Sends exact provider and settings through `create_agent`, including V3 Peer
   assignment/disposition. Paseo has no `profile` create parameter.
5. Uses `get_agent_status` to compare requested and observed route. Missing or
   mismatch evidence is `BLOCKED: MODEL_RESOLUTION_MISMATCH` and the route is
   archived rather than silently corrected.

Provider/model/mode is transport capability only. The V3 assignment binds Peer
mutation authority: only `engineer + MODE: write + OWNED_SCOPE` writes.

## No-Beads phase

Profiles do not introduce a task tracker. There is no Beads or fallback issue
graph: Paseo assignment and handback messages carry current work state.
