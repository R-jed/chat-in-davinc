import type {
  ResolveCapabilityEvidence,
  ResolveCapabilityId,
  ResolveCapabilityStatus
} from '../shared/types.js';
import type { ResolveBrokerSnapshot } from './resolve-broker.js';

const QUALIFIED_RESOLVE_VERSION = /^21\.1(?:\.|$)/;

function hasTool(snapshot: ResolveBrokerSnapshot, name: string): boolean {
  return snapshot.tools.some((tool) => tool.name === name);
}

function methodStatus(snapshot: ResolveBrokerSnapshot, resolveVersion: string | null): ResolveCapabilityStatus {
  if (!hasTool(snapshot, 'run_script')) return 'unavailable';
  if (!resolveVersion || !QUALIFIED_RESOLVE_VERSION.test(resolveVersion)) return 'unknown';
  return 'available';
}

function methodEvidence(options: {
  capabilityId: ResolveCapabilityId;
  symbol: string;
  resolveVersion: string | null;
  snapshot: ResolveBrokerSnapshot;
  limitations?: string[];
  status?: ResolveCapabilityStatus;
  probeStrategy?: string;
}): ResolveCapabilityEvidence {
  const baseStatus = methodStatus(options.snapshot, options.resolveVersion);
  return {
    capabilityId: options.capabilityId,
    symbol: options.symbol,
    introducedIn: null,
    evidenceSource: 'vendor',
    qualification: baseStatus === 'available' ? 'behaviorally_qualified' : 'runtime_observed',
    evidenceBuild: baseStatus === 'available' ? options.resolveVersion : null,
    status: baseStatus === 'available' && options.status ? options.status : baseStatus,
    requirements: [
      'Blackmagic ResolveMCP run_script tool',
      'DaVinci Resolve 21.1 scripting API qualification'
    ],
    limitations: options.limitations ?? [],
    probeStrategy: options.probeStrategy ?? 'vendor-qualified build plus runtime run_script declaration'
  };
}

export function resolveCapabilityRegistry(
  snapshot: ResolveBrokerSnapshot,
  resolveVersion: string | null
): ResolveCapabilityEvidence[] {
  const statusToolAvailable = hasTool(snapshot, 'get_resolve_status');
  const scriptToolAvailable = hasTool(snapshot, 'run_script');
  return [
    {
      capabilityId: 'resolve.status.read',
      symbol: 'get_resolve_status',
      introducedIn: null,
      evidenceSource: 'measured',
      qualification: 'runtime_observed',
      evidenceBuild: resolveVersion,
      status: statusToolAvailable ? 'available' : 'unavailable',
      requirements: ['Official ResolveMCP get_resolve_status declaration'],
      limitations: [],
      probeStrategy: 'runtime tool declaration'
    },
    {
      capabilityId: 'resolve.sandboxed_script.read',
      symbol: 'run_script',
      introducedIn: null,
      evidenceSource: 'measured',
      qualification: 'runtime_observed',
      evidenceBuild: resolveVersion,
      status: scriptToolAvailable ? 'available' : 'unavailable',
      requirements: ['Official ResolveMCP sandboxed run_script declaration'],
      limitations: ['Workflow accepts only app-owned fixed getter-only templates.'],
      probeStrategy: 'runtime tool declaration'
    },
    methodEvidence({
      capabilityId: 'project.identity.read',
      symbol: 'Project.GetName/GetUniqueId/GetCurrentTimeline/GetTimelineCount',
      resolveVersion,
      snapshot
    }),
    methodEvidence({
      capabilityId: 'project.settings.read',
      symbol: 'Project.GetSettings/Timeline.GetSettings',
      resolveVersion,
      snapshot,
      limitations: [
        'Timeline.GetSettings may return project settings when custom timeline settings are disabled.',
        'Missing useCustomSettings evidence is not interpreted as false.'
      ]
    }),
    methodEvidence({
      capabilityId: 'media.inventory.read',
      symbol: 'MediaPool/Folder/MediaPoolItem getter inventory',
      resolveVersion,
      snapshot,
      limitations: ['Resolve Type strings follow the active Resolve UI language and are display evidence only.']
    }),
    methodEvidence({
      capabilityId: 'media.clip_detail.read',
      symbol: 'MediaPoolItem.GetUniqueId/GetClipProperty/GetMetadata/GetThirdPartyMetadata/GetMarkers/GetFlagList/GetClipColor/GetAudioMapping',
      resolveVersion,
      snapshot,
      limitations: [
        'Full-resolution link state has no dedicated qualified getter and remains unverified.',
        'Resolve Type strings follow the active Resolve UI language and are display evidence only.',
        'Protected results omit source and proxy path values.'
      ],
      probeStrategy: 'Resolve 21.1 qualification plus exact-item dir() method probe and direct getter readback'
    }),
    methodEvidence({
      capabilityId: 'media.link_status.read',
      symbol: 'MediaPool/MediaPoolItem dir() link-surface probe',
      resolveVersion,
      snapshot,
      limitations: [
        'The reader never calls RelinkClips, UnlinkClips, LinkProxyMedia, UnlinkProxyMedia or LinkFullResolutionMedia.',
        'Observed mutation methods are runtime surface evidence only and do not qualify a protected writer.',
        'Full-resolution link state has no dedicated qualified getter and remains unverified.',
        'Proxy and optimized-media generation are not exposed by this protected workflow.'
      ],
      probeStrategy: 'Resolve 21.1 exact-object dir() probe over a fixed link-method allowlist; no mutation dispatch'
    }),
    methodEvidence({
      capabilityId: 'edit.timeline_structure.read',
      symbol: 'Timeline track/item/marker getters',
      resolveVersion,
      snapshot,
      limitations: ['Gap/overlap and source-range conflict analysis are separate readers and remain unverified here.']
    }),
    methodEvidence({
      capabilityId: 'edit.transition_fade.read',
      symbol: 'TimelineItem.GetFades',
      resolveVersion,
      snapshot,
      limitations: [
        'Resolve 21.1 live qualification observed AddTransition/GetFades/SetFades on exact video and audio TimelineItems, but the protected reader calls GetFades only.',
        'AddTransition and SetFades are runtime method-surface evidence only and are not registered protected writers.',
        'No qualified getter currently proves applied edit-transition state; transition readback remains unverified.',
        'FadeIn/FadeOut numeric value semantics are returned raw and are not assigned units by the protected reader.'
      ],
      probeStrategy: 'Resolve 21.1 exact-item dir() probe plus direct GetFades readback; no mutation dispatch'
    }),
    methodEvidence({
      capabilityId: 'edit.review_marker.read',
      symbol: 'TimelineItem.GetUniqueId/GetMarkers/GetMarkerByCustomData/GetMarkerCustomData',
      resolveVersion,
      snapshot,
      limitations: ['Initial protected marker planning targets only the current video item.']
    }),
    methodEvidence({
      capabilityId: 'edit.review_marker.write',
      symbol: 'TimelineItem.AddMarker/DeleteMarkerByCustomData',
      resolveVersion,
      snapshot,
      limitations: [
        'Qualified on Resolve 21.1 with disposable-project AddMarker → GetMarkerByCustomData/GetMarkers → DeleteMarkerByCustomData → absence readback.',
        'Protected writer is limited to one exact current-video-item plan with unique customData and local approval.'
      ]
    }),
    methodEvidence({
      capabilityId: 'edit.track.write',
      symbol: 'Timeline.AddTrack/DeleteTrack',
      resolveVersion,
      snapshot,
      limitations: [
        'Protected writer is limited to appending exactly one empty VIDEO track; indexed insertion, AUDIO tracks and subtype selection are not exposed.',
        'Resolve 21.1 live qualification confirmed TypeScript/Python structural fingerprint equality, AddTrack("video"), exact empty-track structural readback and exact cleanup fingerprint restoration.',
        'Class C Timeline Version Protection and durable local exact-plan approval remain mandatory before execution.'
      ],
      probeStrategy: 'Resolve 21.1 disposable-project live qualification of fixed AddTrack("video") writer plus structural readback and cleanup'
    }),
    methodEvidence({
      capabilityId: 'fusion.composition.read',
      symbol: 'TimelineItem.GetUniqueId/GetName/GetFusionCompCount/GetFusionCompNameList',
      resolveVersion,
      snapshot,
      limitations: [
        'Resolve 21.1 behavioral qualification covered exact TimelineItem identity plus both zero- and positive-composition GetFusionCompCount/GetFusionCompNameList readback on the qualified video item.',
        'The protected reader discovers VIDEO TimelineItems through separately qualified edit.timeline_structure.read Timeline.GetTrackCount/GetItemListInTrack methods; it does not depend on Timeline.GetCurrentVideoItem or playhead position.',
        'Positive-composition GetFusionCompNameList returned list[str] and both GetFusionCompByName/GetFusionCompByIndex returned the same observed MediaIn/MediaOut tool set on the qualified fixture.',
        'The qualified zero-composition fixture returns an empty dict from GetFusionCompNameList despite the vendor stub declaring list[str]; this shape is accepted only when GetFusionCompCount is zero.',
        'Tool/port/edge behavior is qualified separately by fusion.graph.read; rendered pixels are not qualified by this capability.'
      ],
      probeStrategy: 'Resolve 21.1 exact TimelineItem behavioral readback for identity/count/name-list, positive GetFusionCompByName/GetFusionCompByIndex access, and bounded timeline VIDEO-item discovery'
    }),
    methodEvidence({
      capabilityId: 'fusion.graph.read',
      symbol: 'TimelineItem.GetFusionCompByName + Composition.GetToolList + Operator.GetInputList/GetOutputList + Output.GetConnectedInputs + Input.GetConnectedOutput',
      resolveVersion,
      snapshot,
      limitations: [
        'Qualified on Resolve 21.1 against disposable Composition 1 with MediaIn1(MediaIn) connected to MediaOut1(MediaOut).',
        'GetToolList(False), GetInputList and GetOutputList returned dict-shaped inventories; the MediaIn Output -> MediaOut Input edge was observed from Output.GetConnectedInputs and independently read back through Input.GetConnectedOutput.',
        'Tool Name is treated as composition-local identity and Tool ID as registry/type identity. Link ID is used for port identity; localized Link Name is not required for graph identity.',
        'Control/input values, node positions, rendered pixels and all graph mutation methods remain outside this capability.'
      ],
      probeStrategy: 'Resolve 21.1 positive-composition readback of exact comp-by-name, tool inventories, port inventories, and bidirectional connection evidence'
    }),
    methodEvidence({
      capabilityId: 'color.pipeline.read',
      symbol: 'Project/Timeline color settings plus TimelineItem color group/version summary',
      resolveVersion,
      snapshot,
      limitations: [
        'Aggregate node/LUT counts in the pipeline summary do not establish per-node graph identity.',
        'DCTL reference enumeration and additional node-stack-layer readback remain unverified.'
      ]
    }),
    methodEvidence({
      capabilityId: 'color.graph.read',
      symbol: 'Timeline.GetNodeGraph + TimelineItem.GetNodeGraph + Project.GetColorGroupsList + ColorGroup.GetPreClipNodeGraph/GetPostClipNodeGraph + Graph.GetNumNodes/GetNodeLabel/GetLUT/GetNodeCacheMode/GetToolsInNode',
      resolveVersion,
      snapshot,
      limitations: [
        'Qualified on Resolve 21.1 against the stable nodeStackLayers="1" baseline and the dedicated CID Color Node Stack Qualification fixture with nodeStackLayers="2" plus one retained Color Group.',
        'The protected reader reads Project.GetSettings().nodeStackLayers and enumerates TimelineItem.GetNodeGraph(layerIdx) for configured layers, bounded to 32 layers per item. The two-layer fixture returned non-null L1/L2 Graph objects with one node on each layer.',
        'The dedicated Color Group fixture returned non-null pre-clip and post-clip Graph objects with one node each. Both group nodes returned empty label/LUT, null cache mode, and null GetToolsInNode; successful null cache readback is preserved distinctly from getter failure.',
        'Clip-layer nodes returned empty label/LUT, cache mode -1 and null GetToolsInNode. These raw values are not interpreted as visual correctness, and Color Group enumeration order/name uniqueness are not treated as stable graph identity semantics.',
        'The protected reader exposes only LUT presence, never the LUT path returned by GetLUT.',
        'Node topology/connections, node parameter values, DCTL identity/reference enumeration, rendered pixels and all graph mutation methods remain outside this capability.'
      ],
      probeStrategy: 'Resolve 21.1 stable one-layer plus dedicated two-layer and Color Group pre/post Graph readback using the fixed five Graph getters'
    }),
    methodEvidence({
      capabilityId: 'color.grade_version.read',
      symbol: 'TimelineItem.GetVersionNameList + TimelineItem.GetCurrentVersion',
      resolveVersion,
      snapshot,
      limitations: [
        'Qualified on Resolve 21.1 against the restored BMX V1 item: GetVersionNameList(0) and GetVersionNameList(1) both returned list[str], and GetCurrentVersion returned {versionName, versionType}.',
        'The accepted fixture returned the same localized name in both local and remote lists while the current version type was local (0); names are therefore not treated as globally unique identities or as evidence that local/remote entries are equivalent.',
        'Version ordering, Color Group version enumeration, rendered pixels, LoadVersionByName, AddVersion, DeleteVersionByName and RenameVersionByName remain outside this capability.'
      ],
      probeStrategy: 'Resolve 21.1 exact TimelineItem readback of local/remote version-name list shapes and current-version dict shape'
    }),
    methodEvidence({
      capabilityId: 'color.grade_version.write',
      symbol: 'TimelineItem.AddVersion + TimelineItem.LoadVersionByName + TimelineItem.DeleteVersionByName',
      resolveVersion,
      snapshot,
      limitations: [
        'Qualified on Resolve 21.1 on 2026-09-13 against the disposable test / CID Marker Qualification Restored / exact BMX V1 fixture.',
        'AddVersion(uniqueName, 0) returned true, added exactly one LOCAL name and made that new LOCAL version current.',
        'Class B compensation was qualified by LoadVersionByName(originalName, 0) followed by DeleteVersionByName(newName, 0), with exact baseline LOCAL list and current-version readback restored.',
        'The protected writer is LOCAL type 0 only and exact TimelineItem scoped. Remote creation, public switching, rename and delete are not exposed.',
        'Version-container readback does not prove copied node parameter values, rendered pixels or visual equivalence.'
      ],
      probeStrategy: 'Resolve 21.1 disposable exact-item AddVersion/readback plus Load/Delete compensation symmetry'
    }),
    methodEvidence({
      capabilityId: 'fairlight.mapping.read',
      symbol: 'Timeline audio track getters and TimelineItem source audio mapping',
      resolveVersion,
      snapshot,
      limitations: ['Sync evidence and transcription state remain outside this reader.']
    }),
    methodEvidence({
      capabilityId: 'fairlight.clip_processing.read',
      symbol: 'TimelineItem.GetProperties + TimelineItem.GetVoiceIsolationState',
      resolveVersion,
      snapshot,
      limitations: [
        'Qualified on Resolve 21.1 against the restored A1 BMX TimelineItem. GetProperties returned all 15 allowlisted audio-processing fields and GetVoiceIsolationState returned {isEnabled, amount}.',
        'The protected reader reports current property values only; automation/keyframes, clip effects, buses, rendered audio and loudness are not inferred.',
        'NormalizeAudioLevel, SetProperties, SetVoiceIsolationState and all other audio-processing writes remain outside this capability.'
      ],
      probeStrategy: 'Resolve 21.1 exact AUDIO TimelineItem readback of allowlisted GetProperties fields plus independent Voice Isolation state'
    }),
    methodEvidence({
      capabilityId: 'deliver.capability_matrix.read',
      symbol: 'Project.GetRenderFormats/GetRenderCodecs/GetRenderResolutions/GetRenderPresetList/GetQuickExportRenderPresets',
      resolveVersion,
      snapshot,
      limitations: [
        'Resolve 21.1 behaviorally returns codec-specific resolution lists from GetRenderResolutions(format, codec); these constraints vary by format/codec and are not inferred from the generic resolution list.',
        'The protected reader exposes a bounded resolution list for the currently selected format/codec when that selection is readable. Resolution-list ordering and uniqueness are not interpreted; duplicate rows are preserved as returned.',
        'GetRenderPresetList and GetQuickExportRenderPresets are exposed as bounded preset-name inventories. API order and duplicate names are preserved; preset contents, compatibility, upload targets and current preset selection are not inferred.',
        'It does not claim the current render resolution because Resolve 21.1 exposes no complete GetRenderSettings getter.'
      ],
      probeStrategy: 'Resolve 21.1 readback of generic resolutions, format/codec-specific resolution sets, and bounded render/Quick Export preset-name lists'
    }),
    methodEvidence({
      capabilityId: 'deliver.settings.partial_read',
      symbol: 'Project.GetCurrentRenderFormatAndCodec/GetCurrentRenderMode/GetRenderJobList',
      resolveVersion,
      snapshot,
      status: 'conditional',
      limitations: [
        'Resolve 21.1 exposes no complete GetRenderSettings getter.',
        'Current target directory, output filename, export toggles, mark range and subtitle export remain unverified.'
      ]
    })
  ];
}
