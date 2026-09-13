# Chat in DaVinci — Implementation Plan

Date: 2026-09-13

Status: living implementation reference

## 1. Purpose

This document converts `PRODUCT_SPEC.md`, `UI_SPEC.md`, `WORKSPACE_SPEC.md`, `CAPABILITY_LEDGER.md`, `WORKFLOW_CATALOG.md` and `EXECUTION_SECURITY_SPEC.md` into an ordered engineering plan against the current repository.

It is an initial sequencing reference, not a mandatory execution queue. Current user goals, exact source state and locally qualified Resolve evidence decide what is implemented next. `ARCHITECTURE_PLAN.md` remains useful historical architecture context.

The plan intentionally stops short of pre-building future systems. Each step adds only what the next accepted user-visible behavior needs.

## 2. Current baseline

Current code facts:

```text
src/main/connection.ts
  one module-level ResolveBroker
  one local ResolveGateway
  Raw + Workflow tunnel lifecycles converging on the same gateway/broker/ResolveMCP authority

src/main/resolve-gateway.ts
  private tokenized local Raw + Workflow routes
  current Workflow in-memory audit ring

src/main/workflow.ts
  status
  inspect(connection/capabilities/project/media/edit/fusion/color/fairlight/deliver/preflight)
  inspect_operation
  audit
  plan
  execute
  fixed app-owned bounded readers plus three qualified protected writers: review-marker add, append-empty-video-track and exact LOCAL grade-version create

src/main/ipc.ts + src/preload/index.ts
  Workflow inspect/risk/audit plus local plan-approval control paths

src/renderer/
  default Floating Topbar navigation; optional fixed Sidebar over the same navigation DOM/state
  Project / Media / Edit / Fusion / Color / Fairlight / Deliver / Activity workspaces
  Settings contains Setup and protected connection diagnostics
  full English + Simplified Chinese app-owned copy

external ChatGPT tunnel
  Raw end-to-end verified
  historical dual-tunnel implementation exists; target architecture uses one CID Tunnel / MCP Gateway
```

Current build/test scripts already exist in `package.json`.

Do not change Raw tool declarations or add a second ResolveMCP child during the work below.

### Technology baseline

Implementation work in this plan uses the existing stack unless a milestone explicitly proves a change is necessary:

```text
Electron 43.4.1
TypeScript ^7.0.2 / ES2023 / strict mode
native HTML + CSS + TypeScript renderer
electron-vite ^5.0.0 / Vite ^7.3.6
@modelcontextprotocol/node ^2.0.0
@modelcontextprotocol/server ^2.0.0
Zod ^4.5.4
Vitest ^4.1.10
electron-builder ^26.16.1
macOS 13.0+; current package target ARM64 DMG
```

CID main process remains the authority for Resolve access, CID Tunnel/MCP lifecycle, secrets, child processes and durable Workflow evidence. COS is the forward ChatGPT/Session/Goal/Prime-Worker runtime; CID owns the final Codex-style Sidebar/Conversation renderer projection, Workspace identity and Resolve Artifact Workspace. Do not import COS visual ownership merely because COS owns Session lifecycle.

Do not add a separate cloud service, cloud database, second simultaneous Resolve authority, SQLite or FFmpeg as incidental dependencies. Do not keep extending the CID-owned `ModelProvider`/`TurnRunner`/Session stack as a parallel product runtime. COS is the target upper runtime; CID keeps its existing TypeScript DaVinci safety plane beneath it.

### 2.1 Authoritative forward order after the 2026-09-12 system reset

The numbered historical milestones below record how the repository reached its current state. They do not override this forward order. New work should strengthen the linked Agent control loop rather than complete pages or API-method counts.

```text
A. bind the real COS ChatGPT/Session/Goal/Prime-Worker runtime; retire the parallel CID lifecycle
B. establish CID Workspace identity <-> one Resolve Project and the CID-owned Codex-style renderer
C. close GoalFrame -> SituationFrame -> DecisionFrame -> ActionOffer -> Plan/ChangeSet -> Evidence -> CompletionReport
D. implement four-layer Artifact Workspace: Context / Active Artifact / Changes·Plan / Evidence·Inspector
E. maintain `CAPABILITY_LEDGER.md` breadth-first and build qualification/routing/composition support across all domains
F. qualify Timeline Version Protection + Human-edit-wins stale/Rebase + implementation sealing
G. production-qualify Project/Media/Edit packs, then Fusion/Color, then Fairlight/Deliver depth-first
H. add content-addressed Analysis Artifacts/Workspace Jobs where concrete packs consume them
I. add Prime/Workers as bounded cognitive parallelism through the same ToolKernel/scheduler
J. add allowlisted UI Automation / Offline Adapter / trusted plugin packs only for explicit gaps
```

For every step, preserve one Resolve authority, one semantic World Model, one execution ledger and one Session lifecycle owner. Breadth-first inventory prevents silent domain gaps; depth-first qualification turns inventory into reliable production capability.

## 3. Milestone 1 — floating top navigation baseline

Status: completed 2026-09-09.

Historical note: this milestone records the shell that was actually built. Its “default stable” Topbar/optional-Sidebar navigation decision is superseded for forward product design by `AGENT_SYSTEM_SPEC.md` and `UI_SPEC.md`, which now target `Codex-style Workspace/Session Sidebar | persistent Conversation | four-layer Resolve Artifact Workspace`. Preserve the current shell as a rollback/migration baseline; do not treat the historical navigation hierarchy below as the next UI architecture.

### Goal

Establish the Floating Topbar workbench shell as the default stable navigation baseline.

No Resolve behavior changes in this milestone.

### Files

Primary:

```text
src/renderer/index.html
src/renderer/main.ts
src/renderer/styles.css
src/renderer/i18n.ts
```

Potentially inspect only:

```text
src/main/index.ts
```

The BrowserWindow dimensions/title-bar behavior should remain unchanged unless live visual testing proves a required adjustment.

### Changes

1. Remove the legacy fixed sidebar, resize handle and sidebar-collapse control from the original setup-utility shell.
2. Remove the legacy renderer-only sidebar width/collapse persistence code and its localStorage keys.
3. Add the Floating Topbar defined in `UI_SPEC.md` as the default stable mode.
4. Change renderer page IDs from current `setup | workflow | activity` to:

   ```text
   project | media | edit | fusion | color | fairlight | deliver | activity | settings
   ```

5. Move the existing Setup markup under Settings.
6. Move current project/timeline preflight identity card under Project.
7. Move current recent Workflow audit display under Activity.
8. Move connection/capability inspection under Settings > Diagnostics.
9. Remove the standalone current Safety card from the top-level workspace. Risk will later be shown in plan/approval context.
10. Add intentional unavailable/empty states to Media/Edit/Fusion/Color/Fairlight/Deliver until their readers exist.
11. Keep the compact global connection state in the top bar.
12. Update English/Chinese navigation and changed app-owned copy.

Current navigation decision superseding the earlier single-Topbar-only direction:

- keep Floating Topbar as the default stable mode and rollback path;
- add an optional Sidebar selectable in Settings;
- Sidebar spans the full window height and supports a persisted expanded/collapsed state;
- collapsed Sidebar reserves zero visible rail width; no compact marks remain on screen;
- when collapsed, left-edge pointer proximity temporarily reveals the full Sidebar as an overlay and leaving it retracts the overlay without writing config;
- Sidebar navigation typography, spacing, selected treatment and background are independent from the Floating Topbar styling;
- Settings is anchored directly at the Sidebar lower-left edge;
- keep Sidebar width draggable from 200 px through 400 px; after reaching 200 px, further inward dragging directly collapses the existing Sidebar state; keep the fixed expand/collapse control centered at x=180 px and optically aligned/sized with the macOS traffic lights; keep its reveal/hide motion short and decisive; do not add automatic responsive switching;
- reuse the same navigation DOM, active-page state and event flow for both layouts; do not create a second renderer/navigation tree;
- treat Sidebar visual acceptance as pending until separately reviewed; this milestone's completed status does not imply the new Sidebar UI has been visually accepted.

### Behavior to preserve

- Setup six-step flow;
- API key suffix behavior;
- connect/disconnect;
- language switching;
- background/menu-bar/login settings;
- current Workflow refresh APIs;
- current activity copy/diagnostic copy;
- current 15-second transport health refresh;
- `hiddenInset` native title bar and traffic-light clearance.

### Acceptance

Use the 12-point UI migration gate in `UI_SPEC.md` section 18.

Validation:

```text
npm run typecheck
npm run build
git diff --check
manual app visual review at normal width and 760 px minimum width
```

Run the existing relevant tests if touched code affects their covered behavior. Do not add a renderer test framework for this layout-only milestone.

## 4. Milestone 2 — read-only Project foundation

### Goal

Make Project a genuinely useful production page using protected read-only state.

### Workflow API direction

Keep the public `inspect` tool. Expand its validated target/action vocabulary rather than adding a separate public MCP tool for every summary.

Target shape may become:

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

Exact target spelling should be finalized once against the catalog before implementation and then versioned/stable.

### Files

Expected:

```text
src/main/workflow.ts
src/main/connection.ts
src/main/ipc.ts
src/preload/index.ts
src/shared/types.ts
src/renderer/main.ts
src/renderer/i18n.ts
```

Create a new main-process reader module only when `workflow.ts` would otherwise accumulate multiple large fixed scripts. Preferred first split when needed:

```text
src/main/workflow-readers.ts
```

Do not create a future `workflow/` directory tree merely to match `ARCHITECTURE_PLAN.md`.

### Reader order

Implement in this order because later readers compose into Project preflight:

1. `project.settings_summary.v1` — implemented and live-validated on Resolve 21.1
2. `media.inventory_summary.v1` — implemented and live-validated on Resolve 21.1
3. `edit.timeline_summary.v1` — implemented and live-validated on Resolve 21.1
4. `color.pipeline_inspect.v1` — implemented and live-validated on Resolve 21.1
5. `fairlight.mapping_inspect.v1` — implemented and live-validated on Resolve 21.1
6. `deliver.capability_matrix.v1` — implemented and live-validated on Resolve 21.1
7. `deliver.settings_inspect.v1` — implemented and live-validated on Resolve 21.1 with unavailable current-setting fields kept explicit
8. `project.preflight.v1` — implemented and live-validated on Resolve 21.1

Each reader uses:

- app-owned fixed code/template;
- getters only;
- bounded structured result;
- no model-supplied Python;
- explicit unavailable/unverified fields for unsupported facts.

### Script strategy

Prefer several small versioned reader templates over one giant generic script interpreter.

Do not accept method names, Python expressions or code fragments from Workflow arguments.

If two readers can safely share one fixed template without introducing branching code supplied by the model, reuse is allowed.

### Acceptance

- no project write methods in any reader template;
- Raw remains exact current upstream snapshot;
- one ResolveBroker child;
- Project page shows real current values;
- project/timeline unique IDs are preserved internally;
- missing capability appears unavailable/unverified rather than zero/false unless zero/false is the real observed value;
- preflight distinguishes pass/warning/blocked/unverified.

Validation:

```text
npm run typecheck
npm test
npm run build
npm run test:gateway:live   when live Resolve evidence is required
git diff --check
```

Only extend an existing live/unit test for accepted new behavior. Avoid a broad synthetic API matrix.

## 5. Milestone 3 — narrow capability registry

Status: complete and live-validated on Resolve 21.1.

### Goal

Give the new read-only Project checks an honest explanation for unavailable or unreliable Resolve features.

### New module

Add only when the first reader needs it:

```text
src/main/resolve-capabilities.ts
```

Initial entries cover only symbols/facts consumed by Project readers.

The module provides:

```text
qualification metadata
safe runtime probe strategy where applicable
evidence source
known limitation text/code
```

It does not become a copy of the reference project's full `api_truth` database.

### Shared type additions

Add the smallest required capability types to `src/shared/types.ts` so Project UI can distinguish:

```text
available
unavailable
conditional
unreliable
unknown
```

### Acceptance

- every capability claim shown by Project has a clear source;
- unknown stays unknown;
- capability registry does not alter Raw schemas or calls;
- no unsafe probe mutates Resolve.

## 6. Milestone 4 — standard protected result envelope

Status: complete and live-validated on the protected MCP surface. Renderer IPC remains intentionally unchanged.

### Goal

Make current read-only Workflow results and future writes share one semantic vocabulary before mutations exist.

### Files

Expected:

```text
src/shared/types.ts
src/main/workflow.ts
src/main/resolve-gateway.ts
src/main/connection.ts
src/preload/index.ts
src/renderer/main.ts
```

### Design

Introduce a typed internal/result shape based on `EXECUTION_SECURITY_SPEC.md` section 14.

Keep the MCP transport representation compatible with the current server, which currently sends JSON as text content.

The transport encoding can remain text JSON. The semantic payload inside it becomes consistent.

For read-only calls:

- `operation.status` reflects the check outcome;
- verification remains explicit;
- no fake `changes: {}`;
- an execution ID is optional unless the call is being durably traced.

### Migration

Do not simultaneously redesign all IPC responses. Add the semantic type and migrate the Project readers/current Workflow result path with minimal surface breakage.

### Acceptance

- UI can render `unverified` distinctly;
- contradiction vocabulary exists before writers;
- existing Raw tool results are untouched.

## 7. Milestone 5 — historical dual-connector transport baseline

Status: historical implementation provenance. The 2026-09-11 target uses one CID Tunnel into one CID MCP Gateway.

The earlier plan required separate Raw and Workflow external connectors. That requirement is superseded for the COS-hosted product path.

### Migration principle

Preserve existing configuration while migrating, but do not make a second Workflow tunnel ID a forward acceptance dependency.

### Expected code areas

```text
src/main/config.ts
src/main/tunnel.ts
src/main/connection.ts
src/main/ipc.ts
src/preload/index.ts
src/shared/types.ts
src/renderer/* Settings/Setup
```

Historical config shape:

```text
existing tunnelId
  preserve as current Raw tunnel ID for backward compatibility

new workflowTunnelId
  protected Workflow connector
```

Do not rename the persisted existing field in-place unless a real migration is implemented and tested.

### Target tunnel lifecycle

The target app owns one CID Tunnel process:

```text
COS -> CID Tunnel -> CID MCP Gateway
                     -> protected Workflow policy
                     -> optional advanced/raw policy
```

Both policy surfaces, if enabled, share one Gateway and one Resolve authority. Raw policy isolation does not require a second product tunnel.

### Settings UX

Target Settings:

- one CID connection is the normal product path;
- protected Workflow is the normal COS Agent policy surface;
- Raw is clearly labeled advanced/direct access and is not part of normal Agent authority;
- Raw warning continues to state that `run_script`/`run_script_unsafe` bypass Workflow protections;
- secrets are not duplicated merely to represent policy surfaces.

### Acceptance

- COS reaches the CID Gateway through one Tunnel;
- the normal Agent sees only protected tools;
- optional Raw access remains policy-isolated and cannot be invoked through the protected namespace;
- one Tunnel/Gateway path does not create a second Resolve authority;
- stop/shutdown terminates the owned tunnel process tree;
- secrets remain out of argv/log/config.

Extend `test/resolve-gateway-live.test.ts` only for the cross-surface behavior it already owns. Add lifecycle coverage only where the two-tunnel refactor changes an existing tested lifecycle contract.

## 8. Milestone 6 — workflow registry and result admission

### Goal

Move risk/execution policy from the current simple “published tool set = low risk” logic to versioned workflow definitions.

### Expected new module

Start with one file:

```text
src/main/workflow-registry.ts
```

Do not create one file per workflow until enough behavior exists to justify it.

### Initial registry

Register only the read-only set listed in `WORKFLOW_CATALOG.md` section 18.

### Replace current risk logic

`assessWorkflowOperation()` currently classifies the four public connector tools rather than specific domain workflows.

Evolve inspection so it can assess a registered workflow/action with:

- risk established;
- blast radius;
- read-only/write;
- approval policy;
- recovery class;
- preview mode;
- verification level.

Unknown workflow IDs remain unestablished and non-executable.

### Acceptance

- registry is the source of protected Workflow metadata;
- UI does not invent registry facts;
- no writer exists yet;
- all currently registered workflows are read-only.

## 9. Milestone 7 — durable ledger, plan and local approval

### Goal

Build the safety path before any writer becomes callable.

### Minimal new modules

Preferred initial split:

```text
src/main/workflow-ledger.ts
src/main/workflow-plan.ts
src/main/workflow-engine.ts
```

Approval persistence can live in the plan/engine layer initially rather than creating a separate module unless the code becomes unclear.

### Ledger

Implement the append-only JSONL design in `EXECUTION_SECURITY_SPEC.md`.

Initialize it from `src/main/index.ts` after `userData`, config, secrets and log are initialized, before any protected writer could be available.

Only the single-instance lock owner initializes/opens it.

Shutdown flushes the ledger owner before process exit if there are buffered events.

### Plan entry point

Add protected MCP `plan` only when at least one useful plan exists.

Before the first writer, it can plan the selected bounded mutation candidate while all existing inspection remains read-only.

### Approval IPC

Add narrow channels such as:

```text
workflow:plan:get
workflow:approval:grant
workflow:approval:reject
```

Exact names may follow current IPC naming style.

Renderer supplies the plan ID and user action. Main process reloads all trusted plan fields.

### Activity projection

Activity reads plan/approval events from the ledger owner.

Do not keep the old in-memory Workflow audit as a second authoritative mutation history. It may continue as transient read-only call telemetry or be replaced by a projection, but the durable ledger owns write history.

### Acceptance

- plan hash canonical/deterministic;
- local approval binds exact hash;
- approval survives app restart;
- rejected/expired/stale plan cannot be approved/executed;
- renderer cannot forge risk/target/hash fields;
- no write is callable yet if execution path is not complete.

Testing should cover one plan/approval success path and one invalid/stale rejection path. Avoid a full state-machine matrix at this stage.

## 10. Milestone 8 — first bounded mutation

Status: completed and live-validated on Resolve 21.1 on 2026-09-10.

### Selection gate

Re-measure the exact official Resolve 21.1 API behavior for the candidate before coding the writer.

Preferred candidate is a narrowly targeted review annotation/metadata operation, currently `edit.review_marker_add.v1`, only if reliable add/readback/remove behavior is proven.

If not, choose another bounded operation with stronger read/write symmetry.

### Implementation

Add exactly one writer workflow definition.

It must declare:

- validated input schema;
- exact target locator;
- derived/native preview;
- low/medium established risk;
- item blast radius;
- local approval;
- Class B compensation if truthful;
- API readback verification;
- ambiguous transport handling.

Add protected `execute(plan_id)` only now.

### Dispatch integration

`WorkflowEngine` calls the existing single broker path. It does not call a new Resolve process or bypass `ResolveGateway` ownership.

Durable event order:

```text
approval already flushed
preconditions revalidated
previous state captured
execution_prepared
dispatch_started + flush
writer call
dispatch_returned
verification
terminal event + flush
```

### Acceptance

Use `EXECUTION_SECURITY_SPEC.md` section 22.

Add at most:

- one primary success test;
- one critical stale/contradiction/ambiguity failure test chosen to cover the actual new risk not already proven by existing tests.

Use a disposable Resolve project for any live mutation validation.

Completion evidence:

- disposable project `test` proved `AddMarker` / `GetMarkerByCustomData` / `DeleteMarkerByCustomData` symmetry before enabling the writer;
- `edit.review_marker_add.v1` is the only callable protected writer;
- protected `execute(planId)` accepts only the durable plan ID and reloads all trusted fields in Main;
- live acceptance completed plan → durable local approval → exact pre-dispatch revalidation → flushed `dispatch_started` → one marker write → API readback → flushed terminal evidence;
- durable event order matched the required sequence and Activity projects the same execution record;
- restart ambiguity is covered by the existing engine test and does not replay the writer;
- the acceptance marker was explicitly removed afterward by its unique `customData`, leaving the disposable project clean.

## 11. Milestone 9 — read-only domain baseline

Status: completed as the current read-only baseline. The Media inventory/detail/link-capability slice is complete. The first five bounded Edit inspection slices, `edit.structure_inspect.v1`, `edit.gaps_overlaps.v1`, `edit.source_range_report.v1`, `edit.transition_inspect.v1` and `edit.review_annotations_inspect.v1`, are implemented, live-validated on Resolve 21.1 and source-preview accepted.

All domain page shells already exist from Milestone 1. After Project is stable, make those pages useful in small end-to-end slices. `WORKSPACE_SPEC.md` owns the full function list and page data composition.

Implement deeper page behavior in this order:

1. Media inventory/detail inspection;
2. Edit structural/QC inspection;
3. Fusion composition/graph inspection;
4. Color graph/version technical inspection;
5. Fairlight track/capability inspection;
6. Deliver full preflight beyond the compact Project summary.

The ordering is adjustable based on actual user need, but each slice should be completed end-to-end before broadening its domain.

For each slice:

```text
one visible user question
-> minimum reader(s)
-> capability qualification
-> typed result
-> UI presentation
-> relevant validation
```

Do not pursue overall Resolve API coverage percentages.

### Media slice

Visible question:

```text
What source material is in the project, is it online, and what is its current link/proxy/metadata state?
```

Build on `media.inventory_summary.v1`, then add only the selected-item/detail paths the UI needs:

```text
media.clip_inspect.v1
media.metadata_inventory.v1
media.link_status.v1
```

Do not place the complete Media Pool into `AppState`; use bounded/paged reader results. Filters and the currently selected row remain renderer presentation state.

Current `media.clip_inspect.v1` resolves one exact `MediaPoolItem.GetUniqueId()` target, probes a fixed getter allowlist with `dir()` on that object, then records direct getter readback failures separately from missing methods. Source/proxy path values are excluded. `fullResolutionLinkState` remains explicitly unverified because Resolve 21.1 exposes no qualified dedicated getter for it. Live gateway validation passed on 2026-09-10 with all 8 checked detail getters observed and zero readback failures. The selected-item metadata inventory is already carried by this reader; do not duplicate it as a second runtime workflow unless a broader project/bin-scope question appears.

Current `media.link_status.v1` probes only the fixed method surface `RelinkClips`, `UnlinkClips`, `LinkProxyMedia`, `UnlinkProxyMedia`, `LinkFullResolutionMedia` using `dir()` and never dispatches any of them. Resolve 21.1 live validation observed all 5/5 surfaces on the exact disposable source item with no missing methods. Those mutation surfaces remain runtime evidence only: no corresponding protected writer is registered or behaviorally qualified. Full-resolution state and proxy/optimized-media generation remain explicit non-claims.

### Edit slice

Visible question:

```text
What is structurally happening on the current timeline and which findings are measurable blockers or warnings?
```

Build on `edit.timeline_summary.v1`, then add:

```text
edit.structure_inspect.v1
edit.gaps_overlaps.v1
edit.source_range_report.v1
edit.transition_inspect.v1
edit.review_annotations_inspect.v1
```

`edit.structure_inspect.v1` is complete. It preserves exact TimelineItem/MediaPool identities and the raw record/source getter values, with all ten fixed item getters observed on the current Resolve 21.1 disposable V1/A1 fixture. It does not infer inclusive/exclusive range-boundary semantics, transition state or linked-audio relationships. The Edit UI consumes the specialized structure view through the existing `inspect` path and narrow local IPC; no public MCP tool or writer was added.

`edit.gaps_overlaps.v1` is also complete. It derives only same-track record-range relationships from the qualified structure snapshot. With record boundary semantics still unqualified, negative raw boundary deltas are definite overlaps, deltas greater than 1 are definite gaps, and delta 0/1 remains boundary-ambiguous; no exact gap/overlap frame count is claimed. Tracks with missing record boundaries are left unverified instead of being compared through. The protected public MCP tool list remains unchanged because this is another `inspect` view, and no writer/capability was added.

`edit.source_range_report.v1` is complete. It reuses the structure reader and reports only exact TimelineItem/MediaPool identities plus raw record/source getter values. It does not derive source duration, source-coordinate equivalence or conform matches. This is deliberate because the source getter coordinate semantics are not qualified by the current fixture. The protected public MCP tool list remains unchanged.

`edit.transition_inspect.v1` is complete. Resolve 21.1 qualification observed `AddTransition`, `GetFades` and `SetFades` on the exact current V1/A1 TimelineItems; the protected reader calls only `GetFades`. The raw `FadeIn`/`FadeOut` values are not assigned units or translated into edit-state claims. `AddTransition` and `SetFades` remain unregistered mutation surfaces. This slice adds the narrow read capability `edit.transition_fade.read`, bringing the capability registry to 15 while leaving the public protected MCP tool list unchanged.

`edit.review_annotations_inspect.v1` is complete. It reuses the already-qualified timeline/item marker and MediaPool detail capabilities to report bounded timeline, TimelineItem and MediaPoolItem marker evidence plus flags and clip color. Required identities and getter return shapes fail closed: malformed/empty evidence stays partial/unverified rather than becoming an empty success. The reader does not expose source/proxy paths, a generic metadata dump or any second marker/flag/color writer. Resolve 21.1 live gateway and source-preview acceptance passed with the public protected MCP tool list still unchanged and `edit.review_marker_add.v1` still the sole writer.

The historical domain order below remains useful as an initial plan, not a hard sequencing constraint. After closing this bounded Edit slice, choose the next implementation from current code gaps, user value and locally qualified Resolve evidence instead of advancing a document label mechanically.

Do not add another Edit plan/writer merely because a read surface exists. The durable plan/ledger path is already established for the sole marker writer; every additional writer still needs its own accepted risk, recovery and verification contract. Resolve 21.1 transition support remains capability-qualified, and discovering the method is not permission to expose a writer.

### Fusion slice

Visible question:

```text
What comp and graph exist on the exact target and what can the official API actually prove about them?
```

Add:

```text
fusion.composition_inspect.v1
fusion.graph_inspect.v1
fusion.tool_inspect.v1
```

`fusion.composition_inspect.v1` is now implemented and live-validated on Resolve 21.1. The accepted reader is timeline-scoped rather than playhead-scoped because `Timeline.GetCurrentVideoItem()` returned null on the disposable fixture even though the timeline contained a valid V1 item. It therefore scans bounded current-timeline VIDEO items and reports exact item identity, per-item composition count/name readback, truncation and method evidence. The zero-composition `GetFusionCompNameList() -> {}` runtime quirk is accepted only when that exact item's count is zero.

`fusion.graph_inspect.v1` is now also implemented and live-validated. Positive qualification was isolated onto the dedicated `Fusion Graph Qualification` timeline after the earlier shared fixture was mutated by Fusion cleanup behavior. Resolve 21.1 established list-shaped positive composition names, composition access by name/index, dict-shaped tool/input/output collections, stable tool/port IDs and the default `MediaIn.Output -> MediaOut.Input` connection with bidirectional readback. The protected graph reader is bounded, getter-only and does not inspect control values, mutate the graph or claim rendered pixels.

Do not advance to tool-detail or graph-writer implementation merely because additional method names are present. `fusion.tool_inspect.v1` remains a separate possible slice only if current product value and qualified evidence justify it. Do not build an interactive node editor before a real workflow needs editing, and do not treat graph readback as pixel/render evidence.

### Color slice

Visible question:

```text
Is the technical color pipeline coherent and what grade/group/version structure exists?
```

Build on `color.pipeline_inspect.v1`. Current state:

```text
color.graph_inventory.v1 — implemented / Resolve 21.1 live-validated / source-preview accepted
color.grade_version_inspect.v1 — implemented / Resolve 21.1 live-validated / source-preview accepted
```

`color.graph_inventory.v1` now reads the behaviorally qualified Timeline/configured-Node-Stack/Color-Group graph surface through the existing protected `inspect { target: 'color', view: 'graph' }` path. It reads `Project.GetSettings().nodeStackLayers`, enumerates `TimelineItem.GetNodeGraph(layerIdx)` for configured layers, and reads up to 32 Color Groups via `GetColorGroupsList`, `GetName`, `GetPreClipNodeGraph` and `GetPostClipNodeGraph`. Global bounds remain 32 layers per item, 64 VIDEO tracks, 200 items, 2048 total node rows and 64 returned OFX/tool names per node. The stable Resolve 21.1 baseline remains `1/1` layer with zero Color Groups, a zero-node Timeline graph and one-node V1 L1 graph. The dedicated `CID Color Node Stack Qualification` project established `2/2` layers and retains `CID Group Qualification`; its pre/post Group Graph objects and both clip-layer Graph objects are non-null with one node each. Clip-layer cache readback is `-1`; Group pre/post cache readback succeeds with `null`, preserved separately from getter failure. Protected source preview rendered `V1 · L1`, `V1 · L2`, Color Group pre and Color Group post rows. The reader reports LUT-reference presence without returning LUT paths and does not claim topology/connections, node values, graph writes or rendered pixels.

`color.grade_version_inspect.v1` now reads the behaviorally qualified `GetVersionNameList(0/1)` and `GetCurrentVersion()` surfaces through `inspect { target: 'color', view: 'versions' }`. The current Resolve 21.1 fixture returns one local and one remote name, both `"版本 1"`, while the current version is `"版本 1"` with type `0`. The reader preserves this exact evidence without treating same-named local/remote rows as the same version identity or inferring list order. It is bounded to 64 VIDEO tracks, 200 items and 64 names per list, exposes no version mutation, and does not claim rendered pixels or Color Group version state.

`color.grade_version_create.v1` is now the third qualified protected writer under the existing six public verbs. Its contract is deliberately narrow: one exact current SharedFocus VIDEO TimelineItem, one caller-visible name, LOCAL type `0` fixed internally, immutable Plan, local exact-plan approval, API readback and Class B compensation. Agent planning crosses the boundary only as semantic `itemRef + generation`; Main resolves the exact item and seals current Project/Timeline/TimelineItem identity, complete bounded local/remote name lists, current LOCAL version, candidate-name absence and a version-state fingerprint. Writer-side code repeats those exact preconditions immediately before the single `AddVersion(name, 0)` call. Remote creation, public switch, rename, delete and generic version mutation remain unavailable.

Resolve 21.1 disposable qualification on 2026-09-13 used `test` / `CID Marker Qualification Restored` / exact V1 BMX. Baseline local/remote/current were `["版本 1"]` / `["版本 1"]` / local `版本 1`. `AddVersion("CID Grade Version Qualification 20260913", 0)` returned true, local names became exactly two and the new LOCAL version became current. `LoadVersionByName("版本 1", 0)` restored the original current version; `DeleteVersionByName(..., 0)` returned true; final local list and current version matched the baseline exactly. The qualification version was removed and the original disposable Project/Timeline context was restored. The temporary qualification harness was removed from source afterward.

The writer's semantic promise is version-container creation/current switch and reversible API state only. Current Color readers still do not observe node parameter values or rendered pixels, so this capability does not claim that the new version is a parameter- or pixel-equivalent snapshot of the grade that existed when the user approved the Plan. A future grade-backup or visual-equivalence capability needs its own stronger evidence contract.

Do not add `color.render_evidence.v1` until a visual claim/write workflow consumes it. The initial page is technical inspection.

### Fairlight slice

Visible question:

```text
How are tracks and source channels mapped, and which Fairlight/sync/transcription capabilities exist on this build?
```

Current state:

```text
fairlight.mapping_inspect.v1 — implemented / Resolve 21.1 live-validated / source-preview accepted
fairlight.clip_processing_inspect.v1 — implemented / Resolve 21.1 live-validated / source-preview accepted / Project preflight integrated
```

`fairlight.clip_processing_inspect.v1` reads current AUDIO TimelineItem Volume, Pan, Pitch, Voice Isolation and Dialogue Leveler properties through four fixed getter surfaces. The stable A1 fixture returned all 15 allowlisted properties with exact Resolve 21.1 runtime types; the independent Voice Isolation getter matched the property state. The reader is bounded to 64 audio tracks / 1000 items, reports missing/failed/incomplete evidence and getter contradictions fail-closed, and does not interpret zero/disabled values as an audio-quality judgment. Automation/keyframes, clip effects, routing/buses, loudness/rendered audio and processing writes remain outside the capability.

Do not add a separate generic `fairlight.track_inspect.v1`; its intended track/state scope is already covered by the mapping reader plus this clip-processing reader. Re-evaluate any broader Fairlight capability reader only against a concrete remaining user-visible gap.

Do not add FFmpeg/Whisper here unless the user-visible page gains a measurement/transcription workflow that needs them.

### Deliver slice

Visible question:

```text
Can the current timeline be rendered to the intended output on this machine without a known blocker?
```

Build on:

```text
deliver.capability_matrix.v1
deliver.settings_inspect.v1
project.preflight.v1 profile=delivery
```

Format/codec identifiers come from the live machine. Do not hardcode counts or infer setter IDs from display descriptions.

`deliver.capability_matrix.v1` now also binds the current selected format/codec to `Project.GetRenderResolutions(format, codec)`. Keep this inside the existing capability reader rather than adding a duplicate Deliver workflow. The returned list is bounded raw capability evidence; do not infer uniqueness/order or call it the current render resolution while full `GetRenderSettings()` readback remains unavailable.

The same reader now exposes bounded `GetRenderPresetList()` and `GetQuickExportRenderPresets()` names because those getter surfaces were already part of the capability scan. Preserve API ordering and duplicates; do not infer preset contents, setting compatibility, upload targets or which preset is currently active.

Do not add `deliver.preflight.v1`; the existing delivery profile of `project.preflight.v1` is the single readiness surface.

## 12. Milestone 10 — Agent execution foundation

Status: source implementation and non-live validation completed 2026-09-10.

### Goal

Prevent the new Agent runtime from becoming a third authority path.

Implement the minimum shared foundation:

```text
ToolKernel / internal Action Catalog
CallContext
ResolveScheduler / lease
```

Local UI, protected MCP and Agent calls must resolve registered actions through the same kernel. The scheduler sits above `ResolveBroker` and serializes page-changing/current-state-dependent calls, render state transitions and all mutations as required.

No broad new Resolve writer or Worker is required for this milestone.

### Acceptance

- current protected tools still behave through the same registered workflow semantics;
- existing `edit.review_marker_add.v1` plan/hash/local-approval/ledger contract is unchanged;
- no Agent/UI helper can call `ResolveBroker` as an alternative mutation path;
- stateful Resolve operations have one explicit scheduling/lease boundary;
- one live Resolve authority remains.

Completion evidence:

- `src/main/resolve-scheduler.ts` owns one serialized Resolve call queue and exposes `runExclusive()` for a future multi-call lease when a concrete stateful action requires one;
- `src/main/tool-kernel.ts` is the shared protected action entry point for local UI, protected MCP and future Agent callers;
- `connection.ts` owns one `ResolveScheduler` around the existing module-level `ResolveBroker`, and initializes both WorkflowEngine and ResolveGateway with that same scheduler;
- local UI inspections now enter the gateway ToolKernel instead of calling `inspectWorkflow()` directly;
- protected MCP calls enter the same ToolKernel, while Raw keeps its exact official schema but sends actual Resolve calls through the same scheduler;
- the existing protected writer execution queue, immutable plan/hash, local approval, durable ledger and ambiguity/no-replay path were left intact;
- `npm run verify` passed with 20 ordinary test files / 70 tests, 3 live files skipped, UI policy 13/13, interaction 9/9, concurrency 4/4 and production build PASS.

The current scheduler serializes actual Resolve calls. `runExclusive()` provides the lease boundary for future page-sensitive multi-call actions; no existing action was expanded merely to exercise that API.

## 13. Milestone 11 — historical CID Chat / Session core

Status: source implementation and non-live validation completed 2026-09-10. This remains useful migration provenance, but the 2026-09-11 architecture reset supersedes it as the target upper runtime.

Historical baseline:

```text
CID ModelProvider / Chat transport
  -> CID TurnRunner
  -> CID durable Conversation / Session
  -> ToolKernel
```

Do not extend this into a parallel product runtime. Forward Chat/Session/Goal/Loop/Finish/Compact & Resume/model-Agent ownership belongs to COS.

Completion evidence for the transport-independent core:

- `src/main/durable.ts` is a provenance-preserving MIT adaptation of COS's small durable-state helper; `THIRD_PARTY_NOTICES.md` carries the required notice;
- `src/shared/agent-session.ts` defines the reduced CID session/turn/tool event model without browser, coding-tool or Worker-specific fields;
- `src/main/agent-session-store.ts` owns a durable session index plus append-only JSONL events, fsyncs user turn/tool intent before downstream execution, and marks a non-terminal running turn `interrupted` on restart instead of replaying it;
- `src/main/model-provider.ts` defines a replaceable provider boundary without selecting a browser-extension or API transport prematurely;
- `src/main/turn-runner.ts` runs one model turn, feeds only the existing protected ToolKernel surface to the provider, records `tool_call_intent` before ToolKernel dispatch, records tool results, and never gives the provider direct `ResolveBroker` authority;
- Agent `CallContext` now carries session/turn/call correlation while local UI and protected MCP contexts remain unchanged;
- app bootstrap initializes/restores Agent sessions and shutdown flushes durable state;
- `src/main/openai-model-provider.ts` implements the initial replaceable `ModelProvider` with the OpenAI Responses API using native `fetch`, `gpt-5.6`, `store: false`, encrypted reasoning carry-forward, `parallel_tool_calls: false` and the existing protected schemas without changing them to strict-all-required shapes;
- the existing Keychain-backed OpenAI API key is reused by the local Agent; no second credential store was added;
- `src/main/agent-chat.ts`, trusted IPC/preload calls and the minimal Chat workspace expose durable sessions and turns without giving the renderer or provider direct Resolve authority;
- the built-in Agent starts/uses the same CID-owned local Resolve Gateway, ToolKernel, scheduler and broker without requiring an external ChatGPT tunnel or starting a second Resolve session;
- Agent ToolKernel calls share the same protected Gateway audit path as protected MCP calls;
- `npm run verify` passed with 22 ordinary test files / 74 tests, 3 live files skipped, UI policy 13/13, interaction 11/11, concurrency 4/4 and production build PASS.

Acceptance: a durable session can execute read-only registered actions through ToolKernel, recover after app restart, and preserve turn identity without gaining direct Resolve authority.

## 14. Milestone 12 — Agent System Spine

Status: implemented at source/non-live validation level on 2026-09-10.

Goal: make the system cheap and legible for an Agent before adding long autonomous loops or broad capability.

Introduce the smallest implementation of the canonical abstractions from `AGENT_SYSTEM_SPEC.md`:

```text
WorkspaceRef / EntityRef / readable local handle
EvidenceRef / AnalysisArtifact reference
WorldFact epistemic state
Resolve World Model generation + invalidation
SituationFrame with SharedFocus/completion gap
richer internal ActionDescriptor
SemanticDelta / ChangeSet projection
```

Reuse existing bounded readers as observation recipes. Do not duplicate the workflow reader layer or build a full project mirror.

Acceptance:

- one current project/timeline can be represented by a generation-scoped SituationFrame;
- one timeline/media object can be shown to the Agent with a readable handle that resolves locally to exact identity;
- stale generation/parent identity refuses instead of targeting a different object;
- one existing observation updates the World Model and produces a semantic delta;
- observed/derived_deterministic/model_inference/user_asserted/unknown/contradicted state is not collapsed into a plain value;
- a prospective plan effect is not inserted into current World Model truth before execution + verification;
- one UI selection can become main-owned SharedFocus without becoming authorization;
- existing six protected verbs, one Resolve authority and marker-writer safety remain unchanged.

Implementation evidence:

- `src/shared/agent-system.ts` now defines the shared semantic contracts for EntityRef/Mention, EvidenceRef, WorldFact epistemic state, SemanticDelta, SituationFrame, SharedFocus, ActionDescriptor, ContextPack and TurnTrace;
- `src/main/agent-world-model.ts` owns one demand-driven in-memory Resolve World Model. Existing protected observations update it after ToolKernel execution; project/timeline/schema changes or explicit authority invalidation advance generation and clear stale semantic bindings rather than retargeting them;
- readable handles remain local bindings to exact IDs. Agent-facing protected `inspect` replaces raw `itemId` with `itemRef + generation`; stale generation/parent identity is refused before Resolve dispatch;
- successful local UI Media selection now projects into main-owned SharedFocus. Focus remains context only and does not alter plan/approval authorization;
- current World Model facts distinguish observed/unknown epistemic state and carry EvidenceRefs; protected execution invalidates affected current-state slices instead of treating proposed/nominal effects as observed truth;
- Raw calls that are not explicitly declared read-only conservatively invalidate semantic state rather than letting external Raw work silently leave the Agent on stale assumptions.

## 15. Milestone 13 — Context Compiler + ACI evaluation baseline

Status: deterministic Context Compiler and turn/resource trace baseline implemented at source/non-live level; representative charged/live Agent task evaluations remain pending explicit authorization.

Build/retain a deterministic Context Compiler that derives a typed DecisionFrame for one decision and serializes it as the bounded ContextPack. DecisionFrame is derived only; it is not a second state owner.

Normal model input should compile only:

```text
stable operating invariants
exact GoalFrame criterion/open obligation needed now
SituationFrame including SharedFocus/completion gap
focused entity detail when decision-relevant
state-bound ActionOffers from the Capability Frontier
recent semantic deltas / prior decision result
deeper evidence by reference only when it can change the decision
```

Do not send the complete session, World Model, capability registry or tool inventory by default.

Add task-level Agent traces/evaluations for existing capabilities. Measure at minimum verified task outcome, model turns/tokens, selected actions, invalid arguments, redundant observations, Resolve-call count/latency, clarification count and stale-target/verification failures.

Capability visibility is ergonomics only; ToolKernel authorization remains unchanged.

Implementation evidence:

- `src/main/context-compiler.ts` compiles a bounded SituationFrame, SharedFocus, semantic deltas and a relevance-ranked subset of ActionDescriptors for each model decision;
- model-visible Entity mentions omit exact Resolve IDs. Protected tool results are projected through the World Model so known exact identities become readable handles and other local identity fields are withheld; plan/execution protocol IDs remain available where they are the actual workflow reference;
- `TurnRunner` keeps only a bounded narrative/tool window for the current decision, injects the ContextPack through the provider-neutral request contract, records redundant protected intents and persists a durable `turn_trace` terminal event;
- the shared `ResolveScheduler` now measures Resolve call count/duration inside an Agent turn scope without creating a second execution path;
- `OpenAiModelProvider` reports Responses API token usage when supplied by the provider, allowing durable traces to aggregate input/output/total token cost;
- focused Agent System tests cover safe semantic projection and stale-handle refusal before Resolve dispatch; the existing TurnRunner success path verifies ContextPack update after a protected observation and durable resource trace output.

## 16. Milestone 14 — CID Codex-style shell + Resolve Artifact Workspace

Status: the current CID shared cockpit is an implemented migration baseline. Forward ownership is now explicit: COS supplies durable Session/Conversation/Goal/Worker runtime state; CID owns the final visual/interaction renderer and the entire DaVinci semantic workspace.

Target layout:

```text
Codex-style Workspace/Session Sidebar | Codex-style Conversation | Resolve Artifact Workspace
                                      |                          | Context
                                      |                          | Active Artifact
                                      |                          | Changes / Plan
                                      |                          | Evidence / Inspector
```

Establish `CID Workspace <-> one Resolve Project identity` and nest COS Sessions/Workers beneath the Workspace. Do not keep a parallel CID Session lifecycle/runtime.

The Active Artifact is contextual; Project/Media/Edit/Fusion/Color/Fairlight/Deliver are capability lenses, not seven peer state owners. Implement soft-follow that never steals an actively inspected/Pinned Artifact. User selection updates SharedFocus only; `Reveal in Resolve` is explicit.

Add bidirectional semantic links through `WorkspaceRef` / `EntityRef` / `EvidenceRef` / Plan / ChangeSet / Job / trace identity. Conversation/run controls distinguish `running`, waiting for a user decision, waiting for local approval and stopping at a safe boundary. A UI Stop/redirect action must not imply that an already-dispatched mutation was cancelled.

Direct semantic Workspace controls use the same ToolKernel/risk/Plan/ChangeSet/verification path as Agent calls. High-risk approval opens full Workspace review; low/medium-risk Chat quick approval projects the same canonical approval object.

## 17. Milestone 15 — COS lifecycle integration

Status: the CID-only compaction/Goal migration work is transitional. The target is to use COS as the actual Session/Goal/Loop/Finish/Compact & Resume owner and connect CID state beneath it.

Replace the upper CID Session/compaction owner with COS rather than continuing to adapt individual COS transactions into a parallel CID lifecycle. Do not stack both mechanisms.

Handoff carries primarily:

```text
original GoalFrame and derived open obligations
important user decisions/corrections
current task position
active plan/approval/execution references
important unresolved uncertainty
EntityRef/EvidenceRef references required for rehydration
```

Current Resolve state is rehydrated from the World Model/observation path when necessary. Do not freeze stale project snapshots into narrative handoffs merely to save a read.

## 18. Milestone 16 — COS Goal / Loop with CID evidence-backed execution

Status: the first COS-to-CID Goal/Loop adaptation remains useful migration evidence, but the target owner is now COS. CID keeps only the independent evidence/verification gate required before a state-changing Goal can be considered complete.

Current implemented Goal/Loop semantics:

- the normal COS Agent sees only the CID protected Resolve surface;
- COS owns Goal/Loop/Finish decisions and continuation lifecycle;
- Goal evaluates only an already-completed final turn. Tool arguments/results are excluded from the Goal model transcript.
- `execute` now produces a World Model `EvidenceRef` carrying exact execution identity plus verification status/level.
- a COS Goal `stop` is admitted only after CID independently binds every protected writer execution to current-generation passed verification evidence. The Goal model neither sees nor cites EvidenceRef IDs.
- CID records/links the execution evidence needed by COS completion state but does not own a second completion state machine.
- a state-changing goal remains open when an execution failed, contradicted, stayed unverified, or lacks exact current EvidenceRef support.

Add Goal/Loop only after Context Compiler and evidence-backed completion semantics exist.

Prove one Agent can complete:

```text
understand exact Goal criterion / completion gap
-> compile DecisionFrame from minimum sufficient fresh state
-> choose one state-bound ActionOffer
-> create exact immutable Plan/ChangeSet draft when mutation is required
-> wait for policy/user approval as required
-> execute through ResolveScheduler using sealed qualified implementation
-> verify at the declared level
-> update ChangeSet / World Model / SemanticDelta / trace
-> derive criterion-level CompletionReport
-> COS continues or finishes only when required evidence supports it
```

The model cannot approve its own plan. Post-dispatch ambiguity still blocks replay. Conversation text alone cannot prove a state-changing task finished.

## 19. Milestone 17 — Timeline Version Protection

Before structural Edit writers:

```text
DuplicateTimeline / archive candidate
-> read back exact backup identity
-> persist backup identity in ledger
-> only then allow protected structural mutation
```

Qualify the actual Resolve 21.1 behavior on a disposable fixture. If required backup creation/identity readback fails, the structural mutation fails closed. Do not call this universal Undo.

Resolve 21.1 live qualification passed on 2026-09-13 using disposable project `test`
(`1c1ec3b1-c087-4e9f-864b-ee6f51e24f85`) and clean baseline timeline
`CID Marker Qualification Restored` (`de561b0e-3a89-47dc-ae7d-1aaec29dc72e`).
`DuplicateTimeline` returned a distinct timeline (`357dea4a-843c-48e9-90ba-1f57df684cf8`),
Resolve switched current timeline to that duplicate, `Project.SetCurrentTimeline(original)` returned true,
exact current-timeline identity readback returned the original timeline, the original timeline structural
snapshot was unchanged before/after duplication, and the duplicate remained present in the disposable
project. The pre-existing user project/timeline was restored after qualification. The internal primitive
uses a flushed `backup_started` ambiguity fence followed by verified `backup_created`; `required_backup=true`
cannot enter `execution_prepared`/`dispatch_started` without that durable verified backup. The primitive remains
non-public as a standalone workflow; registered `edit.track_add.v1` consumes it internally before structural
dispatch. This does not make `edit.timeline.version.create` independently callable through the protected connector.

The first structural writer now exists as protected workflow `edit.track_add.v1`, deliberately limited to
`Timeline.AddTrack("video")` with append placement only. Its Plan fingerprints the complete bounded current
timeline structure, requires a verified Class C timeline duplicate before dispatch, repeats the exact
fingerprint check inside the fixed writer script immediately before `AddTrack`, and verifies that exactly one
empty V track was appended while every pre-existing track/item still reduces to the approved fingerprint.
Transport ambiguity is durable/no-retry. The workflow is registered on the existing protected `plan()` /
`execute()` verbs without adding a new public tool: `plan()` accepts only current timeline + VIDEO + append;
renderer local approval seals the exact plan hash; `execute(planId)` first creates/verifies the required Class C
timeline backup and only then reaches the fixed writer. No generic AddTrack parameters, DeleteTrack path,
indexed insertion, AUDIO track or subtype selection are exposed.

Agent planning authority is narrower than public tool availability. System Spine reads only the user message bound
to the exact active turn; historical Goal/objective text cannot reopen mutation planning. The current mutation
planning allowlist contains only `edit.track_add.v1`, and only narrow explicit add/create/append VIDEO-track wording
can make that ActionOffer applicable. The older marker writer remains blocked from Agent planning until SharedFocus
item identity is sealed into its public Plan target contract. `bindAgentSemanticDispatchArgs()` rejects `plan()`
unless the current DecisionFrame contains an applicable mutate ActionOffer for that exact workflow and, for track
add, the exact fixed `current_timeline + video + append` arguments. Local approval remains renderer-only and never
dispatches a writer by itself.

Resolve authority is also epoch-bound at the final mutation edge. Disconnect synchronously invalidates the workflow
authority epoch before any lifecycle await; a new epoch is established only after a fresh gateway/Agent kernel is
created. Class C backup, marker writer and track writer all re-check that epoch after their durable start fence and
immediately before the external mutation call. A proven pre-dispatch authority loss writes durable
`backup_cancelled` / `execution_cancelled` (`writer_dispatched=false`), clears approval and is non-retry across
restart; ambiguous transport after a mutation call remains on the existing ambiguity/no-replay path.

Resolve 21.1 live qualification passed on 2026-09-13 on disposable project `test`
(`1c1ec3b1-c087-4e9f-864b-ee6f51e24f85`) and clean baseline timeline
`CID Marker Qualification Restored` (`de561b0e-3a89-47dc-ae7d-1aaec29dc72e`). The production-equivalent
bounded snapshot produced the same SHA-256 fingerprint in TypeScript and the fixed Python writer script,
writer-side `preconditionOk` was true, `AddTrack("video")` returned true, video track count advanced from 1 to
2, structural readback verified V2 as present and empty, removing the qualification track restored the exact
pre-write structural fingerprint, and the original user project/timeline was restored exactly. The Class C
qualification backup is retained as timeline `cf536692-276d-41b8-969d-0a4c2bd9a916`. This qualifies the
registered protected writer behavior. Packaging/release acceptance remains a separate product gate.

## 20. Milestone 18 — Capability Ledger maintenance + implementation routing

`CAPABILITY_LEDGER.md` now provides the initial breadth-first inventory of known Project/Media/Edit/Fusion/Color/Fairlight/Deliver abilities and gaps using stable semantic capability IDs. Keep it current as implementation/research discovers more. The executable registry remains narrow; the ledger is broader and includes unsupported/API-gap/UI-automation-candidate states. Next, bind ledger records to versioned implementation candidates, exact Resolve-build qualification evidence, limitations and Artifact/context projection contracts.

Implement routing as `best-qualified wins; official wins ties`. UI Automation is last-resort and allowlisted. Passive qualification may probe readers automatically; writer qualification uses explicit Compatibility Check + disposable fixtures. An immutable Plan seals implementation identity/version/qualification references and may not silently reroute after approval.

Dynamic workflow composition is a DAG. A mutation graph generated by a stronger future model must materialize into an immutable Plan before the first write. Model improvement never automatically raises autonomy.

## 21. Milestone 19 — Project, Media and Edit Capability Packs

Expand real registered operations as vertical Agent capabilities rather than API counts.

Each Capability Pack couples the smallest coherent entity/observation/action/context/UI/evaluation slice. Project target includes safe create/open/save/close, settings, import/export, archive/restore and timeline lifecycle where qualified. Media includes ingest, bins/organization, metadata, relink/unlink, proxy/full-resolution links, sync/multicam preparation and source-safe analysis. Edit includes timeline create/duplicate/version, insert/move/copy/delete/ripple where truthful, transitions/retime/titles/subtitles, conform, multicam/sync and lineage.

Do not invent a razor/split primitive the official API cannot provide. Every writer still needs risk, preview, exact targets, approval, recovery/version and verification contracts.

## 22. Milestone 20 — Fusion and Color Capability Packs + render verification

Fusion target: composition create/delete, tool add/delete, validated `SetInput`, connections, expressions/keyframes/masks and approved templates/groups where qualified.

Color target: grade versions, CDL, LUT/DCTL, DRX/look, grade copy/match, Color Groups, Gallery/still where qualified and Base Tree deployment under explicit existing-grade protection.

API/graph readback proves only structure/state. Any promised visual result requires `RENDER_VERIFIED` evidence. Pack UI/context/evaluation semantics ship with the underlying actions rather than as later cleanup.

## 23. Milestone 21 — Fairlight, Deliver and verification Capability Packs

Fairlight target: behaviorally qualified property writes, Voice Isolation, sync, transcription/subtitle, approved presets and measurable audio QC. Public scripting gaps around complete automation/plugin graphs/bus routing remain explicit.

Deliver target:

```text
render intent
-> settings plan
-> local approval
-> set settings
-> add job
-> start/monitor
-> locate produced file
-> file QC
-> DELIVERABLE_VERIFIED result
```

Introduce FFprobe/FFmpeg/transcription/frame/vision/audio adapters only when a concrete Capability Pack consumes them.

## 24. Milestone 22 — Prime / Workers with bounded WorkPackets

Only after the single-Agent System Spine, Context Compiler and evidence-backed loop are stable.

Potential role split:

```text
Prime
  Project/Media Worker
  Editor Worker
  Fusion/Color Worker
  Audio/Deliver Worker
  Verification Worker
```

Workers receive bounded `WorkPacket`s containing a goal slice, relevant SituationFrame/entity references, a capability subset, required evidence, resource budget and authority limits. They return typed findings/artifacts/candidate plans rather than an unstructured substitute conversation.

Workers may concurrently analyze independent local artifacts. They share the same ToolKernel and never receive raw broker or independent Resolve mutation authority. Stateful Resolve work remains centrally scheduled.

## 25. Milestone 23 — explicit fallback Capability Packs

For proven Blackmagic Scripting API gaps only:

- Resolve UI Automation may be added only as a capability-specific allowlisted implementation with its own permission/approval/recovery/qualification model; generic click/type authority remains prohibited;
- Offline Adapter may handle deterministic conform, DRP/DRT/DRX/project-data or other closed-project work only behind an isolated high-trust boundary;
- neither may silently activate behind an ordinary protected action;
- third-party OFX/VST/Fusion control enters only through CID-owned/trusted versioned plugin Capability Packs; unknown plugins remain observed/unsupported rather than receiving generic UI authority.

The normal product must expose the capability tier and limitations to user and Agent.

## 26. State ownership map during implementation

| Fact | Owner |
| --- | --- |
| app config | `config.ts` |
| OpenAI API key | `secrets.ts` |
| model/provider transport | COS runtime |
| conversation/session/turn | COS Session owner |
| CID Workspace identity / Resolve Project binding | CID Workspace owner |
| Workspace Analysis Artifacts / background Jobs | Analysis Store / Job owner |
| exact user goal/constraints/corrections | COS Goal/Session owner |
| current semantic Resolve state | Resolve World Model owner |
| current user/Agent focus | main-owned SharedFocus |
| semantic entity/evidence references | World Model / Evidence owner |
| model-visible DecisionFrame/ContextPack | Context Compiler output; derived only |
| ToolKernel/action routing | unified ToolKernel / Action Catalog |
| action semantics/affordances | ActionDescriptor owner |
| complete known capability/gap inventory | Capability Ledger |
| implementation selection/build qualification | implementation router + qualification registry |
| Resolve scheduling/lease | `ResolveScheduler` / AuthorityManager |
| Resolve execution authority / driver | CID `ResolveBroker` / adapter |
| local MCP policy surfaces | `resolve-gateway.ts` |
| CID Tunnel process state | `tunnel.ts` |
| connect/disconnect sequencing | `connection.ts` |
| workflow definitions | `workflow-registry.ts` after Milestone 6 |
| raw Resolve observations | workflow reader layer -> World Model evidence |
| capability qualifications | `resolve-capabilities.ts` |
| plans + plan hash | plan owner |
| Goal/Plan-grouped ChangeSet | durable workflow ledger projection |
| Resolve completion assessment | derived CompletionReport |
| approvals/execution evidence | durable workflow ledger/engine |
| protected mutation authority | existing safety/Workflow engine behind ToolKernel |
| Agent orchestration | COS runtime |
| Artifact Pin / pane sizes / drafts | renderer presentation state |
| final Sidebar/Conversation visuals | CID Codex-style renderer backed by COS runtime state |

Do not create parallel owners for convenience.

## 27. File-creation restraint

The target architecture may eventually have a richer directory tree, but each milestone creates only files it needs.

Examples:

- do not create `workflow/recovery.ts` before a writer needs recovery;
- do not create an analysis database before an analysis workflow exists;
- do not create an offline adapter framework before the first offline computation is justified;
- do not create generic status stores when current owners can project their state.
- do not build a full persistent project graph before a concrete World Model slice needs it;
- do not create a speculative third-party plugin marketplace/framework; the shared Capability Ledger/Pack contract itself is now required infrastructure and should be exercised by existing domain slices before plugin extensibility expands.

## 28. Validation policy

For every code milestone:

1. identify the accepted behavior changed;
2. run the smallest existing tests that cover it;
3. add a test only when existing tests cannot protect the accepted behavior;
4. run typecheck/build before considering the milestone complete;
5. use live Resolve validation when behavior depends on undocumented/runtime API behavior;
6. use a disposable project for writes;
7. run `git diff --check`;
8. inspect `git status` and the exact diff before reporting completion.

Do not package/install/commit/push unless the user asks for that milestone action.

## 29. Current implementation state / immediate next action

The first 2026-09-11 COS-host migration slice is now source-complete at non-live level. CID has one product Tunnel runtime, the external Tunnel targets only the protected product endpoint, Raw remains a randomized localhost-only developer/qualification route, and `startResolveGateway` now requires the caller-owned singleton `ResolveScheduler`. The product MCP tool list is exactly COS `session` / `agents` / `session_finish` plus CID `status` / `inspect` / `inspect_operation` / `audit` / `plan` / `execute`. No raw scripting, filesystem, terminal, Desktop or plugin tool is present on the product surface.

The real COS host runtime is now bound. The CID-owned companion bridge records exact browser request_id -> conversation -> COS Session ownership and hosts COS Session/Goal/Loop/Finish/Prime-Worker control plus manual Compact & Resume. Compact & Resume uses durable source/destination Send checkpoints, exact successor-conversation fencing, durable Session rebind, Prime binding transfer and crash recovery. Superseded source conversations remain historical aliases only and cannot mutate Session/Goal state or use protected product tools. Existing CID Chat/Session/TurnRunner/Goal/compaction code remains migration-only source and its create/turn/compact IPC entry points fail closed.

CID now owns the first production read-only System Spine beneath COS: stable Workspace <-> Resolve Project identity, SituationFrame, typed DecisionFrame, state-bound semantic ActionOffers with qualification-first/official-tie routing, the single ToolKernel/ResolveScheduler/ResolveBroker observation path, World Model EvidenceRef/SemanticDelta, and criterion-level CompletionReport. Protected product calls require exact current browser-correlated COS Session + conversation + active turn + message ownership and consistent tool identity. The first exact protected request is context-only and returns a bounded `CID_DECISION_CONTEXT` plus an opaque Session/Turn/context-bound `decisionContextToken`; Resolve dispatch requires a new exact request echoing that token. The receipt is one-shot: it is synchronously consumed into `inflight` before ToolKernel dispatch, refreshed only after the protected result, and every context-only request is durably tombstoned in the COS Session before response. Original parallel requests cannot know it, two concurrent requests cannot consume it twice, cache eviction/restart cannot turn the original request into execution, stale context/turn/restart invalidates it, and it is stripped before ToolKernel/Session argument recording. This is a DecisionContext freshness receipt, not approval. Worker chats have no independent mutation authority, including dormant and still-retired Worker identities. Completion freshness is owned by current World Model semantic provenance/invalidation state rather than a Session-global revision floor: evidence must match the current generation, exact workflow, exact target, exact semantic parameters such as preflight profile, required verification category/status and remain non-invalidated for its semantic slice. Workspace `fresh/stale/offline` remains a broad situation/UX signal. Model summaries are never completion evidence, and `finish_check` comes only from criterion-level CompletionReport.

COS Goal/Loop transport is physically complete at the browser bridge boundary: `/goal/draft`, `/goal/ack`, `/goal/open` and objective/settings/input routes use the canonical COS-derived Goal/Loop authority plus canonical decision-input/browser-helper transport. There is no `CosGoalProviderHost` / `attachCosGoalProviderHost` authority. Missing helper/provider availability fails closed, Goal STOP requires explicit complete CID CompletionReport evidence, and Loop never self-stops. Compact & Resume is forward-recovering after the durable Session destination cut; no terminal/recoverable state may leave Session=B while Prime authority remains A. System-Spine cockpit projection is keyed to exact Session + active Turn, so historical Session read/search and superseded Compact sources cannot replace current projection.

Artifact Workspace foundation is now closed without adding a parallel semantic owner. `AgentArtifactWorkspaceProjection` carries the canonical World Model generation, and Project / Media / Edit / Fusion / Color / Fairlight / Deliver lens detail is derived from evidence-bound Main-owned inspector projections rather than renderer-owned `workflowXxx` reader snapshots. Exact Resolve timeline/item/render-job/tool/port/codec identities remain Main-only; renderer-facing rows use semantic handles or bounded presentation fields. Fusion / Color / Fairlight / Deliver Refresh IPC returns only a bounded `RendererWorkflowObservationReceipt` (`target` + `schemaHash`), so raw protected reader payloads never enter renderer state before canonical reconciliation. Timeline-item focus also stays semantic across the renderer boundary: renderer sends only handle + generation and Main resolves the exact ID. Four-domain protected Agent results are rebuilt from the same canonical World Model inspector projections, so internal codec/job/item/tool identities do not bypass the boundary through model tool results. Empty entity names use fixed per-kind safe labels rather than exact-ID fallback. Explicit Refresh/Inspect remains the observation trigger and lens/navigation selection itself never inspects Resolve. Identity-free current-state readers are fenced before evidence admission: Deliver and the default Color pipeline reuse the existing protected Project observation so an external Project/Timeline switch advances World Model generation before their results can be attributed to a Workspace. Offline browsing is reconstructed from existing owners: CID Workspace durably records the last-known exact Project/Timeline and World Model generation, `AgentWorldModel` retains bounded historical semantic projection plus historical Evidence reads without changing `currentEvidence()`, and workflow Plans remain owned by the durable workflow ledger/projection. Offline/mismatch Artifact/Evidence are `cached_projection` and read-only, Plans are `cached_read_only`, System Spine Completion continues to consume current evidence only, and protected actions remain blocked. Resolve authority loss durably emits `approval_revoked` for unconsumed approved Plans; reconnect therefore preserves the Plan/history but requires a new local approval and the existing exact-target revalidation before execution authority can return. Different-Project reconnect keeps the Session bound to the old Workspace and exposes only its cached history.

Mutation Plan UI now follows the same ownership rule. Full `WorkflowPlanProjection` objects remain Main-owned canonical authority and are no longer returned through the mutation-Plan renderer IPC/preload surface. Main derives a bounded `RendererWorkflowPlanProjection` containing only plan/workflow IDs, lifecycle/risk/verification/approval summary, semantic target handle/label when current, safe fallback labels, bounded proposed-change fields and execution summary. That Mutation Plan IPC/state contains no exact Resolve project/timeline/item IDs, plan hash, fingerprints, marker customData or raw preconditions. Approve/Reject still send only `planId`; Main resolves the durable canonical Plan/hash and performs the existing revalidation/backup/execution gates. Restart/replay rebuilds the bounded renderer projection from the durable Plan rather than persisting a second renderer Plan truth. This statement is scoped to Mutation Plan projection and does not by itself retire unrelated legacy renderer/entity IPC surfaces.

Current exact-current validation:

```text
npm run typecheck
  PASS

npm test
  36 ordinary test files passed
  166 tests passed
  3 live files / 3 live tests skipped

npm run test:policy
  UI policy 13/13
  interaction 15/15
  concurrency 4/4
production build
  PASS
git diff --check
  PASS
```

No package/install/live Resolve writer/paid OpenAI request was run for this slice.

The next functional work is no longer upper-runtime rebasing, System-Spine closure, or Artifact Workspace foundation closure. Keep the completed ownership split, exact DecisionContext receipt gate, generation-fenced Artifact projection, and cached-read-only offline boundary intact; deepen qualified Artifact lens/content coverage and Capability Packs beneath those existing owners. Do not reactivate the legacy CID Session/TurnRunner as a parallel product runtime, do not introduce a second Tunnel/Resolve authority, and do not bypass CID Plan/approval/verification for writes. Local approval remains CID-owned and model/caller text still cannot authorize a write.

The charged real-API/read-only Agent smoke and representative ACI task evaluations remain useful validation when explicitly authorized. They should exercise the already-built System Spine/Context Compiler path, not substitute for it.

The optional real smoke still requires explicit user authorization to use the stored API key.

The old second-Workflow-Tunnel acceptance gap is superseded by the one-CID-Tunnel target architecture.
