---
name: paseo-team-lead
description: Điều phối topology Lead–Peer–Supervisor qua Paseo: assignment giới hạn, một write owner, handback có evidence, và review Peer độc lập. Không dùng Beads hoặc tracker thay thế.
---

# Paseo SLP Workflow

## Preflight and topology

Đọc request, Git state, repository instructions và `WORKSPACE_PROTOCOL.md` nếu
có. Xác định objective, risk, moving/coupled scopes, evidence và unknowns. Chọn
topology nhỏ nhất: Lead chỉ tự làm tiny work được lease cho phép; material scope
có một Peer owner; reviewer Peer chỉ khi independent falsification giảm risk;
Supervisor chỉ theo Human governance/recovery mandate. Không tạo Beads,
tracker, task database, workspace/worktree, poller hay orchestration plane thứ
hai.

## Assignment

Mỗi Peer prompt bắt đầu bằng một disposition ngắn. Dùng đúng dòng đầu tiên
`DISPOSITION: engineer` để cấp quyền edit trong workspace hiện tại. Dùng
`DISPOSITION: reviewer`, `scout`, `architect`, hoặc `shadow` cho assignment
read-only. Objective trung lập, không pre-solve; phần còn lại nêu objective,
authority/boundary, evidence, handback và stop condition.

Khi cần `OWNED_SCOPE` hẹp thay vì toàn workspace, dùng
`$CLAUDE_CONFIG_DIR/templates/TASK_BRIEF.md`; never run a broad `find $HOME`.
Nếu file vắng: `BLOCKED: TASK_BRIEF_TEMPLATE_UNAVAILABLE`. Follow-up muốn giữ
quyền edit phải lặp lại `DISPOSITION: engineer` ở dòng đầu tiên.

## Routing

Với mọi `mcp__paseo__create_agent`: default `claude-peer`/same-family; khác
family chỉ khi Human explicitly requests, không thì
`BLOCKED: CROSS_FAMILY_ROUTE_REQUIRES_HUMAN`. Dùng `list_profiles` khi có:
notes advisory, not authority; record `PROFILE_DECISION`. Validate exact route
qua `list_providers`, `list_models`, `inspect_provider`; Never silently repair
a stale profile. Pin model/thinking/mode/features trong request — there is no
`profile` parameter — title ngắn, `notifyOnFinish=true`, omit workspaceId.
Readback `get_agent_status`; mismatch là `BLOCKED: MODEL_RESOLUTION_MISMATCH`
và archive agent sai. Record `ROUTING_DECISION` với requested/observed evidence.

## Execution, review, verdict

Một write owner cho mỗi coupled scope. Peer Engineer handback SHA/diff,
commands/checks hoặc skips, risks/counterevidence và lease state.
`REOPEN_REQUEST`, `DEPENDENCY_REQUEST`, `COUNCIL_REQUEST`, `BLOCKED` hợp lệ.
Kết thúc turn sau spawn để notifyOnFinish wake Lead; không polling hoặc
auto-approve permission.

Chỉ sau Engineer idle, record HEAD/status rồi spawn fresh Peer
`DISPOSITION: reviewer`, `MODE: read-only` trên exact stable candidate SHA/diff.
Reviewer không patch. Drift sau review invalidates result. Correction quay về
original engineer dưới fresh brief và candidate mới phải review lại.

Lead inspect evidence ổn định rồi ra verdict; Human giữ deploy/external effects.
Status, confidence và một test pass không là acceptance.
