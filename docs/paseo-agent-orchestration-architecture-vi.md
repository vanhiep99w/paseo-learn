# Kiến trúc orchestration agent với Paseo, Pi, Codex và Claude (historical MCP evaluation)

> Tài liệu đánh giá lịch sử. Active architecture đã chuyển sang role-gated
> `paseo-team` facade trên public Paseo CLI; xem `wiki/architecture.md`.

Ngày đánh giá: 2026-08-07  
Repository được đánh giá: paseo-pi-team  
Commit nền khi đánh giá: 4ca99f8  
Trạng thái tài liệu: đề xuất kiến trúc và kế hoạch triển khai, không phải đặc tả API đóng băng

## 1. Kết luận ngắn

Repository hiện tại có một lõi tư tưởng tốt: không xây thêm task database, state machine hay proxy model nếu Paseo đã cung cấp vòng đời agent, workspace, provider và notification. Ba vai trò Supervisor, Lead và Peer cũng là một điểm khởi đầu hợp lý.

Tuy nhiên, implementation hiện tại chưa nên được xem là một nền orchestration tổng quát cho Pi, Codex và Claude. Nó đang là một role pack thiên về Pi, với nhiều quy tắc được bảo vệ bằng prompt, regex và quy ước hơn là ranh giới thực thi.

Khuyến nghị chính của tài liệu này là:

1. Giữ Paseo làm control plane duy nhất cho agent, workspace, provider, lifecycle và notification.
2. Tách orchestration core không phụ thuộc provider khỏi adapter/policy riêng cho Pi.
3. Dùng Lead như một agent ra quyết định động, không biến Lead thành workflow engine hoặc task database.
4. Dùng Paseo Hub cho workflow sản xuất có trigger, input/output có schema và yêu cầu dispatch idempotent.
5. Dùng Git commit SHA, test output và artifact trong repo làm bằng chứng bền vững; không dùng transcript hoặc status tự khai làm bằng chứng hoàn tất.
6. Ưu tiên native Codex hoặc native Claude khi cần sandbox và hành vi đúng với provider; chỉ đi qua Pi khi cần định tuyến đa model hoặc một lớp extension chung.
7. Sửa ngay khái niệm Peer read-only: hiện tại Peer vẫn có Bash nên về mặt thực thi có thể sửa file. Đây là read-only theo giao ước, chưa phải read-only thật.
8. Không đưa multi-supervisor, knowledge graph hay multi-host thành nền bắt buộc trước khi một Lead và một Worker chạy ổn định.

Kiến trúc đích nên là hybrid, provider-neutral:

    Human
      |
      v
    Paseo control plane
      |
      +---- Workspace / Worktree / Lifecycle / Notifications
      |
      v
    Lead session
      |
      +---- native Codex worker
      +---- native Claude worker
      +---- Pi multi-model worker
      +---- fresh reviewer
      |
      v
    Git SHA + tests + artifacts

Supervisor là một lớp tùy chọn ở bên cạnh để quan sát và phục hồi governance, không phải một cấp quản lý luôn chen vào luồng Lead–Peer.

## 2. Phạm vi và cách đánh giá

Tôi đã đọc các nhóm nội dung sau:

- Toàn bộ mã, prompt, script, test, config mẫu và tài liệu có ý nghĩa trong repository.
- Các file chưa được Git track nhưng có liên quan tới ý tưởng orchestration.
- PDF Giáo Án Herdr - First edition.
- Các ảnh sơ đồ trong thư mục orchestration.
- Tài liệu chính thức của Paseo về orchestration, MCP, provider, workspace, worktree, schedule, heartbeat và Hub.
- Tài liệu chính thức hiện hành của OpenAI về Codex configuration, AGENTS.md, skills và multi-agent.
- Trạng thái runtime cục bộ: phiên bản Paseo, Pi, adapter, provider khả dụng và kết quả test/preflight.

Không coi các nguồn sau là chân lý:

- Hội thoại Discord trong Other-mindset.txt.
- Config cũ trong outdate-root-for-herdr.config.toml.
- Các sơ đồ nhiều Supervisor.
- Những khẳng định định lượng không có đo lường, ví dụ một ngưỡng số lượng skill cố định làm agent yếu đi.

Mỗi kết luận trong tài liệu nên được hiểu theo ba nhãn:

- **Đã kiểm chứng**: thể hiện trực tiếp trong code, test, trạng thái runtime hoặc tài liệu chính thức.
- **Suy luận**: kết luận hợp lý từ nhiều bằng chứng nhưng chưa có E2E benchmark.
- **Đề xuất**: thiết kế nên triển khai tiếp theo.

## 3. Mô hình chính thức của Paseo cần hiểu đúng

### 3.1 Paseo là control plane, không phải model proxy

Paseo chạy các coding-agent CLI hiện có và chuẩn hóa vòng đời, stream, input, mode, workspace và orchestration. Nó không nên bị dùng như một lý do để tạo thêm một lớp proxy model riêng. Xem [Providers](https://paseo.sh/docs/providers), [Custom providers](https://paseo.sh/docs/custom-providers), [Codex](https://paseo.sh/docs/codex) và [Claude Code](https://paseo.sh/docs/claude-code).

Hệ quả kiến trúc:

- Authentication vẫn thuộc provider CLI.
- Model và mode phải được discovery từ provider đang chạy.
- Một profile role không nhất thiết phải là một provider mới.
- Custom provider chỉ nên được tạo khi cần command, environment, model catalog hoặc launch behavior khác biệt thật sự.

### 3.2 Agent ownership và workspace placement là hai trục khác nhau

Theo [Paseo orchestration](https://paseo.sh/docs/orchestration):

- Agent được Lead tạo ra sẽ là child của Lead.
- Nếu không truyền workspace, child dùng workspace của parent.
- Nếu truyền workspace khác, vị trí làm việc thay đổi nhưng quan hệ parent–child không thay đổi.
- Parentage quyết định ownership và quyền điều phối; workspace quyết định filesystem/context làm việc.

Điểm này sửa một giả định cũ trong một số ghi chép Herdr: child không đồng nghĩa với một subagent yếu, bị nhốt trong cùng transcript hoặc không có phiên độc lập. Paseo child là một full coding-agent session và có thể khác provider.

Việc detach là một hành động của người dùng/CLI, không phải primitive nên được Lead dựa vào trong MCP workflow. Vì vậy thiết kế “mọi Peer phải là detached sibling” không phù hợp với API orchestration hiện hành.

### 3.3 Workspace và worktree không đồng nghĩa

Theo [Workspaces](https://paseo.sh/docs/workspaces) và [Worktrees](https://paseo.sh/docs/worktrees):

- Workspace là container ổn định của công việc và session.
- Workspace có thể trỏ tới checkout local hoặc managed worktree.
- Nhiều agent đọc cùng một codebase có thể ở cùng workspace.
- Nhiều agent cùng ghi nên được tách worktree hoặc ít nhất tách moving scope.

Quy tắc thực dụng:

| Tình huống | Bố trí nên dùng |
|---|---|
| Một agent làm việc nhỏ | Workspace hiện tại |
| Nhiều agent chỉ đọc | Cùng workspace |
| Một writer, nhiều reviewer | Writer trong worktree; reviewer đọc candidate SHA |
| Nhiều writer độc lập | Mỗi writer một worktree/branch |
| Nhiều writer trên cùng phạm vi | Không khuyến nghị; chia lại scope |

### 3.4 MCP là API orchestration, không phải nơi chứa nghiệp vụ dự án

[MCP catalog](https://paseo.sh/docs/mcp) cung cấp primitive để:

- tạo, nhắn, theo dõi, cập nhật, hủy, archive và kill agent;
- quản lý workspace;
- discovery provider/model;
- chạy workspace scripts;
- làm việc với schedule, heartbeat, permission và browser.

Nó không nên bị biến thành một task ledger thứ hai. Task state lâu dài nên nằm ở Git/artifact hoặc hệ thống workflow phù hợp.

### 3.5 Schedule, heartbeat và Hub giải quyết ba bài toán khác nhau

- Schedule tạo agent mới theo lịch.
- Heartbeat đánh thức lại cùng một session.
- Hub nhận external event và chạy workflow có cấu hình.

Theo [Schedules](https://paseo.sh/docs/schedules), schedule và heartbeat không thay thế nhau. Theo [Hub overview](https://paseo.sh/docs/hub), [Hub concepts](https://paseo.sh/docs/hub/concepts), [Hub daemons](https://paseo.sh/docs/hub/daemons), [Hub workflows](https://paseo.sh/docs/hub/workflows) và [Hub triggers](https://paseo.sh/docs/hub/triggers), Hub phù hợp cho:

- GitHub/Slack/Discord/manual trigger;
- typed input;
- ordered/conditional steps;
- structured output theo JSON schema;
- dispatch idempotent theo execution ID;
- config revision có validation.

Kết luận: Lead dành cho phán đoán động trong một task. Hub dành cho automation sản xuất có tính lặp lại và cần semantics rõ ràng.

## 4. Mô hình chính thức của Codex cần đưa vào thiết kế

### 4.1 AGENTS.md là project instruction tự động

Codex đọc AGENTS.md theo chuỗi từ global đến project và thư mục hiện tại; instruction gần hơn ghi đè instruction xa hơn. Xem [AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md).

Vì vậy, nếu muốn hỗ trợ native Codex tốt:

- Quy tắc mà mọi Codex agent phải biết nên nằm trong AGENTS.md.
- Không nhồi toàn bộ chiến lược Lead vào AGENTS.md.
- Luật repo, command test và vùng cấm chung nên ở AGENTS.md.
- Orchestration policy riêng của Lead có thể ở file khác và được Lead skill/profile đọc.

### 4.2 Skill dùng progressive disclosure

Theo [Codex skills](https://developers.openai.com/codex/skills), ban đầu agent chỉ nhận metadata mô tả skill; nội dung đầy đủ được đọc khi skill được dùng.

Suy luận đúng là: nhiều skill có thể làm tăng chi phí discovery và gây ambiguity nếu mô tả chồng lấn. Nhưng không có cơ sở để biến một con số như “hơn 10 skill thì agent yếu” thành invariant kiến trúc.

Giải pháp nên là:

- mô tả skill ngắn, khác nhau rõ;
- skill chỉ đóng gói workflow thực sự tái sử dụng;
- không biến mọi quy tắc thành một skill;
- benchmark theo task suite thay vì theo số lượng skill.

### 4.3 Native Codex subagents không phải lúc nào cũng nên tránh

Tài liệu [Codex multi-agent](https://developers.openai.com/codex/multi-agent) mô tả subagent như thread riêng có thể chạy song song, steer và tổng hợp kết quả. Khuyến nghị chính thức cũng nhấn mạnh read-heavy task phù hợp hơn write-heavy task.

Do đó:

| Nhu cầu | Primitive phù hợp |
|---|---|
| Fan-out đọc nhanh trong một Codex task | Native Codex subagents |
| Cross-provider hoặc cần Paseo lifecycle/workspace | Paseo child agents |
| Agent dài hạn có ownership tổ chức độc lập | Top-level/detached do người dùng quản lý |
| Nhiều writer | Tách worktree bất kể dùng primitive nào |

Không nên áp dụng giáo điều “phiên độc lập luôn tốt hơn subagent”. Câu hỏi đúng là cần cross-provider, isolation, lifecycle bền vững và ownership ở mức nào.

### 4.4 Codex có profile/config chính thức

[Codex configuration reference](https://developers.openai.com/codex/config-reference) hỗ trợ user config, project config trong repo tin cậy và profile config dưới CODEX_HOME. Tuy nhiên kiểm chứng với Codex 0.147.0 cho thấy `--profile` không áp dụng cho `app-server`, là interface Paseo sử dụng. Bộ triển khai hiện tại vì vậy giữ profile cho CLI trực tiếp nhưng cấp một CODEX_HOME riêng có `config.toml` cho từng Paseo role; cách này tránh launcher dịch TOML và tạo isolation state rõ hơn.

## 5. Hiện trạng repository

### 5.1 Những gì repo đang xây

Repo triển khai một role pack gồm:

- Supervisor: governance/monitoring và recovery có điều kiện.
- Lead: phân rã, giao việc, theo dõi, nghiệm thu.
- Peer: worker có phạm vi hẹp, có thể là engineer, architect, reviewer hoặc scout.

Các thành phần chính:

- [README.md](../tai-lieu-tham-khao/README.md)
- [Pi policy extension](../tai-lieu-tham-khao/extensions/paseo-team-policy.ts)
- [Lead skill](../tai-lieu-tham-khao/skills/paseo-team-lead/SKILL.md)
- [Supervisor prompt](../tai-lieu-tham-khao/prompts/supervisor.md)
- [Lead prompt](../tai-lieu-tham-khao/prompts/lead.md)
- [Peer prompt](../tai-lieu-tham-khao/prompts/peer.md)
- [Task Brief V3 template](../tai-lieu-tham-khao/templates/TASK_BRIEF_V3.md)
- [Workspace Protocol template](../tai-lieu-tham-khao/templates/WORKSPACE_PROTOCOL.example.md)
- [Model routing](../tai-lieu-tham-khao/scripts/model-routing.mjs)
- [Preflight](../tai-lieu-tham-khao/scripts/preflight.mjs)
- [Policy tests](../tai-lieu-tham-khao/test/policy.test.mts)
- [Routing tests](../tai-lieu-tham-khao/test/model-routing.test.mjs)

Lõi tư tưởng của repo là:

- Paseo giữ lifecycle/control plane.
- Pi extension giữ role prompt và tool policy.
- Lead skill giữ workflow.
- Git giữ candidate evidence.
- Không tạo task database hoặc daemon riêng.

Đây là hướng đúng.

### 5.2 Task Brief V3 là phần mạnh nhất

Strict marker block và fail-closed parsing là quyết định tốt:

- Authority đến từ current turn, không phải ký ức của session.
- Field lạ, trùng hoặc parse lỗi làm mất write authority.
- V1/V2 được coi là legacy read-only.
- Commit/push cần quyền rõ.
- Push chỉ được lên branch tương ứng task.

Đây là một capability envelope dễ audit hơn prompt tự do.

Nhưng Task Brief hiện mới cấp quyền theo cờ tổng quát. OWNED_SCOPE được parse nhưng chưa được extension dùng để chặn write/edit/bash ngoài path. Vì vậy “scoped writer” hiện là protocol claim, chưa phải enforced scope.

### 5.3 Model routing có nhiều nguyên tắc đúng

[model-routing.mjs](../tai-lieu-tham-khao/scripts/model-routing.mjs) làm tốt các điểm:

- route class rõ;
- exact provider/model/thinking;
- kiểm tra provider health;
- không silent fallback;
- post-verify observed model;
- routing stateless.

Năm class hiện tại hợp lý:

- MONITOR_ECONOMY
- FAST_READ
- CODING_MEDIUM
- REASONING_HIGH
- REVIEW_HIGH

Vấn đề là implementation gắn cứng với pi-supervisor, pi-lead và pi-peer. Schema thinking cũng phản ánh Pi nhiều hơn native Codex/Claude. Trên máy đánh giá, native Codex có mức ultra ở một số model nhưng Pi route schema chỉ có tới max.

Nên giữ route class, nhưng đổi target thành capability record trung tính:

    route class
      -> provider profile
      -> provider kind
      -> exact model
      -> provider-native effort/mode/options
      -> required capabilities
      -> availability policy

### 5.4 Preflight là nền tốt nhưng đang pin một snapshot cũ

[preflight.mjs](../tai-lieu-tham-khao/scripts/preflight.mjs) kiểm tra khá đầy đủ:

- Node, Git, Paseo, Pi và adapter;
- daemon;
- extension/prompts;
- role providers;
- route và cluster;
- remote endpoint;
- repo state.

Khi chạy trên host hiện tại:

- Node 24.15: đạt.
- Git 2.53: đạt.
- Paseo 0.2.5: đạt.
- Pi đang là 0.84, cao hơn snapshot 0.83.
- Adapter đang là 2.21, cao hơn snapshot 2.19.
- Extension và role provider chưa được cài.
- Routing/cluster config runtime chưa có.
- Repo đang có thay đổi/untracked file.

Do đó preflight trả về không sẵn sàng cho role pack. Đây không phải lỗi của Paseo daemon; đây là môi trường chưa được cài theo pack.

### 5.5 Test status

Kết quả kiểm tra tại thời điểm đánh giá:

- model-routing.test.mjs: pass.
- git diff --check: pass.
- policy.test.mts: chưa chạy được local vì repo không khai báo dependency @earendil-works/pi-coding-agent.

CI cài dependency bằng npm install --no-save. Cách này làm CI có thể chạy nhưng local clone không tái lập ngay được. Repo nên có package.json, lockfile và script test chuẩn.

## 6. Các lỗ hổng và mâu thuẫn cần sửa trước

### 6.1 Peer read-only vẫn có Bash

Policy read-only của Peer cho phép read và bash. Guard Bash hiện chủ yếu chặn một số lệnh Paseo và Git. Nó không chặn các lệnh ghi file tổng quát như redirect, formatter có write mode, script tùy ý hoặc tool shell khác.

Vì vậy:

- “Peer read-only” hiện không phải security boundary.
- Reviewer cũng có thể vô tình làm bẩn candidate.
- Prompt không thể thay thế filesystem sandbox.

Ba hướng sửa, theo thứ tự ưu tiên:

1. Chạy read-only worker bằng provider sandbox thực sự không cho ghi.
2. Nếu dùng Pi, tạo một Bash read-only wrapper/allowlist có semantics rõ hoặc bỏ Bash khỏi profile read-only.
3. Nếu chưa làm được, đổi tên thành advisory read-only và ghi rõ giới hạn; không quảng bá như enforced read-only.

### 6.2 OWNED_SCOPE chưa được máy kiểm tra

Extension biết OWNED_SCOPE nhưng write/edit không đối chiếu path. Bash càng không có enforcement phạm vi.

Đề xuất:

- Chuẩn hóa scope thành danh sách path root, không phải prose mơ hồ.
- Chặn write/edit khi resolved path nằm ngoài scope.
- Với Bash, hoặc dùng sandbox filesystem, hoặc không tuyên bố path confinement.
- Test symlink, relative path, path traversal và command gọi tool gián tiếp.

### 6.3 Regex và prompt là defense-in-depth, không phải isolation

Guard command hữu ích để ngăn lỗi phổ biến, nhưng không thể chứng minh mọi cách gọi gián tiếp. Chính code cũng ghi nhận guard là heuristic.

Mô hình an toàn đúng:

    Provider/OS sandbox     = ranh giới thực thi
    Paseo permission        = ranh giới control plane
    Pi extension policy     = defense-in-depth
    Task Brief + prompt     = contract hành vi
    Git/test evidence       = verification

Không đảo ngược thứ tự này.

### 6.4 PASEO_TEAM_EXTRA_TOOLS là escape hatch

Biến môi trường này có thể mở thêm registered tools cho role. Nó nên được coi là host-admin capability, không phải config bình thường mà Lead hoặc task có thể điều khiển.

Cần:

- không truyền từ input không tin cậy;
- log rõ tool nào được mở thêm;
- test rằng task brief không thể bật nó;
- bỏ khỏi ví dụ tối thiểu nếu chưa cần.

### 6.5 Supervisor recovery có nguy cơ thành split-brain

Repo đã hạn chế Supervisor khá tốt: không trực tiếp điều phối Peer và chỉ được create Lead recovery theo schema. Dù vậy, mọi khả năng tạo thêm Lead đều có nguy cơ hai owner cùng hoạt động.

Cần điều kiện phục hồi rõ:

- xác minh Lead cũ terminal/unreachable;
- gắn recovery_for và predecessor ID;
- candidate ownership không trùng;
- Leader mới đọc durable state chứ không suy đoán từ transcript;
- notification cho Human;
- chỉ một Lead có quyền accept ở một thời điểm.

### 6.6 Provider-neutral chưa đạt

Tên và flow hiện tại giả định Pi:

- provider role gắn pi-lead/pi-peer/pi-supervisor;
- extension là Pi extension;
- mode/thinking là kiểu Pi;
- prompt injection dựa vào Pi lifecycle hook.

Nếu mục tiêu là “Pi, Codex hay Claude”, cần tách:

    orchestration-core/
      task brief schema
      workspace protocol
      lead workflow
      evidence/acceptance contract
      route classes

    adapters/
      pi/
      codex/
      claude/

Không buộc Codex và Claude chạy xuyên Pi chỉ để tái sử dụng role name.

## 7. Đánh giá các ý tưởng thu thập bên ngoài

### 7.1 Những ý tưởng nên giữ

Từ PDF Herdr, Discord và các sơ đồ:

- Một control plane duy nhất.
- Một owner rõ cho mỗi task/moving scope.
- Một writer cho một phạm vi đang thay đổi.
- Peer có local judgment, không phải “cừu” chỉ làm theo checklist.
- Artifact và Git SHA quan trọng hơn transcript.
- Reviewer độc lập với implementer.
- Event-driven supervision tốt hơn polling.
- Bắt đầu với topology nhỏ.
- Human giữ quyền đối với quyết định khó đảo ngược.
- Supervisor quan sát process health thay vì giành quyền task-local.

Những nguyên tắc này phù hợp với Paseo hiện tại.

### 7.2 Những ý tưởng nên sửa

**“Mọi collaborator phải detached sibling”**

Không phù hợp với MCP hiện tại và bỏ qua full-session Paseo child. Chỉ detach khi thật sự cần ownership tổ chức độc lập.

**“Subagent luôn bị authority gradient nên không độc lập”**

Đây là rủi ro prompt và governance, không phải tính chất tất yếu. Paseo child có full session; Codex subagent cũng là thread có thể steer. Cần đánh giá theo task.

**“Nhiều skill vượt ngưỡng cố định làm agent yếu”**

Không có bằng chứng chính thức cho một ngưỡng số. Vấn đề thật là metadata budget, overlap, ambiguity và context.

**“Supervisor là front door cho mọi thứ”**

Điều này dễ tạo central bottleneck và split-brain. Trong bản đầu, Human nên nói trực tiếp với Lead cho task-local work. Supervisor chỉ cần cho multi-workspace governance hoặc recovery đã chứng minh cần thiết.

**“Knowledge graph là durable memory bắt buộc”**

Premature. Git, issue/PR, structured result, labels và Hub execution đã đủ cho MVP. Chỉ thêm knowledge graph khi có truy vấn lịch sử cụ thể không thể phục vụ bằng artifact hiện có.

### 7.3 Structural anti-patterns nên được dùng thế nào

[structural-antipatterns.md](../tai-lieu-tham-khao/structural-antipatterns.md) hữu ích như bộ câu hỏi:

- Đây có phải sai abstraction không?
- Có đang tự xây lại control plane không?
- Có dựng một lớp compatibility chỉ vì nền bên dưới yếu không?
- Có tối ưu từng thành phần nhưng làm hệ tổng thể phức tạp hơn không?
- “Test pass” có thực sự chứng minh user outcome không?

Không nên dùng nó như checklist buộc mọi PR phải gắn nhãn anti-pattern.

## 8. Kiến trúc đích được đề xuất

### 8.1 Sáu lớp, sáu nguồn sự thật

| Lớp | Trách nhiệm | Nguồn sự thật |
|---|---|---|
| Human authority | mục tiêu, ngân sách, quyết định khó đảo ngược | user instruction |
| Control plane | agent, workspace, provider, lifecycle, notification | Paseo daemon |
| Workflow | trigger, ordered steps, failure/re-dispatch semantics | Paseo Hub hoặc Lead session |
| Role policy | ai được làm gì trong task | Task Brief + provider sandbox |
| Project contract | luật repo, command verify, ownership convention | AGENTS.md + Workspace Protocol |
| Evidence | candidate chính xác và tiêu chí đạt | Git SHA + test/artifact |

Một dữ liệu không nên có hai owner. Ví dụ:

- Không tạo agent registry riêng ngoài Paseo.
- Không tạo branch registry nếu Git đã là nguồn thật.
- Không lưu “task complete” chỉ trong label nếu candidate chưa được verify.
- Không coi transcript là durable acceptance record.

### 8.2 Topology mặc định

MVP:

    Human
      |
      v
    Lead
      |
      +---- Worker
      |
      +---- Reviewer khi cần

Supervisor:

    Supervisor ---- observes Lead/workspace health
         |
         +---- notify Human/Lead
         +---- gated recovery Lead only

Không cho Supervisor giao việc trực tiếp cho Peer trong MVP.

### 8.3 Lead contract

Lead chịu trách nhiệm:

- hiểu mục tiêu và xác định acceptance;
- chọn topology nhỏ nhất đủ dùng;
- discovery provider/model trước khi route;
- tạo workspace/worktree cần thiết;
- phát Task Brief có authority rõ;
- phản hồi blocker hoặc scope change;
- verify candidate SHA và bằng chứng;
- quyết định accept/rework/escalate;
- trả kết quả ngắn gọn cho Human.

Lead không:

- tự biến thành daemon polling;
- giữ task database riêng;
- mặc định tự code cùng vùng với Worker;
- tự review implementation của chính mình nếu risk cao;
- silent fallback model;
- tạo nhiều Peer chỉ vì có khả năng tạo.

### 8.4 Peer contract

Peer là một worker có disposition:

- Engineer: implement phạm vi hẹp.
- Architect: đọc và đề xuất ranh giới/thiết kế.
- Reviewer: kiểm tra candidate cố định.
- Scout: tìm bằng chứng, dependency hoặc rủi ro.

Disposition không phải role profile mới. Nó là field trong Task Brief, giúp tránh tạo hàng chục profile gần giống nhau.

Peer phải trả:

- outcome;
- file/SHA đã thay đổi hoặc đọc;
- test đã chạy;
- failure còn lại;
- assumption hoặc scope conflict;
- câu hỏi cần Lead quyết định.

### 8.5 Reviewer contract

Reviewer nên:

- là fresh session khi risk cao;
- nhận exact candidate SHA;
- không chia sẻ moving worktree với writer;
- kiểm tra acceptance, regression, security và proof quality;
- phân biệt bug thực với preference;
- không tự sửa candidate trừ khi được cấp một task write riêng.

“Fresh reviewer” giảm self-confirmation, nhưng không tự động bảo đảm chất lượng. Cần rubric và test phù hợp.

### 8.6 Supervisor contract

Supervisor chỉ đáng dùng khi có ít nhất một trong các điều kiện:

- nhiều workspace đang chạy;
- Lead dài hạn có thể chết hoặc bị compaction;
- governance/chi phí cần quan sát chéo;
- có SLA phục hồi;
- Human không thể theo dõi trực tiếp.

Supervisor không phải:

- project manager cho từng task;
- reviewer mặc định;
- memory database;
- một agent có quyền thay đổi mọi workspace.

## 9. Chọn Pi, native Codex hay native Claude

### 9.1 Không chọn theo “tính cách thương hiệu”

Không nên hardcode:

- Claude luôn làm kiến trúc;
- Codex luôn code;
- model rẻ luôn scout;
- model lớn luôn reviewer.

Route theo:

- task type;
- repository/language;
- tool/sandbox cần thiết;
- context size;
- model/provider availability;
- latency/cost;
- benchmark lịch sử của chính hệ thống.

### 9.2 Native Codex

Nên ưu tiên khi:

- muốn dùng sandbox và instruction semantics nguyên bản của Codex;
- repo đã có AGENTS.md;
- cần native modes/effort;
- không cần Pi làm model multiplexer;
- muốn giảm một adapter/hook layer.

Trên host đánh giá, native Codex đang khả dụng và expose các model/mức reasoning hiện hành, gồm ultra ở một số model.

### 9.3 Native Claude

Nên dùng khi:

- Claude CLI đã được cài và auth;
- benchmark nội bộ cho thấy tốt hơn cho task cụ thể;
- cần native Claude workflow/permission semantics;
- muốn tránh giả lập Claude qua một lớp model router khác.

Paseo tích hợp qua official Claude CLI/Agent SDK theo [Claude Code provider](https://paseo.sh/docs/claude-code).

Trên host đánh giá, provider Claude báo unavailable/not found. Vì vậy mọi cấu hình Claude trong tài liệu này là thiết kế, chưa được live-verify tại máy.

### 9.4 Pi

Pi phù hợp khi:

- cần một interface tới nhiều model/provider;
- muốn extension hook để thử nghiệm role/tool policy;
- cần model catalog ngoài native Codex/Claude;
- chấp nhận thêm dependency và compatibility surface.

Pi không tự động là lớp orchestration tốt hơn. Trong repo này, Pi là execution adapter cộng policy extension; Paseo mới là orchestration control plane.

### 9.5 Khuyến nghị hybrid

Thiết lập mặc định:

| Role/task | Provider ưu tiên | Lý do |
|---|---|---|
| Lead | native Codex hoặc Claude | ít lớp trung gian, lifecycle qua Paseo |
| Code worker | native Codex | sandbox/instruction native |
| Architecture/review | provider thắng benchmark | không hardcode theo thương hiệu |
| Cheap scout | Pi route tới model phù hợp | lợi thế multi-model |
| Supervisor economy | Pi hoặc model nhỏ native | task monitoring đơn giản |

Exact model phải được discovery và pin lúc tạo agent. Nếu unavailable, Lead phải báo hoặc dùng fallback được Human/Workspace Protocol cho phép; không silent fallback.

## 10. Cấu trúc repository nên chuyển tới

Đề xuất cấu trúc:

    AGENTS.md
    .orchestration/
      WORKSPACE_PROTOCOL.md
      task-brief.schema.json
      routes.json
      acceptance/
        default.md
      hub.yml
    orchestration/
      core/
        lead-workflow.md
        evidence-contract.md
        routing-contract.md
      adapters/
        pi/
          extension.ts
          provider.example.json
        codex/
          profile.example.toml
          provider.example.json
        claude/
          provider.example.json
    test/
      contract/
      policy/
      e2e/

Nguyên tắc:

- Core không import Pi package.
- Adapter có thể fail độc lập.
- Route schema chứa provider-native options, không ép mọi provider dùng cùng thinking enum.
- AGENTS.md chỉ chứa luật phổ quát.
- Workspace Protocol chứa strategy của project, nhưng không được coi là secret/security boundary.

## 11. Task Brief V4 đề xuất

V3 nên được giữ tương thích, rồi mở rộng có chủ đích.

Ví dụ:

    BEGIN TASK BRIEF V4
    TASK_ID: auth-refresh-017
    DISPOSITION: engineer
    OBJECTIVE: sửa refresh token race trong phạm vi auth client
    OWNED_PATHS:
      - src/auth/client.ts
      - test/auth/client.test.ts
    FORBIDDEN_PATHS:
      - migrations/
      - package-lock.json
    WRITE_AUTHORITY: true
    COMMIT_AUTHORITY: true
    PUSH_AUTHORITY: false
    EXPECTED_BASE_SHA: abc123...
    CANDIDATE_BRANCH: agent/auth-refresh-017
    ACCEPTANCE:
      - test auth pass
      - không thay public API
      - có regression test cho concurrent refresh
    REQUIRED_EVIDENCE:
      - exact candidate SHA
      - command và exit code
      - danh sách file changed
    ESCALATE_IF:
      - cần đổi token schema
      - phát hiện scope overlap
    END TASK BRIEF V4

Khác biệt quan trọng:

- OWNED_PATHS có thể enforce, không dùng prose tự do.
- FORBIDDEN_PATHS rõ.
- Acceptance và evidence tách riêng.
- Candidate branch rõ nhưng không thay Git làm nguồn thật.
- Escalation condition giảm việc Peer tự mở scope.

Task body sau marker vẫn là untrusted instruction. Parser phải fail closed.

## 12. Lead workflow cụ thể

### Bước 1: Intake

Lead xác định:

- outcome người dùng thật sự cần;
- phạm vi repo;
- mức risk;
- có cần write không;
- có quyết định khó đảo ngược không.

Nếu task nhỏ, Lead có thể tự làm hoặc đề nghị single-agent mode. Orchestration không phải mục tiêu tự thân.

### Bước 2: Read project contract

Đọc:

- AGENTS.md;
- Workspace Protocol;
- current Git state;
- task-specific docs;
- provider availability.

Không dựa vào profile cũ nếu current-turn instruction mâu thuẫn.

### Bước 3: Chọn topology

| Risk/shape | Topology |
|---|---|
| nhỏ, local | một agent |
| read-heavy, nhiều câu hỏi độc lập | fan-out scout |
| một vùng code rõ | một writer |
| design chưa rõ | architect read-only rồi Lead quyết |
| high-risk write | writer + fresh reviewer |
| nhiều package độc lập | nhiều worktree, một writer/package |
| external recurring event | Hub workflow |

### Bước 4: Route provider/model

- gọi discovery;
- match capability;
- pin exact provider/model/mode;
- lưu route decision trong agent labels hoặc task artifact;
- không tạo agent nếu provider unavailable mà không có policy fallback.

### Bước 5: Cấp worktree và brief

- resolve expected base SHA;
- đảm bảo scope không overlap;
- tạo workspace/worktree;
- gửi Task Brief;
- yêu cầu agent xác nhận parse result nếu risk cao.

### Bước 6: Theo dõi bằng notification

Lead phản ứng với:

- completion;
- blocker;
- permission request;
- scope change;
- candidate ready.

Không poll status liên tục. Chỉ kiểm tra chủ động khi mất notification hoặc timeout có nghĩa nghiệp vụ.

### Bước 7: Verify

Lead không chấp nhận câu “done”. Cần:

- exact SHA;
- clean/known tree state;
- diff đúng phạm vi;
- command verify và exit code;
- acceptance-specific proof.

### Bước 8: Review

Tạo fresh reviewer khi:

- auth/security/data migration;
- thay public API;
- thay orchestration policy;
- diff lớn;
- test khó phản ánh user outcome;
- writer báo assumption đáng kể.

### Bước 9: Accept hoặc rework

Rework phải là follow-up cụ thể, không chỉ “làm tốt hơn”. Nếu scope đổi, phát brief mới thay vì vá current authority bằng chat tự do.

### Bước 10: Close

- báo outcome cho Human;
- archive agent/workspace phù hợp;
- giữ artifact/SHA;
- ghi metric tối thiểu;
- không duy trì agent sống chỉ để “nhớ”.

## 13. Hub workflow mẫu về mặt kiến trúc

Một PR review automation nên được thiết kế như:

    GitHub pull_request event
      -> validate sender/repository
      -> Step 1: read-only risk classifier
      -> Step 2: conditional reviewer by risk
      -> Step 3: structured result
      -> Step 4: publish only if policy permits

Mỗi step có:

- provider/model rõ;
- input typed;
- timeout;
- output schema;
- condition;
- permission boundary.

Hub dispatch idempotency giúp tránh tạo agent trùng khi response bị mất. Lead session tự viết một vòng retry không có execution ID sẽ khó đạt semantics tương đương.

## 14. Security và trust boundaries

### 14.1 Phân loại input

| Input | Mức tin cậy |
|---|---|
| Human current-turn instruction | authority cao nhất trong task |
| Repo AGENTS.md đã review | project policy |
| Workspace Protocol đã review | orchestration policy |
| Task Brief marker | capability contract |
| Task body | untrusted data/instruction |
| File trong repo/issue/PR/web | untrusted content |
| Agent status message | claim cần verify |

### 14.2 Quyền khó đảo ngược

Human phải giữ hoặc cấp rõ:

- force push;
- merge;
- production deploy;
- delete workspace/data;
- secret rotation;
- external message/post;
- permission escalation;
- thay policy nền.

Không suy ra những quyền này chỉ từ “hãy hoàn tất”.

### 14.3 Secrets

- Chỉ truyền tên biến môi trường trong config mẫu.
- Không ghi giá trị secret vào prompt, label hoặc transcript.
- Provider auth thuộc CLI/provider.
- Remote host config phải xác định trust boundary riêng.

### 14.4 Multi-host

Multi-host trong repo là một extension nâng cao, chưa phải MVP. Candidate nên đi qua Git SHA, không qua transcript hoặc copy thư mục ad hoc.

Chỉ bật multi-host khi:

- có nhu cầu resource/provider thật;
- network/auth đã chuẩn hóa;
- route/controller có owner;
- failure và reconnection được test;
- không tạo hai control plane cùng quản lý một agent.

## 15. Testing cần có

### 15.1 Unit/contract

- strict Task Brief parser;
- unknown/duplicate field fail closed;
- current-turn reset;
- role tool matrix;
- path confinement;
- symlink/traversal;
- provider route schema;
- exact model post-verification;
- recovery Lead schema.

### 15.2 Integration

- Paseo create/send/status lifecycle;
- same-workspace read-only fanout;
- worktree writer;
- reviewer exact SHA;
- provider unavailable;
- permission denial;
- Lead compaction/recovery;
- notification delivery;
- archive behavior.

### 15.3 Cross-provider E2E

Matrix tối thiểu:

| Lead | Worker | Reviewer |
|---|---|---|
| Codex | Codex | Codex |
| Codex | Pi | Codex |
| Claude | Codex | Claude |
| Pi | Codex | Pi |

Chỉ chạy dòng có provider khả dụng. Claude row hiện phải skip có lý do trên host này.

### 15.4 Adversarial policy tests

- task body yêu cầu bỏ qua marker;
- Bash ghi file trong read-only;
- command gián tiếp gọi Git/Paseo;
- path ngoài OWNED_PATHS;
- unexpected tool qua extra tools;
- Supervisor tạo Lead không đủ labels;
- recovery trùng owner;
- reviewer tự sửa candidate;
- silent provider fallback.

### 15.5 Outcome benchmark

Test policy không đủ. Cần task suite đại diện:

- bug nhỏ;
- refactor nhiều file;
- architecture question;
- security review;
- flaky test diagnosis;
- PR review;
- dependency update.

Đo:

- success theo acceptance;
- wall-clock;
- token/cost;
- số lần Human can thiệp;
- số scope conflict;
- số worktree conflict;
- false-positive review;
- rework count;
- recovery time;
- diff ngoài scope.

## 16. Kế hoạch triển khai theo giai đoạn

### P0 — Sửa nền và định nghĩa đúng

1. Thêm package.json, lockfile và test scripts.
2. Ghi rõ policy heuristic không phải sandbox.
3. Sửa hoặc đổi tên Peer read-only.
4. Chuẩn hóa OWNED_PATHS và path enforcement.
5. Tách core contract khỏi Pi adapter.
6. Cập nhật version matrix và compatibility policy.
7. Thêm AGENTS.md phổ quát cho native Codex.

Exit criteria:

- clone mới chạy test được;
- không có profile nào được gọi read-only nếu vẫn có đường ghi rõ ràng;
- core schema không import Pi.

### P1 — Hybrid provider MVP

1. Thêm native Codex Lead/Worker/Reviewer example.
2. Thêm Claude example nhưng guard theo availability.
3. Generalize route schema cho provider-native effort/mode.
4. Discovery và exact-model verification chung.
5. E2E một Lead, một Worker, một Reviewer.

Exit criteria:

- Codex Lead tạo được Pi hoặc Codex Worker qua Paseo;
- candidate exact SHA được reviewer xác minh;
- provider unavailable không silent fallback.

### P2 — Durable workflow

1. Thêm .paseo/hub.yml mẫu cho PR review hoặc issue triage.
2. Structured output schema.
3. Idempotency và failure/re-dispatch test.
4. Schedule/heartbeat use case rõ, không polling.

Exit criteria:

- cùng execution ID không tạo duplicate;
- output parse được;
- trigger sender/repository được allowlist.

### P3 — Supervisor tối thiểu

1. Chỉ quan sát Lead/workspace health.
2. Notification protocol.
3. Gated recovery với single-owner invariant.
4. Human-visible recovery audit.

Exit criteria:

- không có hai Lead accept cùng task;
- Supervisor không có đường điều phối Peer;
- recovery được test sau Lead crash.

### P4 — Multi-host và tối ưu

Chỉ làm sau khi metrics cho thấy cần:

- remote routing;
- provider placement;
- multi-workspace governance;
- cost/latency optimizer;
- nhiều Supervisor chuyên biệt.

Không thêm knowledge graph nếu chưa có truy vấn và outcome cụ thể.

## 17. Backlog cụ thể cho repository hiện tại

### Ưu tiên cao

- [ ] Thêm package.json và lockfile cho Pi policy tests.
- [ ] Thêm test chứng minh read-only Bash không ghi được, hoặc bỏ tuyên bố read-only.
- [ ] Enforce OWNED_PATHS trên write/edit.
- [ ] Thiết kế sandbox cho Bash hoặc phân loại Bash là unrestricted.
- [ ] Tách route target khỏi pi-lead/pi-peer/pi-supervisor.
- [ ] Hỗ trợ provider-native effort, gồm Codex ultra khi model hỗ trợ.
- [ ] Viết core orchestration contract không phụ thuộc provider.
- [ ] Thêm E2E native Codex.

### Ưu tiên trung bình

- [ ] Thêm native Claude khi CLI có mặt.
- [ ] Thêm structured result schema.
- [ ] Thêm Hub example.
- [ ] Thêm recovery test.
- [ ] Thêm metrics artifact.
- [ ] Gộp/xóa bản duplicate của tài liệu sau khi Human duyệt.

### Chưa nên làm

- [ ] Nhiều Supervisor chuyên biệt.
- [ ] Knowledge graph.
- [ ] Custom task database.
- [ ] Provider proxy riêng.
- [ ] Multi-host mặc định.
- [ ] Auto merge/deploy.

## 18. Quyết định khuyến nghị cho phiên bản đầu

Nếu bắt đầu triển khai ngay, tôi sẽ chọn:

1. Paseo native Codex làm Lead trên host hiện tại.
2. Một Codex Worker trong worktree cho write task.
3. Pi chỉ dùng cho scout/model khác khi có lợi ích đo được.
4. Fresh Codex Reviewer đọc exact SHA.
5. Không Supervisor trong luồng thường.
6. Supervisor chỉ bật thử nghiệm recovery sau khi Lead–Worker–Reviewer E2E ổn định.
7. AGENTS.md cho luật repo; Workspace Protocol cho strategy; Task Brief V4 cho authority.
8. Provider sandbox là ranh giới write/read-only.
9. Hub cho PR automation, không dùng một Lead sống vĩnh viễn để polling.
10. Benchmark trước khi gán cố định Claude/Codex/Pi theo loại vai trò.

Đây là topology nhỏ nhất vừa tận dụng Paseo, vừa không tái xây orchestration framework bên ngoài Paseo.

## 19. Các điểm cần live-verify trước khi production

- Revalidate việc Codex app-server hỗ trợ profile selector ở các phiên bản sau; 0.147.0 hiện từ chối `--profile` cho app-server.
- Provider mode/permission cụ thể của Claude sau khi cài CLI.
- Sandbox thực tế của từng provider khi agent chạy trong Paseo worktree.
- Notification loss/reconnect behavior trong môi trường deployment.
- Hub self-hosted auth và trigger allowlist.
- Path enforcement trên Windows/macOS.
- Compatibility của Pi 0.84 và adapter 2.21 với extension đang pin theo 0.83/2.19.
- Model catalog thay đổi theo account/provider.

Không nên đóng băng config example trước khi các điểm này có automated E2E.

## 20. Nguồn tham khảo

### Tài liệu chính thức Paseo

- [Orchestration](https://paseo.sh/docs/orchestration)
- [Orchestration workflows](https://paseo.sh/docs/orchestration-workflows)
- [MCP](https://paseo.sh/docs/mcp)
- [Skills](https://paseo.sh/docs/skills)
- [Workspaces](https://paseo.sh/docs/workspaces)
- [Worktrees](https://paseo.sh/docs/worktrees)
- [Providers](https://paseo.sh/docs/providers)
- [Custom providers](https://paseo.sh/docs/custom-providers)
- [Codex provider](https://paseo.sh/docs/codex)
- [Claude Code provider](https://paseo.sh/docs/claude-code)
- [Schedules](https://paseo.sh/docs/schedules)
- [Hub](https://paseo.sh/docs/hub)
- [Hub concepts](https://paseo.sh/docs/hub/concepts)
- [Hub daemons](https://paseo.sh/docs/hub/daemons)
- [Hub workflows](https://paseo.sh/docs/hub/workflows)
- [Hub triggers](https://paseo.sh/docs/hub/triggers)
- [Hub configuration](https://paseo.sh/docs/hub/configuration)

### Tài liệu chính thức OpenAI Codex

- [Codex configuration reference](https://developers.openai.com/codex/config-reference)
- [Codex multi-agent](https://developers.openai.com/codex/multi-agent)
- [AGENTS.md guide](https://developers.openai.com/codex/guides/agents-md)
- [Codex skills](https://developers.openai.com/codex/skills)

### Nguồn nội bộ đã đối chiếu

- [Deep dive nội bộ](./demonthorn-agent-orchestration-deep-dive.md)
- [Model routing guide](./model-routing.md)
- [Multi-host guide](./multi-host.md)
- [Implementation report](./implementation-report-model-routing.md)
- [Other-mindset.txt](../tai-lieu-tham-khao/Other-mindset.txt)
- [Structural anti-patterns](../tai-lieu-tham-khao/structural-antipatterns.md)
- [Codex profile guide](../tai-lieu-tham-khao/HUONG_DAN_CODEX_PROFILE_PASEO.md)
- Giáo Án Herdr - First edition.pdf
- outdate-root-for-herdr.config.toml

Hai nguồn cuối có giá trị về tư tưởng nhưng chứa khẳng định/config cũ. Chúng không nên được dùng làm đặc tả runtime nếu chưa đối chiếu tài liệu và binary hiện hành.

## 21. Phán quyết cuối

Repo hiện tại không cần bị viết lại. Nó cần được thu hẹp đúng tên và tách lớp:

- Giữ Task Brief strict, exact SHA, one-writer, event-driven notification và no-silent-fallback.
- Giữ Paseo làm control plane duy nhất.
- Giữ Pi role pack như một adapter thử nghiệm mạnh.
- Bỏ ảo tưởng rằng prompt/regex tạo ra sandbox.
- Không bắt native Codex/Claude đi qua Pi nếu không có lợi ích rõ.
- Đưa workflow định trước sang Hub.
- Chỉ thêm Supervisor/multi-host khi topology nhỏ đã có metric chứng minh.

Nếu thực hiện các bước P0 và P1, repository sẽ chuyển từ “Pi team policy có ý tưởng tốt” thành một orchestration architecture thật sự dùng được với Paseo và nhiều provider.
