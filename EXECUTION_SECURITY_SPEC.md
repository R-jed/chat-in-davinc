# Chat in DaVinci — Execution & Security Specification

Date: 2026-09-12

Status: active protected execution contract; extended for Agent/Worker execution

## 1. Scope

This document owns the protected Workflow execution lifecycle:

```text
registry
inspection
plan
approval
backup/recovery preparation
dispatch
verification
ambiguity handling
durable evidence
restart behavior
```

It does not constrain the Raw official connector. Raw is intentionally a separate advanced surface and is shown as `Unprotected` in Advanced Activity; Raw actions do not receive protected Plan/ChangeSet/verification guarantees.

No protected production writer should ship until the relevant rules in this document are implemented.

## 2. Security boundaries

### 2.1 Raw boundary

Raw proxies Blackmagic's official ResolveMCP declarations and calls.

Workflow guarantees such as local approval, project locations, write registry, backup and readback verification do not apply to Raw.

The UI must not imply otherwise.

### 2.2 Workflow boundary

Workflow exposes only app-owned compound tools and versioned registered workflows.

Workflow does not expose:

```text
run_script
run_script_unsafe
arbitrary Python
arbitrary shell
arbitrary filesystem write
```

Internally, fixed app-owned getter/writer templates may call Blackmagic sandboxed `run_script` when that is the narrowest supported official path.

The model supplies structured validated parameters, never code.

### 2.3 Renderer boundary

Renderer state is presentation state.

The renderer cannot establish:

- workflow registration;
- risk level;
- plan validity;
- approval validity;
- backup success;
- execution permission;
- verification success.

Those facts are main-process owned.

IPC actions continue to require the current trusted top-level renderer sender check.

### 2.4 ResolveBroker boundary

`ResolveBroker` remains the only long-lived owner of Blackmagic ResolveMCP.

No workflow helper, approval handler, verifier, UI refresh or diagnostic path may spawn a second long-lived ResolveMCP session.

### 2.5 Agent / Worker boundary

Agent orchestration does not create a new trust boundary around Resolve.

```text
Agent / Worker / local UI / protected MCP
  -> unified ToolKernel / registered action
  -> existing plan / approval / verification authority
  -> ResolveScheduler / lease
  -> ResolveBroker
```

Rules:

- an Agent or Worker never receives raw `ResolveBroker` access;
- a Worker never dispatches a protected mutation directly;
- model/session state is context and provenance, not authorization;
- local approval continues to bind the exact plan hash regardless of which Agent/Worker proposed the plan;
- no caller-supplied `confirm`, `allow_render` or similar flag substitutes for local approval;
- a future alternative live Resolve driver must be mutually exclusive under the same authority manager rather than run alongside the current broker;
- any delegated autonomy is bound to Goal + exact Workspace/target + capability set + risk ceiling and expires with that scope; it never silently carries to another Workspace/Project.

### 2.6 Model-visible context, semantic handles and capability visibility

Agent ergonomics introduces `EntityRef`, `EvidenceRef`, `SituationFrame`, `SharedFocus`, a Resolve World Model and context-filtered ActionDescriptors. None of these creates a new authorization mechanism.

Rules:

```text
model-visible short handle
  -> resolved locally to exact entity + parent/generation
  -> stale/ambiguous/missing binding refuses
  -> never accepted as an approval token

SharedFocus
  -> convenience for "this" / visible selection
  -> never accepted as write authorization

World Model cached fact
  -> observation/context only
  -> never substitutes for required pre-dispatch live revalidation

ActionDescriptor visibility
  -> controls what the Agent considers
  -> never grants permission to execute it
```

The Context Compiler must not publish plaintext credentials, secret material, approval records/tokens, immutable plan hashes as authority-bearing data, unrestricted Raw schemas, raw model-hidden local state or arbitrary file/Resolve payloads merely because they are locally available.

Exact writer targets remain bound inside immutable plans and are revalidated against current authoritative state immediately before dispatch. If an Agent uses a stale semantic handle, the safe result is a refresh/reselection requirement, never retargeting to the closest current object.

World Model facts must preserve whether they are `observed`, `derived_deterministic`, `model_inference`, `user_asserted`, `unknown` or `contradicted`. Model inference never silently upgrades to observed fact. A plan's expected effects belong to a prospective overlay and must not be promoted into current observed state until post-dispatch evidence establishes them. Planning intent is never execution evidence.

### 2.7 Evidence-backed Agent completion

Model output such as `done`, `completed` or an internally satisfied Goal state cannot establish protected execution success.

For state-changing work, completion may be asserted only from the declared verification contract and durable execution evidence. CID derives a criterion-level CompletionReport against GoalFrame completion criteria; COS may consume that evidence for continue/finish lifecycle but may not reinterpret a weaker level as stronger proof. Model prose is never completion evidence.

## 3. Workflow admission

The runtime executable workflow registry is a security boundary. It is intentionally narrower than the complete Capability Ledger; capability knowledge or visibility does not make an action executable.

Rules:

```text
unregistered workflow
  -> cannot execute

registered read-only workflow
  -> writer templates empty
  -> approval never required for execution

registered write workflow
  -> risk, blast radius, preview, approval, recovery and verification metadata mandatory
```

Mutability is declared metadata. It is not inferred from action names.

For a writer to become callable, the registry validator must establish:

```text
capability_id / contract_version valid
workflow_id/version valid when compound workflow-backed
selected implementation_id/version valid
read_only = false
writer exists
risk established
blast radius established
approval policy declared
preview mode declared
recovery class declared
verification contract declared
verification level declared
required capabilities declared
selected implementation qualification evidence declared for the exact supported Resolve build
```

A missing field fails closed.

## 4. Capability and implementation qualification

Qualification belongs to a concrete implementation on a concrete Resolve build/environment; it is not a timeless boolean on the semantic capability.

Evidence may establish progressively:

```text
declared
  official schema/docs/source says the surface exists

runtime_observed
  safe passive probe on the current Resolve build found the required surface/state

behaviorally_qualified
  disposable-fixture evidence establishes the behavior/limitations claimed by the contract

production
  complete vertical Capability Pack + required live qualification + policy admission
```

Capability/implementation evidence records include:

```text
capability_id / contract_version
implementation_id / implementation_version
source_tier
resolve build/version + macOS/Studio requirements
evidence_source: measured | reported | vendor | code_floor
qualification state
evidence refs / fixture identity
availability: available | unavailable | conditional | unreliable | unknown
requirements
limitations
passive_probe_strategy
active_qualification_strategy when mutable
```

Unknown is not automatically upgraded because the installed Resolve version is newer. Stable read-only implementations may remain provisional only when their declared passive compatibility checks pass. Version-sensitive writers require active qualification for the current supported build before production use.

Active writer qualification is an explicit Compatibility Check using disposable qualification projects/fixtures. It must never mutate a user's production project.

The complete Capability Ledger records known abilities and gaps across every domain; the executable registry remains narrow and contains only admitted implementations.

## 5. Risk model

Risk levels:

```text
low
medium
high
critical
```

Blast radius:

```text
item
track
timeline
project
system
unknown
```

The risk assessment answers how consequential the category of action is. It is not a simulation of the requested change.

An unknown/unrecognized semantic capability/action is not assigned reassuring low risk. A compound workflow record adds constraints when present but is not required for every primitive capability.

## 6. Preview semantics

Every writer declares exactly one preview mode.

### `native`

The selected registered capability implementation can evaluate the exact requested operation without writing.

### `derived_plan`

The engine computes an immutable semantic change plan from current read-only state. It does not call the writer.

### `unavailable`

No truthful preview exists. The system reports preview unavailable.

No generic middleware may synthesize a successful dry run.

If a request asks for dry-run semantics on an action whose preview mode is `unavailable`, return an explicit unavailable/blocked result and do not dispatch the writer.

## 7. Plan model

Plans are immutable evidence objects.

Minimum canonical plan:

```text
plan_id
plan_hash
capability_id
contract_version
workflow_id/workflow_version optional
implementation_id / implementation_version
implementation_qualification_refs
created_at
expires_at
workspace_id
resolve_version / exact qualified build
project_unique_id
timeline_unique_id optional
declared project switches for cross-Workspace plan
target_ids
input_fingerprint
requested_parameters
proposed_changes / ChangeSet draft
preconditions
risk_level
blast_radius
preview_mode
recovery_class
required_backup
verification_level
verification_contract_id/version
capability_evidence_refs
```

Display names may be included for user readability but are not execution identity.

### 7.1 Canonical hashing

`plan_hash` is computed from a canonical serialization of execution-relevant fields.

Exclude presentation-only fields such as localized titles.

The hash algorithm and canonicalization version are explicit fields so future migrations do not reinterpret old approvals.

Suggested initial hash:

```text
SHA-256 over canonical UTF-8 JSON
```

No new cryptographic dependency is needed; Node provides SHA-256.

### 7.2 Fingerprints

The semantic capability/action contract decides which live state contributes to `input_fingerprint`; a workflow contract may refine it when the Plan is workflow-backed.

Examples:

```text
marker write
  project ID
  timeline/item target ID
  existing marker payload at target

structural timeline plan
  project ID
  timeline ID
  relevant tracks/items/ranges

render plan
  project/timeline IDs
  render settings
  expected output destination/collision state
```

Do not use only names.

### 7.3 Plan lifecycle

Plan lifecycle is derived from immutable plan + ledger events:

```text
ready
approved
rejected
expired
stale
consumed
```

The plan payload itself is never edited to change status.

Generating a different proposal creates a new `plan_id` and `plan_hash`. `Rebase` is exactly this operation after fresh observation; it never edits a stale Plan in place. Human edits win: any external exact-target/fingerprint drift that matters to the contract makes the dependent Plan stale.

## 8. Approval model

Approval is local application state.

The model cannot submit a field that makes a plan approved.

Approval record:

```text
approval_id
plan_id
plan_hash
approved_at
expires_at
approved_scope: Goal + exact Workspace/target + capability set + risk ceiling
renderer/session provenance as local metadata
```

The approval IPC handler:

1. receives only `plan_id` plus local UI intent;
2. reloads the canonical plan from the main-process store;
3. verifies the plan is still approvable;
4. records approval against the exact hash;
5. flushes the durable record before reporting success to the UI.

The renderer does not supply risk, target, plan hash, capability/implementation identity or workflow metadata to be trusted. Session-scoped convenience authorization never survives a Workspace/Project change without a new matching scope. If one already-approved immutable cross-Workspace Plan explicitly declares project switches, that approval covers those declared switches and execution revalidates them without repeated per-switch prompts; any undeclared/different switch stops and requires a new Plan/approval.

### 8.1 Rejection and revocation

Rejection is durable and blocks that plan.

Approval may be revoked only before dispatch starts.

Once dispatch starts, the plan is consumed and cannot be made “unexecuted” by changing approval state.

### 8.2 Approval does not auto-dispatch initially

For every newly admitted writer:

```text
Approve
  -> durable approved event
  -> UI shows approved / awaiting execution
```

Execution requires a separate `execute(plan_id)` path. Approval seals the selected implementation as well as semantic intent; execution may not silently reroute the Plan to a different provider/implementation. A changed implementation requires a new Plan/hash and review.

This provides clear audit separation between human authorization and actual dispatch.

## 9. Pre-dispatch validation

Before the first write, the engine performs these checks in order:

1. semantic capability/action is registered and enabled in the executable registry; if the Plan carries `workflow_id`, that workflow record is also registered and enabled;
2. plan exists and hash verifies;
3. plan not rejected/expired/consumed;
4. valid local approval exists when required;
5. live Resolve connection available;
6. selected implementation remains enabled, compatible and qualified for the exact Resolve build;
7. required capabilities still satisfied;
8. Workspace -> Resolve Project binding and any declared project switch match the Plan;
9. project unique ID matches;
10. timeline unique ID matches where applicable;
11. target IDs still resolve;
12. workflow/capability-specific fingerprint still matches;
13. protected/locked state policy permits the operation;
14. required backup/version created and verified;
15. durable pre-dispatch event flushed.

Any mismatch before dispatch is a safe failure. No writer is called.

The user/model receives the concrete stale/blocked reason.

### 9.1 ChangeSet contract

Every protected mutation, including low-risk direct Workspace semantic controls, owns one Goal/Plan-grouped ChangeSet identity. The ChangeSet is created with the proposed transition and survives through dispatch, observation and verification. It records expected vs actual semantic deltas, invalidations, evidence, recovery availability and Goal-criterion impact. Transport calls remain ExecutionTrace detail and do not become separate user-level changes.

`Executed` and `Verified` are independent states. A returned writer call may advance execution state without satisfying the ChangeSet verification contract. Partial acceptance of proposed changes creates a new immutable Plan/ChangeSet draft; an approved Plan is never edited in place.

## 10. Backup and recovery classes

### A. Read-only

No backup required.

### B. Deterministic compensation

The exact previous state is captured and a known inverse operation can restore it.

The inverse operation must itself have a verification contract.

### C. Snapshot/version protected

The engine creates a real backup/version before dispatch.

Examples may include timeline duplication/archive or grade version creation where proven reliable.

The backup identity is persisted before the writer executes.

### D. No automatic recovery guarantee

The plan and approval UI explicitly say automatic rollback is unavailable.

High-impact Class D workflows require deliberate local approval and should remain uncommon.

### 10.1 Fail-closed backup policy

If the workflow declares a required backup and the backup cannot be created or verified, the writer does not execute.

Do not downgrade Class C to Class D at runtime merely to continue.

## 11. Dispatch state machine

The execution owner is one main-process `WorkflowEngine`.

Execution states:

```text
prepared
dispatch_started
dispatch_returned
verifying
verified
partial
failed
contradiction
ambiguous
recovering
recovered
recovery_failed
```

### 11.1 `prepared`

All preconditions and approval checks passed. No writer has been dispatched.

### 11.2 `dispatch_started`

This event is durably recorded before sending the mutating call to ResolveMCP.

After this state exists, the application assumes the write may have happened.

The same plan is never automatically replayed.

### 11.3 `dispatch_returned`

Transport returned a result. This establishes only that execution returned; it does not mean the requested semantic outcome or ChangeSet is verified.

### 11.4 `verifying`

The workflow runs its declared verification contract.

### 11.5 terminal evidence states

`verified` means the required evidence level passed.

`partial` means part of a declared multi-target outcome was established and the workflow contract permits partial reporting.

`failed` means dispatch definitively failed before the requested change was established, or verification established failure without evidence of a contradictory success report.

`contradiction` means Resolve/handler reported success but required readback disagreed.

`ambiguous` means the application cannot determine whether the mutating call took effect.

Recovery states may follow `failed`, `partial`, `contradiction` or an operator-selected recovery path after `ambiguous`, according to the workflow's recovery contract.

## 12. Ambiguous transport handling

Ambiguity is a safety feature, not an error-message detail.

Ambiguous examples:

- ResolveMCP child exits after the write request was dispatched but before a result is received;
- app/process crashes after `dispatch_started` and before a definitive outcome event;
- connection drops after a mutating call where the API cannot establish whether the call ran.

Rules:

```text
once dispatch_started is durable
  -> no automatic retry of that plan

restart finds dispatch_started without terminal evidence
  -> execution projects ambiguous

ambiguous
  -> re-inspect live state
  -> show evidence to user
  -> require a new plan for any further mutation
```

Do not silently transform an ambiguous execution into failed and retry it. Offline-created Plans and approved-but-undispatched writes also never auto-dispatch merely because Resolve reconnects or the app restarts; fresh live observation/revalidation and the normal authority path are required.

## 13. Verification contracts

Every writer defines:

```text
requested_change
readback_source
comparison_rule
required_level
contradiction_rule
timeout_or_completion_rule
```

Allowed evidence sources include:

```text
direct API getter
structural re-enumeration
export/re-import comparison
rendered-frame evidence
rendered/bounced audio evidence or deterministic audio analysis
produced-file probe/QC
```

### 13.1 Verification levels

#### `API_READBACK`

Direct value/object readback establishes the intended state.

Appropriate for narrowly scoped metadata only when the getter is behaviorally reliable.

#### `STRUCTURAL_READBACK`

Re-enumeration or structural comparison establishes the intended project/timeline state.

#### `RENDER_VERIFIED`

Rendered/exported visual evidence is required because API state alone cannot prove the pixels changed as intended.

#### `AUDIO_VERIFIED`

Rendered/bounced audio evidence or a declared deterministic audio-analysis artifact is required because property/API readback alone cannot prove the promised audible or measurable audio outcome.

#### `DELIVERABLE_VERIFIED`

The produced file itself is probed/QC'd against the render/delivery plan.

### 13.2 No silent downgrade

If a workflow requires `RENDER_VERIFIED`, `AUDIO_VERIFIED` or `DELIVERABLE_VERIFIED` and the required stronger verification cannot run, the outcome is not promoted to verified because API readback passed.

The result may be `unverified`, `partial` or failed according to the workflow contract.

### 13.3 Contradiction precedence

Negative readback evidence outranks a successful API/handler return.

The normalized result must preserve contradiction explicitly.

## 14. Standard Workflow result envelope

Protected workflow responses should converge on:

```text
result: domain payload

operation:
  status: success | partial | blocked | failed | ambiguous
  capability_id / contract_version
  workflow_id / workflow_version optional
  implementation_id / implementation_version
  changeset_id optional
  execution_id optional for read-only calls
  risk
  blast_radius
  changes optional
  warnings optional
  verification:
    status: passed | partial | failed | contradiction | unverified
    level_reached optional
    checks
  recovery optional
```

Semantics:

- missing `changes` means no semantic delta was established/reported;
- it does not mean `{}` or “nothing changed”;
- missing verification evidence means `unverified`;
- blocked approval/precondition results are not failures;
- ambiguous is not failure.

## 15. Durable execution ledger

The current in-memory audit ring is sufficient only while Workflow is read-only.

Before the first production write, create one durable owner for plan/approval/dispatch/verification evidence.

### 15.1 Initial storage choice

Use an append-only JSON Lines ledger under the app's existing `userData` directory for the first write implementation.

Rationale:

- no new dependency;
- naturally append-oriented;
- small expected event volume;
- easy crash recovery by replay;
- preserves event history rather than rewriting one mutable status object;
- can be migrated later if query volume justifies SQLite.

Do not introduce SQLite solely for the first bounded mutation.

Suggested file:

```text
<userData>/workflow-ledger.jsonl
```

### 15.2 Single writer

One main-process ledger owner serializes append operations.

Activity, Workflow engine and approval UI read projections from this owner. They do not maintain independent histories.

### 15.3 Event classes

Initial event vocabulary:

```text
plan_created
changeset_created
plan_rejected
plan_stale
approval_granted
approval_revoked
backup_created
execution_prepared
dispatch_started
dispatch_returned
verification_started
verification_completed
changeset_updated
execution_ambiguous
recovery_started
recovery_completed
```

Not every workflow uses every event.

### 15.4 Durability points

The ledger must be flushed at these security boundaries before continuing:

```text
approval_granted before reporting approval success
backup_created before writer dispatch
dispatch_started before sending mutating call
terminal/ambiguous result before reporting final result where practical
```

Implement with a serialized file descriptor/append queue and an explicit flush/fsync policy at these boundaries.

### 15.5 Crash recovery

On startup:

1. replay valid complete JSONL records;
2. ignore only an incomplete trailing record caused by a crash, with a logged warning;
3. rebuild in-memory plan/execution projections;
4. mark any execution whose latest durable state is `dispatch_started` or equivalent in-flight state as `ambiguous`;
5. never auto-resume a writer. Local read-only analysis Jobs may resume under their own deterministic job contract; this exception never crosses a protected write authority boundary.

Corruption before the trailing record is a visible ledger error and blocks protected writes until handled; do not silently discard history.

### 15.6 Event schema/versioning

Every event contains:

```text
ledger_schema_version
event_id
event_type
recorded_at
plan_id optional
approval_id optional
execution_id optional
capability_id/contract_version optional
workflow_id/version optional
implementation_id/version optional
changeset_id optional
payload: bounded typed fields
```

Schema migrations should be explicit once a second version exists. Do not build a migration framework before then.

## 16. Data minimization

Never store in plan/approval/ledger by default:

- API keys;
- private local MCP route tokens;
- arbitrary Python source;
- `run_script_unsafe` payloads;
- complete Raw tool responses;
- media file contents;
- full environment blocks;
- unrestricted user prompts;
- large arbitrary Resolve payloads.

Persist only execution-relevant structured parameters for registered protected workflows.

Full local paths are stored only when a workflow genuinely requires them for a durable plan or verification and its field policy declares that need. Activity UI may redact or shorten them separately.

## 17. Cancellation

`cancel` is not a generic promise.

It may be exposed only when the underlying operation has a truthful cancellation boundary.

Examples:

```text
queued local analysis job before execution
  potentially cancellable

already-dispatched Resolve mutation
  not cancellable through a generic Workflow action
```

Cancellation after dispatch cannot be used as a substitute for recovery.

Agent/UI `RunControl` uses this same truth. A user redirect may abort safe model work or undispatched reads, but once a protected mutation reaches the durable dispatch boundary the conversation layer may only stop/resolve according to the execution state machine. It must not overwrite `dispatch_started` or `ambiguous` with a generic `cancelled` state.

## 18. Concurrency and Resolve scheduling

Independent analysis/read work may run concurrently only when it does not compete for Resolve's global/page/current-project/current-timeline state.

The current broker can hold multiple pending RPC calls, so broad Agent/Worker execution requires one explicit `ResolveScheduler`/lease above `ResolveBroker`.

At minimum the scheduler serializes:

```text
page changes
current-project/current-timeline-dependent operations
all protected mutations
render state transitions
page-sensitive Fusion/Color operations
```

Workers may analyze independent local artifacts concurrently and prepare candidate plans. They never bypass the scheduler for stateful Resolve calls.

Plan creation may be concurrent, but executing one action or a human edit in Resolve can stale another Plan. Human edits win. Every execution therefore revalidates exact identity/fingerprint immediately before dispatch and fails stale rather than attempting an implicit rebase.

The World Model and `SituationFrame` may be assembled from multiple observations, but each material slice must retain its generation/freshness. A Context Compiler must not merge observations from different project/timeline generations into one apparently coherent current frame. When coherence cannot be established, expose stale/unknown and reacquire the minimum required evidence.

The existing mutation queue remains part of writer safety until the scheduler subsumes that responsibility with equivalent or stronger ordering. Do not create two independent mutation lanes.

## 19. Protected/locked timeline rule

If a workflow can modify a timeline, it must inspect the relevant protection/lock state where the API can establish it.

Protected timelines are not modified automatically.

If protection state cannot be established for a workflow whose policy requires it, execution blocks as unverified/unknown rather than assuming unlocked.

## 20. Source-media rule

Camera/source media is immutable by default.

Read-only analysis may read source files when the workflow declares the file access and Project Location/source policy permits it.

Creating derivatives, proxies, transcodes or replacing source media requires a separately specified workflow and is not implied by “analysis”.

## 20.1 UI Automation and plugin adapter boundary

UI Automation is capability-specific, not generic Agent computer control. Even when macOS Accessibility permission is granted, only explicitly registered/qualified allowlisted UI-automation implementations may dispatch. Model-authored click coordinates, arbitrary mouse/keyboard scripts and generic fallback interaction remain outside protected Workflow.

Third-party OFX/VST/Fusion control may enter through versioned trusted Capability Packs. V1 loads only CID-owned/trusted packs. Unknown plugins may be observed as installed/unsupported but do not gain generic parameter-control authority.

## 21. Workflow publication and policy separation

The current source contains historical Raw/Workflow connector routing. The target COS-hosted product uses one CID Tunnel into one CID MCP Gateway.

Protected writes remain isolated by Gateway policy/namespace rather than by requiring a second transport:

```text
COS Agent
  -> one CID Tunnel
  -> one CID MCP Gateway

Protected Workflow policy surface
  exposes only protected compound tools

Optional advanced/raw policy surface
  remains exact official access
```

Do not merge Raw escape hatches into the protected Workflow namespace and do not make them visible to the normal COS Agent.

The product path owns one CID Tunnel process and one CID MCP Gateway. All DaVinci policy surfaces still share exactly one CID-owned Resolve authority; no surface may start a second Resolve session.

## 22. Protected writer acceptance contract

The first production writer is accepted only when one main path and one critical failure path are proven.

Main path:

```text
create immutable Plan with semantic capability + selected implementation + qualification evidence
create Goal/Plan-grouped ChangeSet draft
local approval durably recorded
revalidate target/fingerprint
record dispatch_started durably
perform one bounded write
read back at declared level
record terminal evidence and update ChangeSet actual delta/verification
Activity shows the same ledger result
```

Critical failure path:

```text
target/fingerprint changes OR required readback contradicts
  -> no verified success
  -> no automatic retry
  -> durable stale/contradiction evidence
```

Also verify that an app restart after `dispatch_started` without a terminal result projects the execution as ambiguous and does not replay it.

Do not expand writer coverage into a broad mutation matrix unless each new writer satisfies this contract.
