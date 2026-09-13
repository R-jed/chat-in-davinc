# Chat in DaVinci — Agent-Native System Specification

Date: 2026-09-12
Status: canonical system-level design for the Agent-native control system, Agent ergonomics and CID DaVinci capability growth

Implementation note: the current repository still contains a CID-owned durable Session/TurnRunner/OpenAI baseline created before the 2026-09-11 architecture reset. That code is migration provenance, not the target upper runtime. The target uses COS for ChatGPT Web transport, Conversation/Session/Turn, Goal/Loop/Finish, Compact & Resume, Prime/Worker and model orchestration. Chat in DaVinci owns the final Codex-style desktop presentation, Workspace/Resolve binding and the entire DaVinci semantic/control plane. COS runtime ownership must not be confused with visual ownership of the left Sidebar or middle Conversation renderer.

## 1. Purpose

Chat in DaVinci is not a chat window attached to a set of Resolve pages, and it is not a collection of MCP tools wrapped in safety checks.

It is one synthetic control system whose primary operator is an Agent and whose human user shares the same state, evidence, goals and controls.

The design test is the driver's-seat test: if an Agent were operating Resolve for hours without hidden implementation knowledge, the system should continuously make the next correct decision obvious. The Agent should not need to remember raw API quirks, rediscover unchanged project state, enumerate hundreds of unrelated tools, infer whether a write really happened, or ask the user for facts the application can establish itself.

The system is successful when the Agent can answer, with minimal context and minimal trial-and-error:

```text
What is the user trying to achieve?
What is true in Resolve right now?
What changed since I last looked?
What am I looking at / talking about?
What can I safely do from here?
What is the cheapest reliable next observation or action?
What evidence would prove success?
What remains unresolved?
```

The product should make those questions cheap and explicit. The Agent should not have to reconstruct their answers from raw transcripts, UI pixels, large API payloads or a flat inventory of tools.

## 2. Optimization order

Agent ergonomics is not equivalent to minimizing token count. The system optimizes in this order:

1. **correctness and safety** — never save tokens by weakening target identity, authorization, qualification or verification;
2. **faithfulness to user intent** — preserve the exact goal, constraints, corrections and finish line;
3. **semantic completeness** — the Agent receives the facts necessary to decide correctly, including unknowns and blockers;
4. **recoverability and provenance** — consequential work remains attributable and restart-safe;
5. **minimum user interruption** — ask only for preference decisions, missing material constraints or required local approval;
6. **minimum cognitive/context load** — prefer compact semantic state over raw logs and API noise;
7. **minimum Resolve/API work** — reuse still-valid observations and batch coherent reads where safe;
8. **minimum latency and monetary cost** — choose the least expensive model/tool path that still meets the required confidence and verification contract.

Cost is therefore a planning input, not the highest-level objective.

## 3. Research synthesis

The forward architecture is based on several convergent lessons:

- Anthropic's context-engineering work treats context as a finite resource that must be curated continuously rather than accumulated indefinitely.
- Anthropic's agent-tool research recommends fewer task-shaped tools, clear namespaces, high-signal outputs, token-efficient pagination/filtering, actionable errors and evaluation-driven tool refinement.
- OpenAI's Agents SDK separates local runtime context from LLM-visible context and supports context-aware capability filtering; capability visibility is not itself authorization.
- OpenAI's internal data-agent architecture uses layered context and retrieves only what is relevant at runtime; it explicitly reports that exposing the full tool set created ambiguity and that goal guidance outperformed rigid path instructions.
- Anthropic's Agent Skills work uses progressive disclosure: keep small capability metadata available, then load detailed procedural context only when a capability is relevant.
- Anthropic's Managed Agents work emphasizes stable interfaces between a changing agent harness/model (the brain) and execution environments (the hands). CID should preserve the same separation so model upgrades do not force Resolve safety/control rewrites.
- MCP distinguishes application-controlled resources/context from model-controlled tools. Resolve state should therefore be primarily an application-owned world model, not a huge tool payload repeatedly re-read by the model.
- OpenAI tracing models a run as a hierarchy of task/turn/model/tool spans. CID already has durable execution evidence; Agent traces should connect to that evidence rather than create another uncorrelated log.
- Chat On Steroids demonstrates durable session identity, exact-goal rereading, concise tool activity summaries, fail-closed workspace identity and context compaction across long-running work.
- `samuelgursky/davinci-resolve-mcp` demonstrates the value of compound workflow routers, operation envelopes, execution traces, page/state locking, readback, versioning and explicit API limitations.

Reference material:

```text
https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents
https://www.anthropic.com/engineering/writing-tools-for-agents
https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills
https://www.anthropic.com/engineering/managed-agents
https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
https://openai.com/index/inside-our-in-house-data-agent/
https://openai.github.io/openai-agents-python/context/
https://openai.github.io/openai-agents-python/tracing/
https://openai.github.io/openai-agents-python/multi_agent/
https://modelcontextprotocol.io/specification/2025-06-18/server/index
/Users/qunqing/2026-Project-Agent/chat-on-steroids
/Users/qunqing/2026-Project-Agent/_references/davinci-resolve-mcp
```

These references inform the architecture. CID remains the owner of the resulting system and safety semantics.

## 4. The linked abstraction tower and closed control loop

The Agent should operate through a small number of linked semantic abstractions. Each abstraction exists because it removes a class of repeated reasoning from the model. Together they form one closed control loop rather than a stack of components that merely exchange messages.

```text
GoalFrame + TaskGraph
what outcome is required, what remains, what evidence closes it
        │
        ▼
SituationFrame + SharedFocus
what matters now, what changed, what is uncertain, what is active
        │
        ▼
Capability Frontier
the small set of currently relevant, qualified and admissible affordances
        │
        ▼
Context Compiler -> ContextPack
minimum sufficient decision frame for this one model decision
        │
        ▼
COS Agent Control Loop
observe / decide / propose / clarify / finish claim
        │
        ▼
ToolKernel + immutable Plan when required
stable semantic action contract, policy, exact target, approval, recovery
        │
        ▼
ResolveScheduler -> one Resolve authority
one coherent stateful execution lane
        │
        ▼
qualified implementation
Blackmagic official path / Samuel-derived implementation / allowed adapter
        │
        ▼
Evidence -> ActionResult -> actual SemanticDelta -> update ChangeSet
what actually happened, what is now known, what changed, what remains
        │
        └──────────────► Resolve World Model ───────────────┐
                         sparse current truth + provenance │
                                                          │
        └──────────────── next SituationFrame ◄────────────┘
```

The World Model and Evidence layer are therefore not passive databases under the Agent. They are the deterministic memory and proprioception of the control loop. The Context Compiler should expose only the information that can change the next decision; the Capability Frontier should expose only actions that can plausibly advance the current Goal or resolve a blocking uncertainty.

The UI is not another layer of truth. It is a human projection across the same graph:

```text
Codex-style Workspace/Session Sidebar | Codex-style Conversation | Resolve Artifact Workspace
                                      │                          │
                                      └ same Goal / Situation / entities / plans /
                                        ChangeSets / evidence / jobs ─────────────┘
```

A model answer, a timeline artifact row, an approval review, a ChangeSet, a background job and an Activity trace must resolve to the same canonical identities. Human and Agent navigation is therefore navigation through the semantic graph, not synchronization between separate copies.

### 4.1 Stable brain/hand protocol

The model, harness and orchestration policy will improve over time. Resolve control semantics should not churn with them.

The stable conceptual protocol across the cognitive/execution boundary is:

```text
system -> Agent
  GoalFrame
  SituationFrame
  DecisionFrame / ContextPack
  ActionOffers from the Capability Frontier
  EvidenceRefs when needed

Agent -> system
  observation request / action intent / clarification / finish claim

system -> Agent
  ActionResult
  semantic delta
  ChangeSet or plan state when relevant
  evidence / blocker / remediation / completion gap
```

The model may change; the meaning of an exact target, risk, approval, dispatch, verification and evidence should not.

## 5. Canonical semantic records

### 5.0 WorkspaceRef

`CID Workspace` is the product-level identity that survives Resolve project renames, Session changes and offline work. One Workspace binds one Resolve Project identity. Cross-project work references multiple Workspaces; it does not turn one Workspace into a multi-project container.

```text
WorkspaceRef
  workspace_id
  display_name
  resolve_project_unique_id
  project_library_identity when known
  workspace_root optional
  active_binding_state
  known Session refs
  analysis/job namespace
```

The application-owned Workspace record is authoritative. A user-selected `workspace_root` may hold portable sidecars, but no CID state is ever written into Resolve Project Library/database internals. At any instant, stateful Resolve execution has one `Active Resolve Target`; a cross-Workspace plan must declare every project switch and revalidate it before use.

### 5.1 EntityRef

Every meaningful Resolve object is addressable through a semantic reference.

Target shape:

```text
EntityRef
  kind              project | timeline | track | timeline_item | media_pool_item |
                    fusion_comp | fusion_tool | color_node | grade_version |
                    fairlight_track | render_job | deliverable | ...
  exact_id          local canonical ID when the API provides one
  handle            short session/snapshot-scoped Agent-facing handle
  label             human-readable name
  parent_ref        optional containment/lineage
  locator           optional track/timecode/bin/page coordinates
  generation        project/timeline/world-model generation
```

Agent-facing context should prefer a readable label plus a short handle, for example:

```text
Interview 04 [C17]
Documentary Cut 03 [T2]
V2 / Interview 04 [I31]
```

The exact UUID remains locally bound to the handle. A short handle is never authorization. If its generation or parent identity is stale, resolution fails closed and asks for a refresh/reselection instead of guessing.

### 5.2 EvidenceRef

Every material fact can point to why CID believes it.

```text
EvidenceRef
  id
  source             official_api | render | file_qc | analysis | user | memory
  observed_at
  project_id
  timeline_id optional
  generation
  qualification
  method_or_probe
  value_hash / artifact_ref
  confidence_or_limitations
```

Raw payloads may remain off-context behind the reference. The Agent normally receives the semantic fact plus the evidence reference, not the entire source blob.

### 5.2.1 AnalysisArtifact

Reusable local analysis is a first-class project asset rather than disposable tool output. Its identity is content-addressed so repeated Agent work does not retranscribe, re-index or re-measure unchanged media:

```text
artifact_id =
  source_fingerprint
  + analysis_type
  + algorithm_or_model_version
  + normalized_parameters
```

Artifacts may include transcripts, semantic indexes, shot detection, thumbnails/contact sheets, audio measurements, QC and conform comparison. Portable artifacts may live under the optional Workspace Root; canonical security/approval/dispatch state remains application-owned. Analysis artifacts are not written back into Resolve metadata by default.

### 5.2.2 WorldFact

The World Model must distinguish direct observation, deterministic derivation, model inference, user assertion, unknown and contradiction. A semantic fact therefore carries epistemic state rather than only a value.

```text
WorldFact<T>
  subject EntityRef
  predicate / semantic key
  value + unit/coordinate-space when applicable
  epistemic_state    observed | derived_deterministic | model_inference |
                     user_asserted | unknown | contradicted
  EvidenceRefs
  observed_at / derived_at
  generation
  freshness / invalidation dependencies
  limitations
```

Rules:

- `observed` requires supporting evidence from an accepted source;
- `derived` identifies the observations/rule it was derived from;
- `assumed` is explicit and may be used only where the task tolerates it;
- `unknown` is not rewritten as false/zero/empty;
- `contradicted` remains visible until the conflict is resolved;
- planned/proposed future state never enters the current World Model as an observed fact;
- `model_inference` may be reused by later model decisions only with its epistemic label and provenance preserved; it never silently becomes `observed`;
- `user_asserted` remains distinct from machine observation unless independently verified.

This epistemic separation is central to Agent accuracy: the model should not need to infer from prose whether a field is measured, guessed or merely intended.

### 5.3 SituationFrame

`SituationFrame` is the Agent's cheap proprioceptive snapshot of the current workspace.

It contains only high-value state:

```text
current Workspace / Active Resolve Target
current project / timeline / Resolve page identity
shared focus and why it is focused
project/timeline generation
important deltas since the previous Agent observation
active user goal / current task node
completion gaps / required evidence still missing
active plan / approval / execution state
relevant blockers and unknowns
relevant Capability Frontier summary
in-flight Resolve work
freshness summary
```

It does not contain the full project inventory, every tool definition or the whole conversation.

### 5.4 SharedFocus

`SharedFocus` is the canonical main-process owner of the common "this" between the human and Agent. Model-visible cognition normally receives it only through `SituationFrame.focus`; the Context Compiler should not inject a second peer copy of the same focus state unless raw provenance is specifically needed.

Sources may include:

```text
user selected an item in the Resolve Artifact Workspace
Agent linked/highlighted an entity
current Resolve timeline/playhead-derived observation
a plan or execution selected a target
```

Focus is context, not authorization. A writer still resolves and revalidates its own exact plan targets.

### 5.5 ActionDescriptor

Every internal action has one machine-readable semantic descriptor. This is richer than a public function schema.

Target fields:

```text
action_id              stable semantic ID, e.g. edit.clip.trim
contract_version       semantic contract version
domain
intent / routing summary
not_for
accepted target kinds
input schema
answers / observation value for readers
read set / write set
preconditions
required capabilities
state sensitivity / page requirement
risk / blast radius
approval / preview
idempotency
retry contract
recovery class
verification contract
expected semantic effects
result projection
next affordances / remediation
estimated context cost
estimated Resolve-call cost
latency class
capability tier
```

The descriptor is the common source for Agent capability discovery, plan validation, UI plan explanation, documentation and evaluation fixtures. Concrete implementations are separate, versioned candidates qualified against exact Resolve build/version and environment. Routing chooses the best-qualified implementation for the requested contract; the official path wins ties, and UI Automation is a last-resort allowlisted implementation rather than a generic computer-control escape hatch. Authorization remains in the ToolKernel/Workflow engine.

#### ActionOffer — the Agent-facing affordance

`ActionDescriptor` is the stable capability contract; `ActionOffer` is its state-bound projection for one DecisionFrame:

```text
ActionOffer
  action_id
  bound target candidate(s)
  applicability / precondition state
  goal criterion or uncertainty advanced
  expected semantic effect / proposed ChangeSet summary
  required verification
  risk / approval class
  estimated context / Resolve-call / latency cost
```

The Agent chooses among ActionOffers/action intents. `status`, `inspect`, `inspect_operation`, `audit`, `plan` and `execute` are transport/control verbs used to carry that intent through the gateway; they are not peer cognitive choices beside semantic actions such as `edit.clip.trim`.

### 5.6 GoalFrame

A long-running session needs an explicit, durable representation of the user's intended outcome.

```text
GoalFrame
  original_request       immutable source text/reference
  desired_outcome
  hard_constraints
  user_preferences
  explicit_non_goals
  completion_criteria
  required_evidence
  assumptions
  decisions
  corrections
  open_obligations
```

The original user request remains authoritative. Summaries and task decomposition are derived views and must never silently narrow it.

`completion_criteria` and `required_evidence` form the completion contract from the beginning of the Goal. The Agent should be able to see the remaining completion gap at every decision instead of discovering the finish condition only after work has been performed.

### 5.6.1 TaskGraph

For long work, maintain a revisable obligation/dependency graph rather than a rigid script.

```text
TaskNode
  id
  objective / obligation
  dependencies
  status              open | active | blocked | satisfied | abandoned
  relevant EntityRefs
  required_evidence
  blocker / decision owner
  resource budget optional
```

The TaskGraph answers “what remains?” and “what depends on what?”. It does not dictate a fixed sequence when the Agent can find a better route. It is derived from GoalFrame and may be revised as evidence changes, while the original user request remains immutable authority.

### 5.7 ExecutionTrace

An Agent task needs one end-to-end trace that links model work to CID's existing durable execution evidence.

```text
session -> task -> turn -> decision -> tool/action -> plan -> approval -> dispatch -> verification
```

Trace summaries may include model/token usage, tool count, Resolve calls, latency, semantic changes and verification outcome. Sensitive/raw model content is not required for every trace.

### 5.8 ActionResult

Every significant observation/action returns a semantic result that can feed Agent context, the World Model, UI and trace without each client reparsing raw transport payloads.

Target shape:

```text
ActionResult
  action_id / execution_id
  status
  target EntityRefs
  semantic observations / changes
  EvidenceRefs / verification
  warnings / blockers / unknowns
  invalidated World Model slices
  next affordances / safe remediation
  retry_safety
  resource usage summary when useful
```

Raw MCP/script payloads remain diagnostic evidence beneath this envelope.

### 5.9 SemanticDelta

`SemanticDelta` is the compact bridge from execution/observation to the next decision and to the UI.

```text
SemanticDelta
  generation_before / generation_after
  added_or_changed WorldFacts
  invalidated facts/slices
  new/removed blockers
  changed EntityRefs / relationships
  new EvidenceRefs
  plan/execution state changes
```

The Agent should receive deltas after it already knows the baseline, rather than repeatedly comparing large raw snapshots itself.

### 5.10 Prospective PlanOverlay

Current truth and proposed future state remain separate.

`PlanOverlay` may project the semantic effects of an immutable approved/unapproved plan over the current World Model for human/Agent review, but those effects are labelled `proposed` until execution and declared verification produce current-state evidence.

The Resolve Artifact Workspace may visually compare current vs proposed state. It must never paint a planned marker/edit/grade/render as if Resolve already contains it.

### 5.11 ChangeSet

Every protected Resolve mutation produces a semantic `ChangeSet`, including low-risk direct UI actions. A ChangeSet is the stable semantic transition identity across the whole lifecycle: proposed -> approved -> dispatched -> observed -> verified/partial/contradicted/ambiguous. It is grouped by user intent/Goal/Plan rather than by transport call:

```text
ChangeSet
  id
  workspace / project / timeline scope
  goal / plan reference
  generation_before / expected_generation_after
  expected semantic delta[]
  actual semantic delta[] when observed
  invalidated slices
  execution state
  verification state / achieved level
  Goal-criterion impact
  EvidenceRefs
  recovery availability
  originating Session
```

`PlanOverlay` is the proposed projection of the same intended transition. `ActionResult` references the ChangeSet; `SemanticDelta` is the compact observed-state projection used to update the World Model and next DecisionFrame. Tool calls remain in the ExecutionTrace. ChangeSets answer the human/Agent question “what changed because of this intent?”. Proposed changes may be edited only by producing a new immutable Plan/version; approved plans are never mutated in place.

### 5.12 RunControl

User interruption and redirection are first-class control states:

```text
idle
running
waiting_for_user_decision
waiting_for_local_approval
stopping_at_safe_boundary
ambiguous_dispatch_requires_resolution
```

A new user instruction can update GoalFrame/TaskGraph and cancel safe pending reads/model work. It cannot pretend to cancel a mutation that may already have been dispatched. The Workflow execution state machine remains authoritative for whether cancellation/retry is safe.

## 6. Resolve World Model

### 6.1 Why a world model is required

Without a world model, every turn begins by asking Resolve the same questions and then spending model tokens rebuilding relationships that deterministic code can hold more reliably.

The world model is an application-owned, typed, partially materialized graph of currently relevant Resolve state.

It is not a full mirror of the Resolve project and must not become a continuous crawler.

### 6.2 Graph shape

Conceptually:

```text
Project
  ├─ Timeline
  │   ├─ Track
  │   │   └─ TimelineItem
  │   │        ├─ MediaPoolItem
  │   │        ├─ FusionComposition -> FusionTool graph
  │   │        ├─ Color / grade version / group relationships
  │   │        └─ Fairlight/audio processing relationships
  │   └─ Markers / settings / render relevance
  ├─ MediaPool bins/items
  └─ Deliver settings/jobs/outputs
```

Nodes and edges exist only when observed or needed. Unknown relationships remain unknown.

### 6.3 Demand-driven materialization

At session/turn start the Agent receives a cheap `SituationFrame`. Deeper objects are loaded only when the goal requires them.

Example:

```text
"Check the interview cut for gaps"

cheap situation
-> current timeline identity
-> Edit structure/gap slice only
-> no Fusion graph, Color nodes, Media Pool metadata or Deliver presets unless required
```

### 6.4 Freshness and invalidation

Every observed slice carries project/timeline/schema generation and observation time.

Invalidation is dependency-aware:

- project switch invalidates project-scoped descendants;
- timeline switch invalidates timeline-scoped descendants;
- a timeline mutation invalidates affected timeline structure and dependent derived analysis;
- a grade mutation invalidates grade/render evidence but should not force an unrelated Media Pool rescan;
- external/user Resolve changes may require a cheap identity/fingerprint check before relying on cached state;
- all writes revalidate their exact plan fingerprint immediately before dispatch regardless of cache state.

The system prefers reuse of still-valid observations, never reuse of merely convenient stale data.

### 6.5 Delta-first context

After the Agent has already seen a state, later turns should preferentially receive:

```text
what changed
what became stale
new blockers
new evidence
```

rather than the complete unchanged snapshot again.

## 7. Context architecture

### 7.1 Local context vs model-visible context

CID must maintain an explicit separation:

```text
Local runtime context
  exact IDs
  full world model
  credentials
  authorization state
  plan hashes
  raw evidence
  caches
  scheduler/lease state
  UI selection internals

Model-visible context
  exact user goal/constraints needed now
  SituationFrame including SharedFocus/completion gap
  readable EntityRefs/handles
  Capability Frontier / relevant descriptors
  selected evidence summaries
  recent semantic deltas
  open obligations
```

Local context is not tokenized merely because it exists.

### 7.2 Context Compiler

Every model call goes through a deterministic `ContextCompiler` that chooses the minimum sufficient context for the current decision.

Input sources:

```text
system invariants
GoalFrame
session/turn events
SharedFocus
SituationFrame / World Model
Action Catalog / Capability Frontier
project/user corrections and stable memory
recent ExecutionTrace summaries
```

Output is a `ContextPack` with an explicit budget and provenance. Semantically, that pack is the model-visible serialization of a derived `DecisionFrame`:

```text
DecisionFrame
  active goal criterion / TaskNode
  decision_kind        observe | act | clarify | approve_wait | finish_check
  uncertainty_or_completion_gap
  required predicates / evidence
  relevant WorldFacts + SemanticDeltas
  stale dependencies
  ActionOffers
  budget / provenance
```

`DecisionFrame` is not a second state store and does not duplicate GoalFrame or SituationFrame. It exists to make the exact decision being solved explicit, so the Agent is not handed a bag of context without knowing which uncertainty or completion gap that context is supposed to resolve.

The compiler should be able to answer why each section was included. Every included item must justify itself by at least one of four purposes: preserve a goal/constraint, resolve a decision-relevant uncertainty, select/parameterize an admissible action, or test completion. Data that cannot change the next decision stays local behind a reference.

### 7.3 ContextPack layers

A normal turn should roughly compile:

```text
1. stable operating invariants                  very small, cached
2. exact goal + current open obligations         small
3. current SituationFrame                        small
4. focused entity detail                         only when relevant
5. relevant actions/capabilities                 filtered
6. recent semantic delta / prior decision         small
7. deeper evidence                               by reference/on demand
```

Do not send entire Activity history, all domain readers, all capability descriptions or every previous tool payload on each model call.

### 7.3.1 Observation economy

Observation is an information-gathering action, not a ritual before every decision. The system should prefer the cheapest valid evidence that can distinguish between materially different next actions. Observation recipes therefore declare what question they answer, the World Model slice they refresh, their invalidation dependencies, expected Resolve-call cost and freshness semantics. If a still-valid observation already answers the blocking question, another Resolve read is an ergonomic regression.

Unknowns remain explicit. When an uncertainty is material, the SituationFrame should name it and the Capability Frontier should expose the narrow observation/remediation that can resolve it instead of forcing the model to rediscover the path by trial and error.

### 7.4 Memory tiers

Memory is not current Resolve truth.

Separate:

```text
session memory      goal, decisions, corrections, unresolved obligations
project memory      stable project conventions/annotations explicitly learned
capability memory   qualified runtime/API quirks owned by code/registry
ephemeral world     current observed Resolve state
```

Runtime evidence overrides stale memory. User corrections are preserved with provenance and scope.

### 7.5 Compaction and Resume

Compact & Resume should compact narrative state, not blindly summarize machine state already available elsewhere.

A handoff should primarily carry:

```text
GoalFrame
important user decisions/corrections
open obligations
current task position
active plan/approval/execution references
important unresolved uncertainty
world-model/entity/evidence references needed to rehydrate
```

Fresh Resolve state is rehydrated through the World Model when necessary. A handoff does not need to restate every old tool result.

## 8. Agent Control Loop

The default loop is evidence-oriented:

```text
OBSERVE
  obtain the smallest observation that can reduce decision uncertainty

ORIENT
  compile the exact DecisionFrame from GoalFrame + SituationFrame + fresh evidence
  derive the state-bound Capability Frontier / ActionOffers

DECIDE
  choose the safest highest-value next observation/action, clarification, approval request, or finish check

PLAN
  for consequential mutations, create a concrete immutable plan

ACT
  dispatch only through ToolKernel and the single Resolve authority

VERIFY
  collect the declared evidence level; contradiction outranks nominal API success

UPDATE
  update ChangeSet / semantic deltas / World Model / trace
  recompute completion gaps and stale dependencies

CONTINUE or FINISH
  derive CompletionReport and finish only when GoalFrame completion criteria are supported by evidence
```

The loop is not required to mechanically execute all seven stages on trivial read-only questions. It is a conceptual contract for long-running work.

### 8.1 Evidence-backed completion

CID should not copy COS Goal completion literally when the task changes Resolve state.

Conversation text alone is insufficient proof of completion. Goal completion may use:

```text
conversation evidence
World Model state
verified execution results
render/file/audio/visual evidence when required
```

Completion is evaluated criterion by criterion against `GoalFrame.completion_criteria` and `required_evidence`. CID should be able to derive a compact `CompletionReport` containing satisfied criteria, missing evidence, unresolved blockers/ambiguities and the strongest verification achieved. This report is derived evidence, not a second Goal owner. COS retains Finish lifecycle authority, while CID supplies the Resolve completion evidence.

The Agent saying "done" is not evidence that a render exists or a timeline mutation succeeded.

### 8.2 Clarification ergonomics

The Agent should interrupt the user only when:

- a material preference cannot be inferred safely;
- two plausible interpretations lead to meaningfully different outcomes;
- required information is absent;
- a local approval is required by policy.

A clarification request and an approval request are distinct states. The Agent should not turn routine deterministic choices into user questions.

### 8.3 Decision economics: spend work only when it can change the result

Once correctness/safety/user intent constraints are satisfied, the controller should rank candidate ActionOffers by expected decision value rather than habit or tool convenience. A good next step either advances a Goal criterion, resolves a material uncertainty, unlocks a blocked capability, or produces required completion evidence.

For each candidate, the DecisionFrame may expose compact estimates such as:

```text
goal_progress              which criterion/obligation advances
uncertainty_reduction      which materially different branches it distinguishes
verification_value         which required evidence it can establish
risk / reversibility       what can go wrong and how recoverable it is
context_cost               how much new model context it requires
resolve_cost               expected API/page/render work
latency / user_interrupt   expected wait or human attention
```

Never trade away correctness or required evidence for cost. Among actions that satisfy the correctness floor, prefer the smallest total path to verified completion, not merely the cheapest immediate call. This prevents locally cheap actions from causing repeated probes, brittle retries or late user interruptions.

## 9. Agent-computer interface (ACI)

### 9.1 Small stable transport/control surface

The transport/control surface remains intentionally small. The current six protected verbs are a valid gateway baseline, but they are not the Agent's semantic action ontology:

```text
status
inspect
inspect_operation
plan
audit
execute
```

Do not freeze these names forever without evaluation, but do not expand them merely because more Resolve methods become available.

The long-term pattern is:

```text
DecisionFrame
+ state-bound ActionOffers using stable semantic capability IDs
+ small transport/control verbs underneath
+ complete internal Capability Ledger
+ on-demand detailed evidence
```

The model reasons in semantic actions such as `edit.clip.trim`; the gateway maps that intent to `inspect/plan/execute` as needed. This avoids forcing the Agent to reason simultaneously in two competing vocabularies.

### 9.2 Dynamic capability disclosure

A model should not receive hundreds of action schemas each turn.

The Context Compiler exposes only actions relevant to the current goal, Workspace/Active Resolve Target, focused entity, exact Resolve build qualification, current preconditions, capability tier, user authorization/risk ceiling and Resolve state. The result is the state-dependent `Capability Frontier`, not a static subset chosen only by keywords.

Visibility controls what the Agent considers. It is never authorization. The ToolKernel still validates every selected action and exact target.

### 9.3 Task-shaped actions

Prefer actions that match natural production intent over thin wrappers around individual API methods.

Good:

```text
inspect current timeline gaps
prepare ingest/organize plan
apply approved CDL with version protection
render and verify deliverable
```

Poor as normal Agent primitives:

```text
GetX
SetY
ListZ
method_214
```

Granular API methods remain implementation ingredients and diagnostic evidence.

### 9.4 High-signal results

Default model results should emphasize:

```text
what was learned or changed
important targets by readable handle
verification/evidence state
blockers/unknowns
relevant next affordances
```

Large collections require bounded filtering/pagination. Raw technical identifiers and full payloads are available by reference when the next action requires them.

### 9.5 Actionable failure

A failure should tell the Agent:

```text
what failed
whether anything may already have changed
which precondition/evidence is missing
whether retry is safe
what exact next observation/remediation is available
```

Opaque error codes or stack traces are diagnostic detail, not the primary ACI.

## 10. Capability Packs — how the system grows

New capability should be added as a vertical slice through the abstraction tower, not as an isolated tool.

A `Capability Pack` for one coherent production ability is a complete vertical contract, not a folder of wrappers. It registers only what that ability needs:

```text
stable semantic capability IDs
semantic entities / relationships
observation recipes
primitive ActionDescriptors
workflow ActionDescriptors / composition graph where useful
versioned implementation candidates
Resolve build/version qualification matrix + limitations
context recipes / Capability Frontier rules
plan / approval / recovery / verification contracts when mutable
expected effects + World Model invalidation rules
Artifact Workspace projection
analysis/evidence recipes when required
evaluation tasks and acceptance metrics
provenance / upstream references
```

A pack is not `production` merely because an API call works. Production status requires the vertical contract plus real disposable-fixture qualification on the supported Resolve build for the behavior it claims. Isolated wrappers may exist as implementation ingredients or experimental capabilities but never masquerade as production Agent ability.

Example:

```text
Edit Review Pack
  timeline + marker entities
  annotation observations
  add/remove marker actions
  deterministic compensation
  API readback verification
  Chat links + Edit inspector projection
  task evals for "mark these review points"
```

A capability is not complete merely because code can call an API method. It becomes Agent-capable when the Agent can discover it, select it correctly, target it safely, understand the result, verify it and show it coherently to the user.

The concrete inventory in `CAPABILITY_LEDGER.md` is intentionally broader than the model-visible frontier. Every known Resolve/official/Samuel-derived ability has an explicit lifecycle state such as `production`, `qualified`, `implemented`, `experimental`, `planned`, `unsupported`, `intentionally_excluded`, `api_gap` or `ui_automation_candidate`. Completeness means no silent gaps, not a fabricated 100% support claim. Coverage is reported by domain and lifecycle state, not as a misleading single percentage unless computed from that declared inventory.

### 10.1 Capability frontier

The Agent should have explicit proprioception about its current frontier:

```text
qualified and currently available
qualified but blocked by current state
conditional / license- or version-dependent
known unsupported / hard API gap
not yet implemented in Protected
```

Unknown must remain distinct from unavailable.

### 10.2 Progressive capability disclosure

Capability growth must not make every model call linearly larger. Use three levels of disclosure:

```text
Level 0 — Capability Index
  tiny name/intent/domain/availability metadata sufficient to know a capability exists

Level 1 — Relevant ActionDescriptors
  detailed semantics only for candidates relevant to the current goal/focus/state

Level 2 — Deep contract/evidence
  full schemas, limitations, examples, raw evidence or specialist instructions only when the Agent actually needs them
```

The Context Compiler decides which level is needed for the current decision. Capability metadata should be composable and discoverable without preloading full procedural instructions for every Resolve domain.

### 10.3 Model/inference policy

COS owns model/inference selection in the upper runtime, but correctness and verification dominate cost. Any future inference policy may choose a cheaper/faster model for a proven low-complexity decision only after task-level evaluations demonstrate equivalent required reliability. High-risk planning, ambiguous Resolve state or verification contradictions may justify stronger reasoning. CID must not hard-code a competing model ladder into the DaVinci safety layer.

## 11. Human-Agent shared cockpit

### 11.1 Target desktop layout

The target shell follows the user's Codex-style direction:

```text
┌─────────────────────┬──────────────────────────┬─────────────────────────────────────┐
│ Workspace / Sessions│ Codex Conversation       │ Resolve Artifact Workspace          │
│                     │                          │                                     │
│ Workspace A         │ current durable Chat     │ Context                             │
│   Session A         │ Agent status             │ Active Artifact                     │
│     Workers ▸       │ action/change summaries │ Changes / Plan                      │
│   Session B         │ composer + Context       │ Evidence / Inspector                │
│ connection/settings │                          │                                     │
└─────────────────────┴──────────────────────────┴─────────────────────────────────────┘
```

The persistent Agent workspace is a CID-owned Codex-style visual projection over COS Session/Conversation runtime plus CID Workspace/Artifact state. Project/Media/Edit/Fusion/Color/Fairlight/Deliver are capability-domain lenses, not peer state/page owners.

### 11.2 Codex-style Workspace/Session Sidebar

The final visual/interaction design follows the Codex-style Sidebar, while COS remains the authoritative Session/runtime owner underneath it. CID must not create a parallel Session lifecycle merely because it owns the renderer projection.

The Sidebar is Workspace-first:

```text
Workspace A  <-> one Resolve Project identity
  Session A
    expandable Worker activity/history
  Session B
Workspace B  <-> one Resolve Project identity
  Session C
connection / setup
settings
```

Workspace identity is CID-owned and survives Resolve project rename; Session/Worker identity and durable conversation lifecycle remain COS-owned. Cross-project Goals reference multiple Workspaces rather than binding one Workspace to several Resolve Projects.

It does not become a second tree of Resolve domains.

### 11.3 Codex-style Conversation pane

The middle pane is visually/interaction-wise Codex-style but is fed by the COS Conversation/Session runtime. It stays present while the user inspects different Resolve artifacts.

It shows:

- user/Agent conversation;
- compact semantic action progress rather than raw tool-call walls;
- context chips for SharedFocus;
- inline decision/approval links;
- composer.

Model/provider/token debugging details stay out of the ordinary conversation surface.

### 11.4 Resolve Artifact Workspace

The right pane is not a fake Resolve UI, not seven mini-applications and not a dashboard of equal-weight cards. It is the human-readable projection of the current task, semantic state and consequences of Agent action.

Its stable four-layer skeleton is:

```text
Context
  Workspace / Project / Timeline / SharedFocus / live-or-cached state

Active Artifact
  contextual Timeline / Media Review / Fusion / Color / Audio / Deliver / Project view

Changes / Plan
  proposed, approved, executing, applied, verified, contradicted or ambiguous ChangeSets

Evidence / Inspector
  optional detail, provenance, verification, limitations, developer diagnostics
```

Project/Media/Edit/Fusion/Color/Fairlight/Deliver remain capability/domain taxonomies and manual fallback navigation, not seven pages the user must traverse. The active artifact soft-follows the Agent only while the user is not actively inspecting another artifact. User interaction wins; Pin disables automatic artifact switching. Agent activity elsewhere is signaled without stealing the view.

Examples:

- Edit uses a semantic timeline: tracks/items/ranges/markers/issues/selection/proposed changes, not a second full Edit Page.
- Media Review supports local select/favorite/reject/compare state and commits to Resolve only through an explicit writeback Plan.
- Color emphasizes selected clip, node/stack/group/version relationships and verified visual evidence, with registered semantic controls only.
- Deliver emphasizes render intent, jobs, produced files and verification rather than raw setting dictionaries.
- V1 visual review uses stills, thumbnails, contact sheets and before/after/render evidence; no live Resolve Viewer mirror. Local proxy playback may be added later without coupling to Resolve Viewer capture.

### 11.5 Bidirectional semantic links

Chat and the Artifact Workspace must link through `WorkspaceRef`, `EntityRef`, `EvidenceRef`, Plan, ChangeSet, Job and trace IDs.

```text
Agent message: "V2 has an 11-frame gap" -> Open in Edit / highlight exact relation
User clicks Interview 04 in Edit             -> SharedFocus chip appears in Chat
Approval refers to Interview 04              -> same entity highlights in right pane
Activity trace entry                         -> jumps to same plan/evidence/entity
```

The user and Agent should never be looking at conceptually different copies of the project. Clicking an Artifact updates `SharedFocus` only; changing Resolve page/playhead/selection requires an explicit `Reveal in Resolve`-style action. Workspace browsing therefore does not cause hidden Resolve movement.

Approval is multi-projection but single-state: Chat may offer compact low/medium-risk quick approval while the Workspace shows the full Plan/Changes/evidence. High-risk work must open the full Workspace review. Direct semantic controls in the Workspace use the same ToolKernel, risk policy, ChangeSet and verification path as Agent actions; UI origin never grants authority.

### 11.6 Responsive behavior

On wide desktop windows:

```text
Sidebar             about 200–280 px, resizable/collapsible
Conversation        about 480–680 px, resizable
Artifact Workspace  receives remaining width and has the highest expansion priority
```

When width becomes constrained, shrink the Conversation pane to its minimum before sacrificing the Resolve Artifact Workspace. The right pane may become an overlay/switchable view at very narrow widths. Do not create duplicate DOM/state trees.

## 12. Observability and self-improvement

Agent ergonomics must be measured rather than decided only by intuition.

### 12.1 Trace metrics

For representative tasks record:

```text
task success / verified completion
tool/action selection errors
invalid argument errors
redundant observations
number of model turns
total model input/output tokens
context-pack size by layer
number of Resolve calls
Resolve-call latency
total wall-clock latency
user clarification count
approval count
stale-handle/state mismatches
unsafe/rejected action attempts
verification contradictions
restart/compaction recovery outcome
```

### 12.2 ACI evaluations

Each Capability Pack ships with small realistic Agent tasks. Evaluation asks whether the Agent can reach the correct result, not whether a function returns the expected unit-test value.

Examples:

```text
"Find the unexplained gap in this timeline and tell me where it is."
"Mark all interview clips that are offline without changing source media."
"Prepare a safe plan to apply this approved CDL to these shots."
"Render the current cut to this target and prove the output matches the required format."
```

A held-out task set should be used before changing tool names/descriptions or capability exposure rules.

### 12.3 Agent-assisted ergonomics review

Agent traces are themselves design evidence. Periodically analyze failed/redundant runs to find:

- overlapping tools;
- descriptions that route poorly;
- outputs that cause unnecessary follow-up reads;
- repeated missing context;
- expensive observations that should be consolidated;
- hidden preconditions that should move into ActionDescriptors;
- UI/Agent terminology mismatches.

Improvements still require deterministic tests and human review before shipping.

## 13. Multi-Agent architecture

Multi-Agent is an optimization for parallelizable cognition, not another Resolve authority.

The preferred default is a manager/Prime pattern:

```text
Prime
  owns user conversation, GoalFrame and final decision
  │
  ├─ Project/Media specialist
  ├─ Edit specialist
  ├─ Fusion/Color specialist
  ├─ Audio/Deliver specialist
  └─ Verification specialist
```

Workers receive bounded `WorkPacket`s rather than the whole session:

```text
goal slice
relevant EntityRefs / SituationFrame slice
relevant capability subset
required evidence / acceptance
resource budget
authority limits
```

Workers return typed findings, artifacts or candidate plans. They do not return an unstructured substitute conversation and they do not gain independent Resolve mutation authority.

Parallelism is used for independent analysis and reasoning. Stateful Resolve work is serialized through the single scheduler/authority.

## 14. Security integration

Agent ergonomics must make safe behavior easier, not merely block unsafe behavior late.

Therefore:

- the Agent sees risk/precondition/verification information before planning a mutation;
- short handles reduce identity errors but are resolved and revalidated locally;
- dynamic capability filtering reduces irrelevant dangerous options but does not replace authorization;
- plans are immutable and exact-target-bound;
- local approval is a separate user act;
- `dispatch_started` durability remains before side effects;
- ambiguous post-dispatch work is never automatically replayed;
- World Model/cache state is never sufficient authorization for a write;
- evidence-backed completion prevents nominal model success from masking failed/partial execution.

## 15. One fact, one owner

The system keeps one canonical owner per class of truth:

| Fact | Canonical owner |
| --- | --- |
| user conversation / durable turns | COS Session owner |
| exact goal / constraints / corrections | COS Goal/Session owner |
| current semantic Resolve state | World Model owner |
| current shared human/Agent focus | SharedFocus owner in main process |
| current capability truth | capability qualification registry |
| action semantics / affordances | Action Catalog |
| model-visible context | Context Compiler output; derived, never canonical truth |
| model/provider / Agent orchestration | COS runtime |
| plan/hash/approval/dispatch | existing Workflow engine + durable ledger |
| verification evidence | workflow/verification owners referenced by EvidenceRef |
| DaVinci completion assessment | derived CompletionReport; no lifecycle ownership |
| Resolve scheduling | ResolveScheduler |
| Resolve execution authority / driver binding | CID ResolveBroker / adapter |
| Session/Conversation runtime state | COS runtime |
| final Sidebar/Conversation visual projection | CID Codex-style renderer backed by COS state |
| Resolve Artifact Workspace UI | CID renderer projection only |
| Workspace identity / Resolve Project binding | CID Workspace owner |
| ChangeSet semantic history | workflow ledger projection / ChangeSet owner |
| analysis artifacts/jobs | Workspace-scoped Analysis Store / Job owner |

Derived projections may cache data but cannot silently become new authorities.

## 16. System invariants

1. The Agent should never need the whole project, whole transcript or whole tool catalog to make an ordinary next decision.
2. Every important object, action, plan and piece of evidence is linkable by a stable local reference.
3. Human and Agent views derive from the same semantic state.
4. Friendly handles are ergonomic references, not authorization or durable identity substitutes.
5. Current runtime evidence outranks memory and summaries.
6. Exact user intent outranks derived task decomposition.
7. Unknown is preserved; absence of evidence is never rewritten as success.
8. Capability visibility and capability authorization are separate.
9. New capabilities grow vertically as Capability Packs across observation, action, evidence, UI and evaluation.
10. Model-visible tools remain small and task-shaped; granular APIs remain implementation detail unless evaluation proves otherwise.
11. Context is compiled per decision with a budget; it is not an append-only prompt.
12. Reuse valid observations, but fail closed on stale identity before consequential decisions.
13. Every mutation has a declared verification target before dispatch.
14. Goal completion for state-changing work is evidence-backed.
15. Multi-Agent parallelizes cognition, never live Resolve authority.
16. UI Automation/Offline Adapter remain explicit capability tiers, never silent fallbacks.
17. A change that improves component elegance but makes the abstraction tower harder for the Agent to read is a regression.
18. Human edits win: external target/fingerprint drift makes dependent Plans stale; rebase always creates a new immutable Plan.
19. Every protected mutation produces a ChangeSet; execution success and verification success remain separate states.
20. Stable semantic capability IDs outlive concrete implementations; best-qualified implementation wins and the official path wins ties.
21. Model improvement never automatically raises autonomy. Qualification, user authorization and risk policy remain independent control gates.
22. Background local analysis may resume and outlive the initiating Session; write authority never auto-crosses restart/reconnect boundaries.
23. Complete capability coverage means every known ability has an explicit lifecycle status, not that every ability is already supported.

## 17. Forward implementation order

The CID World Model/Context Compiler/ToolKernel/scheduler/safety foundation exists at source/non-live validation level. The current CID provider/session/chat path is a superseded migration baseline. Forward work is System-Spine-first: every implementation slice must strengthen the closed Agent control loop rather than merely add another page, reader or wrapper.

Recommended order:

```text
0. preserve the current CID Chat/Session path only as migration provenance

1. bind the real COS runtime as the upper cognitive/session owner
   ChatGPT Web / Session / Turn / Goal / Loop / Finish
   Compact & Resume / Prime / Worker
   no second CID lifecycle

2. establish the final Codex-style renderer ownership split
   CID owns the visual Sidebar/Conversation/Artifact Workspace
   COS supplies durable Session/Conversation/Worker state beneath it
   no copy of COS visual design is required as a product constraint

3. make Workspace identity first-class
   one CID Workspace <-> one Resolve Project
   Workspace -> COS Sessions/Workers
   offline Workspace state / App-owned store / optional portable sidecars
   exactly one Active Resolve Target at a time

4. connect COS through one CID Tunnel/MCP Gateway into the existing System Spine
   GoalFrame -> SituationFrame -> Capability Frontier -> ContextPack/DecisionFrame
   ToolKernel -> one ResolveScheduler/authority
   Evidence -> ActionResult -> actual SemanticDelta -> update ChangeSet -> World Model

5. build the four-layer Resolve Artifact Workspace
   Context
   Active Artifact
   Changes / Plan
   Evidence / Inspector
   soft-follow + user-first Pin semantics

6. maintain `CAPABILITY_LEDGER.md` as the breadth-first semantic inventory and establish qualification/routing contract
   stable semantic IDs
   primitive + workflow layers
   exact Resolve build/version qualification matrix
   best-qualified implementation wins; official wins ties
   every known capability has an explicit lifecycle status

7. qualify the production safety spine before broad writers
   Timeline Version Protection
   external-drift / Human-edit-wins staleness
   ChangeSet projection
   criterion-level CompletionReport

8. expand full-domain Capability Packs depth-first
   Project + Media + Edit
   Fusion + Color + visual verification
   Fairlight + Deliver + audio/file verification
   Analysis Store / content-addressed artifacts where consumed

9. add Prime / Workers as bounded cognitive parallelism
   WorkPackets / candidate plans / analysis only
   all live stateful Resolve work returns through the same scheduler/Prime authority

10. add explicit fallback/plugin packs only after the primary contracts are proven
    allowlisted Resolve UI Automation for proven gaps
    offline deterministic adapters
    first-party/trusted plugin Capability Packs
```

Breadth-first inventory prevents entire Resolve domains from becoming architectural afterthoughts; depth-first vertical qualification turns that inventory into reliable production ability. Neither API method count nor UI page completion is an acceptable progress metric by itself.

Do not proceed to broad writer or Worker expansion merely because the model/provider path exists. First make the system legible enough that additional capability does not increase Agent confusion or context cost linearly.

## 18. Acceptance of the System Spine

The 2026-09-10 source/non-live baseline proved the first World Model/ContextPack pieces. The forward System Spine is accepted only when the closed cognitive/control loop is real rather than merely documented.

Before broad writer or Worker expansion, prove at minimum:

```text
one CID Workspace is stably bound 1:1 to one Resolve Project identity
one current Resolve project/timeline is represented by a generation-scoped SituationFrame
one UI selection becomes SharedFocus without moving Resolve or becoming authorization
one decision compiles a typed DecisionFrame that states its criterion/gap and excludes irrelevant context
one Capability Frontier emits only applicable state-bound ActionOffers for that decision
one semantic action resolves through the ToolKernel to one qualified implementation and one Resolve authority
one protected mutation creates one Goal/Plan-grouped ChangeSet before dispatch
one execution updates actual ChangeSet delta + Evidence + World Model + SemanticDelta
one completion check derives criterion-level CompletionReport rather than trusting Agent prose
one human edit/fingerprint drift stales the dependent Plan and Rebase creates a new Plan/hash
one high-risk approval is reviewed through the full Workspace while low/medium projections share the same approval state
one offline Workspace remains useful without any write auto-executing on reconnect
one trace reports verified outcome, redundant observations, model context/tokens, Resolve calls/latency and user interruptions
stale handle/generation refuses rather than targeting the wrong object
existing ambiguity/no-replay and writer verification guarantees remain unchanged
```

This is the minimum foundation for an Agent that can gain capabilities without making context cost, rediscovery, routing ambiguity or execution risk grow linearly with the size of Resolve.
