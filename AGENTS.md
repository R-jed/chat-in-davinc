# Chat in DaVinci

This project is a local Agent workbench for DaVinci Resolve. The target product uses Chat On Steroids (COS) as the upper ChatGPT/Conversation/Session/Goal/Agent runtime foundation, while Chat in DaVinci (CID) owns the final Codex-style renderer projection, Workspace identity, DaVinci transport, MCP gateway, capability/safety/domain stack and single Resolve authority.

## Product direction

- Target domains are Project, Media, Edit, Fusion, Color, Fairlight and Deliver.
- Maintain `docs/development/CAPABILITY_LEDGER.md` as the no-silent-gap breadth-first inventory across Project, Media, Edit, Fusion, Color, Fairlight and Deliver. API-reachable, local-analysis, offline-adapter, allowlisted UI-Automation and trusted-plugin candidates all get explicit lifecycle status; only fully contracted/qualified capabilities become production Agent actions.
- COS is the upper runtime foundation for ChatGPT Web, Conversation/Session, durable turn/input, Goal/Loop/Finish, Compact & Resume, continuation, Prime/Worker, inbox and model/Agent orchestration. CID owns the final Codex-style Sidebar/Conversation renderer projection; never confuse COS runtime ownership with final visual ownership or recreate a parallel CID lifecycle.
- CID owns the DaVinci boundary below COS: its Tunnel, MCP Gateway, Context Compiler, Resolve World Model, Action Catalog/ToolKernel, capability qualification, plan/approval/verification/evidence stack, ResolveScheduler and ResolveBroker.
- `samuelgursky/davinci-resolve-mcp` is a third-party MIT implementation source built on Blackmagic's official Scripting API. Integrate its useful Project/Media/Edit/Fusion/Color/Fairlight/Deliver capability/kernel implementation underneath the CID authority boundary; do not let it become a second persistent Resolve authority or expose its granular inventory wholesale to the normal Agent.
- Blackmagic's official DaVinci Resolve Scripting API remains the primary live capability floor. Any concrete driver below CID must be subordinate to the same single-authority scheduler/broker policy.

## Agent-native system invariants

- `docs/development/AGENT_SYSTEM_SPEC.md` is the canonical system-level design for Agent ergonomics, context architecture, the Resolve World Model, linked semantic references, capability growth and the shared human/Agent cockpit.
- Treat Chat in DaVinci as one synthetic closed control system, not a set of pages/tools/services: `GoalFrame/TaskGraph -> SituationFrame/SharedFocus -> DecisionFrame -> Capability Frontier/ActionOffer -> Plan/ChangeSet -> Evidence/SemanticDelta -> World Model/CompletionReport -> next decision`, with ToolKernel/Scheduler/Resolve authority as the single execution lane beneath it.
- Keep deterministic machine state local. Exact IDs, full cached observations, raw evidence, credentials, approval state and scheduler state must not be copied into model context merely because they exist.
- Model-visible context is compiled per decision. Prefer the exact goal criterion, current `SituationFrame` including SharedFocus/completion gap, recent semantic deltas and state-bound `ActionOffer`s over replaying full transcripts, full project snapshots or the whole Action Catalog. Data that cannot change the next decision stays local.
- Human and Agent views must resolve to the same Workspace/Entity/Plan/ChangeSet/Job/Evidence identities. The right UI is always Context / Active Artifact / Changes·Plan / Evidence·Inspector; Project/Media/Edit/Fusion/Color/Fairlight/Deliver are capability lenses, not seven independent state owners.
- World Model facts must preserve epistemic state (`observed / derived_deterministic / model_inference / user_asserted / unknown / contradicted`) and provenance. Model inference never silently becomes observed truth; proposed Plan effects stay in a separate prospective overlay until execution + declared verification establish current state.
- Prefer readable semantic handles plus local exact-ID binding. Friendly handles are references, not authorization; stale generation/parent identity must fail closed.
- Preserve the current small protected verb surface unless Agent evaluations show that a change improves routing. New Resolve ability normally grows behind the Action Catalog rather than by adding another model-visible tool.
- New capability should be designed as a complete vertical `Capability Pack`: stable semantic IDs, entities/observations, primitive+workflow ActionDescriptors, versioned implementation candidates, build-specific qualification, context/frontier recipe, invalidation, Artifact projection, Plan/ChangeSet, verification/recovery and Agent task evaluations. Isolated API wrappers never become production capability by themselves.
- Goal completion for state-changing work is evidence-backed. Model text saying work is complete is not proof that Resolve state, pixels, audio or a produced file meet the goal.
- User interruption/redirection is first-class. Safe pending model/read work may stop; a potentially dispatched mutation follows the existing ambiguous/no-replay state machine and must not be described as cancelled merely because the conversation changed direction.
- Optimize in this order: correctness/safety, user intent, semantic completeness, recoverability, minimum user interruption, minimum context load, minimum Resolve/API work, then latency/monetary cost.
- Before broad Goal/Loop, Worker or writer expansion, establish the World Model / `SituationFrame` / `SharedFocus` / Context Compiler spine and baseline Agent-computer-interface evaluations.
- Every protected mutation produces a Goal/Plan-grouped `ChangeSet`; `Executed` and `Verified` are separate states. Human edits win: external target/fingerprint drift makes dependent Plans stale and Rebase creates a new immutable Plan.
- Capability routing is `best-qualified wins; official wins ties`. Implementation identity/version and qualification are sealed into an approved Plan; no silent reroute. UI Automation is capability-specific allowlisted fallback, never generic computer control.
- CID Workspace identity is one-to-one with Resolve Project identity. Cross-project Goals reference multiple Workspaces, while stateful Resolve execution has exactly one Active Resolve Target at a time.
- Model improvement never automatically raises autonomy. Authorization stays bounded to Goal + exact Workspace/target + capability set + risk ceiling.
- Workspace-owned Analysis Artifacts/Jobs may outlive a Session and resume when read-only/deterministic; protected write authority never auto-crosses restart or reconnect.

## Authority boundaries

- One CID-owned Resolve authority is mandatory. No Agent, Worker, UI page, tunnel, verifier or helper may create or hold a parallel long-lived Resolve scripting session.
- All DaVinci requests from COS, local CID UI projections and protected MCP converge on one `ToolKernel` / action registry and one `CallContext` model.
- Stateful Resolve work crosses a `ResolveScheduler`/lease before `ResolveBroker`. Page-changing calls, current-project/current-timeline-dependent calls, renders and all mutations are serialized as required by their contract.
- Workers may analyze, read independent local artifacts and prepare candidate plans concurrently. Workers never receive raw `ResolveBroker` authority and never dispatch Resolve mutations directly.
- The protected model-facing surface remains small and stable. Current public tools are `status`, `inspect`, `inspect_operation`, `audit`, `plan`, `execute`.
- Protected Workflow never exposes `run_script`, `run_script_unsafe`, arbitrary Python or arbitrary shell. Model input is structured and validated.
- Raw remains a separate advanced official surface and must never be presented as protected by Workflow policy.

## Execution safety

- Source media is immutable by default.
- Protected timelines are never modified automatically.
- Every protected writer is registered with risk, blast radius, preview, approval, recovery and verification metadata before it can dispatch.
- Approval is local application state bound to the exact immutable plan hash. Caller-supplied `confirm` flags or model-authored approval tokens do not authorize a write.
- Persist `dispatch_started` before a side effect. A potentially dispatched mutation is never replayed automatically after ambiguous transport failure or restart.
- Readback proves only its declared level. Visual claims may require `RENDER_VERIFIED`; final delivery claims require `DELIVERABLE_VERIFIED` against the produced file.
- Structural timeline mutations require a verified duplicate/archive/version identity before dispatch when their workflow declares version protection. This is backup/version protection, not universal Undo.
- Public Scripting API coverage is not 100% Resolve UI parity. Proven hard gaps may use explicit Resolve UI Automation or a separately isolated Offline Adapter only with their own permission, approval, recovery and provenance contract.

## Upstream and licensing

- Chat On Steroids and `samuelgursky/davinci-resolve-mcp` are MIT-licensed upstream sources. Preserve required copyright/license notices and provenance for substantial copied or adapted code.
- Keep COS upper-layer ownership coherent. Do not recreate a second CID Chat/Session/Goal/Loop/Compact & Resume runtime beside it.
- Do not carry COS coding filesystem/terminal/Desktop authority into the protected Resolve path unless separately designed and authorized.
- Samuel-derived capability code remains subordinate to CID's Tunnel/MCP/safety/Resolve authority; do not publish hundreds of granular actions to the normal Agent or create a second live Resolve session.

## Development rules

- Current user instruction, exact current source/runtime evidence, and qualified Resolve behavior outrank old milestone order.
- Read the actual call path before changing behavior. Prefer the smallest implementation that proves the accepted requirement.
- Before multi-Agent work, establish the unified `ToolKernel` and `ResolveScheduler`; otherwise Agent execution would become a third authority path.
- Add tests only for accepted behavior not already covered. Use disposable Resolve projects for live writes.
- Do not `git clean`, `git reset`, delete untracked work, package, install, commit, push or publish unless explicitly requested.
