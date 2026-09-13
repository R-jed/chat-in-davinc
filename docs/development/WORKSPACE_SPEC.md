# Chat in DaVinci — Workspace Functional Specification

Date: 2026-09-12

Status: implementation-ready Resolve Artifact Workspace and Workspace/analysis specification

## 1. Purpose

This document defines how the human-facing Resolve Artifact Workspace projects the Agent-native system, how CID Workspaces bind to Resolve Projects, and how domain capabilities surface as contextual Artifacts without creating seven independent page/state systems.

The target shell is:

```text
Codex-style Workspace/Session Sidebar | persistent Conversation | Resolve Artifact Workspace
                                      |                         | Context
                                      |                         | Active Artifact
                                      |                         | Changes / Plan
                                      |                         | Evidence / Inspector
```

Connection state, Activity and Settings are application-level destinations in the Sidebar. Project/Media/Edit/Fusion/Color/Fairlight/Deliver are capability domains and Artifact lenses inside the right Workspace, not peer mini-applications and not a second set of canonical state owners.

This document owns Workspace identity/binding, Artifact function, semantic data composition and workspace implementation shape. `AGENT_SYSTEM_SPEC.md` owns the higher-level World Model/SituationFrame/Context Compiler/semantic-reference architecture. `UI_SPEC.md` owns layout/interaction styling. `WORKFLOW_CATALOG.md` owns workflow/ActionDescriptor design inventory and safety metadata. `EXECUTION_SECURITY_SPEC.md` owns plan, approval, dispatch, verification and recovery semantics. `IMPLEMENTATION_PLAN.md` owns delivery order against the repository.

## 2. Research basis

The workspace design was checked against current upstream source rather than only earlier snapshots.

### 2.1 DaVinci Resolve MCP reference

Repository:

```text
https://github.com/samuelgursky/davinci-resolve-mcp
reviewed HEAD f4ef03d167ec51c94987f5d5c8ed89bd363ea175
release v2.218.0
```

The reviewed revision exposes 36 compound tools, 368 granular tools and 18 optional advanced/offline tools. Those counts are evidence about the reference revision, not a target for Chat in DaVinci.

The useful page-level sources reviewed were:

```text
docs/guides/control-panel.md
docs/kernels/project-lifecycle-kernel.md
docs/kernels/media-pool-ingest-kernel.md
docs/kernels/timeline-edit-kernel.md
docs/kernels/fusion-composition-kernel.md
docs/kernels/color-grade-kernel.md
docs/kernels/audio-fairlight-kernel.md
docs/kernels/render-deliver-kernel.md
src/utils/execution_lifecycle.py
src/utils/destructive_hook.py
```

The main lesson is domain composition: expose professional questions and guarded operations, not hundreds of raw API methods.

### 2.2 Chat On Steroids upper product foundation

Repository:

```text
https://github.com/totec448-spec/chat-on-steroids
reviewed origin/main HEAD bfd8c980e2e1155401e5254081541fd05c329931
```

The useful implementation sources reviewed were:

```text
src/main/connection.ts
src/main/tunnel/index.ts
src/main/tunnel/health.ts
src/main/diagnostics.ts
src/main/durable.ts
src/main/session/store.ts
src/main/secrets.ts
src/main/mcp/server.ts
src/main/mcp/surfaces.ts
src/main/ipc.ts
src/preload/index.ts
src/renderer/main.ts
src/renderer/dom.ts
src/main/index.ts
src/main/window-lifecycle.ts
```

The upper runtime layer is taken from COS: Conversation/Session/turn lifecycle, Goal/Loop/Finish, Compact & Resume, continuation, Prime/Worker and model/Agent orchestration. The final left/middle renderer follows the Codex-style product design and is CID-owned as a projection of COS state. COS one-owner and durable-lifecycle discipline remains useful throughout the integration.

CID does not recreate those lifecycle owners. It owns Workspace/Resolve binding, the Codex-style renderer projection, the Resolve Artifact Workspace and the execution boundary underneath COS. COS generic coding filesystem/terminal/Desktop authority remains outside the protected Resolve path unless separately approved.

## 3. Workspace-wide architecture

The Conversation and right Resolve Artifact Workspace are two projections over the same Agent-native semantic system. Neither creates a parallel Resolve implementation or independent copy of truth.

```text
COS User / Agent / Session runtime
        -> GoalFrame / TaskGraph
        -> SituationFrame / SharedFocus / completion gap
        -> Context Compiler -> DecisionFrame/ContextPack
        -> Capability Frontier / ActionOffer
        -> CID Tunnel / MCP Gateway
        -> Action Catalog / ToolKernel / CallContext
        -> immutable Plan when required
        -> capability + policy + qualification checks
        -> ResolveScheduler / one active Resolve authority
        -> best-qualified implementation
        -> EvidenceRef / ActionResult / SemanticDelta / ChangeSet
        -> World Model / CompletionReport
        -> Codex-style Conversation + Resolve Artifact Workspace + Activity projections
```

The CID renderer owns presentation but remains non-authoritative for DaVinci state. World Model, semantic entity identity, current shared focus and authorization remain CID-owned. COS owns Chat/Session/Agent state, but that state grants no Resolve authority by itself.

### 3.1 Workspace identity, Resolve binding and offline continuity

A `CID Workspace` is the durable product container and binds exactly one Resolve Project identity. It owns project-scoped Analysis Artifacts, Jobs, provenance projections and Session references. Resolve project display names are labels, not Workspace identity.

```text
Workspace
  workspace_id
  resolve_project_unique_id
  optional project-library identity
  App-owned canonical store
  optional Workspace Root for portable sidecars
  COS Session refs
  Analysis Artifacts / Jobs
```

Default storage is App-owned. When the user binds a Workspace Root, portable analysis sidecars may live under a dedicated CID subdirectory in that root. Never write CID data into Resolve Project Library/database internals. Security/approval/dispatch authority remains App-owned even when analysis assets are portable. Analysis artifacts/sidecars do not add a custom encryption layer; they rely on normal macOS filesystem/FileVault protection, while credentials remain in secure storage.

A disconnected Resolve does not make the Workspace unusable. Cached analysis/history/planning remain available with explicit `Resolve Offline` and cache-freshness labels. Offline write Plans never auto-execute after reconnect; fresh live observation and exact revalidation are mandatory.

### 3.2 Main-owned World Model and SituationFrame

Replace ad-hoc cross-page context with a demand-driven main-owned World Model. The Agent-facing cheap projection is `SituationFrame`:

```text
SituationFrame
  observedAt / generation / schemaHash
  current Project / Timeline / Resolve page
  SharedFocus
  important deltas since previous observation
  active goal/task/plan state
  blockers / unknowns
  relevant affordances/capability frontier
  in-flight Resolve work / freshness
```

The World Model may hold richer semantic nodes/edges by `EntityRef`, but only observed/needed slices materialize. Agent `CallContext` may carry focus/reference correlation for convenience, while every write plan still binds exact IDs/fingerprints independently.

### 3.3 Demand-driven observations

Do not continuously crawl the whole Resolve project. Opening an Artifact/lens or an Agent DecisionFrame should request only the observation needed by that question. Reuse still-valid World Model slices. Late responses belong to the identity/generation that requested them and must not update a different project/timeline.

### 3.4 Observation snapshot keys

Read-only snapshots should carry enough identity to reject stale presentation or Agent reasoning:

```text
observedAt
schemaHash
projectId
timelineId when relevant
resolveVersion/build evidence when relevant
EvidenceRef IDs where material facts need provenance
```

After the Agent has already observed a slice, prefer semantic deltas (`changed / stale / newly blocked / newly verified`) over repeating unchanged snapshots.

### 3.5 Resolve page/project switching and scheduling

Selecting a CID Workspace or Artifact does not implicitly change the Resolve Project/page/playhead/selection. An explicit `Reveal in Resolve` or registered action that genuinely requires a page/project switch declares that side effect and crosses the shared `ResolveScheduler`. Cross-Workspace Goals may reference multiple projects, but only one `Active Resolve Target` exists at a time and every switch must be declared by the Plan.

Page-changing calls, current-project/current-timeline-dependent calls, all mutations, render transitions and page-sensitive Fusion/Color operations must not race. Workers may run independent analysis concurrently but do not call `ResolveBroker` directly.

### 3.6 Shared evidence states

All pages and Agent projections use the same meanings:

```text
loading
ready
warning
blocked
unverified
unavailable
error
stale
```

`unavailable` means the current Resolve build/license/state does not expose a required capability. `unverified` means the application could not establish the fact. Neither is rendered as success.

World Model facts also preserve epistemic origin (`observed / derived_deterministic / model_inference / user_asserted / unknown / contradicted`). This is not merely visual status: UI/Agent projections must not flatten an assumption into an observed fact. Planned changes remain a separate prospective plan overlay until execution + verification establish current state.

### 3.7 Artifact composition rule

The right pane always uses the same four semantic layers. Domain-specific content plugs into them; no domain owns a private navigation/state machine.

```text
Context
  Workspace / Project / Timeline / SharedFocus / live-or-cached state

Active Artifact
  the one semantic object/work surface relevant to the current decision

Changes / Plan
  proposed/current semantic transitions and their lifecycle

Evidence / Inspector
  provenance, verification, limitations and details on demand
```

Each Active Artifact should answer one production question, show the working objects, and surface only the evidence/capabilities needed for the next decision. Avoid a wall of equal-weight cards and avoid surfacing getter names as the information architecture."

### 3.8 One canonical action/read path, bounded projections

Local UI, protected MCP and Agent calls do not need identical payload sizes, but they share the same underlying registered action/read owner.

```text
canonical typed result
  -> World Model observation/delta  canonical semantic state
  -> local DaVinci projection       rich/paged
  -> protected MCP projection       bounded model result
  -> Context Compiler projection    only context needed for this decision
```

Do not implement a second reader or mutation engine for Chat. Redaction/data minimization is applied at publication boundaries without recomputing Resolve state. Agent and UI should refer to the same entities/evidence via semantic references.

### 3.9 Local integration surface

Do not create a generic renderer-to-main script executor. Extend typed IPC/action calls only as a visible workspace behavior requires them. Local UI actions and Agent actions both route to the ToolKernel rather than calling the broker directly.

### 3.10 SharedFocus and bidirectional semantic links

The Resolve Artifact Workspace and Conversation share one main-owned `SharedFocus`; model-visible cognition receives it through `SituationFrame.focus`, not as a duplicate peer context object.

Examples:

```text
user selects Interview 04 [I31] in Edit
  -> Chat composer receives an I31 focus chip

Agent reports a gap on V2 around [I31]
  -> "Open in Timeline" resolves the same EntityRef and highlights it

approval/Activity entry references [I31]
  -> same right-pane entity/plan/evidence can be opened
```

Focus is convenience/context only. A mutation still uses the exact plan-bound target and pre-dispatch revalidation. Artifact selection changes only SharedFocus. Moving Resolve itself requires explicit `Reveal in Resolve` or an action whose side effect is declared.

User redirection is also shared control state. The Conversation can stop/supersede safe pending reasoning/reads, but the Resolve Artifact Workspace/Activity must continue to show the true execution state of any mutation that may already have crossed dispatch. Do not visually erase an ambiguous execution because the current Chat task changed.

### 3.11 Agent-readable domain semantics

The workspace should expose semantic objects and relations that are useful to both human and Agent. For example, Edit should center tracks/items/issues/selection rather than individual getter cards; Deliver should center render intent/job/output/verification rather than raw setting dictionaries.

Every Artifact/lens should be able to answer four shared questions:

```text
What am I looking at?
What matters / is abnormal?
What can be done next?
What evidence supports this view?
```

### 3.12 Soft-follow, Pin and direct semantic control

The Active Artifact may soft-follow Agent work only when the user is not actively inspecting or Pinning another Artifact. User navigation always wins. A Pinned Artifact never auto-switches; background work is surfaced as a non-stealing status/link.

Direct Workspace controls are allowed only for registered semantic capabilities. They enter the same ToolKernel, risk policy, Plan/approval, ChangeSet and verification path as Agent-originated actions. Renderer origin grants no additional authority.

## 4. 项目 / Project capability/artifact lens

### 4.1 User question

Project answers:

```text
What project and timeline am I working in, and is this project in a trustworthy state to continue?
```

It is the fallback Active Artifact when no Goal/SharedFocus/SituationFrame context selects a more relevant Artifact.

### 4.2 Initial functions

The first useful Project Artifact projection contains:

- Resolve version/build evidence and current Resolve page;
- current project name and unique ID;
- current timeline name and unique ID;
- timeline count and basic track counts;
- project settings relevant to production readiness, such as timeline resolution/frame-rate facts where reliably exposed;
- one overall project preflight state;
- compact summaries from Media, Edit, Color, Fairlight and Deliver;
- capability gaps that materially affect those checks;
- warnings/blockers ordered by production impact;
- last refresh time and exact target identity.

Do not duplicate full Media, Edit, Color, Fairlight or Deliver inventories here. Project consumes their compact summaries.

### 4.3 Later functions

After the read-only foundation is stable:

- project/timeline backup and version history summary;
- project lifecycle capability report;
- project settings comparison against an approved profile;
- handoff/archive readiness report;
- project-level plan list;
- project provenance summary.

Project creation/open/save/close, import/export, archive/restore and safe database capabilities are eventual Agent/domain actions. They are not casual early page buttons; each disruptive lifecycle action needs exact capability, target, approval, recovery and provenance rules.

### 4.4 UI shape

Use:

```text
Project identity header
  project name / timeline name / current Resolve page

Preflight strip
  Ready | Warnings | Blocked | Unverified

Domain readiness grid
  Media
  Edit
  Color
  Fairlight
  Deliver

Project facts
  settings / capability limitations / timestamps
```

Domain readiness summaries should open the corresponding Artifact/lens rather than reproduce full detail.

### 4.5 Workflow/data sources

Primary protected workflows:

```text
project.identity.v1
project.settings_summary.v1
project.lifecycle_capabilities.v1
project.preflight.v1
```

Project preflight aggregates compact outputs from:

```text
media.inventory_summary.v1
edit.timeline_summary.v1
color.pipeline_inspect.v1
fairlight.mapping_inspect.v1
deliver.settings_inspect.v1
```

### 4.6 Implementation

Keep the existing fixed getter-only project/timeline script as the first reader. Add small fixed read-only templates only for facts the page actually displays.

Suggested integration:

```text
src/main/workflow.ts
  public inspect routing only

src/main/workflow-readers.ts
  fixed Project/domain readers once workflow.ts becomes too large

src/shared/types.ts
  ProjectSummary / ProjectPreflight typed results

src/main/connection.ts
  access to the one broker and current schema identity

src/main/ipc.ts + src/preload/index.ts
  narrow page refresh methods or one typed inspect method

src/renderer/main.ts
  Project projection only
```

No new long-lived ResolveMCP process, no generic script interpreter and no renderer-side Resolve calls.

### 4.7 Acceptance

Project is useful when the user can tell exactly which project/timeline is active, see meaningful blockers and jump to the domain that explains each blocker without any Resolve write occurring.

## 5. 媒体 / Media

### 5.1 User question

Media answers:

```text
What source material is in this project, is it online and trustworthy, and how is it organized?
```

The design borrows the useful separation in the reference project's Media Inventory and Review views while keeping the first version strictly read-only.

### 5.2 Initial functions

The first Media Artifact/lens contains:

- Media Pool root/current bin context;
- folder/bin tree summary;
- source clip count and media-type breakdown;
- online/offline/missing indicators;
- proxy/full-resolution linkage state where the API can establish it;
- clip FPS, resolution, codec, duration and audio mapping facts;
- mixed-frame-rate/resolution warnings based on explicit rules;
- metadata field inventory required for future ingest/conform/sync workflows;
- marker/flag/clip-color summary where useful for review;
- capability status for link/relink/proxy APIs without invoking them.

### 5.3 Main working view

Use a data-oriented inventory rather than a dashboard of cards:

```text
filters/search
  bin
  media type
  online/offline
  proxy/full-res state
  analysis state later

clip inventory
  name
  type
  duration
  fps
  resolution
  codec
  online state
  proxy/full-res state

detail inspector
  identity
  source properties
  metadata
  annotations
  audio mapping
```

Large inventories must be paged/bounded. Do not serialize the entire Media Pool into the global `AppState`.

### 5.4 Later functions

Protected planned actions may include:

- safe import plan;
- bin organization plan;
- metadata normalization/copy plan;
- relink/unlink plan;
- proxy/full-resolution link plan;
- multicam preparation inputs;
- source-safe media analysis jobs;
- clip review, transcript and shot analysis only when a concrete workflow requires them.

Source files remain immutable. Media Review may keep local `select / favorite / reject / compare` decisions inside CID without modifying Resolve. `Commit selections` or metadata/marker writeback becomes an explicit Plan/ChangeSet. A Media workflow may change Resolve project references or metadata only through an explicit registered writer.

### 5.5 Analysis layer

Visual/transcript/audio/QC/conform analysis is a first-class Workspace capability when consumed by a real workflow or Artifact. Preserve the reference project's useful split:

```text
machine analysis artifact
human correction overlay
effective view
```

Re-analysis must not overwrite human corrections. Analysis Artifacts use content-addressed identity derived from source fingerprint + analysis type + algorithm/model version + normalized parameters, so unchanged material reuses prior work and changed sources invalidate it. Jobs are Workspace-owned; the initiating Session receives a completion reference but does not own the result.

Analysis is local-minimal by default and is not written back into Resolve metadata/markers automatically. A writeback requires an explicit registered capability/Plan. Large rebuildable artifacts may be cache-managed; semantic provenance, user decisions and ChangeSet/Plan history are not silently auto-deleted.

Do not build analysis infrastructure merely to decorate a page. Add it when a Capability Pack or Artifact consumes it, while keeping the Analysis Store contract reusable across domains.

### 5.6 Workflow/data sources

Read-only:

```text
media.inventory_summary.v1
media.clip_inspect.v1
media.metadata_inventory.v1
media.link_status.v1
```

Later plan/write:

```text
media.ingest_plan.v1
media.organize_plan.v1
media.metadata_update.v1
media.relink_plan.v1
```

### 5.7 Implementation

The reference Media Pool kernel shows that MediaPool/Folder/MediaPoolItem enumeration can become large. Implement bounded readers rather than one giant response.

Preferred path:

```text
workflow reader
  enumerate folders/items through fixed getter-only script
  normalize into small typed rows
  cap rows per request
  return total/count summary + page cursor/offset when needed

renderer
  keeps filter/search presentation state
  requests detail only for selected item
```

Do not expose arbitrary filesystem paths in every model response. Local UI may show the full source path in an explicit detail view; model-facing summaries should prefer identities and concise path evidence unless the user asks for the path.

### 5.8 Boundaries

- no source rename/delete/transcode/proxy generation in the early product;
- no assumption that writable metadata fields are stable across Resolve versions/locales;
- relink/proxy paths require separate validation before writes;
- duplicate detection is a fact only when supported by hashes or another explicit matching rule, not similar filenames.

## 6. 剪辑 / Edit capability/artifact lens

### 6.1 User question

Edit answers:

```text
What is structurally happening on this timeline, what needs attention, and what exact edit would a plan change?
```

The main Artifact is a semantic timeline, not a second Resolve Edit Page: tracks, clips, ranges, markers, issues, selected entities and proposed/actual semantic changes. It may zoom/scroll/select/inspect and preview Plan effects, but full freeform ripple/trim/keyframe editing remains in Resolve unless a specific semantic control is registered.

### 6.2 Initial functions

The initial Edit Artifact/lens should expose:

- timeline duration/range/start-timecode facts where reliable;
- video/audio/subtitle track rows;
- track name, lock/enable state and item count;
- item ranges and source ranges;
- linked audio relationships where available;
- gaps and overlaps;
- offline/source-reference blockers;
- markers, flags and review annotations;
- transitions/fades where the running Resolve build exposes them;
- speed/retime state at the level the API can prove;
- titles/generators/subtitles distinction where measurable;
- multicam and sync readiness;
- conform readiness and unresolved identity problems.

### 6.3 Main working view

Use a timeline-structure workspace rather than trying to reproduce Resolve's visual timeline editor.

```text
timeline header
  name / duration / start TC / version state

track structure
  V1/V2/... A1/A2/... subtitle tracks
  item counts / lock / enable / warnings

QC findings
  gaps
  overlaps
  offline references
  source-range conflicts
  transition/retime capability warnings

plans/history
  saved plans
  stale fingerprints
  timeline versions later
```

The workspace is an inspection/review/action surface backed by the Agent engine; it is not an independent second timeline editor or mutation authority.

### 6.4 Later functions

Good early write candidates:

- review marker add/remove;
- clip flag/color metadata where reliable;
- bounded name/annotation changes.

Later structural workflows:

- duplicate/copy clips or ranges;
- reviewed move/insert operations;
- multicam prep timeline;
- conform plan/execution;
- selected transition insertion on supported Resolve 21.1+ builds;
- timeline variant creation.

Structural edits require an explicit timeline backup/version strategy.

### 6.5 Workflow/data sources

```text
edit.timeline_summary.v1
edit.structure_inspect.v1
edit.gaps_overlaps.v1
edit.source_range_report.v1
edit.transition_inspect.v1
edit.review_annotations_inspect.v1
edit.multicam_preflight.v1
edit.sync_preflight.v1
edit.conform_plan.v1
```

### 6.6 Implementation

Use timeline and item unique IDs wherever available. Names are presentation labels only.

For any saved plan, fingerprint at least the exact facts it depends on:

```text
project ID
timeline ID
timeline structure
target item IDs
relevant source ranges
relevant track state
workflow version
```

The latest reference release added native Resolve 21.1 transition creation and immediately had to register it as a destructive write. Chat in DaVinci should treat this as a design rule: capability arrival does not make an action safe automatically. A new writer becomes callable only after the WorkflowRegistry contains its risk, preview, recovery and verification contract.

### 6.7 Boundaries

- no fake razor/split workflow when the public API cannot provide a truthful split primitive;
- no true partial lift claim when the implementation can only delete whole overlapping items;
- no automatic selection of a conform candidate from filename similarity;
- no claim that measurable pauses or transcript continuity determine the creatively best cut.

## 7. Fusion capability/artifact lens

### 7.1 User question

Fusion answers:

```text
What composition and graph are on this target, how are the tools connected, and what evidence proves a visual change actually rendered?
```

### 7.2 Initial functions

The first Fusion Artifact/lens contains:

- current/selected timeline target identity when available;
- Fusion composition count/names;
- active target scope: timeline-item comp versus active Fusion-page comp;
- tool count and tool inventory;
- tool type/name and basic attrs;
- inputs/outputs/ports where exposed;
- graph connections;
- frame-range/cache capability where useful;
- build-specific unavailable controls;
- verification status for any future visual operation.

### 7.3 Main working view

Use a split graph/detail presentation:

```text
composition selector / target scope

graph overview
  nodes/tools
  connections
  obvious disconnected output paths

tool inspector
  attrs
  known inputs
  known outputs
  capability/readback notes

verification evidence
  API readback
  rendered evidence when required
```

The first implementation may use a structured node list plus edge list rather than immediately building a full interactive node editor.

### 7.4 Later functions

Potential protected operations:

- add an approved tool type;
- set validated inputs;
- connect approved tools;
- apply an app-owned declarative comp plan;
- load an approved group/template with backup.

Model-authored arbitrary Fusion script/code remains outside protected Workflow.

### 7.5 Workflow/data sources

```text
fusion.composition_inspect.v1
fusion.graph_inspect.v1
fusion.tool_inspect.v1
```

Later:

```text
fusion.graph_plan.v1
fusion.graph_apply.v1
```

### 7.6 Implementation

Every mutation target must specify whether it is a timeline-item composition or the active Fusion-page composition. Do not silently fall back from one to the other.

The reference kernel shows that tools and inputs are heterogeneous and some values can read back while the visible render remains wrong. Therefore:

```text
graph/API readback
  proves structure only

visual result claim
  requires RENDER_VERIFIED evidence
```

For the first read-only page, use fixed graph probes. A future offline declarative adapter may generate a graph plan, but live application still crosses WorkflowEngine -> ResolveBroker -> official ResolveMCP.

### 7.7 Boundaries

- thumbnails/contact sheets are not assumed to be WYSIWYG proof of Fusion state;
- no generic semantic model for every installed Fusion effect parameter;
- no assumption that every tool ID exists on every Resolve/Fusion build;
- no visual-success claim from `SetInput`/connection return values alone.

## 8. 调色 / Color

### 8.1 User question

Color answers:

```text
Is the technical color pipeline coherent, what grade structure exists, and what evidence supports any proposed grade change?
```

### 8.2 Initial functions

The first Color Artifact/lens contains:

- project color science and timeline color settings;
- current/selected clip identity when available;
- color-group membership;
- clip/group/timeline graph availability;
- node count and high-confidence node metadata;
- grade version names/current version;
- LUT/DCTL references where the API can establish them;
- cache state where relevant;
- technical transform inconsistencies;
- clips that are ungraded or structurally unusual under an explicit rule;
- capability limitations and verification level.

Do not label a creative look good/bad/cinematic/correct unless the user supplied a measurable target that the workflow can actually test.

### 8.3 Main working view

```text
Color pipeline summary
  project / timeline / output state

Target inspector
  clip identity / group / active grade version

Graph structure
  clip nodes
  group pre/post
  timeline graph

Evidence
  technical warnings
  rendered-frame verification later

Plans/history
  versions / approved CDL or look plans later
```

### 8.4 Later functions

Candidate controlled operations:

- create/restore grade version;
- validated CDL application;
- approved LUT/DCTL workflow;
- approved DRX/look application;
- grade copy/match with explicit targets and backup;
- Base Tree deployment only after existing-grade protection is proven.

### 8.5 Workflow/data sources

```text
color.pipeline_inspect.v1
color.graph_inventory.v1
color.grade_version_inspect.v1
color.render_evidence.v1
```

Later:

```text
color.cdl_apply.v1
color.approved_look_apply.v1
```

### 8.6 Implementation

Follow a frame-first verification model for visual claims. A structural read may prove that a node or CDL value exists, but it does not always prove pixels changed as intended.

For a future write:

```text
bind exact clip/group/timeline target
capture grade/version backup
apply through WorkflowEngine
read back graph/version state
render approved evidence frame when visual outcome is claimed
compare expected vs observed evidence
record verification level in Activity
```

Offline `.drx` computation/inspection may later become an internal deterministic adapter. It does not gain authority to apply grades independently.

### 8.7 Boundaries

- `ApplyGradeFromDRX` can replace a target graph; it is not treated as an additive harmless operation;
- Gallery/export behavior may be page/build dependent;
- graph APIs expose only part of Resolve's grading semantics;
- creative auto-grading remains outside near-term protected Workflow.

## 9. Fairlight capability/artifact lens

### 9.1 User question

Fairlight answers:

```text
Is this timeline's audio mapped, routed and measurable in a way that is ready for sync, mix and delivery?
```

### 9.2 Initial functions

The first Fairlight Artifact/lens contains:

- audio track count and subtype;
- track name, lock and enable state;
- item/source audio mappings;
- channel layout evidence;
- track/item voice-isolation capability and state;
- auto-sync capability and dry-run readiness;
- transcription capability;
- subtitle-generation capability;
- Fairlight preset availability;
- build/license/page limitations.

### 9.3 Main working view

```text
timeline audio summary

track list
  type / name / lock / enabled / channels

mapping inspector
  selected item -> source channels

capability/QC
  voice isolation
  sync
  transcription
  presets

measurement later
  LUFS / LRA / true peak / silence evidence
```

### 9.4 Later functions

- bounded audio property edits only when read/write symmetry is proven;
- auto-sync plan and execution;
- approved Fairlight preset application;
- transcription/subtitle workflows;
- source-safe loudness measurement;
- rough-mix plan based on measured dialogue/program levels.

### 9.5 Workflow/data sources

```text
fairlight.mapping_inspect.v1
fairlight.track_inspect.v1
fairlight.capabilities.v1
```

Later:

```text
fairlight.loudness_analysis.v1
fairlight.transcription_analysis.v1
fairlight.sync_execute.v1
```

### 9.6 Implementation

Keep Resolve-native inspection and optional file analysis separate.

```text
Resolve mapping/capabilities
  -> fixed read-only Resolve reader

LUFS/LRA/true-peak later
  -> optional local analysis adapter
  -> produced measurement evidence
```

Do not bundle FFmpeg/Whisper merely to populate the first page. Introduce the first optional adapter only when a user-facing workflow consumes it, and expose its availability/version/missing reason explicitly.

### 9.7 Boundaries

- audio property writes may return false for otherwise plausible payloads;
- auto-sync success depends on actual media and Resolve's engine;
- transcription/subtitle operations can be asynchronous and license/component dependent;
- full Fairlight automation curves and plugin parameter graphs are not exposed by the public scripting API;
- offline project-database bus routing is an advanced closed-project path and must never be hidden behind an ordinary live Workflow action.

## 10. 交付 / Deliver capability/artifact lens

### 10.1 User question

Deliver answers:

```text
Can this timeline produce the intended deliverable on this machine, and did the produced file actually meet the intended specification?
```

### 10.2 Initial functions

The initial Deliver Artifact/lens contains:

- live format/codec/resolution capability matrix summary;
- current render format/codec/mode/settings where readable;
- current render range;
- target/output directory state;
- queued render jobs and status;
- offline media blockers;
- audio/subtitle inclusion state;
- filename/output collision risk;
- preset/Quick Export availability;
- current-machine capability gaps.

Do not use a hardcoded expected count of formats/codecs. Availability varies by Resolve version, OS, license and installed IO components.

### 10.3 Main working view

```text
Delivery readiness
  blockers / warnings / unverified

Render target
  format / codec / resolution / fps / range

Output
  directory / expected filenames / collisions

Queue
  jobs / current status

Verification
  not run initially
  produced-file evidence later
```

### 10.4 Delivery target model

A future delivery target should define both the requested render intent and the verification specification from one source of truth:

```text
delivery_target
  id
  display_name
  allowed format candidates
  allowed codec candidates
  render settings
  audio/subtitle requirements
  output naming rule
  verification spec
```

Live capability resolution chooses only among formats/codecs actually available on the current machine. Description strings must not be treated as codec IDs.

### 10.5 Later functions

- delivery preflight;
- immutable render plan;
- explicit local approval;
- queue/create job;
- render start/monitor;
- produced-file verification;
- optional loudness/legal-range/re-delivery checks.

### 10.6 Workflow/data sources

```text
deliver.capability_matrix.v1
deliver.settings_inspect.v1
deliver.preflight.v1
deliver.render_plan.v1
```

Later:

```text
deliver.render_execute.v1
deliver.verify_output.v1
```

### 10.7 Implementation

Probe live format/codec support through the official API and qualify it against the current Resolve build. Cache only with an identity that makes staleness obvious, such as Resolve build + capability/schema evidence; refresh when that evidence changes.

Render execution follows the full durable path:

```text
plan
-> local approval
-> revalidate target/settings/output path
-> durable dispatch_started
-> queue/start render
-> monitor job
-> record Resolve completion
-> probe produced file
-> final verification result
```

If the connection fails after render dispatch, the operation is ambiguous and is not automatically retried.

Produced-file verification may introduce FFprobe/FFmpeg at this stage because Deliver now has a concrete need for it. The adapter remains local and capability-gated.

### 10.8 Boundary

`Render completed` and `Deliverable verified` are separate states. Final success is `DELIVERABLE_VERIFIED` only when the produced file is checked against the plan's verification specification.

## 10.9 Visual review boundary

V1 does not mirror the live Resolve Viewer. Visual review uses stills, thumbnails, contact sheets, before/after frames and rendered verification evidence. A later local proxy player may support review of source/proxy media without coupling the Workspace to Resolve Viewer capture.

## 11. 活动 / Activity

### 11.1 User question

Activity answers:

```text
What did Chat in DaVinci inspect, plan, approve, change and verify, and what evidence exists if I need to understand or recover it?
```

### 11.2 Current functions

The original read-only telemetry remains, and the first qualified writer now adds durable execution evidence:

- recent protected Workflow calls;
- success/failure and duration;
- durable plan/approval/dispatch/verification events for `edit.review_marker_add.v1`;
- current application connection/diagnostic log;
- copied redacted diagnostics.

### 11.3 Target functions as writer coverage expands

Activity becomes the projection of one durable execution ledger and shows:

- plan creation;
- plan stale/expiry state;
- approval/rejection/revocation;
- risk and blast radius;
- target project/timeline/item identities;
- backup/version creation;
- dispatch started/returned;
- Goal/Plan-grouped ChangeSet and semantic change summary;
- verification state and achieved level;
- contradiction;
- ambiguous outcome;
- recovery/compensation attempt and result;
- durations and timestamps;
- provenance links among plan, approval, execution and analysis artifacts.

### 11.4 Main working view

Use a list/detail history model:

```text
filters
  project
  timeline
  domain
  status
  date

event/execution list
  time
  workflow
  target
  outcome
  verification

detail
  plan
  approval
  risk
  semantic changes
  backup/version
  verification evidence
  recovery
```

Operational logs remain a secondary Diagnostics subsection. Do not mix every tunnel heartbeat with workflow history. Raw/Developer actions live in a separate Advanced Activity stream labelled `Unprotected`; they do not receive protected ChangeSets unless independent protected observation later establishes a semantic state change.

### 11.5 Workflow/data sources

```text
activity.audit_recent.v1
activity.execution_detail.v1
```

The durable source becomes `workflow-ledger.jsonl` before the first production write.

### 11.6 Implementation using COS durability lessons

The ledger should adopt the useful properties of COS's session/durable stores without copying the whole session system:

```text
one main-process writer
serialized append queue
append-only JSONL events
seal/ignore a torn final line on recovery
advance in-memory projection only after append is durable
write/flush dispatch intent before the external mutation call
flush critical terminal state
bounded recent reads
```

The ledger is the source for Activity. Do not create a second Activity database or parallel mutable history.

### 11.7 Data minimization

Do not store by default:

- API keys or tunnel secrets;
- private MCP route tokens;
- arbitrary Python/script text;
- full Resolve result payloads;
- media file contents;
- full source paths where a stable target identity is sufficient.

### 11.8 Acceptance

After writes exist, a restart must not erase whether an approved operation was dispatched, verified, contradicted or left ambiguous.

## 12. Connection utility

The compact connection control is shared by every page.

It projects facts owned by the connection subsystem:

```text
Resolve running/reachable
Resolve driver/Broker
CID MCP Gateway
CID Tunnel
protected Workflow policy
optional advanced/raw policy
last real COS->CID request/tool call
```

Do not create one connection watcher per page.

The target product has one CID Tunnel into one CID MCP Gateway. Protected Workflow and optional advanced/raw access keep separate policy/readiness state inside that Gateway, but they do not require independent product tunnels or independent Resolve authorities.

## 13. Settings utility

Settings contains configuration rather than Resolve production work.

Sections:

```text
Setup
Connection
  CID Tunnel / MCP Gateway
  Protected Workflow policy
  Optional advanced/raw policy
Background
Language
Workspace Storage / optional Workspace Root
Analysis cache management
Project Locations
Diagnostics
Optional adapters later
```

Secrets remain main-process only through macOS secure storage. Renderer receives saved-state/suffix information, never plaintext reads.

If the settings surface becomes more asynchronous, follow the COS pattern of validated main-process input plus serialized renderer saves so an older response cannot overwrite a newer user choice.

## 14. Capability-domain projection map

| Domain / destination | Supplies Artifact projection for | SituationFrame/Project summary consumes only |
| --- | --- | --- |
| Project | identity, project settings, project preflight | n/a |
| Media | Media Pool/source inventory and media state | compact media readiness |
| Edit | timeline structure/editorial QC | compact timeline readiness |
| Fusion | composition/graph structure and visual verification evidence | capability/blocker summary only when relevant |
| Color | color pipeline/grade structure | compact color readiness |
| Fairlight | audio mapping/capabilities/QC | compact audio readiness |
| Deliver | render capability/settings/preflight/output verification | compact delivery readiness |
| Activity | plan/approval/execution/verification traces | recent task/evidence summary only if useful |

These are Artifact projections/capability lenses, not canonical state owners. The World Model owns current semantic Resolve state; capability registry owns capability truth; Workflow engine/ledger owns plans/approval/dispatch; evidence owners own verification. The table prevents domain UI from independently recomputing another domain's facts.

## 15. Current evolution order

The early read-only workspace rollout is an implemented baseline, not the forward product boundary. Forward work follows the System Spine rather than page completion:

```text
1. preserve one ToolKernel / ResolveScheduler / Resolve authority and the existing World Model spine
2. bind the real COS Session/Goal/Worker runtime without keeping the parallel CID lifecycle
3. establish CID Workspace identity + one-to-one Resolve Project binding + offline/App-owned storage
4. render the Codex-style Sidebar/Conversation from COS state and the four-layer Artifact Workspace from CID state
5. establish complete Capability Ledger/schema/qualification/routing/composition breadth-first across all domains
6. make Plan -> ChangeSet -> Evidence -> SemanticDelta -> CompletionReport one linked transition model
7. qualify Timeline Version Protection + Human-edit-wins stale/rebase behavior
8. expand Project/Media/Edit production Capability Packs depth-first
9. expand Fusion/Color + visual verification, then Fairlight/Deliver + audio/file verification
10. add content-addressed Analysis Artifacts/Jobs where consumed by concrete packs
11. add Prime/Workers as bounded cognitive parallelism through the same ToolKernel/scheduler
12. add allowlisted UI Automation, offline adapters and trusted plugin packs only for explicit qualified gaps
```

Capability/domain projections remain World Model/action/evidence projections throughout. They do not gain private writers simply because the Agent or local UI can perform the same action.

## 16. Historical first writer gate

The first writer gate has been passed by `edit.review_marker_add.v1`; the criteria below remain the template for new writers. A review marker remains a strong candidate because the reference risk model treats marker-style operations as tightly bounded and reversible, but Chat in DaVinci must prove the actual Blackmagic 21.1 official path can:

```text
identify exact target
read previous state
preview exact semantic change
write
read back exact marker/payload
compensate deterministically
```

If any of those cannot be established, choose a different bounded metadata operation.

## 17. Research-derived invariants for every Artifact/domain projection

1. The renderer does not own Resolve truth.
2. A domain observation belongs to the exact project/timeline/schema generation that requested it.
3. Observation readers are bounded, demand-driven and selected for decision value rather than page refresh ritual.
4. Project aggregates domain summaries instead of duplicating their full readers.
5. A new API method is not automatically an approved Workflow capability.
6. Unknown capability remains unknown until evidence establishes it.
7. Readback proves only what that readback can actually establish.
8. Visual Fusion/Color claims use rendered evidence when API structure cannot prove pixels.
9. Render-job completion is not deliverable verification.
10. Source media is immutable by default.
11. Names are display labels; unique IDs/fingerprints bind plans.
12. No Artifact/domain lens or direct semantic control owns a parallel write path around ToolKernel/WorkflowEngine.
13. Every registered writer declares preview, risk, recovery and verification before dispatch is possible.
14. A potentially dispatched mutation is never automatically retried after ambiguous transport failure.
15. Activity is a projection of durable evidence, not a manually maintained second history.
16. The World Model is the canonical semantic projection of observed Resolve state; Chat and UI do not maintain competing copies.
17. Agent context is compiled from SituationFrame/focus/deltas and relevant ActionDescriptors, not the complete domain state by default.
18. User and Agent references to an object resolve through the same `EntityRef`; readable handles do not replace exact local identity or authorization.
19. `SharedFocus` can answer what “this” means, but never authorizes a write.
20. Repeated observations should produce semantic deltas and invalidation rather than forcing the Agent to compare large snapshots itself.
21. Artifact UI uses production concepts, relationships, ChangeSets and evidence rather than mirroring getter/method names.
22. Capability expansion is vertical: observation + semantic entity + action + context + UI + evidence + Agent evaluation remain coherent.
23. State-changing task completion is criterion-level and evidence-backed; `Executed` is not `Verified` and an Agent message is never completion proof.
24. Human edits win: external exact-target/fingerprint drift stales dependent Plans; rebase creates a new immutable Plan.
25. Soft-follow never overrides an actively inspected/Pinned Artifact.
26. Every protected mutation yields a Goal/Plan-grouped ChangeSet.
27. Workspace Jobs/Analysis Artifacts outlive the initiating Session when useful; write authority never auto-resumes across restart/reconnect.

## 18. Upstream source map for implementation

When a domain is implemented, revisit the source that established the relevant constraints:

| Workspace | samuelgursky reference | COS pattern to reuse |
| --- | --- | --- |
| Project | `project-lifecycle-kernel.md`, control-panel Overview/Setup | state ownership, generation fencing, diagnostics projection |
| Media | `media-pool-ingest-kernel.md`, control-panel Media Inventory/Review | bounded payloads, demand-driven data, safe renderer IPC |
| Edit | `timeline-edit-kernel.md`, edit plans/history | durable plan identity, exact target identity, append evidence |
| Fusion | `fusion-composition-kernel.md` | authority in main, renderer as graph projection |
| Color | `color-grade-kernel.md` | capability qualification, durable evidence for writes |
| Fairlight | `audio-fairlight-kernel.md` | optional adapter capability state, no hidden fallback |
| Deliver | `render-deliver-kernel.md` | serialized lifecycle, independent transport facts, no blind retry |
| Activity | `execution_lifecycle.py`, `destructive_hook.py`, control-panel History/Plans | `durable.ts`, `session/store.ts`, bounded shutdown flush |
| Connection/Settings | n/a | `connection.ts`, `tunnel/*`, `diagnostics.ts`, `secrets.ts`, `ipc.ts` |

COS is now also an Agent/Session semantic source, Samuel is a domain-kernel/API-truth source, and CID remains the single live execution/safety authority. Current live access continues through one Blackmagic ResolveMCP child; future adapters cannot create a second simultaneous Resolve authority.
