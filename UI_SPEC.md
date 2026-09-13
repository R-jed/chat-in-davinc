# Chat in DaVinci — UI Specification

Date: 2026-09-12

Status: target Codex-style Agent cockpit specification backed by COS runtime and CID semantic/control state; current CID Topbar/minimal Chat remain migration baseline

## 1. Scope and authority

This document owns the user-facing information architecture, navigation, layout, interaction states and approval presentation for Chat in DaVinci.

It refines `AGENT_SYSTEM_SPEC.md` and `PRODUCT_SPEC.md` into a human-facing cockpit. Detailed domain functions/data composition belong to `WORKSPACE_SPEC.md`. It does not define authorization or execution semantics; those belong to `EXECUTION_SECURITY_SPEC.md`. It does not decide which capabilities exist; that belongs to `WORKFLOW_CATALOG.md` / the runtime Action Catalog.

The current CID Floating Topbar plus peer `Chat / Project / Media / ...` pages is an implemented migration baseline, not the target information architecture. The target uses a Codex-style left Workspace/Session Sidebar and middle Conversation renderer backed by COS durable runtime state, plus a CID Resolve Artifact Workspace on the right. COS owns Session/Conversation lifecycle and model orchestration; CID owns the final desktop presentation and must not duplicate COS lifecycle state.

## 2. Product posture

The application should feel like an Agent-driven Resolve control room: Conversation remains continuously available while the user and Agent inspect the same semantic DaVinci state on the right.

Target posture:

```text
Codex-style Workspace/Session Sidebar | Codex-style Conversation | Resolve Artifact Workspace
                                      |                          | Context
                                      |                          | Active Artifact
                                      |                          | Changes / Plan
                                      |                          | Evidence / Inspector
```

The UI is a projection of `GoalFrame`, `SituationFrame`, `SharedFocus`, Workspace identity, the Resolve World Model, Plans, ChangeSets, Jobs and Evidence. It is not a separate truth layer. A selected clip, a Chat reference, a proposed plan and an Activity trace should be able to resolve to the same semantic entity/evidence identity.

The UI should minimize cognitive translation for both the human and Agent: production concepts first, API/getter terminology only in diagnostic detail. It should not imitate Resolve's native pixels where a simpler semantic representation is clearer.

Do not expose internal development phase names in the interface.

## 3. Main window shell

### 3.1 macOS title-bar relationship

The current window uses Electron `titleBarStyle: hiddenInset` and reserves the top 30 px for the native title-bar/traffic-light area.

Keep that behavior unless a later visual review proves a native-window change is necessary.

The target shell remains native-window aware:

```text
native traffic-light/title-bar inset
Codex-style Workspace/Session Sidebar | Codex-style Conversation | Resolve Artifact Workspace
```

Interactive controls must use `-webkit-app-region: no-drag`. Blank title/background regions may remain draggable.

Do not place navigation controls underneath the native traffic lights.

### 3.2 Three-pane shared cockpit

The target shell uses three persistent functional regions:

```text
┌─────────────────────┬──────────────────────────┬─────────────────────────────────────┐
│ Workspace / Sessions│ Conversation             │ Resolve Artifact Workspace          │
│                     │                          │                                     │
│ Workspace A         │ durable Chat             │ Context                             │
│   Session A         │ Agent progress           │ Active Artifact                     │
│     Workers ▸       │ focus / plan links       │ Changes / Plan                      │
│   Session B         │ compact approvals        │ Evidence / Inspector                │
│ Workspace B         │ composer + Context       │                                     │
│ Settings/connection │                          │                                     │
└─────────────────────┴──────────────────────────┴─────────────────────────────────────┘
```

Conversation does not disappear when the active right-hand Artifact changes. The Resolve Artifact Workspace receives the largest horizontal expansion priority because production objects, semantic timelines, graphs, ChangeSets and evidence often need width.

### 3.3 Codex-style Workspace/Session Sidebar

Use Codex-style information architecture and interaction for the Sidebar, backed by COS durable Session/Worker state plus CID Workspace identity. CID owns the visual projection but must not create a second Session lifecycle beside COS.

The hierarchy is first-class, not optional:

```text
Workspace <-> one Resolve Project identity
  New Chat
  recent/durable Sessions
    expandable Worker activity/history
Activity / project history
connection status / setup
Settings
```

Workspace identity is CID-owned and survives Resolve project rename. A cross-project Goal references multiple Workspaces; one Workspace never silently binds multiple Resolve Projects. Switching the active Resolve target is explicit plan state, not a side effect of merely selecting a Sidebar row.

Accepted CID macOS/sidebar mechanics may be reused in the final Codex-style shell where they remain useful:

- it spans the full window height from top edge to bottom edge while keeping controls clear of the macOS traffic lights;
- it supports a persisted expanded/collapsed state;
- collapsed means fully hidden: no compact rail, clipped label, partial navigation mark or reserved sidebar width remains visible;
- while persistently collapsed, moving the pointer to the window's left edge temporarily reveals the full Sidebar as an overlay; leaving the Sidebar/edge interaction region hides it again without changing the persisted collapsed preference;
- Settings is directly reachable at the lower-left edge of the Sidebar;
- the Sidebar surface must visually harmonize with the main workspace background while remaining a distinguishable navigation layer;
- expanded Sidebar width is mouse-draggable from 200 px through 400 px; reaching 200 px keeps it visible, while dragging any farther inward directly collapses the Sidebar using the existing persisted collapsed state;
- the fixed expand/collapse control is centered at x=180 px, remains independent of Sidebar width/collapse/peek state, and is sized/aligned to harmonize optically with the macOS traffic lights;
- collapse/peek must not alter COS durable Session selection, CID Workspace binding or the current right-pane Artifact/Pin state.

The exact 200–400 px implementation bounds and fixed control geometry are current-baseline behavior, not a reason to force future session labels into a poor layout; change them only through a separate visual/interaction review.

### 3.4 Codex-style Conversation pane

The middle pane follows Codex-style conversation interaction and presentation while COS remains the durable Chat/Session/Agent runtime beneath it:

- user messages and Agent responses;
- compact semantic progress such as `Checking current timeline` or `Read 3 video tracks`, not repeated generic `Called tool` rows;
- `SharedFocus` context chips using readable semantic labels/handles;
- a lightweight expandable Context view showing what this turn exposes to the model: Workspace/Timeline/focus, selected evidence, transcript/frame/artifact counts and explicit exclusions;
- links to exact right-pane objects, evidence and plans;
- clarification/decision state when the Agent genuinely needs user input;
- local approval entry points when a protected plan requires approval;
- explicit run state when waiting for user decision/approval or stopping at a safe boundary;
- composer.

Tool names, raw JSON, exact UUIDs, model/provider debugging, token accounting and internal reasoning are not default conversation chrome. Technical evidence remains available through detail/Activity when useful.

### 3.5 Resolve Artifact Workspace

The right pane is the main production surface. It is contextual rather than page-centric. Project / Media / Edit / Fusion / Color / Fairlight / Deliver remain capability domains and optional manual lenses; they are not seven equal pages that the user must traverse.

Stable four-layer skeleton:

```text
Context
  Workspace / Resolve Project / Timeline / SharedFocus / live-or-cached status

Active Artifact
  Timeline / Media Review / Fusion graph / Color comparison / Audio / Deliver / Project

Changes / Plan
  proposed -> approved -> executing -> applied -> verified / contradicted / ambiguous

Evidence / Inspector
  semantic detail / provenance / limitations / developer detail on demand
```

The active Artifact soft-follows Agent work only while the user is not actively inspecting another Artifact. User interaction always wins. Pin disables automatic switching; background Agent work elsewhere is indicated without stealing the view.

Avoid translating each API getter into its own card or reproducing the entire native Resolve UI. The right pane exists to answer: what object/state matters, what is proposed or changed, and what evidence proves it.

Examples:

```text
Timeline      tracks / clips / ranges / markers / issues / selection / proposed edits
Media Review  bins/items + local selects/favorite/reject/compare state
Color         clip + graph/stack/group/version + before/after/render evidence
Deliver       intent / settings / jobs / produced output / verification
```

### 3.6 Semantic links and SharedFocus

The human and Agent share the meaning of `this` through main-owned `SharedFocus`.

```text
user selects Interview 04 [I31] in Edit
  -> Chat shows I31 as context

Agent says V2 has an 11-frame gap near I31
  -> Open in Edit highlights the same semantic object/relation

approval / Activity references I31
  -> same right-pane target/evidence is reachable
```

Focus never authorizes a mutation. Plans continue to bind/revalidate exact targets independently. Selecting an Artifact updates `SharedFocus` only; it does not move Resolve page/playhead/selection. An explicit `Reveal in Resolve` action is required for that side effect.

Current and proposed state must remain visually distinct. A plan may overlay its prospective effects on the right workspace for review, but proposed items use a clear prospective treatment and do not enter the ordinary current-state styling until execution + declared verification succeed.

### 3.7 Resizing and responsive behavior

Initial comfortable-width targets:

```text
Sidebar            about 200–280 px
Conversation       about 480–680 px
Artifact Workspace receives all remaining width
```

Sidebar and Conversation/Artifact boundaries may be user-resizable. Pane sizes are presentation state only.

When width is constrained:

- shrink Conversation toward a readable minimum before making the Artifact Workspace unusably narrow;
- preserve composer and active SharedFocus;
- the right workspace may become a switchable overlay/focus view at very narrow widths;
- never instantiate duplicate domain/session DOM/state trees merely to support a breakpoint.

### 3.8 Startup and migration

Startup routing target:

```text
setup/credential/connection configuration needs attention
  -> Sidebar connection/Settings flow

setup complete
  -> most recent durable Conversation when available
  -> Artifact Workspace restores a valid Pin when possible; otherwise it opens the Artifact implied by current Goal/SharedFocus/SituationFrame, falling back to Project context
```

Do not route to Activity merely because a previous run had an error.

The current Floating Topbar remains an implementation rollback/migration mode until the three-pane shell is accepted. Do not extend it with new long-term domain/session semantics that would then need to be removed.

## 4. Capability-domain artifact lenses

The sections below define domain-specific Artifact projections and capability vocabulary. They do not create seven independent navigation/state owners. `WORKSPACE_SPEC.md` is authoritative for detailed functions, observation/action ownership and implementation boundaries.

### 4.1 Project

Project is the default right-hand production domain when there is no more relevant focus.

The right-hand Project view should answer, in order:

```text
What project/timeline am I on?
Is the project readable and ready?
What needs attention?
What are the important structural facts?
```

Initial sections:

1. current project/timeline identity;
2. project preflight summary;
3. media pool summary;
4. timeline summary;
5. color pipeline summary;
6. audio summary;
7. render summary;
8. capability limitations relevant to those checks.

Existing project/timeline identity facts from the current Workflow page move here.

Connection implementation details do not dominate this page.

### 4.2 Media

Media owns source and Media Pool state rather than timeline editing.

Initial Artifact projection:

- current bin/folder context;
- Media Pool inventory;
- source clip/media-type counts;
- offline/missing references;
- proxy/full-resolution state where measurable;
- frame-rate/resolution mismatch facts;
- metadata inventory needed by later ingest, sync and conform workflows.

Source media remains immutable by default.

### 4.3 Edit

Initial Artifact projection:

- track and item structure;
- gaps/overlaps;
- offline references;
- marker/review state;
- subtitle coverage;
- source-range facts;
- multicam/sync readiness where available.

Later Plan/ChangeSet projection appears in the shared Changes/Plan layer; execution remains owned by the Workflow engine.

### 4.4 Fusion

Initial Artifact projection:

- composition presence by selected/current target where reliably addressable;
- tool inventory;
- input/port inventory;
- graph connectivity;
- known capability or verification limitations.

Later writes may create or connect only app-defined, deterministic tool structures through the protected Workflow engine. A successful API return is not enough to claim a visible Fusion change when render evidence is required.

### 4.5 Color

Initial Artifact projection:

- color-management state;
- timeline color settings;
- group/clip/timeline grade inventory where supported;
- LUT/DCTL references;
- grade/version state;
- technical warnings.

Avoid language that makes creative judgments such as “better”, “cinematic” or “correct look” unless the user supplied a measurable target.

### 4.6 Fairlight

Initial Artifact projection:

- track/channel layout;
- source mappings;
- Fairlight capability/preset state;
- sync readiness;
- subtitle/transcription capability;
- measurable analysis results only when the corresponding local adapter exists.

### 4.7 Deliver

Initial Deliver Artifact is validation-first:

- current render settings;
- format/codec;
- resolution/frame rate;
- render range;
- output destination status;
- audio/subtitle inclusion;
- queued-job state;
- blockers.

Future rendering is shown as three distinct steps:

```text
Plan
Execute
Verify output
```

Do not render a completed Resolve job as a verified deliverable unless file-level verification actually ran.

### 4.8 Activity

Activity eventually has two data groups:

```text
Workflow history
  plans
  approvals/rejections
  executions
  changes
  verification
  recovery

Operational diagnostics
  connection lifecycle
  tunnel events
  gateway events
  errors/warnings
```

The workflow history is the primary view after write workflows exist. Raw operational log text becomes a secondary diagnostics view.

The current copy-activity and copy-diagnostics actions may remain, but copied output must continue to exclude credentials and private MCP route tokens.

### 4.9 Settings

Settings owns:

- Setup;
- connection/tunnel configuration;
- API-key status;
- background behavior;
- menu-bar behavior;
- launch at login;
- language;
- developer/diagnostic details;
- protected-vs-advanced/raw policy configuration behind the single CID Gateway.

The existing six-step setup flow moves here intact during the first UI migration.

## 5. Historical Workflow-page redistribution into the Artifact model

The current generic `Workflow` page disappears as a top-level page.

Redistribute its cards as follows:

| Current card | Destination |
| --- | --- |
| Connection inspection | Settings > Diagnostics |
| Capability inspection | Settings > Diagnostics; relevant limitations also projected into Project |
| Safety inspection | removed as a standalone dashboard card; shown in plan/approval context |
| Recent audit | Activity |
| Project preflight | Project |

The underlying read-only APIs remain usable. This is an information-architecture change, not a backend deletion.

## 6. Resolve Artifact Workspace content layout

### 6.1 Content width

The right Resolve Artifact Workspace is fluid and should use the remaining desktop width. Do not keep the old `720–760px` centered maximum or recreate a narrow web-document column inside a wide production pane.

Settings/Setup may still use a readable centered column when opened as an application utility. Production domains use the full right workspace with sensible column widths inside tables/inspectors.

### 6.2 Surface hierarchy

Prefer flat continuous working surfaces and separators over a dashboard made of rounded cards. The visual hierarchy mirrors the four semantic layers:

1. restrained Context bar;
2. Active Artifact working surface;
3. Changes / Plan review surface when relevant;
4. optional Evidence / Inspector detail.

A layer with nothing material to show may collapse, but its semantics do not migrate into an unrelated duplicate state model.

Cards remain appropriate for discrete semantic objects such as an approval plan, execution contradiction, produced deliverable or compact status summary. Do not give every fact or reader its own bordered container.

### 6.3 Fact presentation

For compact machine facts use label/value rows similar to the current `.fact` pattern.

IDs are display-only references and should normally appear as readable semantic labels plus local short handles such as `Interview 04 [I31]`. The engine continues to retain exact IDs internally. A handle is not authorization.

Project and timeline names may be shown in full when they fit. Long names truncate visually without altering the actual value.

## 7. Status vocabulary

The UI must distinguish lack of evidence from success.

Common evidence states:

```text
ready / verified
warning
blocked
unverified
unavailable
error
loading
```

Rules:

- `unverified` is neutral/attention state, never green success;
- `unavailable` explains a capability gap rather than looking like a runtime failure;
- `blocked` means the workflow cannot proceed under current preconditions;
- `error` is reserved for an actual failed operation/check;
- a transport success alone does not paint a write operation green.

The exact operation evidence states are defined in `EXECUTION_SECURITY_SPEC.md`.

## 8. Connection indicator

The Sidebar connection control is a compact system-health summary. During migration the current top-bar/signal placement may remain, but the target owner is the persistent Sidebar utility region.

User-facing states:

```text
Connected
Connecting
Disconnected
Needs attention
```

The popover must keep three orthogonal health groups separate:

```text
Brain
  COS Chat / Session / Agent runtime

CID transport
  CID Tunnel / MCP Gateway
  protected policy ready
  optional advanced/raw policy state
  last CID request/tool call

Hands
  Resolve running
  Resolve driver / Broker / ToolKernel authority
```

The COS runtime can be healthy while CID transport or Resolve is unavailable, but DaVinci operation is not healthy unless both the CID Tunnel/Gateway and Hands are available. A healthy model session must not paint DaVinci control as connected when the CID boundary or Resolve authority is unavailable.

The detailed diagnostic model remains in Settings. Do not duplicate a second health monitor inside the renderer.

The single compact signal may summarize the highest-priority user-actionable problem, but Settings preserves all three dimensions independently. Protected/raw policy state is diagnostic detail inside CID and never becomes a second Agent-health owner.

## 9. Plan presentation

Plans can be referenced in Conversation, rendered with full detail in the Workspace Changes/Plan layer, and opened from Activity. All projections point to the same durable Plan identity and associated Goal-grouped ChangeSet.

When the right workspace can meaningfully preview a plan, show `current -> proposed` using the same EntityRefs rather than duplicating objects into an unrelated preview model. Proposed state is never painted as current/verified state.

A plan summary must show:

```text
workflow title
target project/timeline
proposed change count/summary
risk level
blast radius
preview status
backup/recovery class
verification level required
expiry/stale state
```

Do not show a plan as approved simply because ChatGPT requested execution.

Stale plans remain visible with a clear stale reason. `Rebase` performs a fresh observation/recomputation and creates a new Plan/hash; it never edits the stale Plan in place. Human edits in Resolve win and any target/fingerprint drift stales dependent Plans.

## 10. Local approval sheet

The approval state is one local application object with multiple projections; it is not an MCP response rendered by the model. Low/medium-risk work may expose a compact Chat quick-approval control. High-risk work must route the user into the full Workspace Changes/Plan review before approval.

Minimum content:

```text
What will change
Where it will change
Risk and blast radius
How the current state is protected
How success will be verified
What cannot be automatically recovered
Approve
Reject
```

The approval sheet displays the immutable plan hash in developer details only, not as primary user copy.

Approval does not automatically dispatch the operation in the first implementation. It transitions the plan to “approved, awaiting execution”. A subsequent `execute(plan_id)` request passes through the same Workflow engine.

This keeps approval and dispatch as separately auditable events and avoids hidden work after a button click.

The UI may later add an explicit `Approve and run` action, but it must call the same engine path and must not bypass the durable approval record.

## 11. Execution result presentation

After execution, show the Goal/Plan-grouped ChangeSet, semantic outcome and evidence separately. Every protected mutation generates a ChangeSet, including low-risk direct Workspace actions. `Executed` and `Verified` are distinct states; only the declared verification level can promote the work to verified completion.

Example:

```text
Operation: completed
Verification: API readback passed
Changed: 1 marker added
Backup: not required; deterministic compensation available
```

Contradiction example:

```text
Operation: Resolve returned success
Verification: contradiction
Expected marker was not present on readback
```

Ambiguous example:

```text
Operation: outcome uncertain
The request may have reached Resolve before the connection was lost.
It was not retried automatically.
```

Do not reduce these cases to one success/failure icon.

## 12. Empty and unavailable states

Every production Artifact/lens needs intentional empty states.

Examples:

```text
No project open
No current timeline
Resolve not connected
This check is unavailable on the current Resolve build
This feature has not been implemented in the protected Workflow yet
```

Avoid generic “Something went wrong” copy when the application knows the actual reason.

Unimplemented future Artifact/lens projections may show one restrained unavailable state during shell migration. Do not fill them with fake sample data or non-functional controls.

## 13. Loading behavior

Read-only inspections are demand-driven.

When the user opens or switches an Artifact/lens:

- render still-valid World Model state immediately;
- load only missing/stale observations without clearing valid facts;
- show local loading state around the affected working surface rather than blanking the whole pane;
- keep refresh explicit for expensive readers.

Do not create aggressive polling of the whole Resolve project. Resolve-disconnected Workspaces remain usable for cached analysis/history/planning with an explicit `Resolve Offline` / cache timestamp state; offline-created write Plans never auto-execute on reconnect and must pass fresh observation/revalidation.

The existing 15-second connection health refresh may remain for transport health. Artifact/domain observations do not join that polling loop. A completed observation should update semantic World Model state/deltas so Chat and the right pane do not each trigger the same read merely to obtain equivalent facts.

### 13.1 Run/interruption state

Long Agent work needs an explicit control state rather than only a disabled Send button:

```text
running
waiting for your decision
waiting for local approval
stopping at safe boundary
outcome ambiguous — review required
```

A user redirect can supersede safe pending reasoning/read work. The UI must not say `Stopped`/`Cancelled` for a mutation that may already have been dispatched; show the execution truth from `EXECUTION_SECURITY_SPEC.md` and require resolution/readback as applicable.

## 14. Focus/context behavior

Use the main-owned `SharedFocus` / `EntityRef` model from `AGENT_SYSTEM_SPEC.md` rather than an ad-hoc renderer-only `ResolveFocus`:

```text
entity kind
readable label + short handle
locally bound exact identity
parent/generation
domain / locator when useful
focus source
```

The Context Compiler can include SharedFocus through the SituationFrame when it helps the Agent resolve natural references such as “this clip” without restating a UUID or path. The UI may show a human-readable projection of the current model-visible ContextPack, but renderer state does not become model context merely because it is visible.

Focus is never approval and never execution authorization. An approved plan carries its own exact target IDs and fingerprint, and stale handle/generation resolution fails closed.

Chat and right-pane links are bidirectional. The user should be able to move from an Agent claim to the exact relevant DaVinci semantic object/evidence, and a selected right-pane object should become visible context in the composer without being copied into a giant prompt payload.

Do not reproduce the browser-control-panel file polling used by the reference project. Electron renderer/preload/main IPC already provides the appropriate state path.

## 15. Language and terminology

Supported preferences remain:

```text
System
English
简体中文
```

Keep product names and technical brands where natural:

- Chat in DaVinci;
- DaVinci Resolve;
- ResolveMCP;
- Fusion;
- Fairlight;
- OpenAI;
- ChatGPT.

Chinese domain labels:

```text
Project  -> 项目
Media    -> 媒体
Edit     -> 剪辑
Fusion   -> Fusion
Color    -> 调色
Fairlight -> Fairlight
Deliver  -> 交付
Activity -> 活动
Settings -> 设置
```

App-owned status/error/approval copy must be localized. Raw official payload content is not rewritten merely to make it Chinese.

## 16. Accessibility and interaction rules

- Every icon-only control has an accessible label and title where useful.
- Active navigation exposes selected state.
- Popovers close on Escape and click-away.
- Keyboard focus remains visible.
- Do not use color as the only indication of verified/warning/error state.
- Controls retain at least the existing practical hit target size.
- Motion is optional and minimal; no navigation requires animation to understand state.

## 17. Optical alignment rules

The three-pane boundaries, persistent composer and right Artifact Context bar are high-frequency visual elements and should be reviewed at actual app scale.

Check:

- Sidebar/session-row optical alignment with the macOS traffic lights and fixed collapse control;
- Conversation text measure, composer width and context-chip density;
- splitter affordance without a visually heavy divider;
- baseline/alignment of right-pane Artifact/lens labels;
- connection and Settings alignment at the Sidebar bottom;
- equal apparent padding inside active right-pane Artifact/lens controls;
- traffic-light clearance;
- selected-domain treatment not visually heavier than the active production content;
- Chinese and English labels align without changing shell geometry unexpectedly.

Do not fix one icon by introducing a global transform that misaligns the rest.

## 18. Shared-cockpit migration acceptance

The current CID Floating Topbar/minimal Chat/Sidebar implementation is a rollback/migration baseline. The target product uses a CID-owned Codex-style visual shell backed by COS runtime state.

The target migration is accepted only when:

1. CID Workspace -> Resolve Project 1:1 binding is visible and stable across Project rename;
2. COS durable Sessions/Workers are selectable/creatable inside the Workspace-first Codex-style Sidebar without duplicating Session lifecycle;
3. Conversation remains visible while the right Active Artifact changes;
4. the right pane uses Context / Active Artifact / Changes·Plan / Evidence·Inspector rather than seven peer mini-pages;
5. soft-follow never steals an actively inspected or Pinned Artifact;
6. existing Project/Media/Edit/Fusion/Color/Fairlight/Deliver reader content is preserved as semantic Artifact/capability projections;
7. Activity, Setup, CID connection diagnostics and Settings remain directly reachable;
8. one right-pane `EntityRef` selection updates main-owned SharedFocus and is visible to Conversation without becoming authorization or moving Resolve;
9. `Reveal in Resolve` is explicit and separate from selection;
10. Agent/entity/evidence/Plan/ChangeSet links resolve to the same canonical objects across Chat, Workspace and Activity;
11. high-risk approval requires full Workspace review; low/medium Chat quick approval hits the same canonical approval state;
12. direct semantic Workspace controls use the same ToolKernel/risk/ChangeSet/verification path as Agent actions;
13. resizing/collapse/peek changes presentation only and cannot create duplicate domain/session state or workflow calls;
14. no backend Workflow/Raw/ToolKernel authorization behavior changes merely because the shell changes;
15. System/English/简体中文 remain complete for all changed user-facing UI;
16. traffic-light clearance, minimum-width behavior, keyboard focus and accessible names remain valid;
17. current connection and Setup behavior still works after the layout change.

Accepted CID geometry/peek/resize behavior may be reused where visually desirable. Do not preserve a parallel CID Session lifecycle/state owner; COS remains that owner even though CID owns the final renderer projection.

Visual inspection plus existing typecheck/UI-policy/interaction/build gates is the minimum validation. Add new renderer tests only for accepted interaction/state behavior not already covered; do not create a new UI test framework solely for the migration.
