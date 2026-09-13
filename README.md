# Chat in DaVinci

Chat in DaVinci 是一个本地 macOS / DaVinci Resolve Studio Agent-native 认知控制系统。目标不是把 Chat、页面和 Resolve API 拼在一起，而是从 Agent 驾驶座出发，把 Goal、Situation、Decision、Capability、Plan/ChangeSet、Evidence、World Model 和 Completion 连成一个闭环，让 Agent 用尽可能少的上下文、重复探测、Resolve 调用和用户打断，持续完成 Project、Media、Edit、Fusion、Color、Fairlight、Deliver 的真实工作。

Blackmagic 官方 Scripting API 是主要 live 能力层。公开 API 确实覆盖不到的 Resolve UI 功能，只能通过明确标记的 UI Automation 或隔离 Offline Adapter 补齐，不能伪装成官方 API 已经支持。

当前项目仍处于开发阶段。CID 的 ToolKernel / CallContext、ResolveScheduler、World Model/Context Compiler 和受保护 Plan / 本机 approval / durable execute 安全链已经存在。目标架构使用 COS 作为 ChatGPT Web / Conversation / Session / Goal / Prime-Worker 运行时；CID 拥有最终 Codex-style Sidebar/Conversation 视觉投影、Workspace/Resolve Project 绑定、Resolve Artifact Workspace、Tunnel/MCP Gateway 和完整 DaVinci 语义/安全执行层。

系统级设计以 `docs/development/AGENT_SYSTEM_SPEC.md` 为准。核心不是继续增加工具数量，而是形成一座 Agent 可读的链接抽象塔：

```text
GoalFrame / TaskGraph
-> SituationFrame / SharedFocus / completion gap
-> Context Compiler -> DecisionFrame / ContextPack
-> Capability Frontier -> ActionOffer
-> COS Agent Loop
-> ToolKernel -> immutable Plan / ChangeSet
-> ResolveScheduler -> one Active Resolve Target / one authority
-> best-qualified implementation
-> DaVinci Resolve
-> Evidence -> ActionResult -> actual SemanticDelta -> update ChangeSet
-> World Model -> CompletionReport
-> next decision
```

## 1. 当前运行时与目标调用链

当前源码运行时仍以 Blackmagic 官方 `ResolveMCP` 为 live driver，但目标架构的关键约束是只有一个 CID-owned Resolve authority。COS 不直接持有 Resolve；Samuel-derived capability code 也必须运行在 CID authority 之下。

```text
COS ChatGPT / Conversation / Session / Goal / Prime-Worker runtime
                │
                ▼
COS GoalFrame + CID SituationFrame / DecisionFrame / Capability Frontier
                │
                ▼
        one CID Tunnel / MCP Gateway
                │
                ▼
     Action Catalog / ToolKernel
 Plan / Approval / ChangeSet / Evidence
                │
                ▼
ResolveScheduler / one Active Resolve Target / ResolveBroker
                │
                ▼
 best-qualified implementation
 Blackmagic official / Samuel-derived / allowed adapter
                │
                ▼
         DaVinci Resolve
                │
                ▼
SemanticDelta / World Model / CompletionReport
```

`ResolveBroker` / CID adapter 是 live Resolve authority 的唯一 owner。COS、protected Workflow、可选 Raw policy 都不能各自启动第二套 Resolve session。

Renderer 不直接访问 Resolve、文件系统、网络或 secrets。界面通过 preload 的固定 API 进入 main process，再由 main process 调用 Workflow、Gateway 和 Broker。

## 2. Raw 和 Workflow

这两个 surface 服务不同用途。

### Raw

Raw 保留 Blackmagic 官方 `ResolveMCP` 的完整工具声明和行为，供高级用户直接使用。

当前实现：

- Broker 启动官方 ResolveMCP；
- 初始化后缓存官方 `tools/list`；
- Raw gateway 原样发布这份工具声明；
- Raw 调用直接转发到同一个 Broker；
- 当前正式连接已经通过 ChatGPT 实际调用 `get_resolve_status` 验证。

Raw 包含官方提供的 `run_script` 和 `run_script_unsafe`。它不享受 Protected Workflow 的 Plan、审批、ChangeSet、恢复和验证保证，并在 Advanced Activity 中明确标为 `Unprotected`。Normal Agent 永远不把 Raw 当生产能力层。

### Workflow

Workflow 是 Chat in DaVinci 自己维护的受保护产品面。它只发布少量稳定的复合工具，让 ChatGPT 处理专业问题，而不是面对数百个底层操作。

当前公开的本地 Workflow 工具有：

```text
status
inspect
inspect_operation
audit
plan
execute
```

当前 `inspect` 支持：

```text
connection
capabilities
project
media
edit
fusion
color
fairlight
deliver
preflight
```

受保护检查通过应用内固定、版本化且有界的模板调用 Blackmagic sandboxed `run_script`。模型不能传入 Python 代码，Workflow 也不发布 `run_script` 或 `run_script_unsafe`。

当前 Workflow 登记了三个受保护 writer：`edit.review_marker_add.v1`、`edit.track_add.v1` 和 `color.grade_version_create.v1`。三者都只能经过不可变 Plan、本机批准、执行前精确身份/指纹重验证、持久 dispatch intent、一次有界写入和声明级别 readback；track-add 额外要求 Class C timeline backup，grade-version create 使用已资格化的 Class B 内部补偿。其他 mutation surface 不会因为 API 存在就自动成为 writer。旧双 tunnel 实现保留为历史代码，但目标产品路径只要求一个 CID Tunnel / MCP Gateway。

未来受保护 surface 的稳定外形计划保持很小：

```text
status
inspect
inspect_operation
plan
execute
audit
cancel       仅在操作确实可以安全取消时存在
```

这些六个名字只是 transport/control verbs，不是 Agent 的认知动作词汇。Agent 看到的是当前 DecisionFrame 下的 `ActionOffer`（稳定 semantic capability ID + 已绑定目标/前置条件/风险/验证）；具体 Resolve 能力放在 Capability Ledger / Action Catalog 后面，不为每个 API 方法创建一个模型可见工具。

## 3. 工作区

目标主界面采用 Codex-style 三栏共享驾驶舱，而不是让 Chat 和七个 Resolve domain 互相切换：

```text
Workspace / Session Sidebar | Conversation | Resolve Artifact Workspace
                            |              | Context
                            |              | Active Artifact
                            |              | Changes / Plan
                            |              | Evidence / Inspector
```

左栏由 CID 以 Codex-style 呈现，`CID Workspace <-> 一个 Resolve Project identity`，下面挂 COS durable Sessions 和可展开 Worker 活动。中栏同样是 Codex-style Conversation，但数据/生命周期来自 COS。右栏根据 Goal/SharedFocus/Agent 当前工作自动选择 Artifact；用户正在查看或 Pin 时 Agent 只能 soft-follow，不能抢走界面。Project / Media / Edit / Fusion / Color / Fairlight / Deliver 是 capability domain/lens，而不是七个独立状态页面。

右区选择对象只更新 `SharedFocus`；只有显式 `Reveal in Resolve` 或声明了该副作用的 Action 才改变 Resolve 原生 page/playhead/selection。所有直接语义控件也必须走同一个 ToolKernel / risk / Plan / ChangeSet / verification 路径。

当前源码的 migration-baseline Renderer 已完成共享驾驶舱壳层和第一轮语义导航：Media/Edit 中选择的项目写入主进程 World Model 的 SharedFocus；Conversation 显示同一语义对象和最多 3 条相关 EvidenceRef，点击后分别打开/高亮右侧对象或滚动到对应证据卡；Agent 创建的计划可从 Conversation 打开，Activity 中的计划也通过主进程按 plan ID 校验目标，再以 `source=plan` 写入同一个 SharedFocus 后打开 Edit；持久 `turn_trace` 在 Conversation 只显示“本轮详情”，完整摘要投影到 Activity。导航不授予写权限，也没有增加 Renderer 真值层。三段式壳层已通过一次不重启主进程的实际窗口视觉检查；需要真实数据的对象/证据跳转视觉验收仍待完成。

### 项目

回答当前项目是什么、当前时间线是什么、项目是否处于可信的继续工作状态。

规划内容包括：

- 项目和时间线身份；
- Project settings；
- 项目级 preflight；
- Media、Edit、Color、Fairlight、Deliver 的紧凑 readiness 摘要；
- 当前 Resolve build 暴露或缺失的能力；
- 后续版本/备份状态。

Project 只聚合其他领域的权威结果，不重复实现 Media、Timeline、Color 或 Render reader。

### 媒体

负责 Media Pool 和源素材状态。

规划内容包括：

- Bin / Folder；
- source inventory；
- offline / missing media；
- proxy / full-resolution 状态；
- FPS、resolution、codec；
- metadata 和第三方 metadata；
- source audio mapping；
- markers、flags、clip color；
- 后续 ingest、整理、relink、metadata normalization 和 source-safe analysis。

源素材默认不可修改。离线分析或 ingest helper 也不能把“读取素材”扩展成修改 camera original 的权限。

### 剪辑

负责当前 Timeline 的结构和 editorial QC。

规划内容包括：

- tracks 和 items；
- record/source ranges；
- gaps / overlaps；
- offline references；
- linked audio；
- markers 和 review annotations；
- transitions / fades；
- retime；
- titles / subtitles；
- multicam / sync readiness；
- conform readiness；
- edit plans 和 timeline version history。

高影响剪辑操作在真正开放以前必须具备 timeline version protection、计划指纹、审批、读回验证和恢复证据。

### Fusion

负责 Composition 和 graph 的检查及未来受保护的 graph 操作。

当前已经实现两项只读能力。`fusion.composition_inspect.v1` 不依赖播放头，而是有界扫描当前 Timeline 的 VIDEO items，显示精确 TimelineItem 身份、每项 Fusion composition 数量/名称和方法证据。Resolve 21.1 的零 composition fixture 会让 `GetFusionCompNameList()` 返回空 dict；只有在同一项目 `GetFusionCompCount() == 0` 时才接受这个特殊返回形状。`fusion.graph_inspect.v1` 在独立的正向 composition fixture 上完成资格化，可有界读取 composition、tool、input/output 数量和连接关系，并以稳定 API ID 表达结构。控件值、graph 写入和最终画面仍保持未验证。

规划内容包括：

- 当前或选定目标的 Fusion composition；
- tool/node inventory；
- inputs / outputs；
- graph connections；
- tool detail；
- capability limitations。

以后如果 Workflow 写入 Fusion graph，只允许受控、确定性的结构。模型任意生成 Fusion/Python 脚本不会进入受保护 surface。

API readback 只能证明 graph state。只要功能声称“画面变成了什么”，最终成功条件需要 render/frame evidence。

### 调色

负责技术色彩管线、grade structure 和验证。

当前已实现 `color.pipeline_inspect.v1`、`color.graph_inventory.v1` 和 `color.grade_version_inspect.v1`。Graph reader 通过官方 Scripting API 读取 `Project.GetSettings().nodeStackLayers`，再用 `Timeline.GetNodeGraph`、`TimelineItem.GetNodeGraph(layerIdx)`、`Project.GetColorGroupsList`、`ColorGroup.GetPreClipNodeGraph/GetPostClipNodeGraph` 和固定 Graph getter 有界读取时间线、已配置片段 Node Stack Layer 及 Color Group 前/后片段节点图。稳定 Resolve 21.1 夹具是 `1/1` 层、0 Color Group；独立 `CID Color Node Stack Qualification` 资格项目实测 `2/2` 层并保留 `CID Group Qualification`。L1/L2 与 Group pre/post 都返回非空 Graph 且各有 1 个节点。片段层 cache 返回 `-1`，Group pre/post 的 cache getter 成功返回 `null`，两种形状不会与 getter 失败混淆。所有这些值只作为 API 证据显示。受保护结果只返回是否观察到 LUT 引用，不返回 LUT 路径。

Grade-version reader 通过 `GetVersionNameList(0/1)` 和 `GetCurrentVersion()` 有界读取当前时间线视频项目。当前 V1 实测 local 和 remote 都返回 `版本 1`，当前版本也是 `版本 1`、类型为本地 `0`。同名只作为显示证据，不推断 local/remote 是同一个版本，也不推断版本顺序或名称全局唯一。

节点拓扑/连接关系、节点参数值、Color Group 版本、DCTL 身份/引用枚举、graph 写入和最终画面仍保持未验证。版本写入仅开放 exact TimelineItem 上的 LOCAL grade-version create；它不声明节点参数或像素等价。Color Group 名称和枚举顺序也不被当作稳定图身份语义。

规划内容包括：

- project / timeline color management；
- clip、group、timeline graph inventory；
- node/group structure；
- grade versions；
- LUT / DCTL references；
- technical warnings；
- 后续 CDL、DRX 和经过批准的 look 应用。

本应用不会把“自动决定创意调色”作为近期开启的受保护能力。涉及可见画面的写入需要明确的备份策略和 render evidence。

### Fairlight

负责音频结构、映射和技术检查。

当前已实现 `fairlight.mapping_inspect.v1` 与 `fairlight.clip_processing_inspect.v1`。Mapping reader 有界读取音频轨道名称/类型/启用/锁定、轨道 Voice Isolation 和紧凑源通道映射证据；Clip-processing reader 用官方 `TimelineItem.GetProperties()` 与 `GetVoiceIsolationState()` 有界读取当前音频项目的 Volume、Pan、Pitch、Voice Isolation 和 Dialogue Leveler 状态。

Resolve 21.1 稳定 A1 夹具实测 15 个白名单属性全部存在，独立 Voice Isolation getter 与属性状态一致。当前 A1 的 Volume/Pan/Pitch 为零值，Voice Isolation 与 Dialogue Leveler 关闭；这些只表示 API 当前值，不表示声音“正常”“正确”，也不代表最终音频。读取器不会返回任意属性或源路径，也不会开放 `SetProperties`、`SetVoiceIsolationState`、`NormalizeAudioLevel` 等写入。

规划内容包括：

- audio tracks 和 subtype；
- lock / enable state；
- source/channel mapping；
- voice isolation state；
- 当前音频项目 Volume / Pan / Pitch / Dialogue Leveler 只读证据；
- sync readiness；
- transcription / subtitle capability；
- Fairlight presets；
- 后续 loudness measurement 和受保护的音频操作。

如果后续需要 LUFS、LRA 或 true peak，才引入 FFmpeg/FFprobe adapter。它们不会成为基础启动依赖。

### 交付

负责当前机器实际能够输出什么，以及交付是否可信。

规划内容包括：

- format / codec / resolution capability matrix；
- render settings；
- render range；
- output destination 和 collision policy；
- render queue；
- offline media、audio、subtitle blockers；
- render plan；
- produced-file verification。

正式 render 必须经过本机批准。Resolve 报告 job complete 只代表 Resolve 结束了任务；最终交付成功需要验证实际生成的文件。

### 活动

Activity 是操作证据和恢复入口。

公共 `audit` 仍保留有界的受保护 Workflow 调用摘要；涉及 mutation 的 plan、approval、dispatch、verification、ambiguity 和 recovery evidence 已由 main-process append-only durable ledger 持有，Activity 从同一 owner 投影执行状态。

持久执行证据至少覆盖：

```text
plan
approval / rejection
dispatch intent
backup / version
execution result
verification
contradiction
ambiguous outcome
recovery
```

连接和 tunnel 的原始运行日志仍然保留，但会放在 Diagnostics，而不是和专业 Workflow 历史混成一层。

## 4. Artifact / capability lens 和 Resolve 原生页面不是同一个状态

在右侧切换 Timeline、Media Review、Fusion、Color、Audio、Deliver 等 Artifact/lens，默认只改变 Chat in DaVinci 的语义焦点/Artifact，不改变 Resolve 原生 UI。

它不会在后台强制 Resolve 切到对应页面。

某个 Workflow 确实要求 Resolve 处于特定页面时，该 Workflow 自己声明这个 precondition。`Reveal in Resolve` 是明确的用户/Action 副作用，不与普通选择混在一起。

## 5. 数据所有权

每类事实只保留一个权威 owner。Reader 负责取得原始观察，World Model 负责把已观察事实组织成当前语义状态；UI 和 Agent 都是 projection。

```text
COS Session          owns conversation/turn history
COS Goal/Session     owns exact goal/constraints/corrections/open obligations
CID Workspace        owns stable Workspace <-> Resolve Project binding
workflow readers     own raw bounded Resolve observations
World Model          owns current semantic observed Resolve state
SharedFocus          owns current human/Agent "this"
Capability Ledger    owns complete known ability/gap inventory
qualification/router owns build-specific implementation evidence/selection
Action Catalog       owns action semantics/affordances
Workflow engine      owns Plan/approval/dispatch lifecycle
ChangeSet projection owns Goal/Plan-grouped semantic mutation transition
Evidence/ledger      owns durable execution/verification evidence
Analysis Store/Jobs  owns Workspace-scoped reusable analysis artifacts/jobs
Context Compiler     owns only derived DecisionFrame/ContextPack
CompletionReport     is derived criterion-level completion evidence
CID Renderer         owns visual/presentation state; COS remains Session lifecycle owner
```

本机 UI 和 Agent/ChatGPT 可以看到同一份事实的不同 projection。

```text
qualified observation/action
       │
       ▼
ActionResult / EvidenceRef / SemanticDelta
       │
World Model / ChangeSet / Analysis Artifacts
     /                          \
Artifact Workspace          SituationFrame -> DecisionFrame
rich human projection       bounded Agent context + ActionOffers
```

不会为了 UI 和 Agent 分别实现两套 Resolve reader，也不会因为 Context Compiler 有缓存就让它变成第二个 truth owner。

观察按需发生。右侧 Artifact 或 Agent DecisionFrame 只加载能改变当前决策的缺失/过期 World Model slice；如果已有 fresh evidence 足以回答问题，就不重复调用 Resolve。异步结果必须绑定 project/timeline/schema generation；用户已经切换上下文时，旧结果不能覆盖新的 SituationFrame/右侧工作区。Agent 已经看过的状态优先用 semantic delta 更新，而不是每回合重复整份 snapshot。

## 6. 写操作安全模型

当前受保护 Workflow 仍以只读检查为主，已登记三个有界 writer：review marker add、append empty VIDEO track、exact LOCAL grade-version create。其他 mutation surface 均未因 API 存在而获得执行权限。

任何新增生产写操作都必须先登记到 workflow registry。每个 writer 至少定义：

```text
risk level
blast radius
preview mode
approval policy
backup / recovery class
verification contract
target identity requirements
```

标准执行路径是：

```text
semantic action intent
  -> immutable Plan / ChangeSet draft when required
  -> local/scoped approval according to risk
  -> revalidate Workspace / exact target / fingerprint / sealed implementation
  -> persist dispatch intent
  -> dispatch to Resolve
  -> update ChangeSet actual delta
  -> readback / render / audio / file verification
  -> criterion-level CompletionReport + durable Activity
```

如果写请求可能已经到达 Resolve，但返回途中连接丢失，结果进入 `ambiguous`。这种情况不会自动重试，因为重试可能把同一个修改做两次。

未知风险不会显示成绿色成功。没有可靠验证证据时，状态保持 `unverified`。

## 7. 本地连接和安全边界

当前实现包含这些边界：

- MCP gateway 只监听 `127.0.0.1`；
- Raw 和 Workflow 使用独立的随机 secret path；
- Host 和 Origin 做 loopback validation；
- HTTP body 有明确大小上限；
- tunnel 自检使用独立 probe header，不混入真实 ChatGPT 访问证据；
- OpenAI tunnel API key 存在 macOS Keychain-backed secure storage；
- API key 不进入 argv、日志或 renderer-readable config；
- tunnel ID 只是 identifier，可以存配置；
- BrowserWindow 禁止任意新窗口和导航；
- main process 拥有 child-process 生命周期，退出时负责回收自己启动的进程树；
- connection lifecycle 串行化，并用 generation 防止旧异步结果重新获得控制权。

Project Location 记录是未来受保护 Workflow 的路径授权材料。它不是 Raw connector 的 sandbox。

## 8. 技术栈

当前工程基线以仓库里的 `package.json`、`electron.vite.config.ts`、`tsconfig.json` 和 `electron-builder.yml` 为准。下面列的是当前真实实现，不是候选技术清单。

| 层 | 当前技术 | 用途 |
| --- | --- | --- |
| Desktop runtime | Electron `43.4.1` | macOS 应用壳、main/preload/renderer 进程边界、窗口和系统集成 |
| Application language | TypeScript `^7.0.2`，ES2023，strict mode | main、preload、renderer、共享类型和测试 |
| Renderer | 原生 HTML + CSS + TypeScript | 悬浮顶栏、工作区、Setup、Activity；当前不使用 React/Vue/Svelte |
| Build | electron-vite `^5.0.0` + Vite `^7.3.6` | 分别构建 main、preload、renderer |
| MCP runtime | `@modelcontextprotocol/node` `^2.0.0` + `@modelcontextprotocol/server` `^2.0.0` | 本机 Raw/Workflow MCP gateway 和工具协议 |
| Validation | Zod `^4.5.4` + TypeScript 类型 | 结构化输入、边界数据和内部契约 |
| Resolve backend | Blackmagic Design 官方 `ResolveMCP` | 唯一 live Resolve backend；通过 stdio 由一个 `ResolveBroker` 持有 |
| ChatGPT transport | OpenAI Secure MCP Tunnel + bundled `tunnel-client` | 把 ChatGPT connector 安全送到本机 loopback MCP gateway |
| Local gateway | Node HTTP + MCP server libraries | `127.0.0.1` 上的随机 secret Raw/Workflow paths、Host/Origin validation 和有界请求 |
| Electron isolation | `contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、`contextBridge` | Renderer 只获得 preload 暴露的固定 API |
| Secret storage | Electron `safeStorage`，macOS Keychain-backed encryption | 加密保存 Tunnel API key；Renderer 只看到状态和末 4 位 |
| Local persistence | app-owned config/log files；Workflow ledger 使用 append-only JSONL | 设置、诊断和可恢复的 plan/approval/dispatch/verification 执行证据 |
| Testing | Vitest `^4.1.10` + TypeScript `noEmit` + opt-in live Resolve tests | 普通单元/生命周期测试与真实 Resolve 集成验证 |
| Packaging | electron-builder `^26.16.1` | 当前生成 macOS ARM64 DMG |
| Platform target | macOS 13.0+ only | 当前不做 Windows |
| Resolve target | DaVinci Resolve Studio only | 具体 writer capability 按 exact Resolve build qualification |

### 8.1 工程约束

这些选择在当前路线中视为默认基线。更换它们需要由具体需求证明必要性：

- CID main process 持有 Resolve、CID Tunnel/MCP、Workspace/World Model/Capability/Plan/ChangeSet/evidence 等权威状态；COS 持有 Session/Chat/Goal/Agent runtime；CID 持有最终 Codex-style renderer；
- 保持一个 Electron/TypeScript 应用运行时，不增加独立 Web backend、云数据库或第二套 Resolve service；
- 保持一个 CID-owned live Resolve authority；Samuel-derived capability/kernel code 可以被适配或包装到该 authority 下面，但不能成为第二个 live session owner；
- Renderer 继续使用原生 HTML/CSS/TypeScript，直到实际界面复杂度证明需要前端框架；仅为了组件化形式不引入 React、Vue 或 Svelte；
- Workflow 需要脚本能力时，只允许应用持有的固定、版本化、getter-only 或明确登记的模板调用官方 sandboxed `run_script`；模型不能提供任意 Python；
- 第一版持久 Workflow ledger 使用 JSONL。只有查询规模、迁移需求或事务需求真正超过它时才考虑 SQLite；
- FFmpeg/FFprobe 只在未来媒体、音频或 produced-file verification 确实需要时作为可选 adapter 引入，不成为基础启动依赖；
- 不为追求工具数量引入第二套 MCP backend、通用 agent runtime、browser automation、Desktop control 或 shell/filesystem tool surface。

## 9. 当前已经实现

当前代码已经具备：

- Electron macOS app；
- `System / English / 简体中文` UI language；
- 当前 CID 悬浮顶栏、Sidebar、最小 Chat、durable Agent Session/Turn event store 和 `ModelProvider`/`TurnRunner` 仍存在，但现在是迁移 baseline；
- Agent 调用只经过现有 Protected ToolKernel，使用同一个 ResolveScheduler/ResolveBroker，并与 Protected MCP 共享 workflow audit；
- Setup 与连接诊断归入 `设置`，项目预检归入 `项目`，Workflow 审计归入 `活动`；
- 六步 Setup；
- Blackmagic ResolveMCP 探测；
- 单一 `ResolveBroker`；
- 官方 tool declaration snapshot 和 schema hash；
- tokenized Raw + Workflow loopback gateway；
- Raw Secure MCP Tunnel；
- Raw ChatGPT end-to-end verification；
- Workflow `status / inspect / inspect_operation / audit / plan / execute`；
- Project/Media/Edit/Fusion/Color/Fairlight/Deliver 的固定有界只读 inspection，以及 Project preflight；
- 当前 Edit 已完成 structure、gaps/overlaps、source ranges、transition/fade 和 review annotations 只读检查；
- 当前 Fusion 已完成 timeline-scoped composition presence/count/name 与 bounded graph/tool/I/O 结构只读检查；控件值、graph 写入和 pixel/render 证据仍未开放；
- 当前 Color 已完成 pipeline、bounded Timeline/configured-Node-Stack/Color-Group pre/post graph、grade-version 只读检查和 exact LOCAL grade-version create；2 层 Node Stack、Color Group 前后节点图及 AddVersion/Load/Delete 补偿行为均已在 Resolve 21.1 disposable fixture 资格化，不返回 LUT 路径，不把版本名或 Color Group 枚举顺序当稳定全局身份，也不声明节点拓扑/参数、Color Group version、DCTL 身份枚举或最终画面；
- 当前 Fairlight 已完成 bounded track/source mapping 与 AUDIO TimelineItem processing 只读检查；Volume/Pan/Pitch/Voice Isolation/Dialogue Leveler 为当前 getter 原值，自动化、片段效果、响度/最终音频和所有音频处理写入仍未声明；
- 当前 Deliver capability matrix 除通用 format/codec/resolution 外，还回读当前 format/codec 的 `GetRenderResolutions(format, codec)` 有界结果，以及 `GetRenderPresetList()` / `GetQuickExportRenderPresets()` 的有界名称清单；API 顺序和重复名称原样保留，不推断预设内容/兼容性/当前选择，也不把 capability list 当成当前实际 render resolution；
- workflow registry、不可变 plan、本机 approval、append-only durable ledger 和 ambiguity/no-retry 执行链；
- 三个受保护 writer 共用 `plan → local approval → execute` authority；marker 与 track-add 已完成真实 protected vertical acceptance，Color grade-version create 的 AddVersion/Load/Delete 底层行为已在 Resolve 21.1 disposable fixture 资格化，正式 protected runtime 已通过非 live 回归；
- Keychain-backed API key storage；
- tunnel readiness / polling / real request diagnostics；
- menu bar/background lifecycle；
- 有界 shutdown；
- 有界的公共 Workflow call audit，以及由 append-only ledger 持有的 mutation plan/approval/dispatch/verification 证据；
- signed local macOS application packaging flow。

除上述三个已登记 writer 外，没有其他受保护 Resolve writer；`LoadVersionByName` / `DeleteVersionByName` 仅作为 Color writer 的内部 Class B compensation，不是公开动作。

## 10. 下一步开发顺序

`docs/development/IMPLEMENTATION_PLAN.md` 记录初步实施路线和验收门。实际下一步以当前用户目标、真实源码状态和已资格化的 Resolve 能力为准，不把文档顺序当作硬约束。

当前 forward 顺序是：

```text
1. 保持已完成的 COS ChatGPT/Session/Goal/Loop/Finish/Compact&Resume/Prime-Worker authority，不恢复并行 CID lifecycle
2. 在已完成的 CID Workspace <-> Resolve Project / DecisionFrame / CompletionReport spine 上扩展 CID-owned Codex-style Sidebar/Conversation + 四层 Artifact Workspace
3. 所有 protected Agent action 继续先经过 exact Session/Turn `CID_DECISION_CONTEXT` + `decisionContextToken` freshness receipt，再进入唯一 ToolKernel / ResolveScheduler / ResolveBroker authority；receipt 不是 approval
4. 落地 Context / Active Artifact / Changes·Plan / Evidence·Inspector + soft-follow/Pin/Reveal in Resolve
5. 持续维护 `docs/development/CAPABILITY_LEDGER.md` 的 breadth-first 能力全集，并落地 build qualification、implementation routing/composition
6. 资格化 Timeline Version Protection、Human-edit-wins stale/Rebase、ChangeSet/CompletionReport
7. depth-first production packs：Project/Media/Edit -> Fusion/Color -> Fairlight/Deliver
8. 具体 pack 需要时加入 content-addressed Analysis Artifacts/Jobs
9. Prime/Workers 通过 bounded WorkPacket 和同一 ToolKernel/scheduler
10. 仅为明确已资格化 gap 加 allowlisted UI Automation / Offline Adapter / trusted plugin pack
```

不会为了追求 API 方法数量把完整能力全集暴露给模型；`docs/development/CAPABILITY_LEDGER.md` breadth-first 记录已知能力/缺口，让它们都有明确归宿。生产能力通过完整 vertical Capability Pack 增生：stable semantic ID、实体/观察、primitive+workflow ActionDescriptor、versioned implementation、build qualification、Context/Capability Frontier、Artifact projection、Plan/ChangeSet、验证/恢复和 Agent task eval 一起进入系统。模型每次只看到当前 DecisionFrame 的 ActionOffers。

## 11. 开发

要求 Node.js 环境与当前 lockfile 对应的依赖。

```bash
npm ci
npm run dev
```

常用验证：

```bash
npm run typecheck
npm test
npm run build
```

项目总验证：

```bash
npm run verify
```

需要连接实际 DaVinci Resolve 时才运行 live tests：

```bash
npm run test:live
npm run test:broker:live
npm run test:gateway:live
```

这些测试会依赖当前机器上的 Resolve/ResolveMCP 状态，不属于默认 `verify` 的普通离线测试路径。

## 12. macOS 打包

当前 ARM64 DMG 命令：

```bash
npm run package:mac
```

它会生成图标、获取固定的 `tunnel-client`、构建 Electron 应用并通过 electron-builder 生成 DMG。

打包、安装和覆盖 `/Applications/Chat in DaVinci.app` 不是普通开发检查的一部分。只有明确需要本机验收时才执行。

## 13. 文档地图

项目规划已经拆成几个职责明确的文档。

| 文档 | 权威范围 |
| --- | --- |
| `AGENTS.md` | 当前项目开发和 Resolve 安全规则 |
| `docs/development/AGENT_SYSTEM_SPEC.md` | Agent 人体工学、闭环链接抽象塔、DecisionFrame/Capability Frontier、World Model、ChangeSet/CompletionReport、Capability Pack、共享 cockpit 与评估体系 |
| `docs/development/PRODUCT_SPEC.md` | 产品目标、架构原则、研究结论 |
| `docs/development/UI_SPEC.md` | Codex-style Workspace/Session Sidebar / Conversation / 四层 Resolve Artifact Workspace、soft-follow/Pin、SharedFocus、审批/ChangeSet 展示 |
| `docs/development/WORKSPACE_SPEC.md` | Workspace/Resolve 绑定、四层 Artifact 模型、各 capability-domain lens、Analysis Store/Jobs 与 World Model 投影 |
| `docs/development/CAPABILITY_LEDGER.md` | breadth-first 已知能力全集、stable semantic capability ID、lifecycle/gap 状态与覆盖快照 |
| `docs/development/WORKFLOW_CATALOG.md` | Capability/ActionDescriptor/implementation contract、当前 executable workflow subset、Capability Pack/Workflow 设计 |
| `docs/development/EXECUTION_SECURITY_SPEC.md` | plan、approval、dispatch、ambiguous、verification、recovery 状态机 |
| `docs/development/IMPLEMENTATION_PLAN.md` | 初步实施路线、文件落点和验收门；顺序可按当前目标与证据调整 |
| `docs/development/ARCHITECTURE_PLAN.md` | 当前技术架构、System Spine 与历史实现背景 |

涉及系统整体 Agent 设计先看 `docs/development/AGENT_SYSTEM_SPEC.md`；涉及能力是否存在/当前处于什么 lifecycle 状态时先看 `docs/development/CAPABILITY_LEDGER.md`；涉及开发顺序时，将 `docs/development/IMPLEMENTATION_PLAN.md` 作为路线参考，并以当前用户目标、真实源码状态和已资格化 Resolve 证据决定实际下一步。涉及右侧 DaVinci domain 的设计目标时参考 `docs/development/WORKSPACE_SPEC.md`；涉及写操作安全语义时以 `docs/development/EXECUTION_SECURITY_SPEC.md` 为准。

## 14. 参考项目

Chat in DaVinci 从两个公开项目吸收经过验证的设计经验，但不会把它们直接作为运行时 backend。

### Blackmagic Design ResolveMCP

当前源码里 Blackmagic 官方 `ResolveMCP` 仍是 live driver。长期不变的约束是只有一个 CID-owned Resolve authority，具体下层 driver/capability adapter 可以演进。

### samuelgursky/davinci-resolve-mcp

Repository:

```text
https://github.com/samuelgursky/davinci-resolve-mcp
```

主要接入内容：

- compound Resolve workflows；
- Media Pool、Timeline、Fusion、Color、Fairlight、Deliver 专业功能划分；
- risk / blast-radius classification；
- dry-run truthfulness；
- version-on-mutate；
- readback verification；
- control-panel review/history/plan UX；
- source-safe media analysis；
- offline computation 和 live apply 的边界。

当前规划调研记录的最新快照见 `docs/development/PRODUCT_SPEC.md` 和 `docs/development/WORKSPACE_SPEC.md`。

`samuelgursky/davinci-resolve-mcp` 是第三方 MIT 项目，不是 Blackmagic 官方 MCP。目标是将其有价值的 Resolve API/domain kernel/readback/page-lock/versioning/capability implementation 接入 CID authority 下方；它不能拥有第二个 live Resolve session，也不能绕过 CID approval/verification。

### Chat On Steroids

Repository:

```text
https://github.com/totec448-spec/chat-on-steroids
```

作为上层 runtime 基线保留：

- ChatGPT Web / Conversation / Session durable state；
- durable turn/input；
- Goal / Loop / Finish；
- Compact & Resume / continuation；
- Prime / Worker / inbox / sleep-revive；
- model/Agent orchestration；
- durable lifecycle / crash-recovery semantics。

CID 以这些 COS runtime 状态驱动最终 Codex-style Sidebar/Conversation renderer；不复制第二套 Session/Goal lifecycle，也不要求复制 COS 原 renderer。COS 的通用 filesystem/terminal/Desktop 编码权限不会因此获得 CID Resolve 权限。

## 15. 项目状态

`package.json` 当前版本为 `0.1.0`，项目标记为 private / `UNLICENSED`。

仓库目前仍在本地开发阶段。发布、版本策略、notarization 和正式分发要求应在真正进入公开发布前单独确定。
