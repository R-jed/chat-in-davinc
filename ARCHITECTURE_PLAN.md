# Chat in DaVinci — Architecture Plan

Date: 2026-09-12
Status: current Agent-native synthetic-system architecture; earlier phase records retained only as implementation provenance

## 0. Active synthetic-system architecture

This section is the active architecture. Older Phase 0/Phase 1 text later in this file records how the current safety plane was built; it does not define the forward product boundary or implementation order.

The product target is now:

```text
Chat in DaVinci
  = Agent-native cognitive control plane
  + durable Chat / Session / Goal execution
  + full-domain DaVinci Resolve operation engine
  + CID world-model / approval / evidence / recovery authority
```

`AGENT_SYSTEM_SPEC.md` is the canonical system-level design above this implementation plan. In particular, forward architecture must preserve its linked abstraction tower rather than treating Chat, domain pages, tools and safety as independent products.

```text
GoalFrame / TaskGraph
  -> SituationFrame / SharedFocus / completion gap
  -> Context Compiler -> DecisionFrame / ContextPack
  -> Capability Frontier -> ActionOffer
  -> COS Agent Control Loop
  -> ToolKernel -> immutable Plan / ChangeSet when mutable
  -> ResolveScheduler -> one Active Resolve Target / one authority
  -> best-qualified sealed implementation
  -> Evidence -> ActionResult -> actual SemanticDelta -> update ChangeSet
  -> Resolve World Model -> CompletionReport
  -> next SituationFrame / DecisionFrame
```

The renderer is a human projection of these same abstractions, not an additional state owner.

The three source layers have distinct roles:

```text
Chat On Steroids
  ChatGPT Web / Conversation / Session runtime
  durable turn/input
  model / Agent orchestration
  Finish lifecycle
  Compact & Resume / continuation
  Goal / Loop
  Prime / Worker / inbox / sleep-revive semantics

Chat in DaVinci
  final Codex-style Sidebar/Conversation renderer projection
  CID Workspace identity <-> one Resolve Project binding
  Resolve Artifact Workspace
  Tunnel / MCP Gateway
  Context Compiler / DecisionFrame / SituationFrame / SharedFocus
  Resolve World Model / Evidence / EntityRef / Analysis Store
  ToolKernel / CallContext / Capability Ledger / implementation router
  immutable Plan/hash + ChangeSet + local approval
  durable execution ledger / CompletionReport
  verification/recovery/provenance
  one ResolveScheduler / Resolve authority

samuelgursky/davinci-resolve-mcp
  third-party MIT capability implementation source built on Blackmagic's official Scripting API
  Resolve API truth and runtime quirks
  domain kernel semantics for Project/Media/Edit/Fusion/Color/Fairlight/Deliver
  readback, page-lock, versioning and render-operation experience
```

The product boundary is now COS above CID, not a CID-owned replacement Chat runtime:

```text
COS ChatGPT / Session / Goal / Loop / Agent orchestration
  -> COS GoalFrame / CID SituationFrame / SharedFocus / completion gap
  -> Context Compiler -> DecisionFrame / Capability Frontier
  -> one CID Tunnel / MCP Gateway
  -> ToolKernel / CallContext
  -> semantic action -> immutable Plan when mutable
  -> CID Safety Plane / ChangeSet / approval / verification
  -> ResolveScheduler / one Active Resolve Target
  -> ResolveBroker / implementation router
  -> best-qualified Blackmagic / Samuel-derived / allowed adapter implementation
  -> DaVinci Resolve
  -> Evidence / SemanticDelta / World Model / CompletionReport
```

COS implementation details that are genuinely required for its Chat/Session/Agent runtime remain in the upper layer. They must not leak into CID's Resolve authorization model. CID exposes one stable DaVinci integration boundary to COS so future COS changes do not require rewriting Resolve safety semantics.

### 0.1 One Resolve authority

`ResolveBroker` currently supports multiple pending RPC calls, while only the existing writer lane is serialized. Broad Agent execution therefore requires a scheduler/lease above the broker before Workers or many stateful writers are introduced.

At minimum serialize:

- page-changing operations;
- current-project/current-timeline state-dependent operations;
- all mutations;
- render state transitions;
- Fusion/Color operations whose correctness depends on active Resolve page/state.

Workers may think in parallel. Resolve has one set of hands. Workers never hold raw broker authority or start their own Resolve session.

### 0.2 Protected action architecture

The normal Agent must continue to see a small semantic decision surface rather than hundreds of Resolve method schemas. Capability growth happens behind a machine-readable internal Action Catalog and is disclosed as state-bound `ActionOffer`s only when relevant to the current Goal/Situation/Active Resolve Target:

```text
Agent / ChatGPT
  -> DecisionFrame + Capability Frontier / ActionOffers
  -> chooses stable semantic action intent
  -> status | inspect | inspect_operation | audit | plan | execute as transport/control verbs
  -> unified ToolKernel / Action Catalog
  -> Plan / ChangeSet / approval / backup / execute / verify / ledger
```

ActionOffer visibility is ergonomics, not authorization. Transport verbs and semantic actions are not peer cognitive vocabularies. The ToolKernel still validates every action, exact target, plan and approval regardless of what the model saw.

Prefer task-shaped actions and high-signal semantic results. Granular `GetX`/`SetY` API methods remain implementation ingredients and diagnostic evidence unless Agent evaluation demonstrates a reason to expose them.

Raw remains a separate advanced official surface. Protected tools do not expose `run_script`, `run_script_unsafe`, arbitrary Python or arbitrary shell.

### 0.3 Semantic capability layer and implementation routing

Blackmagic's public Scripting API cannot provide 100% Resolve UI parity. Product completeness therefore means every known important ability has an explicit Capability Ledger state and every supported ability has at least one qualified implementation. Stable semantic capability IDs are independent from provider/tool names.

Candidate implementation tiers:

```text
Official ResolveMCP / official Scripting API   preferred live floor
Samuel-derived implementation                  subordinate kernel/workflow implementation
Local Analysis / Verification                  transcript/frame/audio/file/QC evidence
Offline Adapter                                deterministic compute/planning
Resolve UI Automation                         capability-specific allowlisted last resort
Trusted Plugin Capability Pack                 per-plugin qualification only
```

Routing is `best-qualified wins; official wins ties`. Qualification is implementation- and Resolve-build-specific. UI Automation/Offline/Plugin paths are never silent fallbacks and require explicit contracts. An approved Plan seals implementation identity/version; execution never silently reroutes it.

### 0.4 Domain target

The Resolve Domain Engine ultimately covers real operations across Project, Media, Edit, Fusion, Color, Fairlight and Deliver. API limitations must remain truthful. For example, if the official API cannot provide a real razor/split primitive, a whole-clip replacement must not be described as a precise split.

Deliver ends only after the produced file is verified when the workflow promises delivery compliance. Fusion/Color visual claims require rendered evidence when API readback cannot prove pixels. Fairlight public-API gaps around automation/plugin graphs/bus routing remain explicit unless an approved fallback tier covers them.

### 0.5 Timeline version protection

Before broad structural editing, qualify a real timeline duplicate/archive path:

```text
structural mutation
  -> create duplicate/archive
  -> read back exact backup identity
  -> persist backup identity in ledger
  -> only then dispatch mutation
```

Required backup failure blocks the mutation. This is version/backup protection, not universal Undo.

### 0.6 Active engineering order

The old phase checklist below is superseded as an execution queue. Forward engineering follows the closed System Spine:

```text
1. preserve one ToolKernel / ResolveScheduler / Resolve authority and existing World Model/safety evidence
2. bind the real COS ChatGPT/Session/Goal/Worker runtime; retire the parallel CID lifecycle
3. establish CID-owned Codex-style renderer + Workspace identity <-> one Resolve Project binding
4. close GoalFrame -> SituationFrame -> DecisionFrame -> ActionOffer -> Plan/ChangeSet -> Evidence -> CompletionReport
5. implement Context / Active Artifact / Changes·Plan / Evidence·Inspector with soft-follow + Pin + Reveal in Resolve
6. maintain `CAPABILITY_LEDGER.md` breadth-first and build schema/qualification/routing/composition support across all domains
7. qualify Timeline Version Protection, Human-edit-wins stale/rebase, implementation sealing and criterion-level completion
8. production-qualify Project/Media/Edit packs, then Fusion/Color, then Fairlight/Deliver depth-first
9. add content-addressed Analysis Artifacts/Jobs where concrete packs consume them
10. enable Prime/Workers as bounded cognitive parallelism through the same ToolKernel/scheduler
11. add allowlisted UI Automation / Offline Adapter / trusted plugin packs only for explicit qualified gaps
```

Breadth-first inventory prevents architectural blind spots; depth-first production qualification prevents shallow unusable coverage. API method count and page completion are not architecture acceptance criteria.

### 0.7 Upstream reuse and provenance

Use COS as the coherent upper product/runtime source instead of continuing to extract isolated Session/Goal/Loop replacements into CID. Keep COS coding filesystem/terminal/Desktop authority outside the protected Resolve path unless separately approved. Reuse or wrap Samuel domain implementations below CID's own gateway/safety boundary; do not expose its granular inventory directly or let it create a second live Resolve authority.

COS and Samuel are MIT-licensed. Substantial copied/adapted code must preserve the required copyright/license notice and source provenance. CID itself remains `UNLICENSED` today.

### 0.8 World Model, SituationFrame and cognitive locality

The Agent should not rebuild Resolve state from raw tool outputs every turn. CID owns a demand-driven typed Resolve World Model with semantic entity relationships, observation freshness and evidence references.

The model normally sees a compact `SituationFrame` inside a derived DecisionFrame rather than the full World Model:

```text
current project/timeline/page identity
shared focused entity
important deltas since the last observation
active goal/task/plan state
completion gap / missing required evidence
relevant blockers and unknowns
Capability Frontier summary
freshness / in-flight state
```

Exact IDs, raw evidence, credentials, hashes and large cached structures remain local unless a specific decision requires them. Model-visible context is a compiled projection, not a mirror of application memory.

### 0.9 Semantic references and capability packs

Every important object/action/evidence item must be linkable. Agent-facing context prefers a readable label plus a short generation-scoped handle, while CID retains the exact local ID and parent/generation binding. Stale handle resolution fails closed and never becomes authorization.

New production ability grows as a complete vertical `Capability Pack`, not an isolated API wrapper. A pack binds together:

```text
stable semantic capability IDs
entity/relationship semantics
observation recipes
primitive + workflow ActionDescriptors
versioned implementation candidates
Resolve build/version qualification + limitations
World Model invalidation
Context Compiler / Capability Frontier recipe
Plan / ChangeSet / recovery / verification when mutable
Artifact Workspace projection
analysis/evidence recipes when needed
Agent task evaluations
```

Primitive and workflow layers both remain available internally. Dynamic workflow composition is a DAG and must materialize an immutable Plan before the first write. `CAPABILITY_LEDGER.md` records production, qualified, implemented, experimental, planned, unsupported, intentionally excluded and gap states so no known ability silently disappears.

This is the mechanism by which the system can gain hundreds of capabilities without giving the Agent hundreds of unrelated schemas.

### 0.10 Shared human/Agent cockpit

The target desktop shell is no longer “Chat plus peer domain pages”. It is one shared cockpit:

```text
Codex-style Workspace/Session Sidebar | persistent Codex-style Conversation | Resolve Artifact Workspace
                                                                           | Context
                                                                           | Active Artifact
                                                                           | Changes / Plan
                                                                           | Evidence / Inspector
```

CID owns the final renderer projection; COS owns the durable Session/Conversation runtime beneath it. The Sidebar is Workspace-first (`CID Workspace <-> one Resolve Project`) with COS Sessions/Workers nested beneath. The right Active Artifact soft-follows Agent work only when the user is not actively inspecting or Pinning another Artifact. Selection updates `SharedFocus`; changing Resolve UI state requires explicit `Reveal in Resolve` or a declared action. Project/Media/Edit/Fusion/Color/Fairlight/Deliver remain capability-domain lenses, not seven state owners.


## 1. Current repository state

The intended product name is **Chat in DaVinci**.

The currently created local folder and GitHub slug are both:

```text
/Users/qunqing/2026-Project-Agent/chat-in-davinci
https://github.com/R-jed/chat-in-davinci
```

The local project name is now standardized as `chat-in-davinci`. Phase 0 initializes the local Git repository and the minimal read-only transport scaffold. The renamed GitHub URL should be attached as `origin` only after it is reachable.

## 2. Historical original product mission (superseded by section 0)

Chat in DaVinci should be a dedicated local application for using ChatGPT with DaVinci Resolve through Blackmagic's official MCP server, while adding a professional workflow layer that is safer and more deterministic than unconstrained `run_script` calls.

The product should solve two distinct jobs:

1. Give an advanced user direct access to Blackmagic's official Resolve MCP surface when they explicitly want the raw capability.
2. Give normal production chats a small, stable workflow surface that can inspect, plan and execute approved post-production workflows without exposing arbitrary Python or the full raw MCP surface.

The product is successful when professional workflows are repeatable, inspectable and fail closed around ambiguous or high-risk state changes. "The model can control Resolve" is not a sufficient success criterion.

## 3. Facts established during this review

### 3.1 Blackmagic official ResolveMCP

The installed DaVinci Resolve 21.1 bundle contains:

```text
/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Applications/ResolveMCP
```

It is a local stdio MCP server. Its current CLI exposes `--test`, `--dump-tools` and `--pretty` and no HTTP/SSE listener mode.

Its current MCP handshake reports:

```text
serverInfo.name = davinci_resolve
serverInfo.version = 21.1
protocolVersion = 2024-11-05
```

The current official surface exposes 14 tools:

```text
launch_resolve
get_resolve_status
get_whats_new
get_scripting_api
search_scripting_api
run_script
run_script_unsafe
get_scripting_docs
list_dctls
list_luts
update_dctl
delete_dctl
delete_lut
generate_lut
```

The raw schema includes MCP annotations such as `readOnlyHint`, `destructiveHint`, `idempotentHint` and `openWorldHint`. These must be preserved on the raw surface.

The annotations are useful model hints but are not sufficient as a security policy. For example, some operations with observable side effects are not classified the same way a professional production policy would classify them. Chat in DaVinci therefore needs its own workflow risk policy rather than deriving authorization directly from upstream annotations.

### 3.2 Resolve scripting identities are strong enough for plan binding

The installed official 21.1 scripting stubs expose `GetUniqueId()` on at least:

```text
Project
MediaPool
MediaPoolItem
Timeline
TimelineItem
Folder
```

This gives the workflow layer a much stronger precondition than names alone. A plan can bind to an exact project and timeline identity and fail if the user switches either before execution.

The API also exposes current project/timeline/page queries and supports project export and timeline duplication. There is no general project-level Undo API comparable to Fusion composition undo. Rollback must therefore be designed per operation rather than promised as a universal Undo button.

### 3.3 OpenAI Secure MCP Tunnel now supports stdio directly

The current OpenAI `tunnel-client` can launch a local stdio MCP command directly. Current documentation includes the `sample_mcp_stdio_local` profile and `--mcp-command` / `--mcp.command` support.

The COS-bundled tunnel-client on this Mac is currently:

```text
0.0.14+0f870e50a973fa820d4c409000059e181e8d242b
```

Its `run --help` confirms:

```text
--mcp.command
--mcp.stdio-send-initialized-notification
--mcp.max-concurrent-requests
--health.listen-addr
--health.url-file
```

This means the first raw end-to-end proof does not need a custom `stdio -> HTTP` bridge.

There is, however, a current open tunnel-client issue around stdio `tools/call` when initialization has not occurred. The Blackmagic server is known to accept the normal `initialize -> notifications/initialized -> tools/list/tools/call` sequence, so the product should explicitly enable the initialized notification and test this exact lifecycle rather than assuming the generic stdio path is correct for ResolveMCP.

### 3.4 Samuel capability layer is subordinate to CID authority

`samuelgursky/davinci-resolve-mcp` is a third-party MIT project built on Blackmagic's official DaVinci Resolve Scripting API. It is not Blackmagic's official MCP server. In the target architecture it supplies reusable capability/kernel implementation beneath CID across Project, Media, Edit, Fusion, Color, Fairlight and Deliver.

CID may port, wrap or otherwise integrate those implementations behind a CID-owned adapter. The Samuel layer does not own transport, approval, scheduling or Resolve session authority. It must not start a second persistent live Resolve session, expose its granular tool inventory wholesale to COS, or replace CID's exact local plan-hash approval with caller-supplied confirmation flags.

Blackmagic's official Scripting API remains the live capability floor. The concrete live driver is owned by exactly one CID authority at a time.

## 4. CID Tunnel and MCP Gateway boundary

The target product path uses one CID-owned Tunnel into one CID MCP Gateway. COS connects to that boundary; CID then routes calls through protected policy and the single Resolve authority.

```text
COS Chat / Agent
  -> Chat in DaVinci Tunnel
  -> CID MCP Gateway
       -> protected production surface
       -> optional advanced/raw surface kept policy-isolated
  -> ToolKernel / Resolve authority
```

### 4.1 Workflow surface

The protected Workflow surface is the normal production surface behind the single CID Gateway. It exposes only our stable, policy-controlled tools.

Initial target shape:

```text
status
inspect
plan
execute
audit
cancel        (only when a workflow can be safely cancelled)
```

The exact names can be refined during implementation, but the surface should remain small. Domain operations should generally be actions inside these tools rather than dozens of permanently exposed schemas.

The model cannot approve its own plan. Approval is a local application UI action.

### 4.2 Raw/advanced surface

The Raw surface is optional and intended for development, unusual troubleshooting and explicitly unrestricted sessions. It is an internal policy surface of the CID Gateway, not a second required product tunnel.

It should expose the Blackmagic tool list and annotations as faithfully as practical. It should not rename the official tools or duplicate their definitions by hand.

Raw access must remain visually and operationally distinct from protected Workflow because it can contain capabilities such as `run_script_unsafe`, direct DCTL/LUT mutation and arbitrary Resolve scripting.

Normal production setup should not require this connector to be enabled.

### 4.3 One transport does not merge trust levels

One Tunnel does not mean one merged tool namespace. The Gateway must enforce separate protected and advanced/raw policy surfaces so the normal COS Agent cannot bypass Workflow policy by calling unrestricted tools.

The split remains a real authorization boundary inside CID. The target product does not require a second tunnel id for Raw.

## 5. Historical transport build sequence

### Phase 1 transport: direct raw proof

Use OpenAI tunnel-client's native stdio support directly:

```text
ChatGPT
  -> Secure MCP Tunnel
  -> tunnel-client
  -> stdio
  -> Blackmagic ResolveMCP
  -> Resolve
```

Purpose: prove the real account, tunnel, ChatGPT connector and Blackmagic MCP work end to end before building a gateway.

Requirements:

- set the ResolveMCP command by exact path;
- enable stdio initialized notification;
- surface `/healthz` and `/readyz` status in the app;
- verify exact `tools/list` count/names against the local server at runtime;
- call only read-only status/docs tools during the proof;
- do not implement workflow writes in this phase.

### Target product transport: one CID tunnel, one gateway, one Resolve authority

The app owns one CID Tunnel/Gateway path and one authoritative Resolve execution authority.

Target shape:

```text
COS
  -> CID Tunnel
  -> CID MCP Gateway
       -> protected Workflow policy
       -> optional advanced/raw policy
  -> ToolKernel / Action Catalog
  -> ResolveScheduler / ResolveBroker
  -> Samuel-derived/Blackmagic capability adapter
  -> DaVinci Resolve
```

The Gateway exists to preserve CID ownership, routing and safety. Advanced/raw access, when enabled, must still share the same scheduler/broker authority and must never create a second Resolve session.

## 6. ResolveBroker design

`ResolveBroker` is the only component allowed to own the official ResolveMCP child process after the broker phase begins.

Responsibilities:

- locate the official ResolveMCP binary;
- verify the path belongs to the installed Resolve bundle;
- start one stdio child with a scrubbed environment;
- perform the official initialization handshake once;
- send `notifications/initialized`;
- maintain JSON-RPC request ids and a pending map;
- parse newline-delimited stdout JSON;
- keep stderr separate from protocol stdout;
- expose a bounded diagnostic summary without persisting raw scripts by default;
- cache the upstream tool snapshot and schema hash;
- expose calls to the CID-owned scheduler; the broker itself does not claim global stateful-call serialization;
- fail all pending calls if the child exits;
- restart for later new calls with bounded backoff;
- never automatically replay a call that may have already mutated Resolve.

An ambiguous failure after dispatch must be reported as ambiguous. The workflow engine must re-read state and require a new decision rather than retrying automatically.

## 7. Raw surface implementation

When the broker phase begins, use the low-level MCP server API rather than manually rebuilding 14 schemas with Zod.

The external server should speak the current MCP protocol supported by the app's MCP SDK, while these request bodies come from the official upstream snapshot:

```text
tools/list  -> official tool declarations
tools/call  -> ResolveBroker -> official tools/call result
```

The raw handler should reject names not present in the current cached official snapshot.

The goal is to preserve Blackmagic descriptions, JSON Schema and annotations while allowing the outer HTTP server to stay compatible with newer MCP protocol revisions than the current ResolveMCP `2024-11-05` handshake.

If the official tool declaration hash changes after a Resolve update, mark the connector as requiring refresh/reconnect. Do not silently claim that ChatGPT's cached schema is current.

Automatic ChatGPT-side plugin refresh is not an MVP dependency. Current tunnel-client/ChatGPT refresh behavior still has active issues, so the first product should provide a clear manual refresh/recreate instruction when the raw schema changes.

## 8. Workflow surface and execution model

### 8.1 No arbitrary Python on the Workflow surface

The Workflow surface must not expose:

```text
run_script
run_script_unsafe
arbitrary shell
arbitrary filesystem write
```

The workflow engine may internally call official `run_script`, but scripts must come from versioned deterministic templates owned by the application. The model supplies validated parameters, not Python source.

`run_script_unsafe` should be prohibited from the production workflow engine unless a future workflow proves that OS access is essential and receives a separate explicit design review.

### 8.2 Plan -> local approval -> execute

The basic lifecycle is:

```text
inspect
  -> plan
  -> local human approval
  -> execute
  -> readback verification
  -> audit result
```

The model can create and inspect a plan. It cannot approve it.

Approval must occur in the Chat in DaVinci app UI and is stored as a separate local record bound to the exact plan hash.

### 8.3 Immutable plan binding

A plan should include at least:

```text
plan_id
workflow_id
workflow_version
created_at
expires_at
resolve_version
project_unique_id
timeline_unique_id        when applicable
input_fingerprint         when applicable
requested_parameters
proposed_changes
risk_level
required_backup_class
preconditions
plan_hash
```

Execution must re-read the live project/timeline identities and relevant preconditions before the first write.

If project identity, timeline identity, source index, required presets or other signed inputs changed, execution stops and the plan becomes stale.

### 8.4 Approval record

The local approval record should bind:

```text
plan_id
plan_hash
approved_at
expires_at
approved_scope
```

The approval record is not a model-generated token and is not accepted from arbitrary MCP input.

## 9. Rollback model

Do not promise a universal rollback operation. Resolve's scripting API does not provide a general project Undo interface.

Classify workflows by recovery mechanism:

### Class A — read-only

No rollback needed.

Examples: preflight, inventory, QC, capability inspection.

### Class B — compensatable mutation

The workflow records the exact previous value and can restore it through a deterministic inverse operation.

Examples: selected settings, names or markers when a reliable read/write round trip exists.

### Class C — snapshot/duplicate protected mutation

Create a recoverable project/timeline/grade snapshot before the write.

Examples:

- duplicate a timeline before structural edits;
- export a project backup before high-impact project changes;
- capture a grade/node state using an approved mechanism before replacing it.

### Class D — non-automatically reversible

The operation requires local human approval and the UI must say that automatic rollback is not guaranteed.

Never convert an uncertain recovery path into a false "rollback supported" claim.

## 10. Safety policy carried forward from Resolve AI Workflow v2

The earlier workflow document contains useful production policy that should survive into this product:

- source media is immutable by default;
- locked/protected timelines are never modified by an automatic workflow;
- filename-only conform matching is insufficient;
- ambiguous camera metadata goes to `CAM_UNKNOWN`;
- input CST is not duplicated across Group/Clip/Timeline levels;
- Base Tree deployment does not overwrite existing grades automatically;
- final renders require explicit local approval;
- every write is followed by a readback verification;
- identity/schema/readback mismatches stop execution;
- reports distinguish verified, failed and unknown instead of treating "no evidence" as pass.

These policies belong in our Workflow layer, not inside the Blackmagic executable.

## 11. State projection

The original lightweight Resolve snapshot evolves into the demand-driven World Model defined by `AGENT_SYSTEM_SPEC.md`. Keep a cheap standing identity/transport slice, then materialize deeper domain state only when needed.

Cheap standing fields remain useful inputs to `SituationFrame`:

```text
resolve:
  installed
  mcp_path
  mcp_version
  running
  reachable
  current_page

project:
  name
  unique_id

timeline:
  name
  unique_id

world_model:
  generation
  shared_focus
  stale_slices
  important_semantic_delta

transport:
  workflow_tunnel
  raw_tunnel
  health
  ready
  last_openai_handshake
  last_chatgpt_request
  last_tool_call
```

Do not continuously crawl the whole project. Existing `inspect`/workflow readers become evidence-producing observation recipes for missing/stale slices. The standing `SituationFrame` should be cheap; exact/raw evidence remains behind references until needed.

## 12. Tunnel lifecycle

The app should own foreground tunnel-client child processes rather than delegate them to a detached process manager. App shutdown should stop the processes it owns.

Use generated profile files or structured arguments rather than shell-constructed command strings where possible.

Secrets:

- store the OpenAI runtime key in the macOS Keychain;
- pass it to tunnel-client through a secret environment reference;
- never place the key in argv, logs, plan files or audit reports;
- keep tunnel ids in config because they are identifiers rather than secrets.

Health should distinguish:

1. tunnel-client process alive;
2. `/healthz` healthy;
3. `/readyz` ready;
4. OpenAI poll/handshake freshness;
5. ChatGPT actually reached the connector;
6. ChatGPT actually called a tool;
7. ResolveMCP process healthy;
8. Resolve application reachable.

Do not collapse these into a single green/red light.

## 13. Chat On Steroids ownership

Use COS as the upper product/runtime baseline with provenance. Keep its Chat/Session/Agent lifecycle coherent rather than extracting isolated copies into CID.

### Keep under COS ownership

```text
Conversation / Chat state
Session identity and continuation
durable turn/input outbox
Compact & Resume / handoff semantics
Goal / Loop supervisor semantics
Finish lifecycle
Prime / Worker roles
Worker inbox and sleep/revive lifecycle
durable-before-side-effect discipline
session/correlation IDs
crash/restart continuation
Session Sidebar / conversation shell
```

### Continue reusing platform patterns already proven in CID

```text
process environment scrubbing
process-tree termination
Keychain secret storage
logging and redaction conventions
tunnel health interpretation
connection generation / stale callback fencing
tokenized loopback MCP paths
Host/Origin validation
bounded HTTP request bodies
packaging/audit patterns
```

### Keep outside the protected Resolve path

```text
coding filesystem / terminal / generic Desktop authority
coding-oriented generic tools
any COS authority that would bypass CID Tunnel/MCP/ToolKernel/approval
```

The stable integration contract is `COS -> CID Tunnel/MCP Gateway -> ToolKernel`. CID should not keep evolving a parallel Session/TurnRunner/Goal/Loop implementation once the COS-hosted path replaces it.

## 14. Suggested repository layout

Do not create every future directory on day one. This is the target shape as features arrive:

```text
chat-in-davinci/
  AGENTS.md
  README.md
  package.json
  electron-builder.yml

  src/
    main/
      app/
      config/
      secrets/
      logging/

      platform/
        process/
        tunnel/
        mcp-http/

      resolve/
        discover.ts
        broker.ts
        protocol.ts
        state.ts
        tool-snapshot.ts

      mcp/
        surfaces.ts
        raw.ts
        workflow.ts

      workflow/
        engine.ts
        registry.ts
        plan.ts
        approval.ts
        audit.ts
        recovery.ts
        policy.ts
        workflows/

    preload/
    renderer/

  schemas/
  presets/
  docs/
  test/
```

Only directories needed by the current phase should actually be created.

## 15. UI scope

The early utility UI has already grown into a workbench. The forward shell is the shared cockpit:

```text
Codex-style Workspace/Session Sidebar | persistent Codex-style Conversation | Resolve Artifact Workspace
                                                                           | Context
                                                                           | Active Artifact
                                                                           | Changes / Plan
                                                                           | Evidence / Inspector
```

### Workspace / Session Sidebar

- CID Workspace <-> one Resolve Project identity;
- New Chat and COS durable Session/Worker list nested under Workspace;
- Activity/evidence history entry;
- connection/setup status;
- Settings;
- reuse current collapse/peek/resize framework.

### Conversation

- durable user/Agent messages;
- SharedFocus chips and semantic entity/evidence links;
- compact action progress rather than raw tool walls;
- clarification/approval links and composer.

### Resolve Artifact Workspace

- current Project/Timeline context;
- contextual capability/domain lenses inside the Active Artifact;
- semantic objects/relationships/issues/current selection;
- Goal/Plan-grouped ChangeSets in the shared Changes/Plan layer;
- focused evidence/inspector detail.

### Activity / Settings

Activity remains the durable plan/execution/verification trace projection. Settings owns connectors, API-key state, diagnostics and application preferences. Neither becomes a separate state owner.

Do not preserve old Overview/Connectors/Plans/Audit card boundaries merely because they existed in an early shell; redistribute the same facts through the shared semantic system.

## 16. Historical first Workflow tools

Do not start with conform or color writes.

The first Workflow surface should support only read-only proof:

### `status`

Cheap connection and current identity snapshot.

### `inspect`

Action-based read-only inventory, initially:

The implemented slice includes `connection`, `capabilities` and `project`. Project identity uses one app-owned fixed getter-only template through Blackmagic's sandboxed `run_script`; the model cannot supply Python and Workflow does not expose `run_script` or `run_script_unsafe` directly.

```text
project
timeline
media_pool_summary
color_pipeline_summary
render_settings
```

### `inspect_operation`

Read-only pre-flight risk classification for a protected Workflow tool. Unknown or unpublished tools must report risk as unestablished instead of returning a reassuring default.

### `plan`

Initially plan only read-only `project_preflight`. Later it becomes the single entry point for controlled mutations.

### `audit`

Read bounded protected-tool execution summaries. The first implementation stores only tool name, time, duration and success/failure in memory; it does not persist arguments or Resolve results.

`execute` can exist only after a real write workflow is implemented and locally approved.

## 17. Active development architecture

The earlier Phase 0/1 implementation created the current transport and safety baseline. Forward development now follows the Agent Workbench order from section 0.6, not the old read-only phase sequence.

### Foundation before Agent execution

- introduce one CID-owned `ToolKernel` / internal Action Catalog used by local UI, protected MCP and Agent runtime;
- introduce `CallContext` carrying session, caller, target/provenance and execution correlation without granting authority;
- introduce `ResolveScheduler` / lease so page/state-sensitive calls and all mutations cannot race through the broker;
- keep one `ResolveBroker` / one live Resolve driver;
- preserve Raw/Protected separation and the existing plan/hash/local-approval/ledger semantics.

### COS-hosted Agent runtime + CID visual shell

- use COS as the owner of Conversation/Session/turn lifecycle, Goal/Loop/Finish, Compact & Resume and model/Agent orchestration;
- use CID as the owner of the final Codex-style Sidebar/Conversation renderer projection and Resolve Artifact Workspace;
- keep the existing CID Session/TurnRunner path only as migration provenance until the COS-hosted path replaces it;
- connect COS to CID through one Tunnel/MCP Gateway rather than giving COS direct ToolKernel or ResolveBroker authority;
- keep `WorkspaceRef`, `EntityRef`, `EvidenceRef`, Analysis Artifacts, World Model generations, `SituationFrame`, `SharedFocus`, DecisionFrame compilation, Capability Frontier and CompletionReport in CID;
- compile only the minimum sufficient DecisionFrame and relevant ActionOffers for each decision; do not replay full application state by default;
- preserve task-level ACI traces/evaluations so tool/context changes can be measured by verified task success, token/tool/Resolve-call cost and routing error rate;
- bind COS Goal/Loop completion to CID evidence without creating a second CID completion lifecycle;
- prove one COS-hosted Agent can inspect, select a registered action, plan, wait for CID local approval, execute, verify and continue/finish from evidence.

### Shared cockpit

- implement a Codex-style Workspace/Session Sidebar backed by COS durable Session/Worker state and CID Workspace identity;
- keep Conversation persistent in the middle pane and expose a lightweight inspectable model-context projection;
- use the four-layer Resolve Artifact Workspace: Context / Active Artifact / Changes·Plan / Evidence·Inspector;
- treat Project/Media/Edit/Fusion/Color/Fairlight/Deliver as capability lenses rather than peer tabs/state owners;
- link Chat, Artifacts, Plans, ChangeSets, Jobs and Activity through the same `WorkspaceRef`/`EntityRef`/`EvidenceRef` identities;
- represent right-pane selection as main-owned `SharedFocus`, never approval; `Reveal in Resolve` is explicit;
- implement soft-follow with user-first Pin semantics; Agent activity never steals an actively inspected Artifact;
- prefer semantic production views/controls over a fake copy of Resolve's UI; direct controls still enter the same ToolKernel/risk/ChangeSet path.

### Mutation expansion

- behaviorally qualify Timeline Version Protection before structural Edit writes;
- maintain a complete no-silent-gap Capability Ledger breadth-first, then expand executable actions by complete `Capability Pack` vertical slices, not method-count coverage;
- prioritize Project lifecycle, Media ingest/organization and Edit structural operations, then Fusion/Color, Fairlight and Deliver;
- add render/frame/file verification before claiming visual/audio/delivery success.

### Workers and fallbacks

Workers arrive only after ToolKernel, scheduler, Agent System Spine, Context Compiler and evidence-backed single-Agent execution are stable. Workers receive bounded WorkPackets rather than whole-session context; they may analyze in parallel but all Resolve stateful work returns through the same scheduler/Prime authority.

Resolve UI Automation and Offline Adapters are later explicit fallback tiers for proven public-API gaps. They are not automatic compatibility shims.

## 18. Test strategy

Keep tests tied to accepted behavior.

### Transport tests

- Blackmagic stdio handshake;
- newline JSON framing;
- initialized notification;
- upstream tools/list snapshot;
- child exit while a call is pending;
- no automatic retry after ambiguous dispatch;
- tunnel health/readiness parsing.

### Surface tests

- Raw contains only official snapshot tools;
- Workflow contains only our declared tools;
- cross-surface tool calls fail;
- upstream annotations survive Raw tools/list;
- schema hash changes are detected.

### Workflow safety tests

- project/timeline ID mismatch blocks execution;
- plan hash mismatch blocks execution;
- expired approval blocks execution;
- model input cannot manufacture approval;
- protected timeline blocks mutation;
- source path policy blocks disallowed writes;
- readback mismatch stops subsequent steps;
- ambiguous mutation is not replayed.

### Resolve sandbox tests

Use disposable Resolve projects for live write tests. Never use an active production project as the automated test fixture.

## 19. Permanent non-goals and prohibited shortcuts

The following remain outside the protected production architecture unless a separate explicit design changes the rule:

- exposing hundreds of granular Resolve methods as normal Agent tools;
- arbitrary model-authored Python or shell through Protected Workflow;
- `run_script_unsafe` on the protected Agent path;
- a second simultaneous live Resolve scripting authority;
- caller-supplied `confirm`, `allow_render` or generic dry-run flags as authorization;
- a fake dry run that can still mutate;
- universal rollback/Undo claims;
- source-media modification by default;
- silent UI Automation fallback;
- silent offline project/database/DRP/DRT/DRX mutation;
- claiming API readback proves pixels, audio quality or final-file compliance when stronger verification is required.

Multi-Agent, Goal/Loop, Compact & Resume and session orchestration are now explicit product goals, not non-goals.

## 20. Major decisions to preserve during implementation

1. Chat in DaVinci is an Agent workbench, not only an MCP bridge or read-only QC utility.
2. `AGENT_SYSTEM_SPEC.md` defines the system as a linked abstraction tower; component-local designs must not create parallel truth or context paths.
3. COS owns ChatGPT Web/Conversation/Session/Turn/Goal/Loop/Finish/Compact & Resume/Prime-Worker/model-agent runtime; CID owns the final Codex-style renderer projection.
4. Samuel's third-party project contributes subordinate Resolve capability/kernel implementation beneath CID; it is not a second live authority.
5. Blackmagic's official Scripting API is the primary live capability floor.
6. Exactly one CID-owned Resolve authority is live at a time.
7. All DaVinci execution originating from COS, local CID UI projections and protected MCP converges on one ToolKernel/Action Catalog.
8. The Resolve World Model is the canonical semantic projection of current observed Resolve state; the UI and Agent both consume it.
9. `SituationFrame` -> derived `DecisionFrame`/ContextPack + state-bound Capability Frontier, not the full world/project/session/tool inventory, is the normal model-visible context path.
10. Every important Resolve object/action/evidence item is semantically linkable; readable handles remain locally bound and are never authorization.
11. Capability grows through complete vertical Capability Packs with stable semantic IDs, primitive+workflow layers, versioned implementations, build-specific qualification, ChangeSet/evidence/UI/evaluation semantics kept together; all known gaps remain in the Capability Ledger.
12. Page/state-sensitive Resolve work and all mutations cross one ResolveScheduler/lease.
13. Raw and Protected surfaces remain separate; Protected never exposes arbitrary Python.
14. Human approval occurs locally and binds the exact immutable plan hash.
15. Potentially dispatched mutations are never automatically retried.
16. Recovery is operation-specific; structural timeline version protection is not universal Undo.
17. Verification level is truthful: execution and verification are separate; every protected mutation has a Goal/Plan-grouped ChangeSet, and state-changing Goal completion is criterion-level through a derived CompletionReport.
18. Workers may analyze concurrently but receive bounded WorkPackets and never bypass the shared ToolKernel/scheduler or hold raw broker authority.
19. UI Automation and Offline Adapters are explicit, isolated fallback tiers for proven API gaps.
20. Substantial MIT-licensed upstream adaptations retain required notices and provenance.

## 21. Recommended immediate next code step

The current CID Chat/Session/TurnRunner path remains migration provenance. The next architecture slice is not “copy the COS renderer”; it is to bind the real COS runtime while establishing CID's final Workspace/Codex-style presentation and closing the semantic control loop:

```text
COS ChatGPT / Session / Goal / Worker runtime
  -> CID Workspace identity + COS GoalFrame + CID SituationFrame
  -> DecisionFrame / Capability Frontier
  -> one CID Tunnel / MCP Gateway
  -> ToolKernel / Plan / ChangeSet / Evidence
  -> ResolveScheduler / one Active Resolve Target
  -> best-qualified implementation / Resolve
  -> SemanticDelta / World Model / CompletionReport

CID renderer
  -> Codex-style Workspace/Session Sidebar from Workspace + COS Session state
  -> Codex-style Conversation from COS event state
  -> four-layer Resolve Artifact Workspace from CID semantic state
```

Acceptance for this slice is System-level: no parallel Session lifecycle; Workspace<->Resolve Project binding is stable; one bounded model decision receives a real DecisionFrame/ActionOffer set; one observation or protected mutation updates the same semantic graph/ChangeSet seen by Agent and UI; no right-pane interaction bypasses ToolKernel; and existing writer ambiguity/no-replay guarantees remain intact.

## 22. Historical Phase 0 implementation progress — 2026-09-08

Implemented in the local `chat-in-davinci` repository:

- minimal Electron + TypeScript application scaffold;
- project-level `AGENTS.md` with the Phase 0 read-only boundary;
- Blackmagic `ResolveMCP` discovery at the official application-bundle path;
- real MCP `initialize -> notifications/initialized -> tools/list -> tools/call(get_resolve_status)` probe;
- runtime capture of official server name/version/protocol and tool names;
- Keychain-backed storage for the OpenAI tunnel API key;
- config persistence for tunnel id and optional tunnel-client path;
- shell-free owned-child process spawning and process-group teardown on macOS;
- OpenAI tunnel-client start/stop using native stdio MCP support;
- local health/readiness/status/last-poll projection;
- minimal Overview/Setup/Activity UI;
- redacted bounded activity logging;
- explicit cached Resolve state so normal health refresh does not repeatedly spawn ResolveMCP;
- live ResolveMCP smoke test plus typecheck, unit tests and production build.

Verified locally:

```text
npm run verify      PASS
npm run test:live   PASS
Electron dev window launches successfully
dev shutdown leaves no Chat in DaVinci / ResolveMCP child processes behind
```

The live Resolve smoke observed:

```text
serverInfo.name    davinci_resolve
protocolVersion    2024-11-05
official tools     14
get_resolve_status successful
```

Remaining Phase 0 acceptance work is external setup rather than a known source failure:

1. The intended renamed GitHub remote `https://github.com/R-jed/chat-in-davinci` currently returns `Repository not found`, while the old empty `R-jed/chat-in-davinc` repository still responds. The local repository intentionally has no `origin` until the intended remote is reachable.
2. A dedicated OpenAI Secure MCP Tunnel id and its API key must be entered into Chat in DaVinci. Existing Chat On Steroids Tets tunnel ids/processes and credentials are deliberately not reused or disturbed.
3. With that dedicated tunnel connected, finish the Phase 0 end-to-end gate in ChatGPT: discover the official schemas/annotations and call `get_resolve_status` through the actual Secure MCP Tunnel.
