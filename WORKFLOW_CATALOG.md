# Chat in DaVinci — Capability & Workflow Catalog

Date: 2026-09-13

Status: canonical Capability/Action contract + protected executable-workflow inventory; concrete breadth-first capability inventory lives in `CAPABILITY_LEDGER.md`

## 1. Purpose

This document defines the canonical Capability/ActionDescriptor schema, lifecycle vocabulary, versioned implementation model and current protected executable Workflow inventory. `CAPABILITY_LEDGER.md` is the canonical breadth-first inventory of known semantic capability IDs, lifecycle states and explicit gaps. `AGENT_SYSTEM_SPEC.md` defines how ledger capabilities become state-bound ActionOffers inside a DecisionFrame and how the Agent composes them.

It is not the Blackmagic Raw tool list. Raw remains the exact official ResolveMCP surface.

The protected connector keeps a small public MCP surface:

```text
status
inspect
inspect_operation
audit
plan
execute
```

`cancel` remains deferred and is not part of the current protected MCP tool surface.

The catalog below distinguishes stable semantic capabilities from concrete executable workflow/implementation records. Agent/UI callers use the same internal ToolKernel/Action Catalog; adding hundreds of internal abilities does not expand the public MCP surface automatically. The Context Compiler exposes only the state-bound Capability Frontier/ActionOffers relevant to one decision. Visibility is not executability or authorization.

## 2. Capability lifecycle vocabulary

`CAPABILITY_LEDGER.md` applies these lifecycle states so known Resolve abilities never disappear into silent gaps:

```text
production
  full vertical contract + real disposable-fixture qualification for the supported Resolve build

qualified
  behaviorally qualified for a declared build/environment, but not yet admitted to production UX/policy

implemented
  code exists, but production qualification/vertical contract is incomplete

experimental
  exploratory implementation or incomplete semantics; never implied reliable

planned
  accepted product direction; implementation not yet complete

unsupported
  known ability currently not implementable under the supported execution tiers

intentionally_excluded
  deliberately outside the protected product surface

api_gap
  known production ability not exposed by the official/public API path

ui_automation_candidate
  API gap that may receive an explicit allowlisted UI Automation Capability Pack
```

Historical labels such as `next`, `deferred` and `rejected` may remain in older per-workflow notes as planning provenance, but new capability accounting uses the lifecycle above. No non-production writer is callable merely because it appears in this document.

## 3. Capability, ActionDescriptor and implementation records

The stable cognitive identity is the semantic `capability_id` / `action_id`, not a script name, MCP tool name or provider-specific workflow ID. Examples: `edit.clip.trim`, `media.item.move`, `color.grade_version.create`.

A canonical capability/action contract contains, as relevant:

```text
capability_id / action_id       stable semantic ID
contract_version                semantic contract version
layer                           primitive | workflow
domain
title / routing_summary / not_for
accepted_target_kinds
input_schema
answers / observation_value     for readers
read_set / write_set
preconditions
risk_level / blast_radius
approval_policy / preview_mode
idempotency / retry_contract
recovery_class
verification_level / verification_contract
expected_semantic_effects
result_projection
next_affordances / remediation
context_recipe / frontier_rules
estimated_context_cost
estimated_resolve_call_cost
latency_class
```

Concrete implementations are separate versioned records:

```text
implementation_id / implementation_version
capability_id + compatible contract_version
source_tier                     official_mcp | official_scripting | samuel_derived |
                                local_analysis | offline_adapter | ui_automation |
                                trusted_plugin_pack
resolve_build/version range
platform/license requirements
qualification state + EvidenceRefs
reader/writer/verification templates or adapter entrypoint
known limitations
```

Existing `workflow_id/workflow_version` records remain the protected executable form for compound actions and may map to one stable capability contract. They are not the long-term semantic identity exposed to Agent reasoning.

The runtime executable registry is authoritative for what can dispatch now. `CAPABILITY_LEDGER.md` is authoritative for the known semantic inventory and lifecycle/gap state. This file owns the contract and executable-workflow design; neither document by itself proves runtime executability.

Action descriptions should be task-shaped and distinguish `intent` from `not_for`. Granular API methods remain implementation ingredients unless an Agent evaluation proves they are the clearest semantic primitive.

## 4. Common safety terms

Risk:

```text
low | medium | high | critical
```

Blast radius:

```text
item | track | timeline | project | system | unknown
```

Preview:

```text
native
derived_plan
unavailable
```

Recovery:

```text
A read-only
B deterministic compensation
C snapshot/version protected
D no automatic recovery guarantee
```

Verification:

```text
API_READBACK
STRUCTURAL_READBACK
RENDER_VERIFIED
AUDIO_VERIFIED
DELIVERABLE_VERIFIED
```

Detailed semantics are owned by `EXECUTION_SECURITY_SPEC.md`.

## 5. Current connector primitives

These are current MCP entry points rather than domain workflows.

| Entry point | Status | Current behavior |
| --- | --- | --- |
| `status` | implemented | Blackmagic/Resolve connection status; read-only |
| `inspect` | implemented | `connection`, `capabilities`, `project`, bounded `media` / `edit` / `color` / `fairlight` / `deliver`, plus aggregated `preflight`; read-only |
| `inspect_operation` | implemented | versioned registry risk/execution metadata for registered protected workflows |
| `audit` | implemented | bounded in-memory protected call summaries; durable mutation evidence is owned by the workflow ledger |
| `plan` | implemented | creates the immutable plan for the currently qualified bounded writer |
| `execute` | implemented | executes only an already-approved durable `planId`; no target/risk/hash fields are accepted from the caller |
| `cancel` | deferred | only added for a specific cancellable job/workflow |

The six current verbs are transport/control vocabulary, not the Agent's cognitive action ontology. The Agent should normally receive a DecisionFrame plus state-bound `ActionOffer`s from the Capability Frontier, choose a semantic action intent, and let the gateway map that intent to the required control verb. `execute` and `edit.clip.trim` are not peer choices.

## 5.1 Capability Pack admission

Future capability is admitted vertically rather than by adding an isolated workflow ID. A coherent Capability Pack should identify, as applicable:

```text
stable semantic capability IDs
semantic EntityRefs / relationships
observation recipes and EvidenceRefs
primitive ActionDescriptors
workflow ActionDescriptors / DAG composition
versioned implementation candidates
Resolve build/version qualification matrix + limitations
World Model freshness/invalidation effects
Context Compiler / Capability Frontier recipe
Artifact Workspace projection
Plan / ChangeSet / approval / recovery / verification contract for mutation
analysis/evidence recipes when required
representative Agent task evaluations
upstream/provenance references
```

A method being callable does not make the pack Agent-capable. `production` requires the complete vertical contract and real qualification evidence for the supported Resolve build. Isolated wrappers may remain implementation ingredients/experimental entries but cannot silently become production affordances.

Primitive and workflow layers both remain complete. A strong future model may compose qualified primitives into a dynamic action graph, while mature workflows provide efficient higher-level behavior. Any dynamic mutation graph must materialize as an immutable Plan before the first protected write. Workflow composition is a DAG: directed composition is allowed; recursion and hidden second execution chains are not.

Hybrid workflows may contain deterministic stages, model-inference stages and human-decision stages, but each stage boundary is explicit. Model improvement never automatically raises autonomy; qualification, user authorization and risk policy remain independent gates.

### 5.2 Qualification and implementation routing

Qualification is implementation- and Resolve-build-specific. Passive qualification may automatically probe read-only capability/state. Active writer qualification requires explicit Compatibility Check flow using disposable qualification projects/fixtures; never use a production project as a writer fixture.

When several implementations satisfy the same semantic contract, routing is deterministic:

```text
1. exclude incompatible/unqualified/stale implementations
2. prefer stronger determinism / verification / recovery at acceptable risk and cost
3. choose the best-qualified implementation
4. official implementation wins ties
5. UI Automation is last-resort and only for an allowlisted qualified capability
```

The selected implementation identity/version and qualification evidence are sealed into a protected Plan before approval. The engine must not silently reroute an approved Plan to another implementation at execution time; a changed implementation requires a new Plan/hash/review.

New Resolve builds do not inherit writer production status blindly. Stable low-risk readers may remain provisional when their passive probes still pass; version-sensitive writers drop to `needs qualification` until active qualification is established.

## 6. System and connection workflows

### `system.connection_status.v1`

```text
status: implemented
domain: system
read_only: true
risk: low
blast_radius: item
preview: native
recovery: A
verification: API_READBACK
```

Purpose: report live Resolve/ResolveMCP connection state without project mutation.

### `system.capability_snapshot.v1`

```text
status: implemented
domain: system
read_only: true
risk: low
blast_radius: item
preview: native
recovery: A
verification: API_READBACK
```

Current output includes the official Raw tool snapshot, protected tool list and the narrow capability evidence consumed by the current protected V1 readers. Capability evidence records source, qualified build, status, requirements, limitations and probe strategy; unknown remains unknown outside the qualified build/runtime evidence.

## 7. Project workflows

### `project.identity.v1`

```text
status: implemented
read_only: true
risk: low
blast_radius: project
preview: native
recovery: A
verification: API_READBACK
```

Reads:

- current Resolve page;
- project name and unique ID;
- timeline count;
- current timeline name and unique ID;
- video/audio/subtitle track counts.

Implementation uses the existing app-owned getter-only script template through Blackmagic sandboxed `run_script`.

### `project.settings_summary.v1`

```text
status: implemented
read_only: true
risk: low
blast_radius: project
preview: native
recovery: A
verification: API_READBACK
```

Current output:

- bounded project and effective timeline resolution facts;
- timeline and playback frame-rate facts where reliably exposed;
- output resolution, frame-rate mismatch behavior, color science and video monitor format;
- timeline custom-settings state only when the official API exposes it;
- explicit unavailable/unverified facts instead of inferred zero/false values.

Implementation reuses the existing app-owned fixed getter-only Project template and reads `Project.GetSettings()` / `Timeline.GetSettings()` through Blackmagic sandboxed `run_script`. The model cannot supply Python. The implementation was live-validated against Resolve 21.1.

Do not mirror every project setting. Read only fields consumed by visible Project/preflight checks.

### `project.lifecycle_capabilities.v1`

```text
status: planned
read_only: true
risk: low
blast_radius: project
preview: native
recovery: A
verification: API_READBACK
```

Reports only the project lifecycle/preset/backup capabilities needed by the UI. It does not create, import, archive, restore, delete or switch databases.

### `project.preflight.v1`

```text
status: implemented
read_only: true
risk: low
blast_radius: project
preview: native
recovery: A
verification: STRUCTURAL_READBACK
```

Inputs:

```text
profile: general | media | edit | fusion | color | fairlight | delivery
```

Aggregates the approved compact domain readers rather than re-enumerating the same facts itself:

```text
media.inventory_summary.v1
edit.timeline_summary.v1
fusion.composition_inspect.v1
fusion.graph_inspect.v1
color.pipeline_inspect.v1
color.graph_inventory.v1
fairlight.mapping_inspect.v1
deliver.settings_inspect.v1
```

Returns:

```text
pass | warning | blocked | unverified
checks
warnings
blockers
capability_gaps
project/timeline identity
observed_at
schema_hash
```

No check mutates state to discover whether something would work.

Current implementation composes the already-approved compact V1 readers through the same `ResolveBroker`. `profile` is supported for `general`, `media`, `edit`, `fusion`, `color`, `fairlight` and `delivery`. Fusion consumes both composition and bounded graph readback; Color consumes both pipeline and bounded timeline/default-clip graph readback. Graph state remains separate from rendered-pixel evidence. The implementation was live-validated against Resolve 21.1 on 2026-09-10.

## 8. Media workflows

Media owns the complete Media Pool/source inventory. Project consumes only its compact readiness summary.

### `media.inventory_summary.v1`

```text
status: implemented
read_only: true
risk: low
blast_radius: project
preview: native
recovery: A
verification: STRUCTURAL_READBACK
```

Target output:

- root/current-bin identity where useful;
- source clip count;
- folder/bin count;
- timeline/compound/generated-item counts where reliably distinguishable;
- offline/missing indicators;
- proxy/full-resolution indicators where supported;
- media-type summary;
- high-confidence frame-rate/resolution mismatch flags.

Current implementation is a fixed getter-only bounded traversal through Blackmagic sandboxed `run_script`. It caps traversal at 200 folders / 1000 items and returns at most 50 folder rows / 50 item rows while preserving observed counts and explicit truncation evidence. It does not return source or proxy file paths. Resolve `Type` strings are display evidence only because they follow the Resolve UI language; timeline identity uses `MediaPoolItem.GetTimeline()` instead. Online/proxy state is counted only when the API returns an explicit recognized value or proxy-path presence. Optimized-media and full-resolution-link state remain explicitly unverified. Motion-source mismatch counts exclude timeline items and one-frame items. Live Resolve 21.1 gateway validation passed on 2026-09-10.

Not for: deep media content analysis, transcription or visual classification.

### `media.clip_inspect.v1`

```text
status: implemented
read_only: true
risk: low
blast_radius: item
preview: native
recovery: A
verification: API_READBACK
```

Reads one exact Media Pool item where a stable ID is available:

- source properties such as type/FPS/duration/resolution/codec;
- audio mapping;
- metadata/third-party metadata where exposed;
- marker/flag/clip-color annotations;
- proxy/full-resolution/link state where measurable.

Current implementation resolves the exact item by stable `GetUniqueId()`, then uses `dir()` against a fixed app-owned allowlist of eight getters: `GetClipProperty`, `GetMetadata`, `GetThirdPartyMetadata`, `GetMarkers`, `GetFlagList`, `GetClipColor`, `GetAudioMapping` and `GetTimeline`. Missing methods and getter/readback failures are returned as explicit evidence and map to `unverified` claims instead of fabricated empty/false values. Source and proxy path values are filtered out. `fullResolutionLinkState` always remains unverified because Resolve 21.1 has no qualified dedicated getter proving that state. Live gateway validation on 2026-09-10 observed all 8/8 checked getters on the disposable source clip with zero missing methods and zero readback failures.

### `media.metadata_inventory.v1`

```text
status: not separately registered in the current selected-item slice
read_only: true
risk: low
blast_radius: item/project
preview: native
recovery: A
verification: API_READBACK
```

The current selected-item metadata/property inventory is already returned by `media.clip_inspect.v1`, including bounded Resolve metadata and third-party metadata with path-like keys/values removed. Do not register a duplicate reader merely to satisfy this catalog name. A separate project/bin-scope metadata inventory should be added only when a concrete ingest/conform/sync question needs that broader scope. Writable metadata fields are not assumed stable across Resolve versions/locales.

### `media.link_status.v1`

```text
status: implemented and live-validated on Resolve 21.1
read_only: true
risk: low
blast_radius: item/project
preview: native
recovery: A
verification: API_READBACK
```

Reports link/relink/proxy/full-resolution method-surface evidence without relinking or modifying source files. The reader uses `dir()` only against a fixed app-owned allowlist: `MediaPool.RelinkClips`, `MediaPool.UnlinkClips`, `MediaPoolItem.LinkProxyMedia`, `MediaPoolItem.UnlinkProxyMedia` and `MediaPoolItem.LinkFullResolutionMedia`. It never calls those methods. Exact item probing is optional and uses bounded unique-ID lookup. Every observed mutation method remains `runtime_observed` with `protectedWrite: not_registered`; method presence is not behavioral writer qualification. Full-resolution link state remains unverified because there is no qualified dedicated getter. Proxy/optimized-media generation is not exposed by the protected workflow.

Live Resolve 21.1 gateway validation on 2026-09-10 observed all 5/5 allowlisted method surfaces on the disposable BMX source clip with zero missing methods. No source/proxy path was returned and no link mutation was dispatched. The reference project informed the allowlist and safety boundary, but local Resolve evidence remains the authority for this product. Source-preview UI acceptance then confirmed the exact item state renders all 5/5 surfaces as observed while explicitly showing that protected writes are not registered; no source path is rendered and full-resolution link state remains unverified.

### `media.ingest_plan.v1`

```text
status: deferred
read_only: true
risk: low
blast_radius: project
preview: derived_plan
recovery: A
```

Validates candidate paths and intended Media Pool destination. A future execution workflow is separate and remains source-safe.

### `media.organize_plan.v1`

```text
status: deferred
read_only: true
risk: low
blast_radius: project
preview: derived_plan
recovery: A
```

Plans bin/folder moves and metadata normalization without executing them.

### `media.metadata_update.v1`

```text
status: deferred
read_only: false
risk: medium
blast_radius: item/project depending scope
approval: required locally
preview: derived_plan
recovery: B only when every previous value is readable and restorable
verification: API_READBACK
```

Writes only explicitly supported metadata fields. Fields without proven read/write symmetry are not admitted to this writer.

### `media.relink_plan.v1`

```text
status: deferred
read_only: true
risk: low
blast_radius: item/project depending scope
preview: derived_plan
recovery: A
verification: STRUCTURAL_READBACK
```

Validates exact clip identities, target directories and ambiguity before any relink/unlink writer is considered. Similar filenames alone are insufficient evidence.

## 9. Edit workflows

### `edit.timeline_summary.v1`

```text
status: implemented
read_only: true
risk: low
blast_radius: timeline
preview: native
recovery: A
verification: STRUCTURAL_READBACK
```

Compact timeline readiness used by Project and Edit:

- current timeline identity;
- duration/range/start-timecode facts where reliable;
- track counts and item counts;
- marker/subtitle counts;
- offline/source-reference blockers;
- high-confidence gap/overlap indicators.

Current implementation is a fixed getter-only bounded timeline reader through Blackmagic sandboxed `run_script`. It reads current timeline identity, start/end frame, duration in frames, start timecode, frame rate, exact video/audio/subtitle track counts, bounded track rows, track enabled/locked state, per-track item counts, timeline marker count, subtitle item count and explicit offline source-item evidence. Source-state inspection is capped at 2000 timeline items and track rows at 64; truncation is explicit. Items without a Media Pool reference are counted as unverified evidence rather than treated as offline, because titles/generators can legitimately lack a source clip. Gap/overlap and source-range conclusions remain explicitly unverified for their dedicated readers. Live Resolve 21.1 gateway validation passed on 2026-09-10.

### `edit.structure_inspect.v1`

```text
status: implemented and live-validated on Resolve 21.1
read_only: true
risk: low
blast_radius: timeline
recovery: A
verification: STRUCTURAL_READBACK
```

Reads exact current-timeline item structure through a fixed app-owned getter-only template. For every bounded video/audio item it probes `GetUniqueId`, `GetName`, `GetStart`, `GetEnd`, `GetDuration`, `GetLeftOffset`, `GetRightOffset`, `GetSourceStartFrame`, `GetSourceEndFrame` and `GetMediaPoolItem` using a `dir()`-qualified fixed allowlist, then returns exact timeline/item/MediaPool identities and the raw record/source range values. `recordRangeConsistent` reports only the observed equality `recordEnd - recordStart === duration`; it does not establish inclusive/exclusive boundary semantics.

Resolve 21.1 live gateway validation on 2026-09-10 observed all 10/10 getter surfaces across the disposable V1/A1 items with zero missing methods and zero readback failures. Source-preview acceptance at 880×720 displayed both items with record/source ranges `0 → 22`, duration `22`, short exact IDs and the explicit note that record/source boundary semantics, transition state and linked-audio relationships remain unverified. No source path is returned or rendered.

### `edit.gaps_overlaps.v1`

```text
status: implemented and live-validated on Resolve 21.1
read_only: true
risk: low
blast_radius: timeline
recovery: A
verification: STRUCTURAL_READBACK
```

Reuses the exact bounded item/range evidence from `edit.structure_inspect.v1` and compares only ordered record ranges on the same track. It does not judge whether a relationship is an editorial mistake.

Because Resolve record-range inclusive/exclusive boundary semantics are still unqualified, the reader does not convert `nextStart - currentCoverageEnd` into a claimed frame count. A negative raw boundary delta is a definite overlap under the unresolved conventions; a delta greater than 1 is a definite gap; delta 0 or 1 remains `boundary_ambiguous`. Tracks with any missing record boundary are not compared through, and incomplete/truncated evidence remains explicit.

Resolve 21.1 protected live gateway validation passed on 2026-09-10 with the same fixed structure getter evidence and no path leakage. The current disposable timeline has one item on V1 and one on A1, so source-preview acceptance at 880×720 correctly showed `0 / 0` comparable same-track pairs and zero definite gaps/overlaps/ambiguous boundaries rather than fabricating a finding. Synthetic derivation coverage separately validates definite overlap, definite gap, boundary-ambiguous and incomplete-range behavior.

### `edit.source_range_report.v1`

```text
status: implemented and live-validated on Resolve 21.1
read_only: true
risk: low
blast_radius: timeline
recovery: A
verification: STRUCTURAL_READBACK
```

Reuses the exact bounded item evidence from `edit.structure_inspect.v1` and reports raw `GetStart`, `GetEnd`, `GetDuration`, `GetSourceStartFrame`, `GetSourceEndFrame` values together with exact TimelineItem and MediaPool identities. It does not choose conform matches from filenames alone and does not derive a source duration from the source start/end getters.

Resolve 21.1 live gateway validation passed on 2026-09-10. The current V1/A1 disposable items both report record `0 → 22`, duration `22` and source getter values `0 → 22`; 880×720 source-preview acceptance displayed both rows and exact MediaPool identities. These fixture values are evidence for the getters only. Record/source boundary semantics, source coordinate consistency, source-range arithmetic and conform matching remain explicitly unverified; no source path is returned or rendered.

### `edit.transition_inspect.v1`

```text
status: implemented and live-validated on Resolve 21.1
read_only: true
risk: low
blast_radius: timeline
recovery: A
verification: API_READBACK
```

Resolve 21.1 qualification on the exact disposable V1/A1 TimelineItems observed the fixed method surface `AddTransition`, `GetFades`, `SetFades`. The protected reader calls only `GetFades`; `AddTransition` and `SetFades` remain runtime method-surface evidence and are not registered protected writers.

Direct `GetFades()` readback succeeded on both current items and returned raw `FadeIn` / `FadeOut` values of `0.0`. Those values are displayed as raw getter evidence only; the protected reader does not assign units or interpret `0` as “no fade”. No qualified getter currently proves applied edit-transition state, so transition readback/state remains explicitly unverified. Live gateway validation and 880×720 source-preview acceptance passed on 2026-09-10 with no source-path leakage and no mutation control.

### `edit.review_annotations_inspect.v1`

```text
status: implemented and live-validated on Resolve 21.1
read_only: true
risk: low
blast_radius: timeline
recovery: A
verification: API_READBACK
```

Reads bounded review evidence from the current timeline without exposing a second review writer. The fixed reader checks Timeline `GetMarkers`; TimelineItem `GetUniqueId`, `GetName`, `GetMarkers`, `GetMediaPoolItem`; and referenced MediaPoolItem `GetUniqueId`, `GetName`, `GetMarkers`, `GetFlagList`, `GetClipColor`. It reuses the already-qualified marker, timeline-structure and Media Pool detail capabilities rather than adding another capability or generic metadata reader.

The reader is capped at 64 tracks, 2000 timeline items, 2000 marker rows and 64 flags per MediaPoolItem. Unexpected getter return shapes, missing/empty required identities, incomplete item-to-MediaPool association and row truncation remain explicit failed/unverified evidence instead of being converted to known-empty results. Source/proxy path getters are not used and path-like fields are not part of the published result.

Resolve 21.1 live gateway validation passed on 2026-09-10 with the exact fixed method surfaces observed and no missing/failed getters on the current disposable fixture. Source-preview acceptance showed zero current timeline/item/MediaPool marker records, zero flagged/colored source items, method evidence `1/1`, `4/4` and `5/5`, complete bounded coverage, short identities only, no source path, and no marker/flag/clip-color mutation control.

### `edit.review_marker_add.v1`

Historical first protected live-qualified writer. Under the current Capability Ledger vocabulary, its semantic capability remains `qualified` until the complete vertical Capability Pack production gate is re-accepted.

```text
status: implemented
read_only: false
risk: low
blast_radius: item
approval: required locally
preview: derived_plan
recovery: B
verification: API_READBACK
qualified_resolve: 21.1
```

Current contract:

- Main seals the exact project, timeline, track and TimelineItem unique IDs into an immutable SHA-256 plan;
- collision, track lock, item bounds and target fingerprint are checked at planning, approval and immediately before dispatch;
- the app generates a unique marker `customData`, and the protected caller supplies only `planId` to `execute`;
- `dispatch_started` is durably flushed before the single `AddMarker` call;
- success requires matching API readback at the approved frame and by unique `customData`;
- Class B compensation can remove only this plan's unique marker when a contradiction leaves that marker addressable;
- ambiguous dispatch is never retried automatically and restart does not replay an in-flight writer.

Resolve 21.1 qualification on 2026-09-10 proved add/readback/remove symmetry in disposable project `test`. A subsequent full protected plan → local approval → execute → API readback acceptance finished `verified` with the required durable ledger order; its qualification marker was explicitly removed afterward.

### `edit.track_add.v1`

First registered structural Edit writer. The public contract is intentionally narrower than Resolve's full `AddTrack` API.

```text
status: qualified
read_only: false
risk: low
blast_radius: timeline
approval: required locally
preview: derived_plan
recovery: C
verification: STRUCTURAL_READBACK
qualified_resolve: 21.1
```

Current contract:

- public `plan()` accepts only `target=current_timeline`, `trackType=video`, `placement=append`;
- Agent-created Plans require a fresh applicable `edit.track_add.v1` ActionOffer derived from an explicit current-turn user request; historical Goal text cannot authorize planning, and other mutation workflows remain outside this allowlist;
- planning seals exact project/timeline identity plus a complete bounded structural fingerprint (64 tracks / 2000 items maximum; overflow fails closed);
- renderer local approval is durable `exact_plan` / `local_renderer` authority and does not execute;
- public `execute(planId)` first creates and verifies a durable Class C timeline duplicate backup, then revalidates Human-edit-wins preconditions;
- the fixed writer re-computes the same bounded SHA-256 structural fingerprint inside the writer script immediately before the one `AddTrack("video")` call;
- success requires exactly +1 VIDEO track, exactly +1 total track, unchanged item count, an empty new V track, and the pre-existing structure reducing to the original approved fingerprint;
- `dispatch_started` is durably flushed before the writer; ambiguous transport is never retried; replay also requires `writer_precondition_ok=true` before `verified` can be restored;
- Resolve authority is epoch-bound: authority loss after a durable backup/dispatch fence but before the actual mutation call records `backup_cancelled` / `execution_cancelled` with `writer_dispatched=false`, clears approval and never calls/retries the mutation;
- Resolve authority is epoch-fenced: disconnect invalidates the current epoch before any asynchronous shutdown work, and backup/marker/track writers re-check the same epoch after their durable dispatch boundary and immediately before the broker mutation call. Authority loss at that point is durably cancelled with `writer_dispatched=false` and never retried;
- indexed insertion, AUDIO tracks, track subtype, DeleteTrack and generic script mutation are not exposed by this workflow.

Resolve 21.1 disposable live qualification on 2026-09-13 proved TypeScript/Python fingerprint equality, `AddTrack("video")` V1→V2, exact empty-track structural readback, exact cleanup fingerprint restoration, and exact restoration of the original user project/timeline. Qualification Class C backup timeline `cf536692-276d-41b8-969d-0a4c2bd9a916` is retained as evidence.

### `edit.review_marker_remove.v1`

```text
status: planned
read_only: false
risk: medium
blast_radius: item
approval: required locally
preview: derived_plan
recovery: B when full previous marker payload is captured
verification: API_READBACK
```

Do not expose broad “clear all markers” behavior as the first writer.

### `edit.multicam_preflight.v1`

```text
status: planned
read_only: true
risk: low
blast_radius: timeline
recovery: A
verification: STRUCTURAL_READBACK
```

Checks candidate angles, source/timecode availability, overlaps and supported native API capability.

### `edit.sync_preflight.v1`

```text
status: planned
read_only: true
risk: low
blast_radius: timeline
recovery: A
verification: STRUCTURAL_READBACK
```

Reports sync evidence only. Optional audio analysis is a separate capability adapter.

### `edit.conform_plan.v1`

```text
status: planned
read_only: true
risk: low
blast_radius: timeline
preview: native/derived plan computation
recovery: A
verification: STRUCTURAL_READBACK
```

Plan evidence may include:

- unique IDs where available;
- reel/tape metadata;
- source path reference;
- timecode;
- frame rate;
- duration/source frame range;
- optional source fingerprint;
- candidate-match reasons.

Filename-only matching is insufficient. Ambiguous candidates remain unresolved.

### `edit.conform_execute.v1`

```text
status: deferred
read_only: false
risk: high
blast_radius: timeline/project
approval: required locally
preview: derived_plan
recovery: C
verification: STRUCTURAL_READBACK, with render/QC evidence where required
```

Requires mature plan fingerprinting, timeline versioning and lineage persistence before implementation.

### `edit.structural_variant.v1`

```text
status: deferred
read_only: false
risk: high
blast_radius: timeline
approval: required locally
preview: derived_plan
recovery: C
verification: STRUCTURAL_READBACK
```

Preferred strategy for aggressive edit automation is creating/duplicating a variant timeline rather than silently rewriting the original.

## 10. Fusion workflows

Fusion is a first-class user-facing workspace, but its protected surface begins read-only.

### `fusion.composition_inspect.v1`

```text
status: implemented / Resolve 21.1 live-validated
read_only: true
risk: low
blast_radius: timeline
preview: native
recovery: A
verification: API_READBACK
```

Current bounded output:

- exact current Timeline identity;
- bounded VIDEO track scan through `GetTrackCount("video")` / `GetItemListInTrack("video", trackIndex)`;
- exact TimelineItem identity where `GetUniqueId` / `GetName` succeed;
- per-item `GetFusionCompCount` and bounded `GetFusionCompNameList` readback;
- explicit track/item/name truncation and method-evidence gaps.

Resolve 21.1 qualification established one important return-shape quirk: on the zero-composition fixture `GetFusionCompNameList()` returned an empty dict rather than the vendor-declared list. The protected parser accepts that shape only when the same item's `GetFusionCompCount()` is exactly zero. A separate positive-composition fixture later confirmed list-shaped names and successful `GetFusionCompByIndex` / `GetFusionCompByName` object access. This composition reader still invokes only the bounded identity/count/name-list path; graph-object access is handled by the separate graph reader.

This workflow deliberately does **not** claim tool inventory, ports, graph edges or rendered pixels. Qualified graph structure is reported only by `fusion.graph_inspect.v1`; rendered pixels remain outside both readers.

### `fusion.graph_inspect.v1`

```text
status: implemented / Resolve 21.1 live-validated
read_only: true
risk: low
blast_radius: timeline
preview: native
recovery: A
verification: API_READBACK
```

Current bounded output:

- bounded current-timeline VIDEO item and Fusion composition discovery;
- exact TimelineItem and composition names used to address the qualified composition object;
- bounded tool inventory with stable tool `ID` plus display name;
- bounded input/output counts and stable port IDs;
- bounded directed graph edges from `GetConnectedInputs`, cross-checked against `GetConnectedOutput` where available;
- explicit truncation, failed-method and bidirectional-readback evidence.

Resolve 21.1 positive qualification uses a dedicated `Fusion Graph Qualification` timeline instead of mutating the clean Edit/Fusion baseline. Its retained `Composition 1` default graph contains `MediaIn1` (`MediaIn`) and `MediaOut1` (`MediaOut`) with the observed edge `MediaIn1.Output -> MediaOut1.Input`; input/output display names may be localized, while stable API IDs are used for semantics. The reader does not inspect control values, execute graph writes, or claim rendered pixels.

### `fusion.tool_inspect.v1`

```text
status: planned
read_only: true
risk: low
blast_radius: item
preview: native
recovery: A
verification: STRUCTURAL_READBACK
```

Inspects one explicitly addressed Fusion tool, including attrs and exposed input/output metadata. It does not pretend the public API provides a semantic schema for every effect parameter.

### `fusion.graph_plan.v1`

```text
status: deferred
read_only: true
risk: low
blast_radius: item/timeline
preview: derived_plan
recovery: A
verification: STRUCTURAL_READBACK
```

Produces an immutable graph-change plan from approved app-defined structures. Any later live apply remains a separate registered writer.

### `fusion.graph_apply.v1`

```text
status: deferred
read_only: false
risk: high
blast_radius: item/timeline
approval: required locally
preview: derived_plan
recovery: C unless deterministic compensation is proven
verification: RENDER_VERIFIED when the workflow promises a visible result
```

Only app-defined deterministic structures are eligible. Model-authored arbitrary Fusion scripts or graph code remain outside protected Workflow.

## 11. Color workflows

### `color.pipeline_inspect.v1`

```text
status: implemented
read_only: true
risk: low
blast_radius: project
recovery: A
verification: API_READBACK
```

Current implementation reads project/effective timeline color-management settings plus a bounded current-timeline sample of Color Groups, current color versions, first-layer node counts and non-empty LUT references. This pipeline summary itself remains first-layer only; configured Node Stack Layers are read separately by `color.graph_inventory.v1`. DCTL-reference readback remains explicitly unverified rather than inferred. Live Resolve 21.1 validation passed on 2026-09-10.

### `color.graph_inventory.v1`

```text
status: implemented / Resolve 21.1 live-validated
read_only: true
risk: low
blast_radius: timeline
recovery: A
verification: API_READBACK
```

Reads only the Color graph surfaces behaviorally qualified on Resolve 21.1:

- exact current Timeline identity;
- bounded VIDEO scan: `64` tracks and `200` items;
- `Project.GetSettings().nodeStackLayers`, bounded to `32` configured layers per item;
- Timeline `GetNodeGraph()` and each scanned TimelineItem's `GetNodeGraph(layerIdx)` for every configured layer inside that bound;
- `Project.GetColorGroupsList()` plus up to `32` Color Groups, each with exact `GetName()`, `GetPreClipNodeGraph()` and `GetPostClipNodeGraph()` evidence;
- bounded graph node inventory: `2048` total node rows;
- fixed Graph getter surface `GetNumNodes`, `GetNodeLabel`, `GetLUT`, `GetNodeCacheMode`, `GetToolsInNode`;
- up to `64` returned OFX/tool names per node;
- explicit graph-access, missing-method, failed-method and truncation evidence.

Resolve 21.1 qualification on the stable `CID Marker Qualification Restored` baseline established `nodeStackLayers="1"`, with the Timeline graph containing `0` nodes, the exact V1 BMX layer-1 graph containing `1` node, and `GetColorGroupsList()` returning an empty list. A dedicated disposable project, `CID Color Node Stack Qualification`, established `nodeStackLayers="2"`: the same source clip returned non-null L1 and L2 Graph objects, each with `1` node. The retained `CID Group Qualification` in that project then established non-null Color Group pre-clip and post-clip Graph objects, also with `1` node each. Clip-layer nodes returned an empty label/LUT, cache mode `-1`, and `GetToolsInNode() -> null`; both Color Group nodes returned an empty label/LUT, successful `GetNodeCacheMode() -> null`, and `GetToolsInNode() -> null`. `cacheModeShape` therefore distinguishes integer, successful-null, and unavailable/failure evidence. Protected source preview rendered the two Node Stack layers plus explicit Color Group pre/post rows. These values remain API evidence only. The protected result exposes only whether a LUT reference is present; it never returns the LUT path.

Node topology/connections, node parameter values, Color Group version state, rendered pixels and all Color graph writes remain explicit non-claims. Color Group enumeration order/name uniqueness are not treated as stable graph identity semantics. DCTL identity/reference enumeration also remains outside this graph contract because the official API exposes no dedicated DCTL enumeration getter.

### `color.grade_version_inspect.v1`

```text
status: implemented / Resolve 21.1 live-validated
read_only: true
risk: low
blast_radius: timeline
recovery: A
verification: API_READBACK
```

Reads bounded grade-version evidence from current-timeline VIDEO items using only `TimelineItem.GetVersionNameList(0/1)` and `TimelineItem.GetCurrentVersion()`.

Resolve 21.1 qualification on the restored BMX V1 fixture established that both local (`0`) and remote (`1`) name-list calls return `list[str]`, while `GetCurrentVersion()` returns a dict containing `versionName` and `versionType`. The accepted fixture returned `"版本 1"` in both local and remote lists while the current version type was local (`0`). The reader therefore treats version names as display evidence only: it does not infer ordering, global name uniqueness, or identity/equivalence between same-named local and remote entries.

The reader is bounded to `64` VIDEO tracks, `200` items and `64` names per local/remote list. Missing/failed getter evidence, item/name truncation and exact current-version readback are explicit and fail closed. Color Group versions and rendered pixels remain outside this reader. `AddVersion(name, 0)` is separately admitted only through `color.grade_version_create.v1`; public switching, rename, delete and remote-version mutation remain unavailable.

### `color.grade_version_create.v1`

```text
status: qualified / Resolve 21.1 live-validated
read_only: false
risk: low
blast_radius: item
preview: derived_plan
approval: local_required
recovery: B
verification: API_READBACK
```

Creates exactly one new LOCAL (`type=0`) grade-version container on one exact current SharedFocus TimelineItem. The model-facing Plan accepts only semantic `itemRef + generation` and a bounded caller-visible name. Main resolves the exact item, seals current Project/Timeline/item identity, current LOCAL version and complete bounded local/remote name lists, and refuses any candidate-name collision. The fixed writer revalidates the same state immediately before exactly one `AddVersion(name, 0)` call. Success requires the LOCAL list to equal baseline plus exactly one candidate and `GetCurrentVersion()` to equal that candidate with type `0`.

Resolve 21.1 disposable qualification on 2026-09-13 proved `AddVersion(uniqueName, 0) -> true`, exact +1 LOCAL name-list readback and automatic current-version switch. The same fixture proved deterministic Class B compensation: `LoadVersionByName(original, 0)` restored the original current version, `DeleteVersionByName(new, 0)` removed the plan-owned version, and the final LOCAL list/current readback exactly matched baseline. Load/Delete remain internal compensation only; public remote creation, switching, rename and delete are not exposed. Ambiguous mutation dispatch is never replayed.

The fixed LOCAL type is not a public writer parameter or result field. Public Agent/Renderer/Artifact Plan projections expose the proposed version name only. Class B compensation is also authority-epoch fenced: after durable `recovery_started`, an authority change prevents Load/Delete dispatch and records recovery as unavailable without retry.

This contract does not claim node-parameter or rendered-pixel equivalence between versions. Creating a grade-version container is API-state evidence, not proof of an approved-grade snapshot.

### `color.render_evidence.v1`

```text
status: deferred until a visual workflow consumes it
read_only: true
risk: low
blast_radius: item
recovery: A
verification: RENDER_VERIFIED
```

Collects approved rendered-frame/still evidence when API graph readback is insufficient to support a visual claim. It is not required merely to display the initial technical Color page.

### `color.cdl_apply.v1`

```text
status: deferred
read_only: false
risk: medium
blast_radius: item
approval: required locally
preview: derived_plan
recovery: C or proven B
verification: RENDER_VERIFIED when claiming visible result
```

Must validate CDL values and create a truthful grade/version backup before changing an existing grade.

### `color.approved_look_apply.v1`

```text
status: deferred
read_only: false
risk: high
blast_radius: item/timeline
approval: required locally
preview: derived_plan
recovery: C
verification: RENDER_VERIFIED
```

Only approved/versioned look artifacts are eligible. Existing grades are not overwritten automatically.

### `color.creative_grade`

```text
status: planned
layer: workflow
read_only: false
risk: high
preview: derived_plan
verification: RENDER_VERIFIED
```

This is a future hybrid workflow: model inference may propose creative decisions, but deterministic qualified Color capabilities perform the mutation. Model strength never grants autonomy by itself; Goal-bound authorization, risk policy, existing-grade protection and visual verification remain mandatory.

## 12. Fairlight workflows

The user-facing domain is `Fairlight`. These workflow IDs also use `fairlight` so the catalog and UI vocabulary do not drift.

### `fairlight.mapping_inspect.v1`

```text
status: implemented
read_only: true
risk: low
blast_radius: timeline
recovery: A
verification: STRUCTURAL_READBACK
```

Current implementation reads bounded audio-track layout, subtype/name/lock/enable state, track Voice Isolation state and compact source-channel mapping evidence. It parses mapping JSON only into channel/count evidence and does not return source paths or transcription content. Sync evidence and transcription state remain explicitly unverified. Live Resolve 21.1 validation passed on 2026-09-10.

### `fairlight.clip_processing_inspect.v1`

```text
status: implemented / Resolve 21.1 live-validated
read_only: true
risk: low
blast_radius: timeline
recovery: A
verification: API_READBACK
```

Reads current AUDIO TimelineItem processing properties through the existing protected `inspect { target: 'fairlight', view: 'audio_processing' }` path. The reader is bounded to `64` audio tracks and `1000` items and exposes only the fixed `GetUniqueId`, `GetName`, `GetProperties` and `GetVoiceIsolationState` surfaces. From `GetProperties` it returns the behaviorally qualified Volume, Pan, Pitch, Voice Isolation and Dialogue Leveler keys; arbitrary property keys are not serialized.

Resolve 21.1 qualification on the exact restored A1 BMX TimelineItem established all 15 allowlisted property keys and their runtime types. The accepted values were Volume enabled / `0.0`, Pan enabled / `0.0`, Pitch enabled / `0` semitones / `0` cents, Voice Isolation disabled / amount `0`, and Dialogue Leveler disabled / mode `0` / output gain `0.0`, with the remaining Dialogue flags false. Independent `GetVoiceIsolationState()` returned `{isEnabled:false, amount:0}` and matched the corresponding property values. These zero/disabled values are raw getter evidence only; they are not interpreted as “correct”, “normal”, or proof of audible/rendered output.

Automation/keyframes, audio clip effects, routing/buses, loudness/rendered audio, transcription/sync state and all audio-processing writes remain explicit non-claims. `SetProperties`, `SetVoiceIsolationState`, `NormalizeAudioLevel` and source-mapping writes are not registered protected writers.

### `fairlight.track_inspect.v1`

```text
status: superseded by existing mapping + clip-processing readers
read_only: true
risk: low
blast_radius: track/item
recovery: A
verification: STRUCTURAL_READBACK
```

Do not build a duplicate generic track reader while `fairlight.mapping_inspect.v1` already covers track subtype/name/lock/enable/source mapping and `fairlight.clip_processing_inspect.v1` covers per-item processing state.

### `fairlight.capabilities.v1`

```text
status: planned
read_only: true
risk: low
blast_radius: project
recovery: A
verification: API_READBACK
```

### `fairlight.loudness_analysis.v1`

```text
status: deferred
read_only: true
locality: local_analysis
risk: low
blast_radius: item/timeline
recovery: A
verification: produced analysis evidence
```

Requires an explicitly approved FFmpeg/analysis adapter and source-safe file handling.

### `fairlight.transcription_analysis.v1`

```text
status: deferred
read_only: true for source analysis path
locality: local_analysis
risk: low
recovery: A
```

Resolve-native transcription that changes project state is a separate write workflow and must not be hidden inside this read-only analysis ID.

### `fairlight.sync_execute.v1`

```text
status: deferred
read_only: false
risk: medium/high depending scope
blast_radius: item/timeline
approval: required locally
preview: derived_plan
recovery: C unless deterministic compensation is proven
verification: STRUCTURAL_READBACK
```

## 13. Deliver workflows

### `deliver.capability_matrix.v1`

```text
status: implemented
read_only: true
risk: low
blast_radius: project
preview: native
recovery: A
verification: API_READBACK
```

Reports the live format/codec/resolution capability matrix or a bounded summary of it. Counts are machine/build/license/plugin dependent and are never treated as portable constants.

Current implementation returns bounded live video/audio format and codec rows, general resolution capability, bounded render/Quick Export preset-name inventories and explicit truncation evidence. It also calls `GetRenderResolutions(format, codec)` for the currently selected format/codec and returns that bounded API list as separate evidence. Resolve 21.1 qualification observed materially different codec-specific sets, including one-resolution Grass Valley/DCP cases; returned ordering and uniqueness are not inferred, and duplicate rows are preserved. Preset names likewise preserve API order/duplicates and do not imply preset contents, compatibility, upload targets or current selection. This is capability evidence only: it does not claim the current render resolution because Resolve 21.1 exposes no complete `GetRenderSettings()` getter. Protected gateway live validation passed on 2026-09-10 with the stable `mov / H264` selection returning 26 resolution entries, 37 render preset names and 10 Quick Export preset names.

### `deliver.settings_inspect.v1`

```text
status: implemented
read_only: true
risk: low
blast_radius: project
recovery: A
verification: API_READBACK
```

Resolve 21.1 exposes current format/codec and render mode plus render-queue job/status getters, but no full `GetRenderSettings()` getter. The current V1 therefore returns only those provable fields and bounded queue evidence; current target directory, output filename, export video/audio toggles, mark range and subtitle export remain explicitly unverified. Job output paths and filenames are not returned. Live validation passed on 2026-09-10.

### `deliver.preflight.v1`

```text
status: superseded / not registered
read_only: true
risk: low
blast_radius: project
recovery: A
verification: STRUCTURAL_READBACK
```

Do not register a second Deliver preflight. Exact current `project.preflight.v1` already supports `profile=delivery` and combines project/settings, media/offline, Edit, Fusion, Color, Fairlight and Deliver evidence into one project-level readiness result. Missing full render-settings/range/destination/subtitle readback remains an explicit capability gap there rather than being hidden behind a duplicate workflow ID.

### `deliver.render_plan.v1`

```text
status: planned
read_only: true
risk: low
blast_radius: project
preview: derived_plan
recovery: A
verification: STRUCTURAL_READBACK
```

The plan defines expected output(s) and the verification spec before rendering.

### `deliver.render_execute.v1`

```text
status: deferred
read_only: false
risk: high
blast_radius: project/filesystem
approval: always required locally
preview: derived_plan
recovery: D for consumed render time; output-file cleanup may be separate and explicit
verification: DELIVERABLE_VERIFIED for final success claim
```

Resolve job completion alone is an intermediate state.

### `deliver.verify_output.v1`

```text
status: deferred
read_only: true
locality: local_analysis/offline_adapter
risk: low
blast_radius: item
recovery: A
verification: DELIVERABLE_VERIFIED
```

Potential checks when a concrete adapter exists:

- file exists;
- container/codec;
- dimensions;
- frame rate;
- duration/range agreement;
- audio stream presence/layout;
- subtitle presence where required;
- optional loudness/legal-range checks.

## 14. Activity and provenance workflows

### `activity.audit_recent.v1`

```text
status: implemented in minimal form
read_only: true
risk: low
blast_radius: item
preview: native
recovery: A
verification: API_READBACK
```

The public `audit` workflow remains a bounded in-memory ring of protected tool name, start time, duration and success/failure. It is included in the runtime registry because `audit` publishes this workflow ID in protected result envelopes.

Mutation authority does not use that ring as history. Plans, approvals, dispatch, verification, ambiguity and recovery evidence are append-only durable workflow-ledger events, and Activity reads the engine projection derived from that same ledger.

### `activity.execution_detail.v1`

```text
status: planned
read_only: true
risk: low
recovery: A
```

Returns redacted plan/approval/execution/verification linkage without raw script text, credentials or unrestricted Resolve payloads.

## 15. Analysis workflows

Analysis is added only when a visible Media/Edit/Fusion/Color/Fairlight/Deliver workflow consumes it.

Candidate IDs:

```text
analysis.media_metadata.v1
analysis.audio_measurement.v1
analysis.transcription.v1
analysis.frame_sample.v1
analysis.visual_review.v1
```

All source-analysis workflows preserve camera/source files.

Long local analysis operations use Workspace-owned persistent Job state when needed. Jobs and Analysis Artifacts belong to the Workspace; the initiating Session stores only an origin/completion reference. Rebuildable large artifacts may be cache-managed, while semantic provenance/user decisions remain durable.

## 16. Offline adapter workflows

Future deterministic adapters may support:

```text
offline.interchange_inspect.v1
offline.conform_compute.v1
offline.drx_inspect.v1
offline.deliverable_qc.v1
```

These compute reports/artifacts/plans and do not gain independent authority to mutate the live Resolve project.

Direct offline `.drp/.drt/.drx` or project-database mutation is outside the ordinary Workflow catalog and requires a separate advanced-security review.

## 17. Explicit protected-surface exclusions

The following are not protected Workflow capabilities:

```text
arbitrary model-authored Python
run_script as a public Workflow tool
run_script_unsafe as a public Workflow tool
arbitrary shell commands
arbitrary filesystem write
generic desktop mouse/keyboard control
automatic project deletion
automatic source-media modification
unscoped creative grading/edit mutation without Goal-bound user authorization and qualified capability contract
```

Raw official ResolveMCP remains separately available for advanced users and is outside these Workflow guarantees. Raw/Developer actions are recorded in separate Advanced Activity as `Unprotected`; they do not receive protected ChangeSet/verification semantics unless later independent protected observation establishes a state change.

## 18. Current executable runtime subset

The current runtime registry is intentionally narrow and is not the breadth-first capability inventory. `CAPABILITY_LEDGER.md` records known abilities/gaps across Project, Media, Edit, Fusion, Color, Fairlight and Deliver even when only a small subset is executable.

The current runtime registry contains only workflows the product already exposes or has live-qualified:

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
edit.review_marker_add.v1
edit.track_add.v1
color.grade_version_create.v1
```

The first twenty-four entries are the current read-only runtime set. `edit.review_marker_add.v1`, `edit.track_add.v1` and `color.grade_version_create.v1` are the three registered live-qualified writers. All use the same protected `plan()` / local approval / `execute(planId)` authority model. The structural track writer additionally requires verified Class C Timeline Version Protection; the Color writer uses qualified Class B Load/Delete compensation and exposes neither operation publicly.

Do not pre-register additional future writers as callable stubs. Every new writer must earn its own complete Capability Pack contract, build-specific qualification, risk/approval/ChangeSet/verification contract and live evidence. Coverage reporting is by domain + lifecycle state; no single percentage is published unless it is computed from a declared inventory denominator.
