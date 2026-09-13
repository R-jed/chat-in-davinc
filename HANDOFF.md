# Chat in DaVinci — Handoff

Date: 2026-09-13

## 接手目标

继续 `chat-in-davinci` 的开发与验收。当前优先级是保持已经收口的 COS/CID 权责边界和单一 Resolve authority，在现有 Artifact Workspace / Capability Pack 基础上推进真实生产能力，不再继续堆平行 runtime、第二套状态 owner 或更多未经完整验收的 writer。

这份文件只记录接手所需的当前状态和风险。详细规格、架构和实施顺序请直接读 `docs/development/` 下的权威文档，不要从本文件复制旧设计继续推导。

## 当前仓库状态

Repository: `chat-in-davinci`
Branch: `main`
Remote: `origin -> https://github.com/R-jed/chat-in-davinc`
Last committed baseline: `13ec412 chore: establish verified Chat in DaVinci baseline`

该 baseline 已 push，`main` 与 `origin/main` 当时完全一致。

当前有一组尚未 commit/push 的纯文档整理变更：

- 10 份开发规划/规格文档已移动到 `docs/development/`；
- `README.md`、`AGENTS.md`、`UI_POLICY.md` 中的引用已同步；
- 本 `HANDOFF.md` 按 handoff skill 要求保留在项目根目录；
- 这组变更当前已 staged；
- `git diff --cached --check` 在整理后通过。

下一位智能体开始前先运行：

```bash
git status --short --branch
git diff --cached --stat
git diff --cached --check
```

不要假设这组 docs 变更已经提交。

## 权威文档入口

只在需要时读取对应文件：

- 系统设计：`docs/development/AGENT_SYSTEM_SPEC.md`
- 产品约束：`docs/development/PRODUCT_SPEC.md`
- 当前技术架构：`docs/development/ARCHITECTURE_PLAN.md`
- 实施路线和即时下一步：`docs/development/IMPLEMENTATION_PLAN.md`
- Capability 全集与 lifecycle：`docs/development/CAPABILITY_LEDGER.md`
- Capability/Workflow contract：`docs/development/WORKFLOW_CATALOG.md`
- 写操作安全：`docs/development/EXECUTION_SECURITY_SPEC.md`
- UI：`docs/development/UI_SPEC.md`
- Resolve Artifact Workspace：`docs/development/WORKSPACE_SPEC.md`
- Agent 驾驶体验审查：`docs/development/AGENT_ERGONOMICS_REVIEW.md`
- 项目开发硬约束：`AGENTS.md`
- 当前产品入口和运行说明：`README.md`

不要把旧 milestone 文本当成比当前源码和用户最新指令更高的 authority。

## 已确认完成的关键内容

以下是当前代码已经建立、后续不要回退的边界：

- COS 负责 ChatGPT Web / Conversation / Session / Goal / Loop / Finish / Compact & Resume / Prime-Worker runtime。
- CID 负责最终桌面 renderer、Workspace↔Resolve Project identity、DaVinci semantic/control plane、Plan/approval/verification、安全和单一 Resolve authority。
- Protected Resolve 公共 surface 仍是 6 个 verb：`status`、`inspect`、`inspect_operation`、`audit`、`plan`、`execute`。
- Raw 保持独立高级 surface，不能借 Protected 暴露任意 Python/shell。
- 所有实际 Resolve 调用共享一个 `ResolveScheduler` / `ResolveBroker` authority。
- read-only System Spine 已存在，并使用 exact current COS Session/Turn + DecisionContext receipt。
- Artifact Workspace 已收口到 Main-owned canonical World Model projection；renderer 不再拥有七个 domain 的平行 workflow snapshot truth。
- Mutation Plan renderer 只拿 bounded projection，exact Resolve IDs、hash、fingerprint、private preconditions 留在 Main。
- registry 当前是 27 个 workflow definition：24 read-only + 3 writers。
- 三个 writer：`edit.review_marker_add.v1`、`edit.track_add.v1`、`color.grade_version_create.v1`。
- `edit.track_add.v1` 已完成真实 disposable protected vertical acceptance，包括当前 Turn 明确意图、Plan、本机 approval、Class C backup、execute、结构 readback、verified、cleanup 和原 project/timeline 恢复。
- Color grade-version writer 已完成 Resolve 21.1 底层 Add/Load/Delete disposable qualification，并有 protected runtime 非 live regression coverage；不要误写成已经完成了同等级的 renderer-approved live protected vertical E2E。此前完整 live acceptance 尝试曾在本机 approval timeout / Plan expiry 处失败。

更完整的实现状态以 `docs/development/IMPLEMENTATION_PLAN.md` 末尾 “Current implementation state / immediate next action” 为准。

## 最近验证结果

在 baseline commit 前执行过完整：

```text
npm run verify
  typecheck PASS
  UI policy 13/13
  interaction 15/15
  concurrency 4/4
  ordinary tests 166 passed
  3 live Resolve tests skipped
  production build PASS
```

随后只有文档移动和引用调整，没有产品代码变化，因此没有为了 docs-only 变更重复跑整套测试。

当前 docs 变更应继续保持 `git diff --cached --check` 通过。

## 当前没有解决完的事情

没有确认的源码级 blocker。真正还没收口的是产品成熟度，而不是“让测试变绿”。

重点 gap：

- Capability Ledger 中大量能力仍处于 `qualified` / `implemented` / `planned` 等状态，不能把它们统一说成 production。
- 下一阶段应把已有 qualified 能力做成完整 production Capability Pack，而不是继续加第 4、第 5 个 writer。
- Timeline Version Protection、Human-edit-wins stale/Rebase、ChangeSet/CompletionReport 还需要按真实生产链继续收口。
- Project/Media/Edit 应优先形成 depth-first production packs，再扩 Fusion/Color、Fairlight/Deliver。
- 真实 charged OpenAI / Agent smoke 仍需用户明确授权后才能使用存储的 API key。
- Chat in DaVinci MCP connector 在此前一次项目审查中返回过 `Session terminated`，同时 Resolve 应用本身仍在运行。该现象没有确认根因，也没有在这次 handoff 中重新验证，不要把它当成已确认代码故障或归因到 Resolve 弹窗。

## 建议下一步

如果用户没有新的更高优先级指令，按下面顺序推进：

1. 先确认当前 staged docs 整理是否需要 commit/push。不要擅自 commit。
2. 读取 `docs/development/IMPLEMENTATION_PLAN.md` 的即时下一步和 `CAPABILITY_LEDGER.md` 当前 lifecycle。
3. 从 Project/Media/Edit 中选择一个已有 qualified、用户价值高、可形成完整 vertical 的能力。
4. 用现有 owner 完成 Capability Pack 缺口，包括 World Model/ActionOffer、Plan/ChangeSet（若有写）、验证、recovery 和 Agent task acceptance。
5. 只运行与该行为相关的已有测试；现有测试足以证明时不要新增测试。
6. 完成前跑 typecheck/build、相关 policy/tests、`git diff --check`，再做 adversarial review。

如果只是要提高“能力数量”，先拒绝这种方向。当前瓶颈是闭环质量和 production qualification，不是 API wrapper 数量。

## 容易踩的坑

- 不要重新启用旧 CID Session/TurnRunner 作为第二套上层 runtime。
- 不要建立第二个 Tunnel、Gateway、ResolveBroker 或任何并行 Resolve authority。
- Worker 可以并行分析，不能直接拥有 Resolve mutation authority。
- 当前历史 Goal/objective 不能自动延续写授权；mutation planning 必须绑定当前适用 Turn/ActionOffer。
- SharedFocus / semantic handle 不是 authorization。
- caller/model 文本中的 confirm 不是 approval。本机 exact Plan approval 仍是 authority。
- `dispatch_started` 后如果结果不确定，必须 ambiguous，不能自动 replay。
- reconnect/restart 后不能自动恢复 write authority 或旧 approval。
- API readback 不能被描述成像素、音频或最终导出内容验证，除非有相应证据链。
- UI Automation / Offline Adapter 只能用于明确 API gap，必须 capability-specific 且显式暴露限制。
- 不要把 Project/Media/Edit/Fusion/Color/Fairlight/Deliver 做成七个独立 state owner。
- 不要为了“完整”新增抽象、框架、测试矩阵或平行实现。
- 不要执行 `git clean`、破坏性删除、package/install、commit/push，除非用户明确要求。

## 当前会话做了什么

本会话完成了三件事：

- 对项目做了只读进度审查，确认当前代码/测试/Capability 状态，并核实 `edit.track_add.v1` 的真实纵向验收已完成。
- 建立首次 Git baseline：commit `13ec412`，并成功 push 到 `origin/main`。
- 将开发计划/规格文档集中整理到 `docs/development/`，同步修正根目录引用；该 docs 整理目前尚未 commit/push。

本 handoff 是在上述状态之后生成的。

## 建议使用的技能

下一位智能体应通过 Skill 工具按任务需要加载：

- `git-workflow-and-versioning`：任何代码修改、commit、branch、push 前使用。
- `source-code-based`：审查当前实现或定位问题时，要求直接从源码和真实运行证据出发。
- `specification-driven`：修改 Capability contract、Plan、安全边界、状态 owner 或产品语义时使用。
- `code-review-and-quality`：完成一段代码后做最小 diff、回归和 adversarial review。
- `reclaim-code-entropy`：当实现开始出现重复 owner、兼容层、补丁叠加或无必要抽象时使用。

如果用户意图本身不清楚，再使用 `interview-first`；不要为了流程形式主动增加提问。

## 接手完成定义

下一位智能体在继续开发前，应能回答：

- 当前 user goal 是什么；
- 当前 staged/uncommitted 状态是什么；
- 哪个文档是该问题的 authority；
- 哪条 existing code path 真正拥有状态和执行权；
- 本次准备改变的唯一 accepted behavior 是什么；
- 哪些内容明确不在本次范围内；
- 哪些现有测试足以证明这次变更。

如果这些问题答不清，不要先改代码。
