# Chat in DaVinci — Product & Workflow Specification

Date: 2026-09-12

Status: current Agent-native synthetic-system product specification

## 1. Purpose

Chat in DaVinci is a local macOS DaVinci Resolve Studio Agent-native cognitive control system. It is designed from the Agent driver's seat: durable intent and conversation, a sparse semantic World Model, a state-dependent Capability Frontier, full-domain operation capability, evidence-backed control and one coherent human/Agent Artifact Workspace form one closed loop rather than a collection of pages and tools.

The product target is:

```text
Chat in DaVinci
  = COS durable ChatGPT/Session/Goal/Agent runtime
  + Codex-style Workspace/Session + Conversation presentation
  + GoalFrame -> SituationFrame -> DecisionFrame -> Capability Frontier
  + Resolve World Model + Evidence + SemanticDelta
  + primitive + workflow Capability Layer across every Resolve domain
  + Plan -> ChangeSet -> verification -> CompletionReport
  + one CID-owned Resolve authority + recovery/provenance
```

`AGENT_SYSTEM_SPEC.md` is the canonical system-level specification for Agent ergonomics, context architecture, semantic references, capability growth and the shared human/Agent cockpit. This product specification defines the product contract underneath that system model.

The product has eight jobs:

1. provide a persistent Chat/Conversation/Session experience that can continue goals across compaction and restart;
2. make each next decision cheap by compiling a truthful `DecisionFrame` from GoalFrame, SituationFrame, SharedFocus, completion gaps and only the relevant evidence;
3. expose a state-dependent `Capability Frontier` rather than forcing the Agent to search a flat API/tool inventory;
4. let an Agent plan and execute behaviorally qualified Resolve operations across every production domain through stable semantic capabilities with primitive + workflow layers;
5. keep every protected mutation behind exact target binding, immutable Plan, bounded user authorization, durable dispatch evidence, Goal-grouped ChangeSet and declared verification;
6. provide a shared human/Agent cockpit in which Chat and the four-layer Resolve Artifact Workspace resolve to the same entities, Plans, ChangeSets, Jobs and Evidence;
7. make capability expansion measurable and compositional through complete vertical Capability Packs, build-specific qualification and a no-silent-gap Capability Ledger;
8. minimize repeated Resolve/API/model work by reusing fresh World Model/Analysis Artifacts, emitting semantic deltas and asking the user only for real preferences/approval decisions.

The product should feel like an intelligent Resolve workbench. Setup, MCP transport and read-only QC remain important subsystems, but they are no longer the product boundary.

"All Resolve functions" is defined truthfully: all behaviorally qualified capabilities reachable through the supported execution tiers should be Agent-operable end to end. Blackmagic's public Scripting API does not expose 100% of the Resolve UI, so proven hard gaps must remain explicit and may use separately governed UI Automation or Offline Adapters rather than fabricated parity.

## 2. Source roles and authority

The product combines three codebases/layers with different ownership. They are not interchangeable.

### 2.1 Chat On Steroids

Upper product/runtime foundation:

```text
https://github.com/totec448-spec/chat-on-steroids
local customized checkout: /Users/qunqing/2026-Project-Agent/chat-on-steroids
MIT License
```

COS is the upper runtime foundation for:

- ChatGPT Web conversation/model transport;
- Session identity and durable turn/input lifecycle;
- Conversation event/state feed used by the CID renderer;
- Goal / Loop / Finish;
- Compact & Resume / continuation;
- Prime / Worker roles, inbox and sleep/revive;
- model/Agent orchestration and crash/restart continuation.

The final desktop visual/interaction shell is CID-owned and follows the Codex-style Sidebar/Conversation design. Runtime ownership must not be confused with visual ownership.

CID should integrate with that runtime at one explicit DaVinci boundary instead of cloning the same lifecycle into a parallel CID-owned Chat stack. COS-specific coding filesystem/terminal/Desktop authority is outside the protected Resolve path unless separately designed and authorized.

### 2.2 samuelgursky/davinci-resolve-mcp

Repository:

```text
https://github.com/samuelgursky/davinci-resolve-mcp
MIT License
```

This is a third-party project built on Blackmagic's official Scripting API; it is not Blackmagic's official MCP server. Its fast-changing tool counts are not product requirements.

The important material is its actual Resolve capability implementation and domain/kernel knowledge, including API-truth/probe/contracts, page locking, readback, operation results, execution lifecycle, destructive-operation admission, timeline versioning and Resolve write helpers across Project/Media/Edit/Fusion/Color/Fairlight/Deliver.

CID may reuse, port or wrap those implementations behind a CID-owned adapter. The Samuel layer is subordinate to CID's ToolKernel/safety/scheduler/broker authority and must not become a second persistent Resolve owner, publish its full granular inventory directly to COS, or substitute caller-supplied confirmation/dry-run flags for CID approval.

### 2.3 Chat in DaVinci

CID is the product presentation, Workspace/DaVinci semantic system and production execution authority around/below COS. It owns:

- the Codex-style Sidebar/Conversation renderer projection and Resolve Artifact Workspace;
- CID Workspace identity with one-to-one Resolve Project binding;
- the CID Tunnel and MCP Gateway;
- Resolve World Model / SituationFrame / DecisionFrame compilation / semantic references;
- Context Compiler and model-visible capability projection;
- unified ToolKernel / Action Catalog / Capability Ledger;
- primitive + workflow Capability Layer, implementation routing and build-specific qualification;
- immutable Plan/hash and exact target binding;
- Goal/Plan-grouped ChangeSet;
- Workspace-scoped Analysis Store and Jobs;
- local approval;
- durable workflow ledger;
- dispatch-before-side-effect durability;
- verification and ambiguity handling;
- recovery/version policy;
- ResolveScheduler / lease;
- provenance, criterion-level CompletionReport and Artifact Workspace projection.

### 2.4 Technology baseline

The current and forward desktop stack remains Electron/TypeScript. COS supplies the upper ChatGPT/Session/Agent runtime; CID supplies the final Codex-style renderer shell and DaVinci system. Existing CID Chat/Session/TurnRunner code is migration provenance rather than the target owner. CID continues to provide the DaVinci integration/safety plane and may host a subordinate Samuel-derived adapter without creating a second live Resolve authority.

Current runtime facts:

```text
desktop runtime       Electron 43.4.1
application language TypeScript ^7.0.2, ES2023, strict mode
renderer              native HTML + CSS + TypeScript
build                 electron-vite ^5.0.0 + Vite ^7.3.6
MCP runtime           @modelcontextprotocol/node ^2.0.0
                      @modelcontextprotocol/server ^2.0.0
validation            Zod ^4.5.4 + typed internal contracts
Resolve authority     one CID-owned scheduler/broker authority
Agent transport       COS upper runtime -> one CID Tunnel/MCP Gateway
Resolve capability    CID adapter -> Blackmagic Scripting API and qualified Samuel-derived implementations
secret storage        Electron safeStorage with macOS Keychain-backed encryption
tests                 Vitest ^4.1.10 + tsc noEmit + opt-in live Resolve tests
packaging             electron-builder ^26.16.1, current ARM64 DMG
supported platform     macOS only
Resolve product         DaVinci Resolve Studio only, build-qualified
minimum macOS           13.0
```

CID currently remains `UNLICENSED`. Substantial copied/adapted MIT code must retain required notices and provenance.

## 3. Product principles

### 3.1 Official Scripting API remains the capability floor

Blackmagic's official Scripting API remains the authoritative capability floor. The current source uses Blackmagic `ResolveMCP` as its live driver, but the permanent invariant is one CID-owned Resolve authority. Samuel-derived implementations may be ported or wrapped beneath that authority without creating a second live session.

Raw tools are proxied from the exact upstream declaration snapshot. Their names, JSON Schema and MCP annotations are preserved.

### 3.2 Protected Workflow is a smaller product surface

The protected Workflow surface inside the CID Gateway exposes a deliberately small set of stable compound tools. It must not publish hundreds of one-method wrappers.

The preferred shape is:

```text
status
inspect
inspect_operation
plan
execute
audit
cancel        only where cancellation is actually safe
```

Domain behavior lives behind validated actions and app-owned workflow definitions.

### 3.3 The model never supplies Python to Workflow

Workflow must never expose `run_script` or `run_script_unsafe` directly.

The app may internally call Blackmagic's sandboxed `run_script` through fixed, versioned templates owned by Chat in DaVinci. Templates accept validated structured parameters and contain only the Resolve calls the workflow needs.

`run_script_unsafe` stays outside protected Workflow unless a future feature proves OS access is essential and receives a separate design review.

### 3.4 Source media is immutable by default

Camera originals and source media are read-only inputs unless the user explicitly requests a workflow whose specification allows creation of a derivative.

Project metadata, analysis sidecars, project database values, timeline structures and renders are separate targets and need their own policy.

### 3.5 Unknown is a real state

No evidence means `unverified`, `unknown` or `not-run` according to context.

The UI and audit layer must never turn absence of evidence into success.

### 3.6 Every write has an execution contract

A model request that can modify Resolve must pass:

```text
inspect
  -> risk assessment
  -> plan
  -> local user approval when required
  -> revalidate project/timeline identity
  -> execute
  -> readback verification
  -> audit
```

Transport failure after a mutation may have reached Resolve is `ambiguous`. It is never automatically retried.

### 3.7 Agent execution shares one protected authority

Local UI, protected MCP and the Agent runtime are clients of one ToolKernel/Action Catalog. None owns a private mutation implementation.

```text
request source
  -> ToolKernel / CallContext
  -> registered action/workflow
  -> plan / local approval / backup as required
  -> ResolveScheduler
  -> ResolveBroker
  -> verification / durable ledger
```

Workers may prepare analysis and candidate plans concurrently. They never hold raw broker authority or dispatch Resolve mutations directly.

### 3.8 One Resolve authority and scheduler

`ResolveBroker` remains the current single long-lived owner of Blackmagic ResolveMCP. Because the broker itself supports concurrent pending requests, the Agent architecture adds an explicit `ResolveScheduler`/lease for page/state-sensitive calls, current-project/current-timeline-dependent work, render transitions and all mutations.

A future alternative live driver may exist only behind the same authority manager and must be mutually exclusive with other live drivers.

### 3.9 Explicit implementation tiers and routing

The semantic capability is stable while implementations are versioned/qualified separately. Candidate implementation tiers include:

```text
Official ResolveMCP / official Scripting API   preferred live floor
Samuel-derived implementation                  reusable kernel/workflow implementation under CID authority
Local Analysis / Verification                  frame/audio/transcript/file/QC artifacts
Offline Adapter                                isolated deterministic compute/planning
Resolve UI Automation                         allowlisted last resort for proven API gaps
Trusted Plugin Capability Pack                 explicit per-plugin qualification only
```

Routing is `best-qualified wins; official wins ties`. Determinism, verification/recovery quality, current Resolve-build qualification, risk and cost all matter. UI Automation is never a generic mouse/keyboard fallback. A selected implementation is sealed into the immutable Plan; execution cannot silently reroute an approved Plan.

### 3.10 One semantic World Model

CID owns one demand-driven typed semantic projection of observed Resolve state. It is a partial graph, not a full mirror and not a polling crawler.

```text
Project
  -> Timeline
     -> Track
        -> TimelineItem
           -> MediaPoolItem / Fusion / Color / Fairlight relationships
  -> Media Pool
  -> Deliver state / jobs / outputs
```

Every observed slice carries identity, generation, freshness and evidence. Project/timeline switches and mutations invalidate only dependent state where possible. The Agent and renderer consume projections of this same World Model rather than independently reconstructing Resolve truth.

World Model facts preserve epistemic state: `observed`, `derived_deterministic`, `model_inference`, `user_asserted`, `unknown` or `contradicted`. Model inference remains labelled when reused. A proposed plan effect is a prospective overlay, not current truth, until execution and the declared verification establish it.

### 3.11 Context is compiled, not accumulated

Exact IDs, raw evidence, plan hashes, credentials, caches and scheduler state remain local application context. A deterministic Context Compiler derives a `DecisionFrame` for the exact decision/gap being solved and serializes the minimum sufficient model-visible `ContextPack`. Data that cannot change the next decision remains local behind references.

Normal model context favors:

```text
exact goal criterion / open obligation
current SituationFrame including SharedFocus + completion gap
relevant semantic entities / fresh WorldFacts
ActionOffers from the current Capability Frontier
recent semantic deltas / prior decision outcome
deeper evidence by reference only when it can change the decision
```

The whole session transcript, whole project snapshot and whole Action Catalog are not default prompt material.

### 3.12 Semantic references and shared focus

Important Resolve objects, plans and evidence are linkable through local semantic references. Human-facing labels and short generation-scoped handles reduce cognitive/token cost while exact IDs remain locally bound.

A handle or `SharedFocus` is context, never authorization. A stale generation/parent binding fails closed; every protected writer still resolves and revalidates exact plan targets before dispatch.

### 3.13 Capability grows vertically

A Resolve API method is not a product capability by itself. New Agent capability enters as a complete vertical `Capability Pack` containing the smallest coherent set of:

```text
stable semantic capability IDs
entity/relationship semantics
observation recipes
primitive ActionDescriptors
workflow ActionDescriptors / DAG composition
versioned implementation candidates
Resolve build/version qualification + limitations
World Model invalidation
Context Compiler / Capability Frontier recipe
Artifact Workspace projection
Plan / ChangeSet / recovery / verification contracts when mutable
analysis/evidence recipes when needed
Agent task evaluations
```

The internal layer keeps both primitives and workflows so stronger future models can compose lower-level qualified abilities without sacrificing mature high-level workflows. Every known ability has an explicit lifecycle state in `CAPABILITY_LEDGER.md`; completeness means no silent gaps, not fake API/UI parity. The protected public transport verbs stay small while the semantic frontier grows behind them.

### 3.14 Completion is evidence-backed

For state-changing work, model prose is not completion evidence. CID derives a criterion-level `CompletionReport` from GoalFrame completion criteria and the strongest evidence promised by the task: API readback, structural readback, rendered evidence, audio analysis or produced-file verification as applicable. COS retains continue/Finish lifecycle authority; CID owns the Resolve completion evidence.

### 3.15 Agent ergonomics is measurable

Tool/context design is evaluated on real Agent tasks, not only unit tests or API coverage. Relevant metrics include verified task success, routing/argument errors, redundant observations, turns, context tokens, Resolve calls, latency, user clarifications, stale-target errors and verification contradictions.

### 3.16 Interruption is part of control

The user can redirect an Agent run without destroying execution truth. Safe pending model/read work may stop or be superseded; waiting-for-decision and waiting-for-approval are explicit states. A write that may already have crossed `dispatch_started` remains governed by the durable ambiguous/no-replay lifecycle and cannot be labelled cancelled merely because the conversation moved on.

## 4. Information architecture and UI

The target desktop information architecture follows a persistent three-pane shared cockpit. The current Floating Topbar + peer-page layout is a migration baseline, not the forward product structure.

```text
Codex-style Workspace/Session Sidebar | Codex-style Conversation | Resolve Artifact Workspace
                                      |                          | Context
                                      |                          | Active Artifact
                                      |                          | Changes / Plan
                                      |                          | Evidence / Inspector
```

The user and Agent share one semantic project representation. Project/Media/Edit/Fusion/Color/Fairlight/Deliver remain capability domains/lenses, not seven separate mini-applications that recompute facts independently.

### 4.1 Codex-style Workspace/Session Sidebar

The CID visual shell projects COS durable Session/Worker state under a first-class CID Workspace hierarchy:

```text
Workspace A <-> one Resolve Project identity
  New Chat
  durable/recent Sessions
    expandable Worker activity/history
Workspace B
Activity / execution history
connection status / setup
Settings
```

CID must not maintain a second Session lifecycle model. Resolve Project names are labels; CID Workspace identity survives rename. Cross-project Goals reference multiple Workspaces, while stateful Resolve execution has exactly one Active Resolve Target at a time.

### 4.2 Codex-style Conversation pane

The middle pane is rendered by CID in Codex style but backed by the COS-owned durable user/Agent conversation and remains visible while the right Active Artifact changes.

It contains:

- user and Agent messages;
- compact semantic action progress instead of generic tool-call walls;
- `SharedFocus` chips such as `Documentary Cut 03 [T2] / V2 / Interview 04 [I31]`;
- an expandable lightweight Context projection showing what Workspace/focus/evidence/artifacts this turn exposes to the model and what remains local;
- links to exact right-pane entities, evidence, plans and execution traces;
- local approval/decision entry points when required;
- the composer.

Provider names, raw JSON, tool schemas, exact UUIDs, token counters and debugging internals are not ordinary conversation chrome.

### 4.3 Resolve Artifact Workspace

The right pane receives the largest expansion priority. It is a human-readable projection of the Resolve World Model, current task and semantic consequences of Agent action, not a fake copy of Resolve's native UI and not a dashboard of equal-weight cards.

Stable four-layer shape:

```text
Context                 Workspace / Project / Timeline / SharedFocus / freshness
Active Artifact         contextual Timeline / Media Review / Fusion / Color / Audio / Deliver / Project
Changes / Plan          proposed -> approved -> executing -> applied -> verified/contradicted/ambiguous
Evidence / Inspector    provenance, verification, limitations and developer detail on demand
```

The Active Artifact soft-follows the Agent only when the user is not actively inspecting or Pinning another Artifact. User navigation wins; Pin disables automatic switching. Selecting an object updates `SharedFocus` only. `Reveal in Resolve` is the explicit side effect that changes Resolve UI/page/playhead/selection.

Direct semantic Workspace controls use the same ToolKernel/risk/Plan/ChangeSet/verification path as Agent-originated actions. High-risk approvals require full Workspace review; low/medium-risk work may expose Chat quick approval backed by the same canonical approval state.

### 4.4 Capability-domain Artifact lenses

#### Project

The project-level situation view.

Contains:

- current Resolve version and current page;
- current project identity;
- current timeline identity;
- timeline count and track counts;
- media pool summary;
- color pipeline summary;
- render settings summary;
- project preflight result;
- warnings and blockers;
- approved project locations when relevant.

#### Media

Focused on Media Pool and source state.

Read-only first:

- bin/folder context;
- source/media inventory;
- offline or missing references;
- proxy/full-resolution state where measurable;
- metadata needed by later sync/conform workflows;
- frame-rate/resolution consistency facts;
- source-media safety state.

Later protected actions may cover safe ingest/organization and reviewed metadata operations. Source files remain immutable by default.

#### Edit

Focused on timeline and editorial state.

Read-only first:

- tracks and item counts;
- gaps and overlaps;
- missing/offline media references;
- source ranges;
- timeline markers and annotations;
- transitions and unsupported-interchange risks;
- subtitle coverage;
- timeline version / protection state;
- multicam readiness and sync diagnostics.

Later protected actions:

- markers;
- bounded metadata edits;
- track-safe operations;
- deterministic insert/move/duplicate workflows;
- conform planning and reviewed execution.

#### Fusion

Read-only first:

- composition presence;
- tool inventory;
- input/port inventory;
- graph connectivity;
- known API/readback limitations relevant to the current build.

Later protected writes may create/connect approved deterministic structures, with render verification whenever ordinary API readback cannot prove the visible result.

#### Color

Read-only first:

- project color management;
- timeline color settings;
- clip/group/timeline graph inventory where supported;
- LUT/DCTL usage;
- grade versions;
- group membership;
- node counts and structural warnings;
- inconsistent input/output transforms;
- ungraded or structurally unusual clips.

Later protected actions:

- version creation;
- bounded metadata/label operations;
- CDL validation/application;
- approved LUT/DCTL workflows;
- grade copy/match workflows with snapshot/readback policy;
- Base Tree deployment only after explicit protection rules exist.

#### Fairlight

Read-only first:

- audio track count;
- channel mapping;
- source audio mapping;
- silence / dead-space indicators when supported by an approved analysis backend;
- subtitle/transcription capability state;
- Fairlight routing and preset availability;
- sync readiness.

Later protected actions:

- safe property edits;
- marker/writeback workflows;
- audio sync plans;
- Fairlight preset application where the previous state can be verified.

#### Deliver

Read-only first:

- render format and codec;
- timeline/output resolution;
- frame rate;
- render range;
- output path policy;
- queued render jobs;
- filename collision risk;
- offline media blockers;
- audio/subtitle inclusion;
- delivery preset status;
- deliverable QC result.

Execution later requires explicit local approval before starting a final render.

#### Activity

Activity is an application-level evidence/trace destination reachable from the Sidebar rather than a peer Resolve domain tab.

Contains:

- recent protected tool calls;
- plans;
- approvals/rejections;
- execution steps;
- risk classification;
- durations;
- semantic changes;
- verification results;
- warnings;
- ambiguous results;
- recovery/compensation outcome where one exists;
- operational connection events in a separate diagnostic subsection.

Arguments, API keys, arbitrary scripts, large Resolve responses and client media payloads must not be dumped into the activity stream.

#### Settings

Settings remains an application utility destination in the Sidebar rather than a peer Resolve domain.

Contains:

- Setup;
- OpenAI Secure MCP Tunnel configuration;
- API key saved state and suffix;
- auto-connect;
- background/menu-bar behavior;
- launch at login;
- language;
- diagnostics detail;
- future workflow policy switches when they represent real product choices.

### 4.5 Layout and responsive behavior

At comfortable desktop widths, initial targets are:

```text
Session Sidebar      about 200–280 px, resizable/collapsible
Conversation         about 480–680 px, resizable
Artifact Workspace   remaining width; highest expansion priority
```

The Conversation/Artifact splitter is a presentation control only. It does not create duplicate state or authority. When width becomes constrained, shrink Conversation toward its minimum before sacrificing the right production workspace. At very narrow widths, the Artifact Workspace may become a switchable/overlay view rather than forcing two unusably narrow panes.

The Floating Topbar may remain temporarily as rollback/migration provenance while the three-pane shell is implemented, but new interaction semantics target the four-layer Resolve Artifact Workspace rather than extending the old peer-page structure.

## 5. Setup specification

Setup remains the single place where a non-technical user completes initial configuration.

Current flow stays:

1. detect DaVinci Resolve;
2. choose project directory, optional;
3. create tunnel;
4. create API key;
5. start tunnel;
6. add to ChatGPT.

Setup requirements:

- detect what can be detected automatically;
- keep external OpenAI instructions exact and short;
- API key field guidance remains `Owned by: You`, optional name `Chat in DaVinci`, same organization/project as the tunnel, Permissions `All`;
- keep the one-time key warning to: `请立即复制一次，平台之后不会再次显示它。`;
- tunnel-client is bundled and invisible to normal users;
- system permissions are requested only when a real feature needs them;
- current Raw/Workflow Resolve access does not require Screen Recording, Accessibility or Full Disk Access;
- new required system permissions must be integrated into Setup rather than creating an unrelated second onboarding flow.

## 6. Runtime architecture

Target runtime:

```text
COS ChatGPT / Session / Goal / Prime-Worker runtime
  -> GoalFrame / TaskGraph
  -> CID SituationFrame / SharedFocus / completion gap
  -> Context Compiler -> DecisionFrame / ContextPack
  -> Capability Frontier / ActionOffers
  -> one CID Tunnel / MCP Gateway
  -> ToolKernel / CallContext
  -> immutable Plan when required
  -> CID Safety Plane / approval / backup / verification
  -> ResolveScheduler / one Active Resolve Target / one authority
  -> best-qualified sealed implementation
  -> DaVinci Resolve

Resolve observations / executions
  -> EvidenceRefs / Analysis Artifacts
  -> ActionResult / actual SemanticDelta -> update Goal-grouped ChangeSet
  -> Resolve World Model
  -> SituationFrame / CompletionReport
  -> next DecisionFrame + Codex-style Conversation + Resolve Artifact Workspace
```

Raw remains a separate advanced official connector. It does not inherit protected guarantees.

### 6.1 One authority

The app owns exactly one live Resolve scripting authority. Current implementation is one `ResolveBroker` with one Blackmagic ResolveMCP child. A tunnel, Agent, Worker, page, verifier or helper cannot spawn a parallel persistent Resolve session.

### 6.2 ResolveScheduler

The scheduler is required before broad Agent/Worker execution because the current broker can hold multiple pending RPCs. It serializes at least:

- page-changing calls;
- calls whose correctness depends on current project/timeline/page state;
- all protected mutations;
- render state transitions;
- page-sensitive Fusion/Color operations.

Independent local analysis may run concurrently.

### 6.3 Unified ToolKernel / Action Catalog

The public protected tool set remains small:

```text
status
inspect
inspect_operation
audit
plan
execute
```

Those entry points, local UI actions and Agent calls resolve to the same internal registered action owner. Hundreds of internal domain actions do not imply hundreds of model-visible schemas.

The internal catalog evolves toward richer `ActionDescriptor` metadata covering target kinds, preconditions, read/write sets, state sensitivity, retry/idempotency, expected semantic effects, verification, remediation and resource-cost hints. The Context Compiler exposes only the descriptors relevant to the current goal/focus/state. Visibility is not authorization.

### 6.4 Agent plane

Agent runtime is a first-class product subsystem:

```text
Conversation
Session
durable turns
Compact & Resume
continuation/handoff
Goal / Loop
Prime / Workers
```

These upper lifecycle capabilities are now owned by COS. CID consumes the resulting Agent/tool intent through its single Tunnel/MCP Gateway boundary and does not retain a parallel durable conversation authority as the target architecture. The existing CID `ModelProvider`/`TurnRunner` implementation remains migration provenance only.

Before broad Goal/Loop autonomy, insert the Agent System Spine defined in `AGENT_SYSTEM_SPEC.md`:

```text
EntityRef / EvidenceRef
Resolve World Model
SituationFrame
SharedFocus
Context Compiler
ExecutionTrace resource metrics
```

Compact & Resume then carries durable intent/open obligations and semantic references while current machine state is rehydrated through the World Model when necessary.

### 6.4.1 Resolve World Model

The World Model is the canonical semantic projection of current observed Resolve state. It is demand-driven, generation-scoped and evidence-linked. It is not a second live Resolve authority, a database mirror or an excuse for whole-project polling.

### 6.4.2 SituationFrame and Context Compiler

`SituationFrame` is the compact current-state summary used for Agent orientation. The Context Compiler combines the active Goal criterion, SituationFrame (including SharedFocus/completion gap), fresh facts/deltas and the state-bound Capability Frontier into a derived DecisionFrame serialized as a bounded model-visible `ContextPack` per decision.

Full local state remains local. This makes capability growth sublinear in prompt/tool cost instead of requiring every future Agent turn to reread every capability and domain fact.

### 6.4.3 SharedFocus and semantic links

The Resolve Artifact Workspace, Conversation, Plans, ChangeSets, Jobs and Activity use common `WorkspaceRef`/`EntityRef`/`EvidenceRef` identities. User selection updates `SharedFocus`; Agent references can navigate/highlight the same entity. Focus is convenience/context only and never substitutes for exact Plan binding or implicitly move Resolve UI.

### 6.5 Domain engine and Samuel reuse

Reuse, port or wrap Samuel's domain kernels, API truth, readback, page-lock, versioning and concrete capability implementations behind CID-owned adapters. Do not start Samuel as a second live Resolve authority. Requalify every imported behavior against CID's supported Resolve build and safety contract.

### 6.6 Analysis and fallback tiers

Analysis/verification may use FFprobe/FFmpeg, transcription, frame extraction, vision, image QC and audio QC when a workflow needs them. Preferred flow:

```text
compute offline
  -> report/artifact/plan
  -> validate live target
  -> local approval if required
  -> Resolve apply
  -> API/render/file verification
```

UI Automation and direct offline project-data mutation require separate explicit security boundaries and user-visible capability status.

## 7. Workflow registry

Every production workflow should have one versioned definition.

Required metadata:

```text
workflow_id
workflow_version
domain
title
description
read_only
routing_summary
not_for
risk_level
blast_radius
risk_policy
required_capabilities
supported_resolve_versions
capability_policy
input_schema
preconditions
reader_template_ids
writer_template_ids
verification_template_ids
verification_level
verification_contract
preview_mode: native | derived_plan | unavailable
locality: resolve | local_analysis | offline_adapter
deterministic
recovery_class
approval_policy
```

The registry, not the renderer, decides what workflows exist and what they can do.

Any workflow that can write must be explicitly registered as a writer. A write path that is callable but absent from the registry is a release-blocking defect, because risk, approval, backup and verification policy would otherwise be bypassed.

The UI renders registry/projected state.

## 8. Read-only project state

The first project reader uses Blackmagic's sandboxed `run_script` with an app-owned, fixed getter-only template.

The model supplies no Python.

Current minimum project snapshot:

```text
observed_at
resolve_version
current_page

project:
  name
  unique_id
  timeline_count

timeline:
  name
  unique_id
  video_tracks
  audio_tracks
  subtitle_tracks
```

Expand this only through reviewed readers.

Next read-only slices:

### 8.1 `media.inventory_summary.v1`

- root folder identity;
- bin count;
- source clip count;
- timeline/compound/generated item count where distinguishable;
- offline/missing indicators;
- proxy/optimized/full-resolution state where exposed;
- media type summary;
- mixed frame-rate/resolution flags;
- source-media safety status.

### 8.2 `edit.timeline_summary.v1`

- current timeline identity;
- duration/range;
- track counts;
- item counts by track;
- subtitle count;
- gap/overlap indicators;
- marker count;
- protected/locked state where measurable;
- source-range and offline-reference blockers.

### 8.3 `color.pipeline_inspect.v1`

- project color science;
- timeline color settings;
- input/output transform state;
- LUT/DCTL references;
- group/clip/timeline grade-layer inventory;
- high-confidence structural warnings only.

### 8.4 `fairlight.mapping_inspect.v1`

- audio tracks;
- channel layout;
- source mappings;
- Fairlight preset/capability state;
- subtitle/transcription capability state;
- measurable sync warnings.

### 8.5 `deliver.settings_inspect.v1`

- current render settings;
- selected format/codec;
- resolution/frame rate;
- output path;
- range;
- queued jobs;
- final-render readiness blockers.

## 9. Project preflight

`project_preflight` is the first major compound production workflow.

It is read-only.

Inputs should be minimal:

```text
scope: current project/current timeline
profile: general | media | edit | fusion | color | fairlight | delivery
```

It should aggregate the approved read-only readers and return:

```text
status: pass | warning | blocked | unverified
project_identity
timeline_identity
checks[]
warnings[]
blockers[]
capability_gaps[]
observed_at
schema_hash
```

It must distinguish:

- checked and passed;
- checked and failed;
- unavailable capability;
- unverified because the reader did not establish the fact.

No preflight check may run a mutation to discover whether an operation would work.

## 10. Professional workflow directions

The reference Resolve MCP project demonstrates broad capability. Chat in DaVinci should absorb it as product workflows in controlled vertical slices.

### 10.1 Editorial intake

Read-only:

- project/timeline inventory;
- frame-rate/resolution mismatches;
- source/reference availability;
- tracks and item structure;
- markers;
- subtitles;
- media pool organization.

Later:

- approved bin organization;
- marker/metadata normalization;
- timeline duplication before structural changes.

### 10.2 Media ingest and organization

Read-only first:

- source clip inventory;
- image sequence detection;
- metadata inventory;
- proxy/full-res state;
- missing media;
- duplicates/candidate duplicates;
- source path/reporting without source modification.

Later:

- safe import;
- bin organization;
- project metadata writeback;
- relink/proxy plans.

### 10.3 Multicam and sync prep

Read-only first:

- candidate angles;
- camera/audio mapping;
- timecode availability;
- source duration overlaps;
- existing sync state;
- capability check for native Resolve functions.

Later:

- stacked prep timeline;
- marker-based sync proposals;
- explicit user-reviewed native multicam creation where supported.

### 10.4 Conform

Treat conform as a plan-driven workflow, not a generic write tool.

Plan should report:

- exact source/timeline identities;
- match evidence;
- unmatched clips;
- ambiguous candidates;
- handle/range conflicts;
- offline references;
- expected moves/relinks;
- recovery strategy.

Filename-only matching is never sufficient.

### 10.5 Review and annotations

Good early write candidate because many operations are bounded and reversible when previous state is captured.

Potential workflows:

- add/remove review marker;
- copy markers;
- set flags;
- set clip color;
- generate review report;
- marker thumbnail QC.

Each mutation still needs risk classification and readback.

### 10.6 Color

Progression:

1. inspect project color pipeline;
2. inspect grade structure;
3. compare/version state;
4. plan bounded grade changes;
5. snapshot/version;
6. execute;
7. read back graph/version state.

Do not introduce automatic creative grading as an early workflow.

### 10.7 Fusion

Read-only first:

- composition presence;
- tool inventory;
- inputs/ports;
- graph connectivity.

Later protected writes may create or connect known safe tools through deterministic templates.

### 10.8 Fairlight / audio

Read-only first:

- track layout;
- clip/source audio mapping;
- bus/preset capability;
- transcription/subtitle capability;
- measurable level/silence/sync facts where a reviewed analysis backend exists.

Later:

- safe property changes;
- approved Fairlight preset application;
- sync operations;
- transcription/subtitle workflows.

### 10.9 Delivery

Read-only delivery QC comes before rendering.

Potential checks:

- format/codec support;
- project/timeline/output frame-rate agreement;
- resolution/aspect agreement;
- render range;
- audio routing;
- subtitle inclusion;
- offline media;
- output destination;
- collision/overwrite risk;
- queued job state.

Final render execution requires explicit local approval.

## 11. Media analysis

Media analysis is useful but introduces a separate trust/performance boundary from Resolve control.

The reference project demonstrates FFprobe/FFmpeg, transcription, embeddings, visual analysis, source-safe reports and metadata writeback.

Chat in DaVinci should add analysis only when a concrete workflow requires it.

Rules:

- no source file modification;
- analysis output goes to app-owned scratch/report storage or approved project analysis storage;
- optional external binaries/models are capability-gated;
- missing analysis capability is reported honestly;
- large media analysis must be job-based and cancellable where safe;
- analysis results carry provenance and timestamps;
- model-visible output is summarized and bounded;
- full analysis artifacts stay local unless the user explicitly asks to export them.

Early candidates:

- media metadata inventory;
- missing/offline detection;
- frame-rate/resolution consistency;
- audio silence/level scan when a concrete Fairlight/analysis Capability Pack consumes it;
- transcription as a content-addressed Workspace Analysis Artifact with local-minimal model disclosure and the defined App-owned/optional Workspace Root storage policy.

## 12. Risk model

Use four risk levels:

```text
low
medium
high
critical
```

Use blast radius:

```text
item
track
timeline
project
system
unknown
```

Risk classification must come from the workflow registry and validated operation shape, not from English action names alone.

Unknown/unregistered operations return:

```text
risk_established = false
```

They do not receive a reassuring default classification.

Suggested policy:

### Low

- read-only inspection;
- bounded reversible metadata edits with verified prior value;
- review marker additions when exact target identity is known.

### Medium

- recoverable edits to an existing object;
- timeline item properties;
- bounded graph edits with a verified snapshot/version;
- approved preset application with readback.

### High

- deletes;
- ripple/structural edits;
- batch grade changes;
- relink/conform changes;
- project-wide setting changes;
- broad media pool edits.

### Critical

- project deletion;
- project database changes;
- irreversible system/session-wide changes;
- operations without a truthful recovery path where loss could be severe.

## 13. Plan and approval model

Every mutation plan is immutable after approval.

Minimum plan fields:

```text
plan_id
workflow_id
workflow_version
created_at
expires_at
resolve_version
project_unique_id
timeline_unique_id
input_fingerprint
requested_parameters
proposed_changes
risk_level
blast_radius
recovery_class
preconditions
plan_hash
```

Approval is local App UI state.

The model cannot manufacture approval through MCP input.

Approval record:

```text
plan_id
plan_hash
approved_at
expires_at
approved_scope
```

Execution re-reads project/timeline identities and preconditions before the first write.

A mismatch makes the plan stale.

## 14. Recovery classes

Do not promise universal Undo.

### A. Read-only

No recovery required.

### B. Deterministic compensation

Capture prior value and restore it through a known inverse operation.

### C. Snapshot-protected

Create a timeline/project/grade snapshot or version before mutation.

### D. No automatic recovery guarantee

Require explicit local approval and state that automatic rollback is unavailable.

The recovery class is part of the workflow definition and plan.

## 15. Execution evidence and audit

Borrow the useful distinction from the reference Resolve MCP operation envelope.

One execution should project:

```text
execution_id
workflow_id
status
started_at
ended_at
duration_ms
risk
steps[]
changes
verification
warnings[]
ambiguous
recovery
```

Verification status:

```text
verified
failed
unverified
contradiction
```

`contradiction` means the operation reported success but readback disagreed.

Audit records should avoid:

- API keys;
- arbitrary script source;
- full tool arguments by default;
- full Resolve return payloads;
- media file contents;
- secret local MCP paths.

The existing in-memory bounded call-audit ring may remain for lightweight read/tool summaries, while protected mutation execution evidence is already restart-durable in the append-oriented workflow ledger. Activity projects those owners rather than maintaining a second execution-history truth.

## 16. Tool result semantics

Protected tools should return one consistent operation envelope.

Recommended shape:

```text
result: domain payload

operation:
  status: success | partial | blocked | failed | ambiguous
  execution_id
  risk
  changes
  verification
  warnings
```

Missing `changes` means the workflow did not establish a semantic delta. It must not be silently converted to `{}`.

Missing verification evidence means `unverified`.

## 17. Connection and diagnostics

Reuse COS's separation of health facts.

Display independent checks for:

- Brain: COS Chat/Agent runtime configured and latest model-call/session state available;
- Hands: Resolve installed/running, ResolveMCP reachable, Broker active, ToolKernel/local gateway active, schema hash current;
- CID transport: single Tunnel/MCP Gateway readiness, route freshness, last request/tool call and last tool name/time; advanced/raw policy state is reported separately when enabled.

Brain, CID transport and Hands are distinct health facts. A healthy COS runtime never masks an unavailable CID Tunnel/Gateway or Resolve authority. The user-facing CID Codex-style shell may summarize the highest-priority actionable issue, while CID diagnostics preserve the individual facts.

## 18. Secrets and privacy

- API key plaintext remains main-process only;
- Analysis Store/portable sidecars use ordinary local files and rely on macOS filesystem/FileVault protection; no custom at-rest encryption layer is added to analysis artifacts;
- use macOS Keychain through Electron safeStorage;
- renderer receives only saved state and suffix;
- no secret in config, argv, log, plan, audit or MCP response;
- tunnel ID is a non-secret identifier and may be persisted;
- local MCP random route token never appears in Activity;
- logs and audit exports must be redacted before renderer exposure.

## 19. Project Locations

Project Locations remain optional approved folders for future Workflow-side filesystem operations.

They do not constrain Raw official `run_script_unsafe`.

If a Workflow later reads or writes external project assets:

- resolve paths through one canonical containment owner;
- validate the exact target at use time;
- separate read permission from write permission if the product exposes both;
- source media remains immutable unless the workflow explicitly declares derivative creation.

## 20. State ownership

Follow the COS rule: one fact, one owner.

Suggested authority map:

| Fact | Owner |
| --- | --- |
| app configuration | `config.ts` |
| secret API key | `secrets.ts` |
| model/provider transport | COS runtime |
| conversation/session/turn | COS Session owner |
| CID Workspace identity / Resolve Project 1:1 binding | CID Workspace owner |
| Workspace-scoped Analysis Artifacts / Jobs | CID Analysis Store / Job owner |
| exact user goal/constraints/corrections | COS Goal/Session owner |
| current semantic Resolve state | Resolve World Model owner |
| current human/Agent focus | main-owned SharedFocus |
| model-visible context | Context Compiler output; derived only |
| ToolKernel/action routing | unified ToolKernel / Action Catalog |
| action semantics/affordances | Action Catalog / ActionDescriptor owner |
| complete known capability/gap inventory | Capability Ledger |
| implementation selection/qualification | implementation router + build-specific qualification registry |
| Resolve scheduling/lease | `resolve-scheduler.ts` |
| ResolveMCP process + upstream schema | `ResolveBroker` |
| CID MCP policy surfaces | `resolve-gateway.ts` |
| CID Tunnel process and metrics | `tunnel.ts` |
| connection lifecycle | `connection.ts` |
| workflow definitions | `workflow-registry.ts` |
| raw project/timeline observations | workflow/state readers + EvidenceRefs |
| capability qualification | `resolve-capabilities.ts` |
| plan + plan hash | workflow plan owner |
| semantic mutation transition / ChangeSet | workflow ledger ChangeSet projection |
| criterion-level Resolve completion assessment | derived CompletionReport |
| local approval | approval owner |
| protected execution lifecycle | workflow engine behind ToolKernel |
| durable execution evidence | `workflow-ledger.ts` |
| renderer pane sizes/filter/draft/Pin | renderer only |
| final Sidebar/Conversation visual projection | CID Codex-style renderer backed by COS runtime state |

Never create a second status/watch layer when the existing owner can project the fact.

## 21. Active implementation sequence

The sequence below supersedes page-first/read-only-first roadmaps. Existing readers, ToolKernel, scheduler, World Model and first writer remain baseline evidence; they are not reimplemented. Progress is measured by the integrity of the closed Agent control loop and qualified Capability Packs, not page count or API method count.

### A. Bind the real COS upper runtime

Use COS for ChatGPT Web, Session/Turn, Goal/Loop/Finish, Compact & Resume and Prime/Worker ownership. Retire the parallel CID lifecycle rather than continuing to migrate individual pieces into it.

### B. Final Codex-style shell + Workspace identity

CID owns the final visual Sidebar/Conversation/Artifact Workspace. Establish one CID Workspace <-> one Resolve Project identity, Workspace -> COS Sessions/Workers, Offline Workspace state, App-owned canonical storage and optional portable Workspace Root sidecars.

### C. Close the Agent cognitive loop

Make `GoalFrame -> SituationFrame -> DecisionFrame -> ActionOffer -> Plan/ChangeSet -> Evidence/SemanticDelta -> CompletionReport` the normal cognitive path. SharedFocus enters model context through SituationFrame; World Model and Evidence remain deterministic local memory.

### D. Maintain Capability Ledger breadth-first

Maintain `CAPABILITY_LEDGER.md` breadth-first across Project/Media/Edit/Fusion/Color/Fairlight/Deliver before deep domain expansion. Stable semantic IDs, primitive + workflow layers, implementation candidates, lifecycle state and Resolve-build qualification must exist without exposing the whole ledger to the model.

### E. Implementation routing + qualification

Route by `best-qualified wins; official wins ties`; UI Automation is allowlisted last resort. Passive qualification is read-only; active writer qualification uses disposable fixtures through an explicit Compatibility Check. An approved Plan seals implementation identity/version and cannot silently reroute.

### F. Resolve Artifact Workspace + ChangeSet

Implement Context / Active Artifact / Changes·Plan / Evidence·Inspector, soft-follow + Pin + Reveal in Resolve, semantic Timeline and Media Review local decisions. Every protected mutation, including direct semantic UI controls, creates a Goal/Plan-grouped ChangeSet. Executed and Verified remain distinct.

### G. Safety/recovery spine

Qualify Timeline Version Protection, Human-edit-wins staleness, immutable Rebase, bounded autonomy scopes, ambiguous/no-replay behavior, restart/reconnect refusal and criterion-level CompletionReport.

### H. Depth-first production Capability Packs

Qualify Project + Media + Edit vertical packs, then Fusion + Color with rendered evidence, then Fairlight + Deliver with audio/file verification. Complete one vertical contract at a time without letting untouched domains disappear from the breadth-first ledger.

### I. Analysis Store / Jobs

Add content-addressed transcripts, indexes, thumbnails/contact sheets, shot/audio/QC/conform artifacts only where concrete packs consume them. Local analysis Jobs may resume; write authority never auto-crosses restart/reconnect. Analysis stays local-minimal and does not write back into Resolve by default.

### J. Prime / Workers

After single-Agent control is stable, Workers receive bounded WorkPackets, produce findings/artifacts/candidate plans and never dispatch live Resolve mutations independently.

### K. Explicit fallback/plugin packs

For proven gaps only, add allowlisted Resolve UI Automation, isolated Offline Adapters and CID-trusted plugin Capability Packs. Generic computer control and unknown-plugin parameter authority remain outside protected Workflow.

## 22. Permanent constraints and current non-goals

The following are prohibited shortcuts, even though full Agent orchestration is now a product goal:

- replacing one CID-owned Resolve authority with multiple simultaneous live scripting sessions;
- importing/publishing Samuel's granular tool inventory as the normal Agent API;
- arbitrary model-authored Python or `run_script_unsafe` on Protected Workflow;
- caller-supplied confirmation flags as local approval;
- generic dry-run middleware that can still mutate;
- source-media modification by default;
- universal rollback/Undo claims;
- silent UI Automation;
- silent offline `.drp/.drt/.drx` or project-database mutation;
- claiming creative correctness from measurable technical evidence;
- claiming API readback proves pixels/audio/final-file compliance when stronger evidence is required.

COS multi-Agent, Goal/Loop and Compact & Resume remain product capabilities, but broad autonomy now additionally waits for the Agent System Spine/Context Compiler so capability growth does not linearly increase prompt size, tool ambiguity and rediscovery work.

## 23. Acceptance gates for every new workflow

Before a workflow is considered implemented:

1. its user purpose is clear;
2. it has a stable workflow ID/version;
3. its model input is structured and bounded;
4. it uses the existing Broker and Gateway;
5. it does not expose arbitrary Python;
6. read/write behavior is explicit;
7. project/timeline identity is bound where relevant;
8. risk and blast radius are established or reported unknown;
9. any required approval is local and cannot be model-forged;
10. write recovery claims are truthful;
11. every mutation has readback verification;
12. ambiguous post-dispatch failure is never automatically retried;
13. audit contains enough evidence to explain the result without leaking secrets or large client data;
14. Raw official behavior remains unchanged;
15. the UI renders actual backend state and does not invent success;
16. existing relevant tests pass;
17. a live Resolve validation is used when the behavior cannot be proved by unit tests alone.

## 24. Current implementation baseline to preserve

As of 2026-09-10, the exact source baseline is:

```text
one CID-owned ResolveBroker / one Blackmagic ResolveMCP child
one private local gateway shared by Raw + Workflow
Raw = exact current 14-tool Blackmagic ResolveMCP surface
Protected public tools = status, inspect, inspect_operation, audit, plan, execute
Workflow registry = 24 read-only definitions + 1 writer
Resolve capability registry = 20 entries
sole protected writer = edit.review_marker_add.v1
```

The read-only registry already covers Project, Media, Edit, Fusion, Color, Fairlight, Deliver and Activity. The writer path already has immutable plans, canonical plan hash, exact local approval, durable JSONL ledger, `dispatch_started` durability before side effect, target/fingerprint revalidation, API readback and ambiguous-dispatch no-replay behavior.

The current source also includes Raw/Workflow tunnel routing through the same gateway, Keychain-backed API key handling, Setup, Activity projection, English/Simplified Chinese/System language support, process-tree ownership, Host/Origin guards and bounded request bodies.

The external Raw connector has been end-to-end verified and the local dual-surface gateway exists. That older dual-tunnel acceptance path is historical; the target COS-hosted product requires one CID Tunnel into one CID MCP Gateway, with protected/raw separation enforced inside CID.

The formally installed application can lag the source during active development and is not the source of truth for architecture planning.

The navigation shell supports Floating Topbar and optional Sidebar over shared navigation/workspace state. Presentation choice does not change Agent/ToolKernel/Resolve authority.

## 25. Deep research findings from `samuelgursky/davinci-resolve-mcp`

Research date: 2026-09-09.

The upstream project changes quickly. Tool counts, Resolve-version coverage and individual workflow actions should therefore be treated as observations of the researched revision, not copied into Chat in DaVinci as permanent constants. The useful part is the architecture and the production lessons behind those capabilities.

### 25.1 The strongest idea is the compound workflow surface

The upstream project exposes a compact compound server for ordinary model use and a much larger granular surface for power users. The compound side groups many Resolve operations behind domain tools and action parameters.

This validates the direction already chosen for Chat in DaVinci:

```text
Raw/advanced policy surface
  exact Blackmagic tool declarations

Protected Workflow policy surface
  small stable product surface
  -> domain/workflow actions underneath
```

Chat in DaVinci should not copy the upstream compound schemas one-for-one. The relevant lesson is that hundreds of low-level Resolve methods should not become hundreds of permanently model-visible production actions.

The protected Workflow surface should remain small enough that the model can reason about it reliably. Domain breadth belongs behind validated `inspect`, `plan` and execution workflows.

### 25.2 Operation results need a semantic envelope

The upstream project separates tool transport success from what actually happened in Resolve. Its result envelope tracks operation status, semantic changes, warnings, verification and an execution identity.

This is important because these statements are different:

```text
the RPC call returned
the Resolve API returned true
the requested change appeared in Resolve
the readback matched the requested state
```

Chat in DaVinci should standardize protected Workflow results around one internal shape:

```text
operation:
  status: success | partial | blocked | failed | ambiguous
  workflow_id
  execution_id
  risk
  blast_radius
  changes[]
  warnings[]
  verification:
    status: passed | partial | failed | contradiction | unverified
    checks[]
  recovery:
    class
    status
```

`unverified` is a real result. It must never be rendered as success.

When evidence conflicts, stronger negative evidence wins. A successful handler return cannot hide a failed readback or contradiction. This rule belongs in one Workflow result normalizer, not in individual UI cards.

### 25.3 Risk inspection is useful, but static risk classification is not a preview

The upstream `inspect_operation` classifies risk, destructive potential and blast radius. It also documents an important limitation: this is heuristic classification, not simulation of the requested operation.

Chat in DaVinci should keep the same conceptual distinction:

```text
risk classification
  answers: how dangerous is this category of action?

preflight
  answers: does this exact live project satisfy the prerequisites?

dry run / plan
  answers: what exact change would be attempted on this exact state?
```

If an operation cannot provide a truthful dry run, report `dry_run_unavailable`. Do not manufacture a preview from generic risk metadata.

Risk records should include:

```text
level: low | medium | high | critical
blast_radius: item | clip | track | timeline | project | application | filesystem
destructive: boolean
requires_approval: boolean
required_backup_class
recognised: boolean
```

An unknown action is not low risk. `recognised=false` must remain visible.

### 25.4 Plans need fingerprints, not names

The upstream Edit Plans view preserves dry-run plans and warns when a saved plan no longer matches its source fingerprint. This is a strong production pattern.

Our existing project/timeline unique-ID binding should be extended with workflow-specific fingerprints. A structural edit plan may need:

```text
project_unique_id
timeline_unique_id
timeline_structure_fingerprint
selected_item_ids
relevant_source_ranges
relevant_track_state
workflow_schema_version
```

Execution re-reads those facts. A mismatch makes the plan stale. It does not try to "repair" the plan by finding similarly named clips or timelines.

Names remain display labels only.

### 25.5 Timeline versioning is stronger than a fake Undo button

The upstream project archives timeline versions before destructive timeline operations and keeps a visible edit/version history. This matches Resolve's real limitation: there is no universal scripting Undo that can safely reverse arbitrary project mutations.

For Chat in DaVinci, timeline mutation policy should be:

```text
small reversible property write
  -> capture exact previous value
  -> write
  -> read back

structural timeline mutation
  -> duplicate/archive timeline first
  -> bind backup identity to execution
  -> write
  -> read back

project-wide/high-impact mutation
  -> project backup/export when feasible
  -> explicit local approval
  -> write
  -> read back
```

If the required backup cannot be created, high-impact execution fails closed.

The UI should call this `Version` or `Backup`, not `Undo`, unless a deterministic inverse operation actually exists.

### 25.6 The control panel proves that review UI and execution UI should stay separate

The upstream local control panel exposes project state, media review, history and saved edit plans. A key design detail is that the Edit Plans panel itself does not execute the plan. Execution stays in the MCP/chat path where confirmation and workflow rules apply.

For Chat in DaVinci this maps cleanly to the shared workspace-navigation product, regardless of whether the user selects Floating Topbar or Sidebar:

```text
Project / Media / Edit / Fusion / Color / Fairlight / Deliver
  inspect
  review
  compare
  prepare plan

local approval sheet
  approve/reject the immutable plan

Workflow engine
  execute the approved plan

Activity
  show evidence and result
```

A domain workspace must never become a second mutation engine. UI buttons call the same Workflow owner used by ChatGPT.

### 25.7 Media analysis is a separate product subsystem, not another Resolve reader

The upstream media-analysis system is much deeper than metadata inspection. It contains persisted analysis jobs, transcription, visual sampling, review corrections, search/indexing, shot/entity relationships and metadata/marker publishing.

Useful concepts for Chat in DaVinci:

- source files remain immutable;
- analysis artifacts live under an app-owned project analysis root;
- long analysis runs are persistent jobs rather than one huge MCP call;
- analysis results have version/provenance metadata;
- a report can be reused only when its source/input fingerprint still matches;
- missing or inconsistent previous analysis is surfaced instead of silently re-running;
- human corrections have history and can be reverted;
- incomplete visual analysis remains explicitly incomplete.

The upstream `host_chat_paths -> commit_vision` pattern is clever but should not be copied directly into the initial product. Chat in DaVinci already owns an application and can later provide a cleaner analysis adapter.

If/when visual analysis is added, define an internal job state such as:

```text
queued
extracting
awaiting_visual_analysis
transcribing
merging
publishing
complete
failed
cancelled
```

`awaiting_visual_analysis` cannot be shown as complete simply because frame extraction succeeded.

### 25.8 Analysis memory needs provenance and reuse rules

The upstream project refuses to pretend that old analysis is valid when it cannot validate the associated report. This is relevant if Chat in DaVinci later stores project intelligence.

Every reusable analysis artifact should bind at least:

```text
project_unique_id
media_pool_item_unique_id where available
source_file_fingerprint
analysis_profile
analysis_version
created_at
inputs_hash
output_hash
```

Reuse states:

```text
valid
stale
missing_source
missing_report
incompatible_version
unknown
```

Only `valid` may be reused automatically.

### 25.9 Resolve capability detection needs its own truth layer

The upstream project has accumulated a large `api_truth` ledger because Resolve scripting has real behavioral gaps, silent failures and version-specific quirks. One especially important documented problem is that Python Resolve objects can fabricate callable attributes, so naïve `hasattr` checks are unreliable.

Chat in DaVinci should not assume that the presence of a method name, a successful RPC call or the installed Resolve version proves a feature works.

Our source of truth should have three levels:

```text
declared capability
  official ResolveMCP schema / official scripting docs

runtime capability
  observed availability on the running Resolve build

behavioral qualification
  known verified limitation, requirement or bad behavior
```

Add an app-owned `ResolveCapabilityRegistry` only when the read-only domain workspaces require these facts. Do not attempt to mirror the entire upstream ledger now.

Initial registry entries should cover only behavior our Workflow uses.

Example:

```text
capability_id
resolve_version_range
surface
status: available | unavailable | conditional | unreliable | unknown
requirements[]
known_limitations[]
evidence
```

This registry informs Workflow validation. It must not modify or reinterpret the Raw connector's official schemas.

### 25.10 Some Resolve readbacks are themselves misleading

The upstream research contains cases where an API value can read back as though it was written while the actual render does not reflect the change. Fusion is a concrete example documented by that project.

This means Chat in DaVinci needs verification levels:

```text
API_READBACK
STRUCTURAL_READBACK
RENDER_VERIFIED
AUDIO_VERIFIED
DELIVERABLE_VERIFIED
```

A workflow declares the minimum verification level it needs.

Examples:

- marker metadata may accept `API_READBACK`;
- timeline structural changes need `STRUCTURAL_READBACK`;
- a claim that Fusion or grading visually changed the shot may need `RENDER_VERIFIED`;
- a claim that Fairlight processing audibly/measurably changed output may need `AUDIO_VERIFIED`;
- final delivery compliance needs `DELIVERABLE_VERIFIED` against the produced file.

The Activity view should display the actual verification level, not merely a green check.

### 25.11 Render and delivery should be validation-first

The upstream project treats deliverables as a QC problem as much as a render-start problem. Its offline advanced surface can inspect codec, dimensions, loudness and compliance after rendering.

Chat in DaVinci should split Deliver into:

```text
Render Plan
  target preset
  timeline/range
  format/codec
  output path
  audio/subtitle choices
  collision checks
  expected files

Render Execute
  explicit local approval
  queue/start
  monitor job

Delivery Verify
  actual file exists
  metadata/probe matches plan
  optional loudness/QC checks
  final status
```

"Render job completed" alone is not final-delivery verification.

### 25.12 The offline advanced server is strategically useful, but too powerful for the near-term runtime

The upstream project now contains an optional Node server for `.drp`, `.drt`, `.drx`, project database, conform, offline grading, deliverable QC and provenance. Its own design rule is essentially "compute offline, apply live" for tasks where direct scripting is weak.

This is valuable as a future architecture direction for Chat in DaVinci:

```text
Workflow engine
  -> live Resolve adapter
  -> optional offline analysis/codec adapters
```

Potential future uses:

- deterministic conform math/QC;
- interchange parsing;
- `.drx` inspection and comparison;
- delivery-file QC;
- provenance reports;
- offline frame/audio measurement.

Do not add offline project DB mutation, `.drp/.drt/.drx` authoring or grade injection to the first product phases. Those capabilities bypass some of the safety properties of a live Resolve session and need a separate threat/recovery model.

The future extension point should be an app-owned internal adapter, not another unrestricted Workflow MCP surface.

### 25.13 Conform needs evidence and lineage

The upstream conform work reinforces the existing rule that filename matching is insufficient.

A production conform plan should reason with evidence such as:

```text
source unique identity where available
reel/tape metadata
source path
timecode range
frame rate
duration
source frame range
media hash/fingerprint when needed
candidate score with reasons
```

Ambiguous matches remain unresolved. They are never auto-selected merely because one filename is close.

After conform, store a lineage record between the prior and new timeline/source mapping so later color-trace or delivery-QC workflows can explain where each item came from.

### 25.14 Editorial intelligence must distinguish measurable evidence from creative judgment

The upstream project explicitly separates measurable assistance from subjective editorial judgment. For example, silence, transcript continuity and source coverage can be measured; "best take" and "good edit" cannot be established from those measurements alone.

Chat in DaVinci should preserve that line in both tool descriptions and UI copy.

Allowed machine claims should look like:

```text
long pause detected
dialogue overlap detected
source range missing
candidate take has fewer transcription restarts
timeline gap exists
```

Avoid claims such as:

```text
this is the best performance
this cut is better
this grade is more cinematic
```

unless a user has defined a concrete measurable target that can actually be evaluated.

### 25.15 Color workflows need technical QC before creative automation

The upstream project contains extensive grading and `.drx` work, but that breadth should not push Chat in DaVinci toward early automatic grading.

The useful near-term order remains:

```text
inspect color-management state
inspect group/clip/timeline graph structure
detect transform/LUT inconsistencies
inspect versions and grade presence
compare requested vs actual technical state
```

Then add narrow deterministic operations such as creating a version, validating/applying a CDL, or deploying an approved preset/tree with backup and render verification.

Creative shot matching or automatic look creation belongs much later and should remain opt-in.

### 25.16 Governance tiers are useful only when tied to concrete budgets

The upstream control panel includes session governance tiers and usage gauges for costly/local AI operations. The pattern is useful, but generic "safe / unsafe" modes would add complexity without a defined policy.

Chat in DaVinci should introduce governance tiers only when there are multiple operations that consume a measurable resource or share a meaningful risk budget.

Possible future budgets:

```text
generated media count
render minutes
analysis frames
transcription minutes
disk output size
number of project/timeline mutations
```

Until those workflows exist, use explicit per-operation approval and risk policy instead of adding a global tier UI.

### 25.17 Provenance should answer "why is the project like this?"

The upstream advanced surface treats provenance as a product feature rather than only a log.

Chat in DaVinci Activity should eventually support queries such as:

```text
Why was this timeline changed?
Which approved plan produced this marker/grade/render?
Which project/timeline version existed before the change?
Was the result actually verified?
Which source analysis supported the decision?
```

This requires stable links among:

```text
plan_id
approval_id
execution_id
project/timeline identities
backup/version id
analysis artifact ids
semantic changes
verification evidence
```

The audit ledger should therefore be designed as structured evidence from the beginning, even if the first UI shows only a compact timeline.

## 26. Product capability map after the deep research

The following table is the current decision boundary.

| Upstream idea/capability | Chat in DaVinci decision | Timing |
| --- | --- | --- |
| Compound domain tools | Adopt concept | Current architecture |
| Full granular API surface | Keep only through Blackmagic Raw | Current |
| Operation semantic envelope | Adopt | Before first mutation |
| Risk + blast radius | Adopt | Current/read-only now, strengthen before writes |
| Dry-run distinction | Adopt | Plan engine |
| Plan fingerprints | Adopt | Plan engine |
| Timeline auto-versioning before destructive edits | Adopt concept | First structural edit |
| Execution traces | Adopt in smaller form | Before first mutation |
| Control-panel review workspaces | Adopt product pattern | Shared Sidebar/Conversation/DaVinci cockpit |
| Persisted Workspace-owned analysis jobs | Adopt when a concrete Capability Pack consumes them | Capability-dependent |
| Analysis correction/history | Adopt if analysis is added | Later |
| Search/semantic media index | Content-addressed Analysis Artifact when a concrete workflow consumes it | Capability-dependent |
| Source-media immutability | Adopt | Permanent invariant |
| API truth / capability qualification | Adopt narrowly | Read-only domain expansion |
| Render-level verification | Adopt where visual state matters | Color/Fusion/Deliver phases |
| Delivery-file QC | Adopt | Deliver phase |
| Offline conform/QC computation | Strong future candidate | After live workflows |
| `.drx` offline parsing/inspection | Future candidate | Color phase |
| Offline `.drp/.drt/.drx` writes | Defer with separate review | Advanced phase |
| Project DB mutation | Reject for near term | Advanced phase only if justified |
| Creative edit/grade | Allow only through explicit Goal-bound user authorization + qualified capability contract; model strength alone never raises autonomy | After deterministic control and verification |
| Governance tiers | Defer until measurable budgets exist | Later |
| Provenance graph | Adopt incrementally | Start with plan/approval/execution IDs |

## 27. Revised capability-domain Artifact lenses

The current Topbar/peer-page layout is historical implementation provenance. The active target is the shared cockpit from section 4:

```text
Codex-style Workspace/Session Sidebar | persistent Codex-style Conversation | Resolve Artifact Workspace
                                                                           | Context
                                                                           | Active Artifact
                                                                           | Changes / Plan
                                                                           | Evidence / Inspector
```

Activity, connection/setup and Settings remain application-level destinations. CID owns the final renderer; COS owns durable Session/Conversation runtime state beneath it. Project/Media/Edit/Fusion/Color/Fairlight/Deliver are capability domains/lenses feeding the contextual Active Artifact, not independent canonical state owners or mandatory tabs.

The deeper research changes what each domain lens supplies.

### Project

Supplies:

- current project/timeline identity;
- project preflight;
- media-pool inventory summary;
- source integrity warnings;
- color-management summary;
- timeline structural summary;
- capability/build limitations relevant to the project;
- project/timeline backup/version history.

### Media

Supplies:

- Media Pool/bin inventory;
- source/offline/proxy state;
- metadata and source-identity facts;
- ingest/organization readiness;
- source-level evidence used later by sync/conform workflows;
- source-safety warnings.

### Edit

Supplies:

- track/item structure;
- gaps/overlaps;
- source-range inspection;
- marker/review operations;
- subtitle/transcript alignment facts;
- multicam/sync readiness;
- saved edit plans;
- stale-plan/fingerprint warnings;
- conform plan and lineage later.

### Fusion

Supplies:

- composition inventory;
- tool/input/port structure;
- graph connectivity;
- Fusion-specific capability limitations;
- future deterministic graph plans;
- render-verification evidence where a visual claim requires it.

### Color

Supplies:

- color pipeline state;
- group/clip/timeline graph inventory;
- LUT/DCTL presence;
- grade versions;
- technical inconsistency warnings;
- future version/CDL/preset plans;
- verification level, including render verification when required.

### Fairlight

Supplies:

- tracks and channel mapping;
- source mapping;
- Fairlight capability/presets;
- transcript/sync readiness;
- measurable silence/level/QC facts when the analysis backend exists;
- future bounded audio/Fairlight plans.

### Deliver

Supplies:

- render plan;
- format/codec/range/output checks;
- job queue and run state;
- final local approval;
- output-file verification;
- future loudness/compliance QC.

### Activity

Supplies:

- plan history;
- local approvals/rejections;
- execution traces;
- semantic changes;
- backup/version links;
- verification results and level;
- ambiguous outcomes;
- recovery/compensation results;
- provenance links;
- connection diagnostics in a separate subsection.

## 28. Agent Workbench domain expansion

Section 21 is the active architecture sequence. Domain work then expands by complete user workflows rather than API-method counts.

Target coverage:

```text
Project
  create/open/save/close, settings, import/export, archive/restore,
  project/timeline lifecycle and provenance where safely reachable

Media
  ingest, bin organization, metadata, relink/unlink, proxy/full-resolution links,
  sync/multicam preparation, transcription/analysis and source-safe intelligence

Edit
  timeline create/duplicate/version, insert/move/copy/delete/ripple,
  transitions, retime, titles/subtitles, conform, multicam, sync and lineage

Fusion
  composition lifecycle, tool add/delete, validated inputs/connections,
  expressions/keyframes/masks/templates and render verification

Color
  grade versions, CDL, LUT/DCTL, DRX/look, copy/match, Color Groups,
  Gallery/still where qualified, Base Tree and rendered-frame verification

Fairlight
  qualified property writes, Voice Isolation, sync, transcription/subtitles,
  approved presets and audio/loudness QC; public API gaps stay explicit

Deliver
  render intent -> plan -> local approval -> settings/job/start/monitor
  -> locate produced file -> file QC -> deliverable verification
```

A mature end-to-end acceptance scenario is a user goal such as organizing documentary media, synchronizing it, creating a roughly three-minute edit, applying a technical grade, processing dialogue, generating subtitles, rendering 4K H.264 and verifying the produced file. Completion requires durable session continuation, exact Plan/approval evidence, Goal-grouped ChangeSets, safe versions where required, final verification/provenance and no unresolved ambiguity. ACI evaluation also measures redundant observations, model turns/tokens, Resolve calls and unnecessary user interruptions.

If the official Scripting API has a hard gap, the product reports the gap or invokes a separately approved fallback tier. It never disguises an approximate operation as the missing native primitive.

## 29. New invariants derived from the research

These rules are now part of the product specification:

1. A successful Resolve/API call is not automatically a verified operation.
2. Contradicting readback evidence outranks handler success.
3. Unknown verification remains `unverified`.
4. Static risk inspection is not a dry run.
5. A plan executes only against the exact project/timeline/input fingerprint it was created for.
6. Structural timeline writes require a truthful backup/version strategy.
7. Domain UI never owns a second execution path.
8. Source media is immutable unless the user explicitly requests a source-media operation designed for that purpose.
9. Resolve capability claims must distinguish declared, runtime-observed and behaviorally-qualified support.
10. Visual-state claims use render verification when ordinary API readback cannot prove the pixels changed.
11. Render completion and deliverable verification are separate facts.
12. Reusable analysis requires provenance and a matching input fingerprint.
13. Missing analysis evidence is not permission to silently regenerate or claim success.
14. Measurable editorial evidence must not be presented as creative judgment.
15. Offline file/DB manipulation remains a separate high-trust subsystem and cannot silently appear behind an ordinary Workflow action.
16. Provenance links plan, approval, execution, backup and verification from the first write workflow onward.

## 30. Second-pass code-level findings from upstream v2.217.0

This pass reviewed the current upstream `origin/main` at commit `33131d5d94e654f181d78c6f27a09fe790b9b339`, not only the earlier v2.216.1 snapshot. The purpose was to inspect the enforcement mechanisms behind the documented features and identify design rules worth carrying into Chat in DaVinci.

### 30.1 A write registry is part of the security boundary

The v2.217.0 release added native Resolve 21.1 speed and fade setters. The important lesson is not the setters themselves. When the contributed actions first landed, they changed Resolve but were not yet known to the destructive-action registry. That meant the surrounding risk classifier, safe-mode policy, dry-run refusal, operation log and version-on-mutate path could all treat a real mutation as if it were outside the protected set.

The upstream release corrected this by registering the actions as destructive and pinning that classification with tests.

Chat in DaVinci should make the invariant stronger and simpler:

```text
no registered workflow definition
  -> no protected writer can dispatch

registered read-only workflow
  -> writer_template_ids must be empty

registered write workflow
  -> risk + blast radius + approval + recovery + verification are mandatory
```

The registry must not infer mutability from tool names such as `set_*`, `delete_*` or `apply_*`. Names are useful for review, not authority.

This applies only to the protected Workflow surface. Raw remains a faithful proxy of the official Blackmagic surface and is intentionally outside Workflow guarantees.

### 30.2 Write/read symmetry should be an admission rule for protected workflows

The upstream repository generates a read/write symmetry audit. At the researched revision it found many write-style actions whose readback relationship is less direct than their setter name suggests, including several high-signal setters without a direct known getter.

The exact counts will change. The product lesson is stable: implementing a setter is easier than proving the setter worked.

Every Chat in DaVinci write workflow therefore needs an explicit verification contract before it becomes executable:

```text
verification_contract:
  requested_change
  readback_source
  comparison_rule
  required_level
  contradiction_rule
  timeout_or_completion_rule
```

Allowed verification sources:

```text
direct API getter
structural re-enumeration
export/re-import comparison
rendered-frame evidence
produced-file probe/QC
```

If none can establish the promised outcome, the Workflow must either remain read-only or state that the requested guarantee is unavailable. A successful API return alone is insufficient.

### 30.3 Verification level belongs in the workflow definition

Upstream research repeatedly shows that different operations require different evidence. One field readback may prove a marker. The same class of API readback may be too weak to prove that a visual effect changed rendered pixels.

Use these levels:

```text
API_READBACK
STRUCTURAL_READBACK
RENDER_VERIFIED
AUDIO_VERIFIED
DELIVERABLE_VERIFIED
```

Each write workflow declares one minimum level. The engine may collect stronger evidence, but it may not silently downgrade the required level.

Examples:

```text
review marker write        -> API_READBACK
timeline structural edit   -> STRUCTURAL_READBACK
grade/Fusion visual claim  -> RENDER_VERIFIED
Fairlight audible/QC claim -> AUDIO_VERIFIED
final delivery claim       -> DELIVERABLE_VERIFIED
```

The user interface should show the level that was actually reached.

### 30.4 Resolve version support needs evidence provenance, not a version-number guess

The upstream project keeps patch-level version gates because Resolve scripting surfaces can appear in `20.2.2`, `21.0.4`, `21.1` and other patch releases rather than only at major boundaries. It also distinguishes where a gate came from: measured locally, reported by a contributor, stated by Blackmagic documentation, or enforced by existing code.

Chat in DaVinci's `ResolveCapabilityRegistry` should record the same distinction for only the capabilities it consumes:

```text
capability_id
symbol
introduced_in
evidence_source: measured | reported | vendor | code_floor
evidence_build
status: available | unavailable | conditional | unreliable | unknown
requirements[]
limitations[]
probe_strategy
```

`unknown` remains unknown. A version higher than a remembered floor is not proof that the live method behaves correctly.

The project should prefer a real runtime probe where that probe itself is read-only and reliable.

### 30.5 The lifecycle pipeline should observe evidence, while the workflow engine owns authority

The upstream execution-lifecycle hooks include risk classification, Resolve-state inspection, readback verification, drift detection and provenance tracing. A useful implementation detail is that the shipped hooks observe; they do not synthesize a successful result on behalf of a handler.

Chat in DaVinci should keep one execution owner:

```text
WorkflowEngine
  -> validate registered workflow
  -> bind live identity
  -> validate approval
  -> create required backup/version
  -> dispatch deterministic operation
  -> read back
  -> normalize evidence
  -> commit audit result
```

Risk, drift and provenance helpers may contribute evidence to that engine. They must not create a second execution path or invent a preview/result that the real operation cannot establish.

### 30.6 Preview support must be declared, not guessed

Upstream now keeps an explicit set of destructive actions that genuinely implement `dry_run`. A destructive action that receives `dry_run=true` without a native dry-run path is refused before the handler executes. This was added after real mutations occurred under a flag callers reasonably believed meant "do not execute".

Chat in DaVinci should encode preview semantics directly in the workflow registry:

```text
preview_mode = native
  real implementation computes a no-write preview from live state

preview_mode = derived_plan
  immutable plan computes the proposed semantic delta without dispatching the writer

preview_mode = unavailable
  UI and model receive an explicit unavailable result
```

No generic lifecycle helper may turn `unavailable` into a synthetic success preview.

### 30.7 The integrated Electron UI should reuse panel focus, not the upstream polling mechanism

The upstream browser control panel shares project/clip/shot focus with chat through a small persisted panel-state file and polling. That mechanism makes sense because its panel is a separate browser process.

Chat in DaVinci already owns the renderer, preload and main process. Reproducing file polling would create a second state path for no benefit.

Adopt the concept as a main-owned `ResolveFocus` projection:

```text
project_unique_id
timeline_unique_id
media_pool_item_unique_id optional
shot_id optional
domain
observed_at
```

The renderer updates focus through narrow IPC. Workflow may expose a read-only `current_focus`/context field so ChatGPT can understand what the user is looking at.

Focus is convenience state only. It never grants permission and never replaces explicit IDs in an approved plan. A write plan always binds its own target identities.

### 30.8 Human analysis corrections should be an overlay over machine output

The upstream review UI preserves user corrections across later re-analysis and keeps field history/revert behavior. This is the right model for any future Chat in DaVinci analysis subsystem.

Do not overwrite a user correction when a model or local analyzer runs again.

Use two conceptual layers:

```text
machine_analysis
  immutable result for one analysis version/input fingerprint

human_overlay
  explicit user corrections/annotations with author time and field identity

effective_view
  machine result + newest applicable human overlay
```

Re-analysis creates a new machine layer. Existing compatible human overlays remain visible until the user clears or replaces them.

The UI must distinguish machine-derived text from user-authored corrections.

### 30.9 Optional analysis dependencies should remain capability-driven

The upstream project does not silently pretend missing FFmpeg, transcription, embedding or vision dependencies are available. It reports capabilities and install guidance per feature.

Chat in DaVinci should avoid bundling a broad media-analysis stack before a real workflow needs it.

When the first optional adapter is justified, give it a small capability descriptor:

```text
adapter_id
available
version
locality
features[]
missing_reason
install_guidance
license_note
```

The product can then say exactly why a check is unavailable without turning Settings into a general package manager.

### 30.10 Offline deterministic engines should produce artifacts and plans; live Resolve remains the apply boundary

The upstream advanced server has an internal tool catalog whose descriptors include `when_to_use`, `not_for`, locality, cost, review gates and deterministic-vs-Resolve execution mode. Its runner separates deterministic computation from live application.

This is useful for future Chat in DaVinci adapters. A conform engine, DRX inspector or delivery-QC engine can compute locally and return artifacts without gaining independent authority to mutate Resolve.

The preferred future shape is:

```text
offline/local adapter
  -> deterministic report/artifact/plan
  -> WorkflowEngine validates artifact + live target
  -> local approval if required
  -> official ResolveMCP live apply
  -> readback/render/deliverable verification
```

Add `routing_summary` and `not_for` to workflow definitions so the model can distinguish similar operations without exposing dozens of extra tools.

An offline adapter that directly mutates `.drp`, `.drt`, `.drx` or a project database remains a separate advanced capability and requires its own security/recovery review.

### 30.11 Audit persistence becomes mandatory when the first mutation ships

The current Chat in DaVinci read-only audit can remain bounded and in-memory while there is nothing irreversible to recover across restart.

That changes at the first write workflow. An approval, dispatched mutation and ambiguous result can remain relevant after the app restarts.

Before Stage F ships, add one durable execution ledger that owns:

```text
plan_id
plan_hash
approval_id
execution_id
workflow_id/version
target identities
dispatch state
semantic changes summary
verification state
backup/version link
ambiguous flag
recovery result
```

Do not persist unrestricted script text, secrets, full media paths or large Resolve payloads by default.

The durable ledger becomes the source for Activity. Activity should not maintain its own parallel history.

### 30.12 Recent upstream 21.1 work reinforces render evidence for visual claims

The v2.217.0 speed/fade contribution includes a useful evidence pattern: the contributor validated selected behavior against exported frames, while explicitly declining to claim untested reverse/freeze/ripple/keyframe/audio-pitch behavior.

That is the standard Chat in DaVinci should use for visual workflows:

```text
tested behavior
  -> claim only what the observed evidence establishes

related option not tested
  -> capability remains unknown/unqualified
```

A green unit test around argument forwarding does not become a claim that Resolve rendered the requested pixels.

### 30.13 Historical pre-first-writer implementation gate

This section records the gate that was used before the first bounded writer. It is historical provenance, not the current next-step order; `IMPLEMENTATION_PLAN.md` and `AGENT_SYSTEM_SPEC.md` now own the active Agent-native sequence.

Before the first production mutation was implemented, the required foundation was:

```text
1. shared navigation shell and then-current domain layout baseline
2. read-only Project summaries
3. narrow capability registry with evidence provenance
4. standard Workflow operation envelope
5. workflow registry that refuses unregistered writers
6. declared preview mode
7. declared verification contract and level
8. immutable plan + fingerprint + local approval
9. durable execution ledger
```

Only then add the first bounded annotation/metadata mutation.

The first mutation acceptance should prove one main path and one critical failure path:

```text
main path:
  plan -> local approval -> write -> required readback -> durable audit

critical failure:
  target/fingerprint changes or readback contradicts -> execution stops and never reports verified success
```

No broader mutation test matrix is required at that stage.

### 30.14 Additional invariants from the second pass

1. An unregistered protected writer is not callable.
2. Every protected writer has an explicit verification contract before it is enabled.
3. Preview semantics are declared per workflow; unavailable preview fails explicitly.
4. Resolve patch-level support claims carry evidence provenance.
5. Runtime focus is convenience context and never target authorization.
6. Human corrections outrank regenerated machine analysis in the effective review view.
7. Optional local analyzers are capability adapters, not hidden global dependencies.
8. Offline computation may prepare an apply plan, but ordinary live mutation still crosses the Workflow engine.
9. Durable execution evidence exists before the first production write is shipped.
10. Visual claims are limited to the verification level actually observed.

### 30.15 Upstream implementation references for later development

When implementing the corresponding Chat in DaVinci subsystem, revisit the upstream source that demonstrated the relevant behavior instead of copying this specification's prose as code.

| Chat in DaVinci concern | Upstream reference reviewed |
| --- | --- |
| compound tool/product vocabulary | `docs/SKILL.md`, `docs/kernels/README.md` |
| operation envelope and execution traces | `docs/SKILL.md`, `src/utils/execution_lifecycle.py` |
| destructive-action admission | `src/utils/destructive_hook.py` |
| truthful dry-run support | `src/utils/destructive_hook.py` |
| timeline version-on-mutate | `src/utils/destructive_hook.py`, timeline versioning helpers |
| Resolve patch-level capability evidence | `src/utils/resolve_versions.py` |
| behaviorally verified Resolve quirks | `src/utils/api_truth.py`, `docs/reference/api-limitations.md` |
| write/read verification gaps | `docs/reference/readwrite-symmetry.md` |
| render/interchange fidelity evidence | `docs/reference/roundtrip-fidelity.md`, `docs/reference/roundtrip-rich-fidelity.md` |
| review/history/plan UX | `docs/guides/control-panel.md` |
| source-safe media intelligence | `docs/guides/media-analysis-guide.md` |
| offline/local workflow routing descriptors | `resolve-advanced/server/tool-catalog.mjs` |
| offline compute -> live apply contract | `resolve-advanced/server/runner-apply-contract.mjs` |
| local HTTP hardening | `SECURITY.md` |

These files are references for invariants and failure lessons. Chat in DaVinci should implement the smallest architecture required by the active Agent Workbench path, reusing the existing protected Workflow safety plane rather than creating parallel authority.

## 31. Implementation document split

The product research is now separated into focused implementation documents so this file can remain the product-level source of direction.

Use:

```text
PRODUCT_SPEC.md
  product purpose, architecture principles, domain direction and research conclusions

AGENT_SYSTEM_SPEC.md
  Agent ergonomics, closed abstraction/control loop, World Model, SituationFrame, DecisionFrame, Capability Frontier, ChangeSet/CompletionReport semantics, shared cockpit and evaluations

UI_SPEC.md
  Codex-style Workspace/Session Sidebar + Conversation + four-layer Resolve Artifact Workspace, soft-follow/Pin, semantic links, approval/ChangeSet/result presentation

WORKSPACE_SPEC.md
  Workspace/Resolve binding, four-layer Artifact model, Project/Media/Edit/Fusion/Color/Fairlight/Deliver capability-lens projections, Analysis Store/Jobs and data composition

CAPABILITY_LEDGER.md
  breadth-first known semantic capability inventory, stable IDs, lifecycle/gap state and coverage snapshot

WORKFLOW_CATALOG.md
  Capability/ActionDescriptor/implementation contract + protected executable subset, Capability Packs, risk/preview/recovery/verification

EXECUTION_SECURITY_SPEC.md
  plan/approval/dispatch/verification state machine, ambiguity rules and durable evidence

IMPLEMENTATION_PLAN.md
  current repository integration points, milestone order and acceptance gates
```

`ARCHITECTURE_PLAN.md` remains a historical architecture record and implementation provenance source. Its older phase checklist should not override the newer execution order in `IMPLEMENTATION_PLAN.md`.

Within each document's subject area, use the focused document for implementation detail while preserving the permanent product invariants in this specification, `AGENT_SYSTEM_SPEC.md` and `AGENTS.md`.

The active navigation/system target is now the Codex-style three-pane shared cockpit, four-layer Resolve Artifact Workspace and Agent-native closed System Spine. Future upstream research should remain scoped to concrete implementation questions rather than reopening the fundamental one-authority / one-world-model / compiled-context architecture without new evidence.
