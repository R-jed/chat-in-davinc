# Chat in DaVinci — Capability Ledger

Date: 2026-09-13

Status: canonical breadth-first inventory of known semantic capabilities and explicit gaps; not a runtime executability list

## 1. Authority and purpose

This ledger answers one question: **what does Chat in DaVinci know it should eventually be able to understand or do, and what is the exact current lifecycle state of that ability?** It exists so capability growth never depends on memory, page-by-page implementation order or whichever API wrapper was added most recently.

Authority split:

- `CAPABILITY_LEDGER.md` is authoritative for the breadth-first inventory, stable semantic capability IDs and lifecycle/gap state.
- `WORKFLOW_CATALOG.md` is authoritative for Capability/ActionDescriptor/implementation contract shape and the current protected executable workflow subset.
- `EXECUTION_SECURITY_SPEC.md` is authoritative for risk, immutable Plan, approval, ChangeSet, dispatch, ambiguity, recovery and verification semantics.
- runtime registries and qualification evidence are authoritative for what can actually dispatch on a concrete Resolve build.

A row in this file is **not** permission to execute. `qualified` means behavioral evidence exists for the stated capability/build; `production` additionally requires the complete vertical Capability Pack and release admission defined by the system specs. The current reset deliberately does not relabel existing readers/writers as `production` until that full contract is re-accepted.

## 2. Ledger invariants

1. Stable IDs describe user/Agent semantics, never provider names, MCP verbs, Python helpers or UI coordinates.
2. Primitive and workflow layers both remain explicit. Workflows may compose capabilities as a DAG; mutation graphs materialize as immutable Plans before the first write.
3. Concrete implementations are separately versioned and build-qualified. Routing is `best-qualified wins; official wins ties`; UI Automation is capability-specific last resort.
4. Every known important capability or hard gap has an explicit lifecycle state. There are no silent gaps.
5. The model never receives this entire ledger by default. The Context Compiler projects only the state-bound Capability Frontier/ActionOffers needed for one DecisionFrame.
6. Model strength never changes capability lifecycle, qualification, risk policy or autonomy by itself.
7. Source media remains immutable unless an explicitly specified derivative workflow says otherwise.
8. A protected mutation is not complete until its ChangeSet reaches the required verification state.

Lifecycle vocabulary is the canonical vocabulary defined in `WORKFLOW_CATALOG.md`: `production`, `qualified`, `implemented`, `experimental`, `planned`, `unsupported`, `intentionally_excluded`, `api_gap`, `ui_automation_candidate`.

## 3. Coverage snapshot

| Domain | Total | production | qualified | implemented | experimental | planned | unsupported | intentionally_excluded | api_gap | ui_automation_candidate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Project | 13 | 0 | 2 | 1 | 0 | 10 | 0 | 0 | 0 | 0 |
| Media | 31 | 0 | 4 | 0 | 0 | 26 | 0 | 0 | 1 | 0 |
| Edit | 39 | 0 | 7 | 1 | 0 | 30 | 0 | 0 | 1 | 0 |
| Fusion | 17 | 0 | 2 | 0 | 0 | 14 | 0 | 1 | 0 | 0 |
| Color | 20 | 0 | 4 | 0 | 0 | 15 | 0 | 0 | 1 | 0 |
| Fairlight | 18 | 0 | 2 | 0 | 0 | 12 | 0 | 0 | 3 | 1 |
| Deliver | 19 | 0 | 4 | 0 | 0 | 11 | 0 | 0 | 4 | 0 |
| Cross-domain support | 9 | 0 | 0 | 0 | 0 | 9 | 0 | 0 | 0 | 0 |
| **Total** | **166** | **0** | **25** | **2** | **0** | **127** | **0** | **1** | **10** | **1** |

> Coverage counts are inventory counts, not a product-completeness score. A `planned` or `api_gap` row is valuable because it prevents the ability from disappearing from architecture.

## 4. Project

| Capability ID | Layer | State | Mode | Current implementation / evidence | Required evidence / verification | Main constraint / note |
| --- | --- | --- | --- | --- | --- | --- |
| `project.identity.inspect` | primitive | implemented | read | workflow `project.identity.v1` | API_READBACK | Current Project/Timeline identity reader exists; keep `implemented` until this semantic capability is re-qualified under the new ledger contract. |
| `project.settings.inspect` | primitive | qualified | read | workflow `project.settings_summary.v1`; official Scripting API | API_READBACK | Resolve 21.1 live-validated bounded project/timeline settings. |
| `project.preflight` | workflow | qualified | read | workflow `project.preflight.v1`; composes qualified domain readers | STRUCTURAL_READBACK | Resolve 21.1 live-validated; supports general/media/edit/fusion/color/fairlight/delivery profiles. |
| `project.lifecycle.capabilities.inspect` | primitive | planned | read | workflow design `project.lifecycle_capabilities.v1` | API_READBACK | Inventory only the lifecycle/preset/backup surfaces needed by product behavior. |
| `project.create` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Must bind the resulting Resolve Project to exactly one CID Workspace. |
| `project.open` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Project switch is an explicit side effect; never caused by Sidebar selection alone. |
| `project.save` | primitive | planned | write | official/Samuel-derived candidate | API_READBACK | Requires exact active Workspace/Project binding. |
| `project.close` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Must preserve Session/Workspace identity and fail closed on mismatch. |
| `project.import` | workflow | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Source-safe import with explicit destination/project identity. |
| `project.export` | workflow | planned | write | official/Samuel-derived candidate | DELIVERABLE_VERIFIED | Export artifact must be located/verified when the workflow promises a file. |
| `project.archive` | workflow | planned | write | official/Samuel-derived candidate | DELIVERABLE_VERIFIED | Archive is consequential and needs explicit output/recovery semantics. |
| `project.restore` | workflow | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Restore must create/rebind exact project identity without silently replacing another Workspace. |
| `project.delete` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Known high-risk lifecycle ability; never automatic, always full Workspace review/local approval, exact identity and recovery/backup policy. |

## 5. Media

| Capability ID | Layer | State | Mode | Current implementation / evidence | Required evidence / verification | Main constraint / note |
| --- | --- | --- | --- | --- | --- | --- |
| `media.inventory.inspect` | primitive | qualified | read | workflow `media.inventory_summary.v1` | STRUCTURAL_READBACK | Resolve 21.1 live-validated bounded Media Pool traversal; truncation explicit. |
| `media.item.inspect` | primitive | qualified | read | workflow `media.clip_inspect.v1` | API_READBACK | Resolve 21.1 live-validated exact MediaPoolItem inspection. |
| `media.metadata.inspect` | primitive | qualified | read | same implementation as `media.clip_inspect.v1` | API_READBACK | Selected-item metadata is already qualified; do not add a duplicate reader. |
| `media.link.capabilities.inspect` | primitive | qualified | read | workflow `media.link_status.v1` | API_READBACK | Resolve 21.1 observed relink/unlink/proxy/full-resolution method surfaces; no writes admitted. |
| `media.image_sequence.inspect` | primitive | planned | read | Media Pool/property analysis candidate | analysis evidence | Explicitly distinguish image-sequence/source grouping when the available metadata can prove it. |
| `media.duplicate_candidates.analyze` | workflow | planned | read | content fingerprint/metadata analysis candidate | analysis evidence | Candidate duplicates are evidence-ranked findings, never automatic destructive cleanup. |
| `media.source_reference.inspect` | primitive | planned | read | local Resolve/source-reference adapter | API_READBACK | Exact source/path evidence stays local by default; model receives semantic handles unless the decision truly needs path detail. |
| `media.multicam_candidates.inspect` | workflow | planned | read | source metadata + edit/mapping observations | STRUCTURAL_READBACK | Candidate angle evidence for multicam preparation; does not create a multicam timeline. |
| `media.sync_candidates.inspect` | workflow | planned | read | timecode/audio/duration observations | STRUCTURAL_READBACK | Candidate sync evidence keeps timecode, source overlap and existing-sync uncertainty explicit. |
| `media.ingest.plan` | workflow | planned | read | workflow design `media.ingest_plan.v1` | plan artifact; execution verified separately | Validates source candidates and destination before any ingest writer. |
| `media.ingest.execute` | workflow | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Source-safe ingest; no camera-original mutation. |
| `media.bin.create` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Part of complete bins/organization capability. |
| `media.item.move` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Exact item/bin identities; suitable for deterministic organization. |
| `media.organize` | workflow | planned | write | workflow design `media.organize_plan.v1` + primitives | STRUCTURAL_READBACK | Semantic bin/folder organization and optional metadata normalization. |
| `media.metadata.update` | primitive | planned | write | workflow design `media.metadata_update.v1` | API_READBACK | Only fields with proven read/write symmetry may become production. |
| `media.marker.add` | primitive | planned | write | MediaPoolItem annotation candidate | API_READBACK | Source-item annotation only; exact item/frame identity and existing marker state required. |
| `media.marker.remove` | primitive | planned | write | MediaPoolItem annotation candidate | API_READBACK | Exact marker identity required; no blanket clear. |
| `media.flag.set` | primitive | planned | write | MediaPoolItem annotation candidate | API_READBACK | Supports organization/review without changing source media. |
| `media.clip_color.set` | primitive | planned | write | MediaPoolItem annotation candidate | API_READBACK | Semantic review/organization action; exact prior state recorded in ChangeSet. |
| `media.relink.plan` | workflow | planned | read | workflow design `media.relink_plan.v1` | STRUCTURAL_READBACK | Ambiguous source matches remain explicit; filenames alone are insufficient. |
| `media.relink.execute` | workflow | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Exact source/target identity required; relink is not a blind path substitution. |
| `media.unlink.execute` | primitive | planned | write | observed official `MediaPool.UnlinkClips` surface | STRUCTURAL_READBACK | Method presence is not writer qualification. |
| `media.proxy.link` | primitive | planned | write | observed official `MediaPoolItem.LinkProxyMedia` surface | API_READBACK | Requires source/proxy identity validation and explicit write contract. |
| `media.proxy.unlink` | primitive | planned | write | observed official `MediaPoolItem.UnlinkProxyMedia` surface | API_READBACK | Requires exact target and current-link readback where available. |
| `media.full_resolution.link` | primitive | planned | write | observed official `MediaPoolItem.LinkFullResolutionMedia` surface | API_READBACK | Current full-resolution-link state lacks a qualified dedicated getter. |
| `media.full_resolution.state.inspect` | primitive | api_gap | read | no qualified dedicated getter on current Resolve 21.1 evidence | API_READBACK | Do not infer state from method presence or path-shaped values. |
| `media.proxy_or_optimized.generate` | workflow | planned | write | implementation candidate not yet qualified | STRUCTURAL_READBACK | Known production ability; current Protected surface does not expose generation. |
| `media.review.decision.local` | primitive | planned | local | CID Workspace/Artifact state | local evidence | Select/favorite/reject/compare decisions remain local and do not dirty Resolve. |
| `media.review.commit` | workflow | planned | write | CID review state -> registered Resolve writers | STRUCTURAL_READBACK | Commits selected review decisions only through an explicit Plan/ChangeSet. |
| `media.review_report.generate` | workflow | planned | local | CID review decisions + annotations + evidence | analysis evidence | Produces a durable review artifact without mutating Resolve. |
| `media.marker_thumbnail_qc` | workflow | planned | read | marker + frame-sample analysis | analysis evidence | Associates marker positions with bounded visual evidence for review/QC. |

## 6. Edit

| Capability ID | Layer | State | Mode | Current implementation / evidence | Required evidence / verification | Main constraint / note |
| --- | --- | --- | --- | --- | --- | --- |
| `edit.timeline.inspect` | primitive | qualified | read | workflow `edit.timeline_summary.v1` | STRUCTURAL_READBACK | Resolve 21.1 live-validated bounded timeline readiness. |
| `edit.timeline.structure.inspect` | primitive | qualified | read | workflow `edit.structure_inspect.v1` | STRUCTURAL_READBACK | Resolve 21.1 live-validated exact bounded item/range identities. |
| `edit.timeline.gaps_overlaps.inspect` | primitive | qualified | read | workflow `edit.gaps_overlaps.v1` | STRUCTURAL_READBACK | Definite/ambiguous boundaries kept distinct. |
| `edit.clip.source_range.inspect` | primitive | qualified | read | workflow `edit.source_range_report.v1` | STRUCTURAL_READBACK | Raw source/record ranges only; no fabricated conform arithmetic. |
| `edit.transition.inspect` | primitive | implemented | read | workflow `edit.transition_inspect.v1` | API_READBACK | Current code qualifies fade getter evidence but does not yet establish applied transition state; keep the broader semantic capability below `qualified`. |
| `edit.fade.inspect` | primitive | qualified | read | workflow `edit.transition_inspect.v1` (`GetFades`) | API_READBACK | Resolve 21.1 live-validated raw FadeIn/FadeOut getter evidence; units/meaning remain contract-limited. |
| `edit.review_annotations.inspect` | primitive | qualified | read | workflow `edit.review_annotations_inspect.v1` | API_READBACK | Timeline/item/source annotations; bounded and path-safe. |
| `edit.marker.add` | primitive | qualified | write | workflow `edit.review_marker_add.v1` | API_READBACK | First live-qualified protected writer; remains exact-item/local-approval scoped alongside the newer structural track-add writer. |
| `edit.marker.remove` | primitive | planned | write | workflow design `edit.review_marker_remove.v1` | API_READBACK | Deterministic compensation candidate; exact marker identity required. |
| `edit.marker.copy` | workflow | planned | write | annotation primitives + exact source/destination targets | API_READBACK | Copies selected markers only; never a blind whole-timeline overwrite. |
| `edit.review_report.generate` | workflow | planned | local | edit annotations + ChangeSets + evidence | analysis evidence | Produces review/report artifacts without changing timeline state. |
| `edit.multicam.preflight` | workflow | planned | read | workflow design `edit.multicam_preflight.v1` | STRUCTURAL_READBACK | Checks source/timeline readiness without building multicam state. |
| `edit.sync.preflight` | workflow | planned | read | workflow design `edit.sync_preflight.v1` | STRUCTURAL_READBACK | Separates measurable sync readiness from mutation. |
| `edit.sync.propose` | workflow | planned | read | sync preflight + marker/timecode/audio evidence | plan artifact; execution verified separately | Produces marker/timecode/native-sync proposals while preserving ambiguity. |
| `edit.multicam.prep_timeline` | workflow | planned | write | qualified timeline primitives + multicam preflight | STRUCTURAL_READBACK | Optional stacked/prep timeline is a protected structural edit, not hidden setup. |
| `edit.conform.plan` | workflow | planned | read | workflow design `edit.conform_plan.v1` | plan artifact; execution verified separately | Exact identity/timecode/source-range matching; ambiguity stays explicit. |
| `edit.conform.execute` | workflow | planned | write | workflow design `edit.conform_execute.v1` | STRUCTURAL_READBACK | Structural mutation requires timeline/version protection. |
| `edit.repull.plan` | workflow | planned | read | conform/lineage primitives + timeline diff | plan artifact; execution verified separately | Roundtrip/repull is a first-class deterministic editorial workflow. |
| `edit.repull.execute` | workflow | planned | write | conform/lineage primitives | STRUCTURAL_READBACK | Applies a newly approved repull Plan to a protected exact timeline target. |
| `edit.timeline.structural_variant` | workflow | planned | write | workflow design `edit.structural_variant.v1` | STRUCTURAL_READBACK | Creates/uses a protected edit variant before structural Agent work. |
| `edit.timeline.create` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Complete timeline lifecycle target. |
| `edit.timeline.duplicate` | primitive | planned | write | official API; Resolve 21.1 live-qualified internal primitive | STRUCTURAL_READBACK | Disposable `test` qualification confirmed distinct duplicate identity, duplicate-becomes-current behavior, exact original restore/readback, unchanged source structure and retained duplicate. Still not public/production-registered. |
| `edit.timeline.version.create` | workflow | planned | write | qualified duplicate/restore primitive + durable backup ledger strategy | STRUCTURAL_READBACK | The backup primitive is qualified and is now consumed internally by registered structural workflow `edit.track_add.v1`. It remains non-public as a standalone workflow; callers cannot request arbitrary timeline duplication through the protected connector. |
| `edit.track.add` | primitive | qualified | write | protected workflow `edit.track_add.v1`; Resolve 21.1 live-qualified append-empty-video-track writer | STRUCTURAL_READBACK | Public protected `plan()` accepts only current timeline + VIDEO + append; local exact-plan approval is required; public `execute(planId)` creates/verifies the mandatory Class C timeline backup before the fixed writer can dispatch. Disposable Resolve 21.1 qualification confirmed TS/Python fingerprint equality, `AddTrack("video")`, exact empty-track readback, exact cleanup fingerprint restoration and original user project/timeline restoration. The six public protected verbs remain unchanged; this adds a second qualified writer contract, not a new generic mutation surface. |
| `edit.clip.insert` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Exact source item/range/record target. |
| `edit.clip.move` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Must declare ripple/overwrite semantics explicitly. |
| `edit.clip.copy` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Source and destination identities remain separate. |
| `edit.clip.delete` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Structural delete requires protected target/version policy. |
| `edit.clip.trim` | primitive | planned | write | semantic contract; implementation candidate pending qualification | STRUCTURAL_READBACK | Stable semantic capability ID; implementation may vary by Resolve build. |
| `edit.clip.ripple` | workflow | planned | write | implementation candidate pending qualification | STRUCTURAL_READBACK | Only when exact ripple semantics can be qualified. |
| `edit.transition.add` | primitive | planned | write | observed official `AddTransition` surface | STRUCTURAL_READBACK | Method presence is not qualification; visual semantics may require stronger evidence. |
| `edit.fade.set` | primitive | planned | write | observed official `SetFades` surface | API_READBACK | Units/semantics must be qualified before production. |
| `edit.retime.set` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Speed/freeze/reverse/ripple/pitch behavior must be qualified separately. |
| `edit.title.manage` | workflow | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Create/update title objects without exposing arbitrary Fusion code. |
| `edit.subtitle.manage` | workflow | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Subtitle creation/import/edit/export state needs explicit contracts. |
| `edit.multicam.build` | workflow | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Uses preflight evidence and protected timeline target. |
| `edit.sync.execute` | workflow | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Sync strategy and affected objects must be explicit in Plan. |
| `edit.lineage.inspect` | primitive | planned | read | World Model/timeline version history candidate | STRUCTURAL_READBACK | Needed for conform/repull/version reasoning. |
| `edit.rough_cut.build` | workflow | planned | write | hybrid model decision + qualified edit primitives | STRUCTURAL_READBACK | Creative selection may be model inference; execution stays deterministic and Goal-scoped. |
| `edit.clip.split` | primitive | api_gap | write | no qualified official razor/split primitive in current design evidence | STRUCTURAL_READBACK | Do not invent a fake primitive; future qualified fallback may change state. |

## 7. Fusion

| Capability ID | Layer | State | Mode | Current implementation / evidence | Required evidence / verification | Main constraint / note |
| --- | --- | --- | --- | --- | --- | --- |
| `fusion.composition.inspect` | primitive | qualified | read | workflow `fusion.composition_inspect.v1` | STRUCTURAL_READBACK | Resolve 21.1 live-qualified composition identity/count/name surfaces. |
| `fusion.graph.inspect` | primitive | qualified | read | workflow `fusion.graph_inspect.v1` | STRUCTURAL_READBACK | Resolve 21.1 positive graph fixture qualified nodes/edges; no rendered-pixel claim. |
| `fusion.tool.inspect` | primitive | planned | read | workflow design `fusion.tool_inspect.v1` | STRUCTURAL_READBACK | Explicit tool attrs/ports only; no universal effect-parameter schema assumed. |
| `fusion.composition.create` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Part of full Fusion composition lifecycle. |
| `fusion.composition.delete` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Consequential; requires exact comp identity/recovery. |
| `fusion.tool.add` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Only qualified tool IDs/types. |
| `fusion.tool.delete` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Exact node identity and connection impact required. |
| `fusion.tool.input.set` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Validated `SetInput`; typed/qualified parameter semantics only. |
| `fusion.graph.connection.set` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Create/remove qualified port connections. |
| `fusion.expression.manage` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Expression text remains a typed capability input, not arbitrary script authority. |
| `fusion.keyframe.manage` | workflow | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Bounded keyframe operations where public API semantics are qualified. |
| `fusion.mask.manage` | workflow | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Mask-specific semantics require per-tool qualification. |
| `fusion.template.apply` | workflow | planned | write | app-defined approved template/group artifacts | RENDER_VERIFIED | Only versioned/approved deterministic structures; visible claims need render evidence. |
| `fusion.graph.plan` | workflow | planned | read | workflow design `fusion.graph_plan.v1` | plan artifact; execution verified separately | Produces immutable graph-change plan. |
| `fusion.graph.apply` | workflow | planned | write | workflow design `fusion.graph_apply.v1` | RENDER_VERIFIED | High-risk graph mutation; app-defined deterministic structures only. |
| `fusion.render.verify` | workflow | planned | read | render/frame evidence adapter | RENDER_VERIFIED | Graph readback is insufficient for visible-result claims. |
| `fusion.arbitrary_script.execute` | primitive | intentionally_excluded | write | none on Protected surface | unavailable | Model-authored arbitrary Fusion/Python code never becomes a normal protected capability. |

## 8. Color

| Capability ID | Layer | State | Mode | Current implementation / evidence | Required evidence / verification | Main constraint / note |
| --- | --- | --- | --- | --- | --- | --- |
| `color.pipeline.inspect` | primitive | qualified | read | workflow `color.pipeline_inspect.v1` | API_READBACK | Resolve 21.1 live-validated bounded color-management/pipeline state. |
| `color.graph.inspect` | primitive | qualified | read | workflow `color.graph_inventory.v1` | API_READBACK | Resolve 21.1 qualified node-stack and Color Group pre/post graph inventory. |
| `color.grade_version.inspect` | primitive | qualified | read | workflow `color.grade_version_inspect.v1` | API_READBACK | Resolve 21.1 qualified local/remote version names and current version. |
| `color.grade_version.create` | primitive | qualified | write | protected workflow `color.grade_version_create.v1`; Resolve 21.1 qualified `AddVersion(name, 0)` plus internal Load/Delete compensation | API_READBACK | Exact current SharedFocus TimelineItem only; LOCAL type 0 is fixed internally. Live qualification proved exact +1 LOCAL name readback, automatic current-version switch, Load-original/Delete-new Class B compensation and exact baseline restoration. It does not claim node-parameter, pixel, or approved-grade snapshot equivalence. |
| `color.grade_version.switch` | primitive | planned | write | observed official `LoadVersionByName` surface | API_READBACK | Version names alone are not global identity. |
| `color.grade_version.rename` | primitive | planned | write | observed official version mutation surfaces | API_READBACK | Exact current/version type binding required. |
| `color.grade_version.delete` | primitive | planned | write | observed official version mutation surfaces | API_READBACK | Must refuse deletion when recovery/target identity is not provable. |
| `color.cdl.apply` | primitive | planned | write | workflow design `color.cdl_apply.v1` | RENDER_VERIFIED | Validate CDL + create truthful grade/version backup before mutation. |
| `color.lut.apply` | primitive | planned | write | official/Samuel-derived candidate | RENDER_VERIFIED | LUT identity/path handling stays local; visible result needs render evidence. |
| `color.dctl.apply` | primitive | planned | write | official/Samuel-derived candidate | RENDER_VERIFIED | Versioned DCTL artifact only; no arbitrary model-authored code. |
| `color.drx.apply` | workflow | planned | write | official/Samuel-derived/offline-adapter candidate | RENDER_VERIFIED | DRX/look application is protected by version/grade backup. |
| `color.approved_look.apply` | workflow | planned | write | workflow design `color.approved_look_apply.v1` | RENDER_VERIFIED | Only approved/versioned look artifacts; do not overwrite existing grade silently. |
| `color.grade.copy` | workflow | planned | write | official/Samuel-derived candidate | RENDER_VERIFIED | Copy requires exact source/destination clip identities. |
| `color.grade.match` | workflow | planned | write | hybrid/qualified color primitives | RENDER_VERIFIED | Matching algorithm/inference is separate from deterministic application. |
| `color.group.manage` | workflow | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Create/assign/manage Color Groups and pre/post graph state where qualified. |
| `color.gallery.still.manage` | workflow | planned | write | official/Samuel-derived candidate | API_READBACK | Gallery/still lifecycle and identity require qualification. |
| `color.base_tree.deploy` | workflow | planned | write | approved template + qualified graph primitives | RENDER_VERIFIED | Explicit protection of existing grades required. |
| `color.render.verify` | workflow | planned | read | workflow design `color.render_evidence.v1` | RENDER_VERIFIED | Required only when the claim is visual. |
| `color.dctl_reference.inspect` | primitive | api_gap | read | no dedicated qualified DCTL enumeration getter in current evidence | API_READBACK | Do not infer DCTL identity/reference from unrelated graph data. |
| `color.creative_grade` | workflow | planned | write | hybrid model inference + qualified color primitives | RENDER_VERIFIED | Capability exists as future Goal-bound workflow; model strength never grants autonomy by itself. |

## 9. Fairlight

| Capability ID | Layer | State | Mode | Current implementation / evidence | Required evidence / verification | Main constraint / note |
| --- | --- | --- | --- | --- | --- | --- |
| `fairlight.mapping.inspect` | primitive | qualified | read | workflow `fairlight.mapping_inspect.v1` | STRUCTURAL_READBACK | Resolve 21.1 live-validated track/source mapping and track state. |
| `fairlight.clip_processing.inspect` | primitive | qualified | read | workflow `fairlight.clip_processing_inspect.v1` | API_READBACK | Resolve 21.1 qualified 15 processing-property keys plus Voice Isolation readback. |
| `fairlight.capabilities.inspect` | primitive | planned | read | workflow design `fairlight.capabilities.v1` | API_READBACK | Build/license dependent capability summary. |
| `fairlight.loudness.analyze` | workflow | planned | read | workflow design `fairlight.loudness_analysis.v1`; local analysis | analysis evidence | Source-safe measurable audio evidence. |
| `fairlight.transcription.analyze` | workflow | planned | read | workflow design `fairlight.transcription_analysis.v1`; local analysis | analysis evidence | Content-addressed Workspace artifact; project-mutating native transcription is separate. |
| `fairlight.sync.execute` | workflow | planned | write | workflow design `fairlight.sync_execute.v1` | STRUCTURAL_READBACK | Scope-dependent medium/high risk; protected target/version required. |
| `fairlight.clip.volume.set` | primitive | planned | write | qualified property schema; setter candidate pending | API_READBACK | Do not infer audible result solely from property readback. |
| `fairlight.clip.pan.set` | primitive | planned | write | qualified property schema; setter candidate pending | API_READBACK | Typed semantic parameter only. |
| `fairlight.clip.pitch.set` | primitive | planned | write | qualified property schema; setter candidate pending | API_READBACK | Semitone/cents semantics must remain explicit. |
| `fairlight.voice_isolation.set` | primitive | planned | write | observed `SetVoiceIsolationState` candidate | API_READBACK | Independent getter must agree; audible claim may need audio evidence. |
| `fairlight.dialogue_leveler.set` | primitive | planned | write | qualified property schema; setter candidate pending | API_READBACK | Typed allowlist only. |
| `fairlight.normalize` | workflow | planned | write | observed `NormalizeAudioLevel` candidate | AUDIO_VERIFIED | Target/normalization semantics require behavioral qualification. |
| `fairlight.source_mapping.set` | primitive | planned | write | official/Samuel-derived candidate | STRUCTURAL_READBACK | Exact source-channel mapping and affected clip/track identity required. |
| `fairlight.preset.apply` | workflow | planned | write | approved preset artifact + qualified setters | AUDIO_VERIFIED | Only approved/versioned presets; no blind parameter spray. |
| `fairlight.routing.control` | workflow | api_gap | write | public scripting gap in current design evidence | AUDIO_VERIFIED | Complete routing/bus control remains explicit gap; qualified fallback may be added later. |
| `fairlight.automation.control` | workflow | api_gap | write | public scripting gap in current design evidence | AUDIO_VERIFIED | Automation/keyframes remain outside current protected capability. |
| `fairlight.clip_effect.control` | workflow | api_gap | write | public/plug-in-specific gap | AUDIO_VERIFIED | Requires per-effect/plugin capability contract. |
| `fairlight.plugin_parameter.control` | primitive | ui_automation_candidate | write | future trusted plugin pack / allowlisted UI automation | AUDIO_VERIFIED | No generic computer-control authority; qualify per plugin/version. |

## 10. Deliver

| Capability ID | Layer | State | Mode | Current implementation / evidence | Required evidence / verification | Main constraint / note |
| --- | --- | --- | --- | --- | --- | --- |
| `deliver.capability_matrix.inspect` | primitive | qualified | read | workflow `deliver.capability_matrix.v1` | API_READBACK | Resolve 21.1 live-validated format/codec/resolution/preset capability evidence. |
| `deliver.settings.inspect` | primitive | qualified | read | workflow `deliver.settings_inspect.v1` | API_READBACK | Resolve 21.1 live-validated partial current settings + queue evidence. |
| `deliver.queue.inspect` | primitive | qualified | read | same implementation as `deliver.settings_inspect.v1` | API_READBACK | Bounded job/status getter evidence; output paths remain withheld. |
| `deliver.preflight` | workflow | qualified | read | `project.preflight.v1` with `profile=delivery` | STRUCTURAL_READBACK | Semantic Deliver capability reuses the canonical project preflight implementation; no duplicate workflow registry entry. |
| `deliver.collision.inspect` | primitive | planned | read | local destination/file adapter | analysis evidence | Checks overwrite/collision risk before approval; does not delete/replace files. |
| `deliver.render_range.inspect` | primitive | api_gap | read | current full render-settings readback gap | API_READBACK | Mark/range state stays unknown until a qualified implementation exists. |
| `deliver.audio_output.inspect` | primitive | planned | read | Deliver settings + Fairlight mapping/QC composition | STRUCTURAL_READBACK | Reports only evidence-supported audio inclusion/layout/routing facts. |
| `deliver.render.plan` | workflow | planned | read | workflow design `deliver.render_plan.v1` | plan artifact; execution verified separately | Defines exact expected outputs and verification contract before render. |
| `deliver.settings.set` | primitive | planned | write | official/Samuel-derived candidate | API_READBACK | Exact settings semantics and compatibility must be qualification-backed. |
| `deliver.job.add` | primitive | planned | write | official/Samuel-derived candidate | API_READBACK | Render job identity must be captured durably. |
| `deliver.job.start` | primitive | planned | write | official/Samuel-derived candidate | API_READBACK | Start is consequential and part of an approved render Plan. |
| `deliver.job.monitor` | primitive | planned | read | official queue/status getters | API_READBACK | Monitoring may be background Job state; no busy polling. |
| `deliver.render.execute` | workflow | planned | write | workflow design `deliver.render_execute.v1` | DELIVERABLE_VERIFIED | Resolve job completion is intermediate; final success requires output verification. |
| `deliver.output.verify` | workflow | planned | read | workflow design `deliver.verify_output.v1`; local analysis/offline adapter | DELIVERABLE_VERIFIED | File existence/container/codec/dimensions/rate/duration/audio/subtitles/QC as declared. |
| `deliver.quick_export.plan` | workflow | planned | read | Quick Export preset capability evidence | plan artifact; execution verified separately | Preset name alone does not prove contents; plan must materialize exact effective intent. |
| `deliver.quick_export.execute` | workflow | planned | write | official/Samuel-derived candidate | DELIVERABLE_VERIFIED | Must use the same approval/verification path as ordinary render. |
| `deliver.render_settings.full.inspect` | primitive | api_gap | read | Resolve 21.1 has no complete qualified `GetRenderSettings()` getter | API_READBACK | Current destination/filename/toggles/range/subtitle state cannot be claimed from partial getters. |
| `deliver.destination.inspect` | primitive | api_gap | read | same full-settings readback gap | API_READBACK | Do not infer output destination from stale UI/configuration. |
| `deliver.subtitle_export_state.inspect` | primitive | api_gap | read | same full-settings readback gap | API_READBACK | Subtitle export state remains explicit unknown until qualified. |

## 11. Cross-domain support

| Capability ID | Layer | State | Mode | Current implementation / evidence | Required evidence / verification | Main constraint / note |
| --- | --- | --- | --- | --- | --- | --- |
| `analysis.media_metadata` | workflow | planned | read | candidate `analysis.media_metadata.v1` | analysis evidence | Workspace-owned, source-safe Analysis Artifact. |
| `analysis.audio_measurement` | workflow | planned | read | candidate `analysis.audio_measurement.v1` | analysis evidence | Content-addressed local evidence for Fairlight/Deliver workflows. |
| `analysis.transcription` | workflow | planned | read | candidate `analysis.transcription.v1` | analysis evidence | Workspace-owned transcript artifact; model receives bounded excerpts only as needed. |
| `analysis.frame_sample` | workflow | planned | read | candidate `analysis.frame_sample.v1` | analysis evidence | Still/contact-sheet evidence; no live Resolve Viewer requirement. |
| `analysis.visual_review` | workflow | planned | read | candidate `analysis.visual_review.v1` | analysis evidence | Model inference remains epistemically labelled. |
| `offline.interchange.inspect` | workflow | planned | read | candidate `offline.interchange_inspect.v1` | analysis evidence | Deterministic report/plan only; no independent live Resolve authority. |
| `offline.conform.compute` | workflow | planned | read | candidate `offline.conform_compute.v1` | analysis evidence | Compute matching/repull plan outside Resolve, then apply through the one authority. |
| `offline.drx.inspect` | workflow | planned | read | candidate `offline.drx_inspect.v1` | analysis evidence | Inspection only unless a separate protected writer is designed. |
| `offline.deliverable.qc` | workflow | planned | read | candidate `offline.deliverable_qc.v1` | DELIVERABLE_VERIFIED | Local deterministic produced-file QC. |

## 12. Qualification and routing rules

- Qualification is attached to a concrete implementation + exact Resolve build/environment, not permanently to the semantic capability.
- A new Resolve build does not silently inherit writer qualification. Stable readers may remain provisional only when passive probes still pass; writer qualification requires explicit disposable-fixture Compatibility Check.
- An approved Plan seals `capability_id`, contract version, implementation ID/version and qualification evidence. Runtime execution cannot silently route to a different implementation.
- If a capability has only `api_gap` or `ui_automation_candidate` implementations, the Capability Frontier must show the limitation rather than pretending it is available.

## 13. Capability Pack production gate

A ledger row may become `production` only when its coherent Capability Pack supplies, as applicable:

```text
stable semantic capability contract
entity / relationship semantics
observation recipe + EvidenceRefs
primitive and/or workflow ActionDescriptor
versioned implementation candidate(s)
exact Resolve build qualification + known limitations
Context Compiler / Capability Frontier recipe
expected World Model invalidation / semantic delta
Artifact Workspace projection
immutable Plan / approval / ChangeSet / recovery contract when mutable
verification contract and fixture evidence
Agent task evaluation / ACI acceptance
provenance / upstream attribution
```

No isolated API wrapper, method-surface probe or UI control is promoted directly to production.

## 14. Breadth-first maintenance rule

When research, a new Resolve build, Samuel-derived code, a user workflow or an implementation review reveals a meaningful new ability, first add/update the semantic ledger row. Only then decide whether it is `planned`, a hard `api_gap`, a `ui_automation_candidate`, or ready to enter a vertical Capability Pack. This keeps the full function layer ahead of implementation order and lets stronger future models exploit newly qualified abilities without redesigning the system.
