# Model routing — CLI-only contract

Active packs route agents through `$PASEO_TEAM_CLI`, which wraps the public
Paseo CLI. MCP, native subagents and daemon-default model inheritance are not
valid routing paths.

## Inputs

1. Human request and same-family authority.
2. Role/disposition and `MODEL_CLASS`.
3. `$PASEO_TEAM_CLI providers` health output.
4. `$PASEO_TEAM_CLI models <role-provider>` model/thinking catalog.
5. `$PASEO_TEAM_CLI inspect <agent-id>` runtime evidence.

Agent Profiles are Human UI presets, not routing input for Lead.

## Mandatory cycle

```text
providers
→ models <role-provider>
→ run --provider <role-provider>/<provider>/<model-id> --thinking <id>
→ inspect <agent-id>
```

Rules:

- same-family role provider by default;
- cross-family only from an explicit Human request;
- exact provider/model and thinking are mandatory;
- optional mode must be explicit and post-verified;
- observed Provider/Model/Thinking/Mode must match;
- mismatch or missing evidence → `BLOCKED: MODEL_RESOLUTION_MISMATCH` and archive
  the wrong agent through the facade;
- never silently clamp, substitute or omit a field.

## Routing record

```text
ROUTING_DECISION
TASK_ID:
DISPOSITION:
MODEL_CLASS:
PASEO_PROVIDER:
PROVIDER_FAMILY_AUTHORITY: SAME_FAMILY_DEFAULT | HUMAN_EXPLICIT
HUMAN_CROSS_FAMILY_REQUEST:
REQUESTED_MODEL:
REQUESTED_THINKING:
REQUESTED_MODE:
OBSERVED_PROVIDER:
OBSERVED_MODEL:
OBSERVED_THINKING:
OBSERVED_MODE:
WORKSPACE_REF:
AGENT_REF:
ROUTING_EVIDENCE: <providers + models + inspect>
```

The Lead owns observed routing evidence. Workers only echo `ASSIGNED_*` fields
and report mismatch; they do not select or mutate their runtime route.
