---
name: paseo-team-lead
description: Điều phối topology Lead–Peer–Supervisor qua Paseo: giao assignment giới hạn, giữ một write owner, handback có evidence, và review Peer độc lập. Không dùng Beads hoặc tracker thay thế.
---

# Paseo SLP Workflow

## 1. Preflight

1. Đọc request, trạng thái Git, `AGENTS.md` và `WORKSPACE_PROTOCOL.md` nếu có.
2. Xác định objective, known evidence, open questions, non-goals, risk,
   moving/coupled scopes, evidence cần có và điều gì chưa biết. Status không thay
   evidence.
3. Chọn topology nhỏ nhất: Lead tự làm tiny work được lease cho phép, một Peer
   owner cho material scope, reviewer Peer chỉ khi independent falsification
   giảm rủi ro; Supervisor chỉ khi Human cần governance/recovery.
4. Không tạo Beads, tracker, task database, worktree, workspace, poller hoặc
   orchestration plane thứ hai.

## 2. Assignment

Mỗi Peer prompt bắt đầu bằng một disposition ngắn. Dùng đúng dòng đầu tiên
`DISPOSITION: engineer` để cấp quyền edit trong workspace hiện tại. Dùng
`DISPOSITION: reviewer`, `scout`, `architect`, hoặc `shadow` cho assignment
read-only. Không đưa solution đã pre-solve vào objective. Assignment chỉ nói
objective, authority/boundaries, evidence, handback và stop condition.

Brief phải tách `KNOWN_EVIDENCE`, `OPEN_QUESTIONS` và `NON_GOALS`; không ép
Peer chọn phương án Lead thích nếu đó không phải Human decision. Với public API,
schema/database, auth, permission hoặc integration boundary, nêu
`CONTRACT_BOUNDARY` hiện có trước khi yêu cầu write/test; contract thiếu hoặc cần
đổi là `REOPEN_REQUEST`, không tự mint field/API/mock để test pass.

Khi cần `OWNED_SCOPE` hẹp thay vì toàn workspace, dùng V3 template tại
`$PI_CODING_AGENT_DIR/templates/TASK_BRIEF.md`; never run a broad `find $HOME`.
File thiếu: `BLOCKED: TASK_BRIEF_TEMPLATE_UNAVAILABLE`. Follow-up muốn giữ
quyền edit phải lặp lại `DISPOSITION: engineer` ở dòng đầu tiên.

## 3. Routing (mandatory)

Với mọi `create_agent`:

1. Chọn `pi-peer` hoặc `pi-supervisor` theo role/disposition. Default là
   same-family; cross-family chỉ khi Human explicitly requests it, nếu không
   `BLOCKED: CROSS_FAMILY_ROUTE_REQUIRES_HUMAN`.
2. `list_profiles` khi có; notes advisory, not authority. Record
   `PROFILE_DECISION`.
3. `list_providers`, `list_models`, `inspect_provider` để validate exact
   provider/model/thinking/mode/features. Never silently repair a stale profile.
4. Create với route và settings đã pin, title ngắn, `notifyOnFinish=true`, và
   không `workspaceId`; there is no `profile` parameter.
5. `get_agent_status` readback. Mismatch/missing evidence:
   `BLOCKED: MODEL_RESOLUTION_MISMATCH` và archive agent sai.

Record `ROUTING_DECISION`: task, disposition, requested/observed provider/model/
thinking/mode/features, workspace, agent, và evidence.

## 4. Execution and handback

Chỉ một writer trong một coupled scope. Peer Engineer verify own writes và
handoff artifact, commands/checks hoặc skips, SHA/diff, risk/counterevidence,
what would make this conclusion wrong, và lease state. `REOPEN_REQUEST`,
`DEPENDENCY_REQUEST`, `COUNCIL_REQUEST`, hoặc `BLOCKED` là handback hợp lệ. Khi
nhận `REOPEN_REQUEST`, Lead phải reconcile premise/evidence rồi phát brief mới,
giữ premise bằng counterevidence, hoặc escalate Human decision; không trả lời
“implement first” hay yêu cầu rework mơ hồ.

Sau spawn, kết thúc turn để `notifyOnFinish` wake Lead. Khi wake, dùng status
rồi activity khi cần; không polling hay auto-approve permission.

## 5. Independent review and verdict

Sau Engineer idle, Lead record HEAD/status. Spawn một **Peer** mới với
`DISPOSITION: reviewer`, `MODE: read-only`, và exact stable candidate SHA hoặc
identified diff. Reviewer không viết và phân loại finding là `DEFECT`, `RISK`,
`PREFERENCE`, hoặc `UNVERIFIED`; reviewer phải thử falsify scope, regression,
contract, lifecycle và proof, không redesign module ngoài mandate. Re-read
HEAD/status sau review; drift invalidates review. Finding quay về original
engineer dưới fresh brief; tạo candidate mới thì review lại.

Lead inspect stable evidence và issue engineering verdict. Human giữ external
effects/deploy và mọi quyết định ngoài lease. Không coi lifecycle completed,
confidence hay test pass đơn lẻ là acceptance.
