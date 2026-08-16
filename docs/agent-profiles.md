# Paseo Agent Profiles — tích hợp với role packs

Tài liệu này định nghĩa cách ba active pack dùng **Agent Profiles** của Paseo
v0.4.0+ mà không làm yếu hợp đồng **no silent fallback** hoặc V3 Task Brief.
Nguồn upstream: [PR #3208](https://github.com/getpaseo/paseo/pull/3208).

## Agent Profile là route candidate, không phải role authority

Một Agent Profile là cấu hình host-local do Human quản lý:

```text
provider + model + modeId + thinkingOptionId + featureValues + notes
```

Nó không chứa system prompt, task prompt, labels, workspace/worktree, tool
allowlist hay quyền ghi. Trong các pack này, ba lớp có trách nhiệm khác nhau:

| Lớp | Trách nhiệm |
|---|---|
| Custom provider (`pi-worker`, `codex-reviewer`, …) | Chọn role home, CLI, prompt và policy enforcement |
| Agent Profile | Gợi ý cấu hình provider/model/mode/thinking/features trên một host |
| V3 Task Brief | Cấp authority cho đúng task và đúng turn |

`notes` là mô tả để Lead chọn route; nó là dữ liệu tư vấn do Human viết, không
phải instruction và không được mở rộng authority.

## Same-family routing mặc định

Lead phải ưu tiên role provider cùng family với runtime của mình:

| Lead | Worker mặc định | Reviewer mặc định |
|---|---|---|
| `pi-lead` | `pi-worker` | `pi-reviewer` |
| `claude-lead` | `claude-worker` | `claude-reviewer` |
| `codex-lead` | `codex-worker` | `codex-reviewer` |

Cross-family routing (`pi-lead` gọi `claude-reviewer`, chẳng hạn) chỉ hợp lệ khi
Human **chỉ định rõ provider family cho delegation đó**. Profile tồn tại, model
được đánh giá tốt hơn, hoặc role cùng family đang unavailable không tạo quyền
cross-family. Trong các trường hợp đó Lead phải ghi
`BLOCKED: CROSS_FAMILY_ROUTE_REQUIRES_HUMAN` và hỏi Human, không tự fallback.
Mọi cross-family `ROUTING_DECISION` phải ghi
`PROVIDER_FAMILY_AUTHORITY: HUMAN_EXPLICIT` và quote nguyên văn chỉ định family
của Human; route thông thường ghi `SAME_FAMILY_DEFAULT`.

Rule này là routing policy, không phải capability restriction: Lead vẫn có thể
thấy các provider family khác để discovery, nhưng không được chọn chúng nếu
thiếu chỉ định rõ của Human.

## Cài profile

`./install pi` và `./install claude` tự query ordered model catalog của provider
gốc (`pi` hoặc `claude`) và chọn model đầu tiên/default cùng
`defaultThinkingOptionId`. Mỗi installer merge bốn profile có namespace vào
`daemon.agentProfiles`:

```text
paseo-learn:<pack>:lead:host-default
paseo-learn:<pack>:worker:host-default
paseo-learn:<pack>:reviewer:host-default
paseo-learn:<pack>:supervisor:host-default
```

Màu được gán nhất quán theo role trên cả Pi và Claude:

| Role | Color |
|---|---|
| Lead | `blue` |
| Worker | `amber` |
| Reviewer | `violet` |
| Supervisor | `red` |

Paseo lưu **tên màu identity palette**, không nhận mã hex tùy ý. Giá trị lạ
được UI resolve thành `none`, nên installer phải dùng đúng các tên palette trên.

Tất cả profile trong một pack dùng model mặc định của host theo lựa chọn cài
đặt hiện tại; role behavior vẫn đến từ custom provider riêng. Installer cố ý
không ghi `modeId` hoặc `featureValues`, để không override mode/policy nằm trong
role home. Daemon phải đang chạy và provider gốc phải trả catalog không rỗng;
không discover được model thì installer fail trước khi ghi file.

Codex installer chưa tự tạo Agent Profiles vì Codex pack đang giữ các route
pinned riêng theo role. Có thể tạo chúng thủ công trong Paseo Desktop/Web:

```text
Settings → Host → Agents → Agent profiles → New profile
```

Có thể tạo thêm profile riêng cho từng disposition. Ví dụ:

| Name | Provider | Model | Notes |
|---|---|---|---|
| Pi Worker · Implement | `pi-worker` | exact host model | Bounded implementation; requires V3 write brief |
| Pi Reviewer · Audit | `pi-reviewer` | exact host model | Independent read-only review |
| Claude Lead · Plan | `claude-lead` | exact host model | Lead planning/recovery only |
| Codex Worker · UI | `codex-worker` | exact host model | UI implementation with V3 scope |

Profile dùng cho orchestration phải có ít nhất:

- `provider` đúng custom role provider;
- `model` đầy đủ, đúng ID daemon công bố;
- `thinkingOptionId` nếu model có thinking options;
- `modeId` và `featureValues` nếu task phụ thuộc vào chúng;
- `notes` mô tả disposition và giới hạn dùng.

Không tạo profile provider-only cho active packs: áp nó sẽ dùng model/default
preference hiện tại và phá tính quyết định của no-silent-fallback.

## Chu trình bắt buộc của Lead

Với mỗi `create_agent`:

1. Chọn role, disposition và `MODEL_CLASS` từ rủi ro của task.
2. Gọi `list_profiles` nếu tool tồn tại. Chỉ xem profile là candidate khi
   `provider` khớp role đã chọn và `model` không rỗng. `notes` chỉ dùng để đánh
   giá suitability.
3. Nếu không có profile phù hợp, chọn route từ host-local preferences như trước.
   Nếu `list_profiles` không tồn tại trên daemon cũ, ghi
   `PROFILE_CATALOG_UNAVAILABLE` rồi tiếp tục discovery; không tự đoán model.
4. Gọi `list_providers` và `list_models` để xác minh provider, exact model và
   thinking option. Profile không phải runtime evidence.
5. Nếu candidate có `modeId` hoặc `featureValues`, gọi `inspect_provider` với
   cùng draft settings để xác minh mode/feature còn hợp lệ.
6. Nếu profile stale hoặc không hợp lệ, ghi `PROFILE_REJECTED` cùng lý do. Không
   xóa field lỗi, đổi model hoặc fallback âm thầm; chọn route khác bằng một
   quyết định mới có ghi nhận.
7. Copy giá trị vào `create_agent`; không có tham số `profile`:

   ```text
   provider = "<profile.provider>/<profile.model>"
   settings.modeId = profile.modeId
   settings.thinkingOptionId = profile.thinkingOptionId
   settings.features = profile.featureValues
   ```

   Paseo tách provider string ở dấu `/` đầu tiên, nên model ID nhiều segment vẫn
   giữ nguyên.
8. Gọi `get_agent_status`; so khớp model, thinking, mode và feature values đã
   yêu cầu. Lệch hoặc thiếu evidence là `BLOCKED`, không phải pass.

Ghi quyết định theo mẫu:

```text
PROFILE_DECISION: selected | rejected | none | catalog-unavailable
PROFILE_ID:
PROFILE_REASON:
ROUTING_DECISION
TASK_ID:
DISPOSITION:
MODEL_CLASS:
PASEO_PROVIDER:
REQUESTED_MODEL:
REQUESTED_THINKING:
REQUESTED_MODE:
REQUESTED_FEATURES:
OBSERVED_PROVIDER:
OBSERVED_MODEL:
OBSERVED_THINKING:
OBSERVED_MODE:
OBSERVED_FEATURES:
WORKSPACE_REF:
AGENT_REF:
ROUTING_EVIDENCE:
```

## MCP behavior

`list_profiles` là read-only và trả danh sách host-wide. Lead của ba active pack
có full agent-scoped Paseo MCP nên dùng được tool này trên Paseo v0.4.0+.
Worker/Reviewer không nhận Paseo MCP. Supervisor vẫn giữ allowlist monitoring /
recovery tối thiểu và không nhận `list_profiles`; recovery route của Supervisor
vẫn phải đến từ protocol/brief đã được Human phê duyệt.

Profile không phải trạng thái được chọn: Paseo materialize các field rồi quên
profile. Không có default profile hoặc drift tracking. Vì vậy Lead luôn xác minh
catalog trước và runtime sau khi tạo agent.

## Persistence và installer

Profiles nằm ở `daemon.agentProfiles` và được patch theo **whole-list
replacement**. Pi/Claude installers thực hiện read-modify-write toàn bộ list:

- giữ nguyên thứ tự và nội dung mọi profile không thuộc managed IDs;
- append managed profiles còn thiếu;
- chấp nhận managed profile đã giống manifest;
- fail closed nếu managed profile đã bị sửa;
- chỉ thay managed profile khác biệt khi chạy `--force`.

Vì model catalog có thể đổi, một lần cài lại có thể phát hiện default model mới
và dừng ở conflict. Review thay đổi rồi chạy `./install <pack> --force` nếu muốn
nâng bốn managed profiles lên default mới. Human-owned profiles không bao giờ bị
`--force` thay thế.

Để test/offline hoặc pin một default đã biết mà không query daemon, có thể truyền:

```bash
PASEO_PI_AGENT_PROFILE_DEFAULT_JSON='{"model":"provider/model","thinkingOptionId":"high"}' \
  ./install pi

PASEO_CLAUDE_AGENT_PROFILE_DEFAULT_JSON='{"model":"claude-opus-5","thinkingOptionId":"high"}' \
  ./install claude
```

Giá trị override vẫn phải có exact `model`; installer từ chối provider-only
profile. Sau khi cài, restart/refresh daemon khi các agent đang chạy đã an toàn.

## Áp profile vào running agent

UI chỉ hiện profile cùng provider với running agent; provider process không thể
đổi. Daemon áp bundle theo thứ tự:

```text
model → mode → thinking → features
```

Bundle không transactional: lỗi ở bước sau giữ nguyên các bước đã áp trước đó.
Tránh để nhiều client đồng thời áp profile khác nhau lên cùng agent. Luồng
orchestration của các pack không cần áp profile lên running agent; nó đọc profile
trước `create_agent` và truyền exact settings ngay khi tạo.
