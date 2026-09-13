# Chat in DaVinci — Handoff

Date: 2026-09-13
Status: Agent-native synthetic-system reset complete in design docs: COS owns ChatGPT/Session/Goal/Worker runtime; CID owns final Codex-style presentation, Workspace/Resolve binding, semantic Capability/Artifact system, safety and single Resolve authority; Samuel-derived implementation remains subordinate

## 当前任务与最新用户目标

继续本地项目 `chat-in-davinci`。用户当前进一步把目标提高为：不要把项目看成 Chat、工具、页面、安全模块的集合，而要把它概念化为一个对 Agent 最大限度直观、连贯、可读、低上下文成本、可持续增生能力的合成 SYSTEM。Agent 应像坐在驾驶座上一样，以最低重复探测/上下文/用户打断成本理解局势、选择最优动作、精确控制 Resolve，并用证据而不是模型自述判断完成。

现有源码已经完成统一 `ToolKernel / CallContext` + `ResolveScheduler`、CID-owned durable Chat/Session migration baseline、World Model/Context Compiler 等基础工作。最终主从关系已经冻结：不再继续把 COS 生命周期逐块复制进 CID；COS 负责 ChatGPT Web / Conversation / Session / Goal / Loop / Finish / Compact & Resume / Prime-Worker runtime，CID 负责最终桌面 renderer、Workspace/Resolve Project identity、DaVinci semantic/control system 和单一 Resolve authority。

UI 最终方向是 CID-owned Codex-style 三栏：左侧 Workspace/Session Sidebar（CID Workspace 下挂 COS Sessions/Workers）、中间 Codex-style Conversation（数据/生命周期来自 COS）、右侧四层 Resolve Artifact Workspace：Context / Active Artifact / Changes·Plan / Evidence·Inspector。Project / Media / Edit / Fusion / Color / Fairlight / Deliver 是 capability domain/lens，不是七个独立 page/state owner。

深度调研和文档设计之后，用户要求实现。当前第一条真实 read-only System Spine 已接入生产代码：COS browser companion -> exact Conversation/Session/Goal/active Turn -> CID Workspace <-> Resolve Project -> SituationFrame -> DecisionFrame -> state-bound ActionOffer -> 单一 ToolKernel/ResolveScheduler/ResolveBroker reader -> World Model EvidenceRef/SemanticDelta -> CompletionReport -> COS session_finish。旧 CID Session/TurnRunner 创建/执行/compact IPC 已 fail-close，只保留迁移历史读取；Resolve writer 权限模型未放宽。

COS manual Compact & Resume 也已经物理接入：source/destination Send checkpoint、handoff token、successor command、exact destination identity、durable Session rebind、Prime transfer 与 crash recovery 都由 COS host seam 持有。旧 source conversation 只保留历史 alias，不能继续写 Session/Goal、调用 session_finish、agents 或 protected Resolve RPC。

旧规划顺序不再是硬性队列。执行优先级是：当前用户指令 > exact current 源码和 Resolve 行为证据 > 已合理开始的工作 > 旧 milestone 顺序。

## 新产品架构

三套技术职责必须保持清楚：

```text
Chat On Steroids
  -> ChatGPT Web / Conversation / Session runtime
  -> durable turn/input
  -> model / Agent orchestration
  -> Goal / Loop / Finish
  -> Compact & Resume / continuation
  -> Prime / Worker / inbox / sleep-revive semantics

Chat in DaVinci
  -> final Codex-style Sidebar / Conversation renderer projection
  -> CID Workspace identity <-> one Resolve Project binding
  -> four-layer Resolve Artifact Workspace
  -> CID Tunnel / MCP Gateway
  -> SituationFrame / SharedFocus / DecisionFrame / Context Compiler
  -> Resolve World Model / EvidenceRef / EntityRef / Analysis Store
  -> Capability Ledger / Action Catalog / implementation router
  -> unified ToolKernel / CallContext
  -> immutable Plan/hash + Goal/Plan-grouped ChangeSet + exact local approval
  -> durable execution ledger / CompletionReport
  -> verification / recovery / provenance
  -> ResolveScheduler / one Active Resolve Target / one Resolve authority

samuelgursky/davinci-resolve-mcp
  -> third-party MIT capability implementation source built on Blackmagic official Scripting API
  -> Resolve API truth / runtime quirks
  -> Project / Media / Edit / Fusion / Color / Fairlight / Deliver kernel semantics
  -> page locking / readback / operation result / versioning / render experience

Blackmagic official Scripting API
  -> primary live Resolve capability floor
```

`AGENT_SYSTEM_SPEC.md` 现在是系统层的最高设计规范。核心抽象塔：

```text
GoalFrame / TaskGraph
  -> SituationFrame / SharedFocus / completion gap
  -> Context Compiler -> DecisionFrame / ContextPack
  -> Capability Frontier -> ActionOffer
  -> COS Agent Control Loop
  -> ToolKernel -> immutable Plan / ChangeSet when mutable
  -> ResolveScheduler -> one Active Resolve Target / one authority
  -> best-qualified sealed implementation
  -> DaVinci Resolve
  -> Evidence -> ActionResult -> actual SemanticDelta -> update ChangeSet
  -> Resolve World Model -> CompletionReport
  -> next SituationFrame / DecisionFrame
```

UI 不再被当作另一层 truth。它是同一系统的 human projection：

```text
Codex-style Workspace/Session Sidebar | Codex-style Conversation | Resolve Artifact Workspace
                                      |                          | Context
                                      |                          | Active Artifact
                                      |                          | Changes / Plan
                                      |                          | Evidence / Inspector
```

Chat、Artifact、Plan、ChangeSet、Job、Approval、Activity 必须通过同一 `WorkspaceRef` / `EntityRef` / `EvidenceRef` / plan / execution identity 相互链接。人和 Agent 不是同步两份状态，而是在同一 semantic graph 上导航。

### Agent-native canonical abstractions

- `EntityRef`: semantic object identity + readable short handle + exact local ID/parent/generation binding. Handle 只为可读/省 token，不是授权；stale/ambiguous 必须 fail closed。
- `EvidenceRef`: fact 的来源、时间、generation、qualification、method/artifact/limitations；raw payload 通常留在本地，通过 reference 按需读取。
- `Resolve World Model`: demand-driven typed partial graph，不是 whole-project mirror，也不是持续 crawler；由现有 readers/actions/verification 更新。
- `SituationFrame`: Agent 的低成本“本体感觉”，包含 Workspace/Active Resolve Target、project/timeline/page、SharedFocus、重要 delta、active goal/task/plan、completion gap、blockers/unknowns、Capability Frontier、freshness/in-flight state。
- `SharedFocus`: 人和 Agent 对“这个 clip/这个 timeline/这里”的共同指向；context only，不是 authorization。
- `ActionDescriptor`: 稳定 semantic action contract；具体 provider/script/MCP 实现单独 versioned。Agent 每次实际看到的是 state-bound `ActionOffer`：已绑定目标、applicability、它解决哪个 criterion/gap、预期 ChangeSet、验证、risk/cost。`status/inspect/plan/execute` 只是 transport/control verbs。
- `GoalFrame`: original request、desired outcome、hard constraints、preferences/non-goals、completion criteria、required evidence、decisions/corrections/open obligations。Original user request remains authoritative；derived summaries 不能静默缩窄。
- `DecisionFrame`: Context Compiler 为一个具体 decision/gap 派生的 model-visible frame；明确 decision kind、uncertainty/completion gap、必要事实/证据、stale dependencies、ActionOffers、budget/provenance；不是第二个 truth owner。
- `ChangeSet`: Goal/Plan 级 semantic transition identity，贯穿 proposed/approved/dispatched/observed/verified|partial|contradicted|ambiguous；记录 expected vs actual delta、invalidations、evidence、Goal criterion impact。
- `CompletionReport`: CID 从 GoalFrame criteria + current evidence 派生的 criterion-level completion assessment；COS 仍独占 Finish lifecycle。
- `ExecutionTrace`: session -> task -> turn -> decision -> action -> plan -> approval -> dispatch -> verification，并记录 token/tool/Resolve-call/latency 等资源指标。
- `Capability Pack`: 新能力的完整 vertical contract；stable semantic capability ID、entity/observation、primitive+workflow ActionDescriptor、versioned implementation、Resolve-build qualification、Context/Capability Frontier、invalidation、Artifact projection、Plan/ChangeSet、verification/recovery/evals/provenance 一起增加。孤立 API wrapper 不能成为 production capability。
- `Capability Ledger`: `CAPABILITY_LEDGER.md` breadth-first 记录所有已知 production/qualified/implemented/experimental/planned/unsupported/intentionally_excluded/api_gap/ui_automation_candidate，确保没有 silent gap；Agent 只看到当前 Capability Frontier。
- `AnalysisArtifact/Job`: Workspace-owned、content-addressed 可复用分析（fingerprint + analysis type + model/algorithm version + params），可跨 Session；read-only local Job 可恢复，write authority 不跨 restart/reconnect 自动恢复。
- future `WorkPacket`: Worker 只收到 bounded goal slice + relevant SituationFrame/entities + capability subset + required evidence + resource/authority budget。

目标调用链现在明确为 COS 在上、CID 在下：

```text
COS ChatGPT / Session / Goal / Prime-Worker runtime
  -> CID Workspace + COS GoalFrame + CID SituationFrame
  -> DecisionFrame / Capability Frontier
  -> one CID Tunnel / MCP Gateway
  -> ToolKernel / immutable Plan / ChangeSet / Evidence
  -> ResolveScheduler / one Active Resolve Target / ResolveBroker
  -> best-qualified sealed implementation
  -> DaVinci Resolve
  -> Evidence / ActionResult / actual SemanticDelta -> update ChangeSet
  -> World Model / CompletionReport
```

不要让 COS 的通用 filesystem/terminal/Desktop 编码权限绕过 CID 的 DaVinci 安全边界。

`samuelgursky/davinci-resolve-mcp` 不是 Blackmagic 官方 MCP。目标是把其有价值的 capability/kernel 实现接到 CID authority 下面；不要让它成为第二个 Resolve session owner，也不要把数百 granular tools 直接暴露给 COS Agent。

## 一个 Resolve authority

这是硬约束。

当前已经新增 `src/main/resolve-scheduler.ts`。`connection.ts` 用一个 module-level `ResolveScheduler` 包住原有唯一 `ResolveBroker`，WorkflowEngine、ResolveGateway、Protected MCP、local UI inspection 和 Raw 实际 Resolve 调用都共享这个 scheduler。

当前 scheduler 对进入它的实际 Resolve calls 做统一串行。它同时提供 `runExclusive()`，用于未来真正需要跨多个调用保持 page/current-state 租约的 action。现阶段没有为了“证明接口”而扩大任何 workflow。

未来至少以下 stateful action 应在需要时使用同一个调度/租约边界：

```text
page-changing operations
current-project/current-timeline/current-page-dependent operations
all protected mutations
render state transitions
page-sensitive Fusion / Color operations
```

Workers 可以并行分析、本地读文件、生成候选计划。Workers 不能持有 raw `ResolveBroker`，不能自己启动 Resolve session，也不能直接 mutation。多个 Agent 可以同时想，Resolve 只有一双手。

`src/main/tool-kernel.ts` 现在是统一 protected action 入口：

```text
local UI inspection ----\
protected MCP -----------+-> ToolKernel -> existing callWorkflowTool / registry -> ResolveScheduler
Agent -------------------/
```

Local UI 不再直接调用 `inspectWorkflow()`。Protected MCP 也通过同一个 ToolKernel。Raw 仍保留 Blackmagic 官方 schema/边界，但实际 `tools/call` 也经过同一个 scheduler，避免与 Protected/UI 竞争 Resolve。

## Protected / Raw 边界

Protected 模型可见 surface 当前保持六个：

```text
status
inspect
inspect_operation
audit
plan
execute
```

未来即使内部有大量 domain actions，也优先保持少量稳定外部工具：

```text
Agent / ChatGPT
  -> small protected public surface
  -> ToolKernel / Action Catalog
  -> internal registered domain actions
  -> CID Safety Plane
```

Protected 不公开：

```text
run_script
run_script_unsafe
arbitrary Python
arbitrary shell
```

Raw 仍是独立高级 surface，忠实代理 Blackmagic 官方工具，不能把 Protected 的审批/恢复保证暗示给 Raw。

## 执行安全不可回退

现有 CID safety plane 比 COS 通用 permission 和 Samuel caller-supplied confirm 更适合作为 Resolve mutation authority，继续复用，不另造第二套：

```text
registered writer
-> exact live target/fingerprint
-> immutable plan + canonical hash
-> local app approval bound to exact hash
-> revalidation
-> required backup/version if applicable
-> execution_prepared
-> durable dispatch_started + flush
-> one mutation dispatch
-> readback / structural / render / file verification
-> durable terminal evidence
```

`dispatch_started` 后如果发生不确定 transport failure，结果是 ambiguous，不自动 replay。重启恢复时也不能重放可能已经发生的 mutation。

不要使用 caller-provided `confirm`, `allow_render` 或 generic `dry_run` 作为用户批准。Samuel 曾经出现过 dry-run 标志下仍 mutation 的安全问题，CID 继续以本机 exact plan-hash approval 为准。

结构性 timeline mutation 在进入大规模 writer 前需要 Timeline Version Protection：

```text
DuplicateTimeline / archive
-> read back exact backup identity
-> persist backup identity in ledger
-> only then dispatch structural mutation
```

required backup 失败则 fail closed。名称用 Version/Backup，不承诺 universal Undo。

2026-09-13 已在 Resolve Studio 21.1 disposable project `test`
(`1c1ec3b1-c087-4e9f-864b-ee6f51e24f85`) 对 clean baseline timeline
`CID Marker Qualification Restored` (`de561b0e-3a89-47dc-ae7d-1aaec29dc72e`) 完成真实资格验证：
`DuplicateTimeline` 返回独立 ID `357dea4a-843c-48e9-90ba-1f57df684cf8`，Resolve 会把 current timeline
切到 duplicate；`SetCurrentTimeline(original)` 返回 true 且 exact ID 回读恢复 original；source timeline
结构快照前后完全一致；duplicate 保留在 disposable project。原先打开的用户 project/timeline 也已恢复。
源码侧已经有 durable `backup_started -> verified backup_created` 边界以及 `required_backup` dispatch gate；
Timeline Version Protection 仍是 non-public internal primitive；现在由已注册的 `edit.track_add.v1` 在 public
`execute(planId)` 内部强制调用。调用方不能单独请求任意 timeline duplicate，也不能绕过 backup gate。

所有 mutation 另有共享 Resolve authority epoch fence：disconnect 一进入就同步使当前 epoch 失效；Class C backup、
marker writer、track-add writer 在 durable start boundary 落盘后、真正 broker mutation call 前再次比对同一 epoch。
若期间 authority 丢失，则持久记录 `backup_cancelled` / `execution_cancelled`（`writer_dispatched=false`），不调用
Resolve writer，也不自动重试。新 epoch 只在新的 product Tunnel 完整建立或本地 Agent gateway 建立后开启。

第一条 structural writer 已注册为 protected workflow `edit.track_add.v1`，只允许 append 一个空 VIDEO track。
没有新增 public tool，仍只有原来的六个 protected Resolve verbs；现有 `plan()` 新增这一条 workflow contract，
现有 `execute(planId)` 只消费 durable planId。renderer 只负责本机 exact-plan Approve/Reject，不提供绕过 Plan 的写按钮。

Agent 侧目前不是“所有注册 writer 都自动可规划”。System Spine 只认 exact active turn 对应的当前 user message；
历史 Goal/objective 不能延续写授权。当前 mutation-planning allowlist 只有 `edit.track_add.v1`，并且必须是当前
用户明确要求 add/create/append VIDEO track 的措辞；`plan()` 还会经过当前 applicable ActionOffer + exact
workflowId/`current_timeline + video + append` 参数绑定。`edit.review_marker_add.v1` 虽然仍是 public protected
writer，但 Agent planning 暂时保持 blocked，因为它的 SharedFocus semantic item 尚未封进 public Plan target。
本地 approval 只授予 exact Plan authority，本身绝不执行 writer。

authority-loss 最新规则：connection disconnect 一开始即同步 invalidate workflow authority epoch，新 gateway/
Agent kernel 建立后才 establish 新 epoch。Class C backup、marker writer、track writer 都在 durable start fence 后、
真正外部 mutation call 前做最后一次 epoch check。若此时 authority 已变化，记录 durable `backup_cancelled` 或
`execution_cancelled`（`writer_dispatched=false`），清 approval，且 restart 后不可 retry；对应 race regression
明确断言 DuplicateTimeline/AddTrack/AddMarker 调用次数均为 0。
System Spine 只有在当前用户输入明确要求 mutation 时才允许生成 mutation Plan ActionOffer；这只开放 planning，
不授予 local approval，也不绕过 `execute(planId)`、Class C backup 或 authority fence。
Plan 绑定完整 bounded structural fingerprint；approval 后必须先有 verified Class C timeline backup；真正
`AddTrack("video")` 前固定脚本再次重算 exact fingerprint 以拦截 revalidation 与 dispatch 之间的 human edit；
readback 只在 video track count 恰好 +1、总 track count 恰好 +1、item count 不变、新轨为空、移除新轨后
其余结构 fingerprint 完全等于原 Plan 时才 `verified`。transport ambiguous 不自动 readback 猜测或 retry。

2026-09-13 已完成 Resolve Studio 21.1 disposable live qualification：在 project `test`
(`1c1ec3b1-c087-4e9f-864b-ee6f51e24f85`) / clean baseline timeline `CID Marker Qualification Restored`
(`de561b0e-3a89-47dc-ae7d-1aaec29dc72e`) 上，TypeScript 与 writer Python 对同一 bounded structure 计算出
完全相同的 SHA-256 fingerprint；writer-side precondition=true；`AddTrack("video")` 成功从 V1 增到 V2；
structural readback 验证 V2 存在且为空；qualification cleanup 删除 V2 后，source timeline structural fingerprint
精确恢复；原用户 project `main_1 (Copy)` (`81746ff7-69d0-4781-936f-e599604269db`) / timeline
`0290bb47-136b-426d-8216-da8bd4c1b66a` exact restore。Class C qualification backup 保留为
`cf536692-276d-41b8-969d-0a4c2bd9a916`。当前 public protected contract 已注册；`execute(planId)` 会在 local approval
之后先创建/验证 mandatory Class C timeline backup，再进入 fixed writer。仍不开放 indexed AddTrack、AUDIO/subtype、
DeleteTrack 或 generic run_script writer。package/release 仍是后续独立 gate。

验证等级继续区分：

```text
API_READBACK
STRUCTURAL_READBACK
RENDER_VERIFIED
AUDIO_VERIFIED
DELIVERABLE_VERIFIED
```

API readback 不能自动证明 pixels、audio quality 或 produced file 正确；音频结果需要 `AUDIO_VERIFIED` 级别的 bounced/rendered audio 或声明过的确定性 audio-analysis evidence。

## Resolve capability tiers

Blackmagic public Scripting API 无法覆盖 100% Resolve UI。产品目标不能写成虚假的 100% API parity。

```text
A. Official Scripting API
   主 live 操作层

B. Resolve UI Automation
   proven API hard gap 的显式 fallback

C. Offline Adapter
   DRP / DRT / DRX / project-data / deterministic conform 等高权限隔离能力

D. Analysis / Verification
   FFprobe / FFmpeg / transcription / frame extraction / vision / image QC / audio QC / deliverable QC
```

B/C 不能静默 fallback。它们需要单独的权限、threat model、approval/recovery 和 provenance。

## 最终 domain 目标

### Project

create/open/save/close、settings、import/export、archive/restore、project/timeline lifecycle、safe database capability、provenance。

### Media

ingest、bin/folder organization、metadata、relink/unlink、proxy/full-resolution link、sync/multicam prep、transcription/analysis、source-safe media intelligence。

### Edit

timeline create/duplicate/version、insert/move/copy/delete/ripple、range workflows、transitions、retime、titles/subtitles、conform、multicam、sync、lineage/provenance。

如果官方 API 没有真实 razor/split primitive，不能用 whole-clip replacement 冒充精准 split。

### Fusion

composition create/delete、Tool add/delete、validated SetInput、connections、expressions、keyframes、masks、approved templates/groups，以及需要时的 rendered-frame verification。

### Color

grade versions、CDL、LUT/DCTL、DRX/look、grade copy/match、Color Groups、Gallery/still where qualified、Base Tree、rendered-frame verification。

### Fairlight

qualified property writes、Voice Isolation、sync、transcription、subtitle、approved presets、loudness/audio QC。Blackmagic public API 对完整 automation/plugin graph/bus routing 的缺口必须诚实保留；不能把 offline project-data mutation 隐藏成普通 Workflow fallback。

### Deliver

```text
render intent
-> settings plan
-> local approval
-> set settings
-> add job
-> start/monitor
-> locate produced file
-> file QC
-> DELIVERABLE_VERIFIED
```

“render completed” 不等于 “deliverable verified”。

## 当前源码真值

Repository：本地 `chat-in-davinci`，branch `main`，`No commits yet on main`。工作树 intentionally dirty/untracked。不要 `git clean` / `git reset` / 删除未跟踪文件。

Resolve：DaVinci Resolve Studio 21.1。

当前 live architecture：

```text
Raw tunnel
Workflow tunnel
    -> one local gateway
    -> one ResolveBroker
    -> one Blackmagic ResolveMCP child/session
    -> Resolve
```

Blackmagic official ResolveMCP 当前 Raw surface：14 tools。

Workflow public surface：6 tools。

Workflow runtime registry：24 read-only definitions + 1 writer。

Resolve capability registry：20 entries。

Exact read-only runtime set：

```text
system.connection_status.v1
system.capability_snapshot.v1
project.identity.v1
project.settings_summary.v1
media.inventory_summary.v1
media.clip_inspect.v1
media.link_status.v1
edit.timeline_summary.v1
edit.structure_inspect.v1
edit.gaps_overlaps.v1
edit.source_range_report.v1
edit.transition_inspect.v1
edit.review_annotations_inspect.v1
fusion.composition_inspect.v1
fusion.graph_inspect.v1
color.pipeline_inspect.v1
color.graph_inventory.v1
color.grade_version_inspect.v1
fairlight.mapping_inspect.v1
fairlight.clip_processing_inspect.v1
deliver.capability_matrix.v1
deliver.settings_inspect.v1
project.preflight.v1
activity.audit_recent.v1
```

Sole protected writer：

```text
edit.review_marker_add.v1
risk: low
blast_radius: item
approval: local_required
preview: derived_plan
recovery: B
verification: API_READBACK
qualified Resolve: 21.1
```

`fusion.graph_inspect.v1` exact source verification metadata is `API_READBACK`. `WORKFLOW_CATALOG.md` has been aligned to that source truth during the 2026-09-10 planning reset.

## Current implemented domain baseline

Project:
- identity
- settings summary
- project preflight

Media:
- `media.inventory_summary.v1`
- `media.clip_inspect.v1`
- `media.link_status.v1`

Edit:
- `edit.timeline_summary.v1`
- `edit.structure_inspect.v1`
- `edit.gaps_overlaps.v1`
- `edit.source_range_report.v1`
- `edit.transition_inspect.v1`
- `edit.review_annotations_inspect.v1`

Fusion:
- `fusion.composition_inspect.v1`
- `fusion.graph_inspect.v1`

Color:
- `color.pipeline_inspect.v1`
- `color.graph_inventory.v1`
- `color.grade_version_inspect.v1`
- graph coverage includes Timeline graph, configured Node Stack Layers, Color Group pre and post

Fairlight:
- `fairlight.mapping_inspect.v1`
- `fairlight.clip_processing_inspect.v1`

Deliver:
- `deliver.capability_matrix.v1`
- `deliver.settings_inspect.v1`
- delivery readiness through `project.preflight.v1 profile=delivery`
- capability matrix includes current format/codec `GetRenderResolutions(format, codec)`, render preset names and Quick Export preset names

## Known ResolveMCP getter behavior

Blackmagic ResolveMCP 21.1 has intermittently returned exactly:

```json
{"error":""}
```

from unrelated getter-only scripts. Current protected read-only script path retries this exact empty error once. Non-empty errors fail immediately. Plan/writer/recovery dispatch is excluded from this retry so mutation remains no-auto-replay.

## Disposable qualification fixtures

Stable project:

```text
project: test
project ID: 1c1ec3b1-c087-4e9f-864b-ee6f51e24f85
```

Clean baseline timeline:

```text
CID Marker Qualification Restored
ID de561b0e-3a89-47dc-ae7d-1aaec29dc72e
```

V1:

```text
ID 3ae6bdfb-6b71-41df-a18c-3e75f73a3b52
name BMX 4_S-Log3 (S-Gamut3.Cine).mov
record/source getter values 0 -> 22
duration 22
```

A1:

```text
ID aa0bb325-0a56-407a-a110-32b510af99fa
same MediaPoolItem
record/source getter values 0 -> 22
duration 22
```

MediaPoolItem:

```text
c8cdb35a-4b7e-4181-8dd9-444534881495
```

Dedicated Fusion positive fixture:

```text
timeline Fusion Graph Qualification
ID 9ea2559b-efee-4b8a-bdc8-09f08d342f60
V1 569a9667-6af2-4de8-804d-0fec0d7006b4
retains Composition 1
```

Dedicated Color positive fixture:

```text
project CID Color Node Stack Qualification
project ID 89cca32a-55a0-4014-90cc-4d78a7339a60
timeline Node Stack Qualification
ID 628b1e44-a8d7-4da1-9c6a-252e702fa627
nodeStackLayers = 2
Color Group CID Group Qualification
```

Historical timeline `CID Marker Qualification` (`8b4e5d01-b547-424b-8682-4b62b9035ce4`) was mutated during earlier qualification and is not a clean fixture.

## Latest validation after Milestone 10 foundation

```text
npm run verify
  20 ordinary test files passed
  3 live files skipped
  70 tests passed
  3 skipped
  UI policy 13/13
  interaction 9/9
  concurrency 4/4
  build PASS

git diff --check
  PASS

No live Resolve test was run for Milestone 10.
```

The previous real gateway acceptance remains the latest live evidence:

```text
CID_LIVE_RESOLVE_GATEWAY=1 npm run test:gateway:live
  1/1 PASS before this foundation change
```

Current source invariants remain:

```text
Raw = 14 official tools
Workflow = 6 protected public tools
capability registry = 20
workflow registry = 24 read-only + 1 writer
```

Do not rerun live Resolve merely for Markdown changes.

## External and local gaps

- The old second-Workflow-Tunnel acceptance gap is superseded. The target product uses one CID Tunnel into one CID MCP Gateway; protected vs raw remains an internal policy boundary.
- The current CID OpenAI Responses `ModelProvider`/TurnRunner remains in source as migration baseline only. The target upper Agent runtime is COS.
- Actual Resolve calls entering CID go through the shared `ResolveScheduler`; future page-sensitive multi-call operations may use its `runExclusive()` lease boundary when a concrete action requires it.
- Agent System Spine is now implemented in production source under COS Session/Goal ownership: generation-scoped EntityRef/EvidenceRef World Model, SituationFrame, SharedFocus, typed DecisionFrame, semantic ActionOffer routing, SemanticDelta, bounded ContextPack and criterion-level CompletionReport are wired through exact COS Session/active-turn attribution into the single CID ToolKernel/Scheduler/Broker path. The model-visible protected path is context-first: the first exact request receives bounded `CID_DECISION_CONTEXT` plus an opaque Session/Turn/context-bound `decisionContextToken` and does not dispatch Resolve; only a new exact request that echoes that one-shot receipt can enter ToolKernel. Receipt admission synchronously transitions `ready -> inflight` before any Resolve await, so the same token cannot authorize two concurrent dispatches. Every context-only exact request is durably tombstoned in the COS Session before its response, so cache eviction/restart cannot turn a replay into execution. Parallel pre-context requests, stale-turn/context tokens and post-restart tokens fail closed. The receipt is freshness evidence only, never approval, and is stripped before ToolKernel/Session argument recording.
- CID Workspace identity is durable and keyed to stable Resolve Project identity. Project rename keeps the Workspace; cross-project Session reuse is a mismatch; Resolve-offline state blocks Resolve-dependent ActionOffers while preserving cached evidence as read-only context.
- Product protected RPC requires exact browser `request_id -> conversation -> Session -> turn -> message` evidence, consistent tool identity where present, and that exact correlated turn must still be the current active COS turn. Superseded Compact source chats fail closed. Worker mutation authority is denied for active, dormant and still-retired Worker conversations. Raw/filesystem/terminal/Desktop/plugin capabilities remain outside the product connector.
- Completion requires current generation + World Model semantic provenance/invalidation currentness + exact workflow + exact semantic target handle + exact semantic parameter binding + exact verification category. Workspace `fresh/stale/offline` remains a broad UX/situation signal, not a Completion evidence epoch. Model prose/summary never counts as evidence. `finish_check` is derived only from criterion-level CompletionReport; unrelated observations cannot revive an invalidated semantic slice.
- Browser companion authority is durable: pairing rotation is serialized, command ledger mutation is globally serialized, fresh Worker leasing is atomic, revival claim/ACK is exact-command fenced, and revival final-answer completion is fenced to the current wake epoch.
- COS Goal/Loop browser transport is physically hosted by the canonical COS-derived Goal/Loop authority plus canonical decision-input/browser-helper transport: `/goal/draft`, `/goal/ack`, `/goal/open` and objective/settings/input routes share that authority. Missing helper/provider availability fails closed; Goal STOP requires an explicit complete CID CompletionReport, missing evidence holds, and Loop never self-stops.
- Cockpit/System-Spine projection is keyed by exact Session + active Turn; historical `session` search/read does not replace current projection, and Compact successor projection moves only after the successor's real turn exists.
- The Context Compiler/resource trace baseline is implemented, but representative real-model/live-Resolve ACI task evaluation still requires explicit authorization to spend API quota/run live validation.
- Current CID Chat/domain UI remains a migration baseline. The renderer now exposes only a presentation projection of Workspace/Decision/ActionOffer/Completion and disables legacy CID New Chat/Send ownership. The remaining UI target is the fuller CID-owned Codex-style Workspace/Session Sidebar + Conversation backed by COS runtime, plus four-layer Resolve Artifact Workspace.
- Blackmagic public scripting has hard gaps, including truthful full razor/split parity and incomplete Fairlight automation/plugin/bus control. Report these as capability gaps unless an explicit approved fallback tier exists.
- Formal installed app may lag current source during rapid development. Do not overwrite/install it unless the user asks.

## 2026-09-11 architecture reset / 2026-09-12 system-and-ledger consolidation

Planning/spec documents were updated to make the Agent Workbench direction active:

```text
AGENTS.md
AGENT_SYSTEM_SPEC.md
ARCHITECTURE_PLAN.md
PRODUCT_SPEC.md
WORKSPACE_SPEC.md
IMPLEMENTATION_PLAN.md
EXECUTION_SECURITY_SPEC.md
CAPABILITY_LEDGER.md
WORKFLOW_CATALOG.md
UI_SPEC.md
README.md
HANDOFF.md
```

Key changes:

- old “agents / Goal / Loop are non-goals” policy removed;
- COS is now the upper ChatGPT/Session/Goal/Prime-Worker runtime foundation; CID owns final renderer/Workspace/Artifact presentation rather than copying COS visual ownership;
- CID remains owner of Tunnel/MCP Gateway, World Model/Context Compiler, ToolKernel, plan/approval/evidence/verification and Resolve authority;
- Samuel is now a subordinate capability/kernel implementation source beneath CID, not a second live authority;
- unified ToolKernel / CallContext and ResolveScheduler made prerequisites for Agent/Workers;
- full Project/Media/Edit/Fusion/Color/Fairlight/Deliver Agent coverage made product target;
- Timeline Version Protection made prerequisite for structural writes;
- explicit Official API / UI Automation / Offline Adapter / Analysis tiers defined;
- current runtime counts and sole writer preserved;
- `fusion.graph_inspect.v1` catalog verification aligned to exact source `API_READBACK`;
- `AGENT_SYSTEM_SPEC.md` now defines the Agent-native closed abstraction/control loop, optimization order, WorkspaceRef, World Model, SituationFrame, DecisionFrame, Capability Frontier/ActionOffer, ChangeSet, CompletionReport, Capability Packs, WorkPackets, shared cockpit and task-level ACI evaluation strategy;
- capability growth is breadth-first in the no-silent-gap Capability Ledger and depth-first through complete vertical Capability Packs; stable semantic IDs survive versioned implementations;
- model-visible context is a per-decision DecisionFrame/ContextPack; only information that can change the next decision or completion test is admitted;
- Goal completion is criterion-level via derived CompletionReport; Executed != Verified and conversation text never proves completion;
- UI target is CID-owned Codex-style Workspace/Session Sidebar + Conversation backed by COS runtime, plus Context / Active Artifact / Changes·Plan / Evidence·Inspector on the right.

## 2026-09-10 Milestone 11 transport-independent core

本轮新增：

```text
THIRD_PARTY_NOTICES.md
src/main/durable.ts
src/shared/agent-session.ts
src/main/agent-session-store.ts
src/main/model-provider.ts
src/main/turn-runner.ts
test/turn-runner.test.ts
```

并修改：

```text
src/main/tool-kernel.ts
src/main/index.ts
```

关键行为：

- COS `durable.ts` 以 MIT provenance 方式适配，未复制 COS 113 KB `session/store.ts`、56 KB `session/input.ts`、browser transport 或 Agent broker；
- Session 使用 durable index + append-only JSONL event history；
- user turn 在调用 provider 前持久化；
- 每个 Agent tool call 的 `tool_call_intent` 在进入 ToolKernel 前写入并 `fsync`；
- provider 只看到现有六个 protected ToolKernel tools；
- Agent `CallContext` 有 `sessionId` / `turnId` / `callId` correlation，但这些字段不是授权；
- app restart 遇到没有 durable terminal event 的 running turn 时写 `turn_interrupted` 并停止，不自动重放 provider/tool call；
- 现有 marker writer 的 immutable plan/hash、本机审批、workflow ledger、dispatch ambiguity/no-replay 路径没有改；
- app bootstrap 初始化并恢复 Agent session store，shutdown flush durable state。

本轮验证：

```text
npm run verify
  21 ordinary test files passed
  3 live files skipped
  72 tests passed
  3 skipped
  UI policy 13/13
  interaction 9/9
  concurrency 4/4
  build PASS

focused TurnRunner / workflow-engine / concurrency
  3 files passed
  14 tests passed

git diff --check
  PASS
```

## 2026-09-10 Milestone 11 concrete provider + minimal Chat

本轮在上述 provider-neutral core 上新增/接通：

```text
src/main/openai-model-provider.ts
src/main/agent-chat.ts
test/openai-model-provider.test.ts
src/main/ipc.ts
src/preload/index.ts
src/renderer/index.html
src/renderer/main.ts
src/renderer/styles.css
src/renderer/i18n.ts
```

并对 `tool-kernel.ts`、`resolve-gateway.ts`、`connection.ts`、`secrets.ts` 和共享 Agent types 做最小扩展。

关键行为：

- OpenAI Responses transport 保持在 `ModelProvider` 后面，默认 `gpt-5.6`，使用 native `fetch`，没有新增运行时依赖；
- `store:false`，并请求/回传 `reasoning.encrypted_content`，CID durable Session 而不是 OpenAI response ID 继续作为会话真值；
- Responses function calling 使用现有六个 Protected tools，`parallel_tool_calls:false`；现有工具 schema 保持不变并显式 `strict:false`，没有为了 provider 改写受保护工具契约；
- 本机 Keychain 中现有标准 OpenAI API key 同时供 Tunnel 和内置 Agent 使用，没有第二套 secret store；
- Agent 可按需启动同一个本机 Resolve Gateway/ToolKernel，不要求先连接外部 ChatGPT Tunnel，也不会创建第二个 Resolve broker/session；
- Agent ToolKernel 调用经过与 Protected MCP 相同的 Gateway audit 记录路径；
- renderer 只通过固定 trusted IPC 访问 Session/turn 服务，不接触 API key、网络或 Resolve broker；
- [historical baseline] Chat UI 曾迁入三栏壳层：Sidebar 投影 durable Sessions/New Chat，中间 Conversation 持续挂载，右侧七个 domain 独立切换。该 page-centric renderer 现在仅是 migration provenance；最终 UI 是 Workspace-first Codex-style shell + contextual four-layer Artifact Workspace。旧 CID Compact & Resume baseline 同样仅属过渡实现。
- 没有执行真实 OpenAI API 请求，也没有 live Resolve Agent smoke。

本轮最终非 live 验证：

```text
npm run verify
  23 ordinary test files passed
  3 live files skipped
  79 tests passed
  3 skipped
  UI policy 13/13
  interaction 15/15
  concurrency 4/4
  build PASS
```

## 下一段代码工作

The first transport/control boundary slice has now landed at source/non-live level:

```text
one CID product Tunnel runtime
-> protected productUrl only
-> one CID MCP Gateway
-> COS control schemas: session / agents / session_finish
-> CID protected verbs: status / inspect / inspect_operation / audit / plan / execute
-> one caller-owned ResolveScheduler / ResolveBroker authority
```

Raw remains localhost-only. The real COS host is now bound behind the existing adapter: browser correlation, Session/Goal/Loop/Finish, Prime/Worker lifecycle and manual Compact & Resume are production source paths; the adapter still fails closed whenever an exact COS authority/evidence seam is unavailable. The pre-migration source snapshot is stored outside the repo at `/Users/qunqing/2026-Project-Agent/.cid-migration-baseline/2026-09-11-before-cos-host.txt` (SHA-256 `205d4afbd1720bc7bc4234b2dfec6bf9a1951abae505fc95841d0512399a9dc5`).

Artifact Workspace foundation now has one domain-lens presentation truth: Project / Media / Edit / Fusion / Color / Fairlight / Deliver bounded Inspector detail is Main-owned by `AgentWorldModel` and projected through `AgentArtifactWorkspaceProjection`; the renderer no longer owns `workflowXxx` snapshots for those domain readers. Session/Workspace plus World Model/entity generation prevent semantic-handle reuse across epochs. Exact Resolve timeline/item/render-job/tool/port/codec identities remain Main-only; renderer rows receive semantic handles or bounded display fields. Fusion / Color / Fairlight / Deliver Refresh IPC exposes only `RendererWorkflowObservationReceipt { target, schemaHash }`; raw reader payloads stay in Main. Timeline-item focus crosses the renderer boundary only as semantic handle + generation, with exact identity resolved inside Main. Four-domain Agent protected results are also projected from the canonical World Model inspector rather than exposing raw reader payloads, Deliver format/codec tokens are translated to qualified display names or omitted, and blank entity names use fixed safe labels instead of exact IDs. Artifact/lens/navigation selection performs no implicit Resolve observation; explicit Refresh/Inspect observes through the existing ToolKernel and then repaints from the canonical projection. Deliver and the default Color pipeline are identity-fenced with an existing protected Project observation before their identity-free results are admitted, preventing an external Resolve Project/Timeline switch from contaminating the old Workspace generation. Offline projection reuses the existing owners instead of creating an offline semantic store: the Workspace record durably retains the last-known Project/Timeline/generation binding, `AgentWorldModel` exposes bounded historical projection/evidence reads while `currentEvidence()` remains current-generation-only, and Plan/history comes directly from the durable workflow ledger via exact Project/Timeline scope. Cached Artifact/Evidence are `cached_projection`/read-only and never enter DecisionFrame or CompletionReport. Cached Plans are `cached_read_only`; losing Resolve authority durably revokes any unconsumed local approval while preserving Plan/history, so reconnect cannot silently restore approval or execution authority and a new approval must perform the existing exact-target revalidation.

Mutation Plan renderer boundary is now closed too: Main keeps the complete durable `WorkflowPlanProjection`; the Mutation Plan IPC/preload surface returns only `RendererWorkflowPlanProjection`. The bounded view contains `planId/workflowId/planKind/state`, risk/blast/expiry, approval/backup/verification summary, semantic target handle/label when current (safe fallback label otherwise), bounded marker/track/structural proposed-change fields and execution summary. This Plan projection does **not** contain `project_unique_id`, `timeline_unique_id`, `target_ids`, `plan_hash`, input/structure/marker fingerprints, marker `custom_data`, raw preconditions, backup exact IDs or execution exact IDs. Approve/Reject still submit only `planId`; Main performs canonical hash lookup and authority gates. `agent:focus:plan` is now timeline-item-only; structural/track Plans open the Edit lens without fabricating a TimelineItem SharedFocus. Unrelated legacy renderer/entity IPC migration debt is outside this specific closure and must not be inferred closed from this paragraph.

Third protected writer closure: `color.grade_version_create.v1` is now registered and qualified on Resolve 21.1. It accepts only one exact current SharedFocus TimelineItem plus a bounded name; LOCAL type `0` is fixed internally. The immutable Plan seals Project/Timeline/item identity, current LOCAL version, complete bounded local/remote name lists and a version-state fingerprint; writer-side code repeats those checks immediately before one `AddVersion(name, 0)`. Local exact-plan approval remains mandatory, verification is `API_READBACK`, and recovery is Class B. Disposable qualification proved exact +1 LOCAL name readback, automatic current switch, `LoadVersionByName(original, 0)` restore, `DeleteVersionByName(new, 0)` cleanup and exact baseline restoration. Load/Delete remain internal compensation only. Renderer/Artifact/public Agent projections expose only semantic item identity and the proposed version name; the fixed LOCAL type, exact IDs, lists and fingerprints stay Main-only. The Class B recovery dispatch is fenced by the same Resolve authority epoch as the primary writer: if authority changes after durable `recovery_started`, no Load/Delete mutation dispatches, the ledger records recovery unavailable, and replay preserves that terminal state. The writer does not claim node-parameter or pixel-equivalent grade backup.

The qualification one-shot source hook has been fully removed. A subsequent ordinary `npm run dev` startup replayed the existing 18-event workflow ledger and started the normal product gateway/tunnel without any new Color qualification/write event.

Current exact-current validation after writer #3: `npm test` = 36 ordinary files / 166 tests passed with 3 live files / 3 live tests skipped. UI policy 13/13, interaction 15/15, concurrency 4/4, typecheck, production build and `git diff --check` PASS. Focused Color writer tests cover protected semantic plan routing, local approval, one `AddVersion`, API readback, stale Human-edit-wins failure, authority loss before Class B compensation, capability qualification, registry policy, public version-type redaction and renderer private-state redaction. Registry is exactly 24 read-only workflows + 3 writers; public Resolve verbs remain exactly six. No package, install, commit or push was performed.

Final independent exact-current recheck after the two closing fixes is PASS: the reviewer confirmed recovery authority fencing and writer-facing `versionType/version_type` removal, with 24 readers + 3 writers and six public Resolve verbs unchanged. A subsequent ordinary dev restart replayed the same 18 durable workflow-ledger events and started the normal product gateway/tunnel without any Color qualification or writer dispatch.

The existing CID Chat/Session/Goal migration work remains useful evidence but must not be extended as a second upper runtime. COS rebasing and the first read-only System Spine closure are no longer the next task. Continue beneath the frozen ownership split:

```text
keep final renderer CID-owned and Codex-style over the completed COS runtime
-> keep the closed Artifact Workspace foundation invariants and deepen qualified lens/content coverage beneath the same projection owners
-> preserve exact Session/Turn DecisionFrame receipt gating into one ToolKernel / ResolveScheduler / ResolveBroker authority
-> keep `CAPABILITY_LEDGER.md` breadth-first inventory current + bind stable IDs to build qualification and implementation routing
-> qualify Timeline Version Protection + Human-edit-wins stale/Rebase + ChangeSet/CompletionReport
-> depth-first production packs: Project/Media/Edit -> Fusion/Color -> Fairlight/Deliver
-> add content-addressed Analysis Artifacts/Jobs only where packs consume them
-> Prime/Workers through bounded WorkPackets and same scheduler authority
-> allowlisted UI Automation / Offline Adapter / trusted plugin packs only for explicit qualified gaps
```

Optional baseline smoke, when user explicitly authorizes use of the stored API key:

```text
one short COS-hosted Agent turn
-> CID Tunnel / MCP Gateway
-> one current read-only Protected inspection
-> confirm shared Workflow audit and no Raw/direct broker access
```

The smoke should validate the System Spine/Context Compiler path, including one real DecisionFrame/ContextPack + ActionOffer set, semantic projection and turn resource trace. It still does not authorize broader writers or Workers.

A mature end-to-end acceptance scenario is a user request such as organizing documentary media, syncing it, creating about a three-minute cut, applying a technical grade, processing dialogue, generating subtitles, rendering 4K H.264, then verifying the produced file. The session should survive context compaction and application restart; all mutations retain Plan/approval/ChangeSet/version/verification provenance; final completion is criterion-level; and ACI traces expose redundant observations, model turns/tokens, Resolve calls and unnecessary user interruptions.

## Licensing

- Chat On Steroids: MIT.
- `samuelgursky/davinci-resolve-mcp`: MIT.
- Chat in DaVinci `package.json`: `UNLICENSED`.
- If substantial upstream code is copied/adapted, preserve required MIT copyright/license notices and provenance.

## Do not

- do not treat old milestone order as authority over the current user goal;
- do not start a second Samuel/Resolve live authority;
- do not expose hundreds of granular tools to the normal Agent;
- do not let COS Agent/Worker call `ResolveBroker` directly;
- do not add Workers before ToolKernel + ResolveScheduler;
- do not weaken Raw/Protected separation;
- do not expose arbitrary Python/shell through Protected;
- do not replace local exact plan-hash approval with model/caller confirmation;
- do not auto-retry a possibly dispatched mutation;
- do not promise universal rollback/Undo;
- do not claim API readback proves pixels/audio/final output;
- do not promise 100% public-Scripting-API UI parity;
- do not silently invoke UI Automation or offline project-data mutation;
- do not treat Project/Media/Edit/Fusion/Color/Fairlight/Deliver as seven independent state/page owners in the target UI;
- do not expose transport verbs and semantic capability IDs as competing Agent action vocabularies;
- do not silently reroute an approved Plan to a different implementation;
- do not let model upgrades automatically expand autonomy;
- do not auto-resume/replay write authority after restart or Resolve reconnect;
- do not run live gateway while another source preview owns Resolve;
- do not `git clean`, `git reset`, delete untracked work, package, install, commit or push unless explicitly requested.
