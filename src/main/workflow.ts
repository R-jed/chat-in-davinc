import type { CallToolResult, Tool } from '@modelcontextprotocol/server';
import type {
  ColorGradeVersionInspect,
  ColorGraphInventory,
  ColorPipelineSummary,
  DeliverCapabilityMatrix,
  DeliverSettingsInspect,
  EditGapsOverlapsInspect,
  EditReviewAnnotationsInspect,
  EditSourceRangeReport,
  EditStructureInspect,
  EditTransitionInspect,
  EditTimelineSummary,
  FairlightClipProcessingInspect,
  FairlightMappingSummary,
  FusionCompositionInspect,
  FusionGraphInspect,
  MediaClipInspect,
  MediaInventorySummary,
  MediaLinkStatus,
  ProjectPreflightCheck,
  ProjectPreflightProfile,
  ProjectPreflightStatus,
  ProjectPreflightSummary,
  ProtectedOperation,
  ProtectedVerificationLevel,
  ProtectedWorkflowId,
  ProtectedWorkflowResult,
  ReviewMarkerAddRequestedParameters,
  ResolveCapabilityEvidence,
  WorkflowAuditEntry,
  WorkflowInspectResult,
  WorkflowInspectTarget,
  WorkflowPlanProjection,
  ProjectSettingsFacts,
  ProjectSettingsFactKey,
  WorkflowRiskAssessment
} from '../shared/types.js';
import type { ResolveBrokerSnapshot } from './resolve-broker.js';
import type { ResolveClient } from './resolve-scheduler.js';
import { resolveCapabilityRegistry } from './resolve-capabilities.js';
import { assessRegisteredWorkflow, getWorkflowDefinition } from './workflow-registry.js';
import {
  createTimelineDuplicateBackupForPlan,
  createColorGradeVersionCreatePlan,
  createEditTrackAddPlan,
  createReviewMarkerPlan,
  executeColorGradeVersionCreatePlan,
  executeEditTrackAddPlan,
  executeWorkflowPlan,
  getWorkflowPlan
} from './workflow-engine.js';

const READ_ONLY_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
} as const;

const PLAN_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;

const EXECUTE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false
} as const;

const READ_ONLY_PROJECT_SNAPSHOT_SCRIPT = `p = project
t = p.GetCurrentTimeline() if p else None
ps = p.GetSettings() if p else None
ts = t.GetSettings() if t else None
result = {
    "page": resolve.GetCurrentPage() if resolve else None,
    "project": None if not p else {
        "name": p.GetName(),
        "id": p.GetUniqueId(),
        "timelineCount": p.GetTimelineCount()
    },
    "timeline": None if not t else {
        "name": t.GetName(),
        "id": t.GetUniqueId(),
        "videoTracks": t.GetTrackCount("video"),
        "audioTracks": t.GetTrackCount("audio"),
        "subtitleTracks": t.GetTrackCount("subtitle")
    },
    "projectSettings": None if not ps else {
        "timelineResolutionWidth": ps.get("timelineResolutionWidth"),
        "timelineResolutionHeight": ps.get("timelineResolutionHeight"),
        "timelineFrameRate": ps.get("timelineFrameRate"),
        "timelinePlaybackFrameRate": ps.get("timelinePlaybackFrameRate"),
        "timelineOutputResolutionWidth": ps.get("timelineOutputResolutionWidth"),
        "timelineOutputResolutionHeight": ps.get("timelineOutputResolutionHeight"),
        "timelineFrameRateMismatchBehavior": ps.get("timelineFrameRateMismatchBehavior"),
        "colorScienceMode": ps.get("colorScienceMode"),
        "videoMonitorFormat": ps.get("videoMonitorFormat")
    },
    "timelineSettings": None if not ts else {
        "timelineResolutionWidth": ts.get("timelineResolutionWidth"),
        "timelineResolutionHeight": ts.get("timelineResolutionHeight"),
        "timelineFrameRate": ts.get("timelineFrameRate"),
        "timelinePlaybackFrameRate": ts.get("timelinePlaybackFrameRate"),
        "timelineOutputResolutionWidth": ts.get("timelineOutputResolutionWidth"),
        "timelineOutputResolutionHeight": ts.get("timelineOutputResolutionHeight"),
        "timelineFrameRateMismatchBehavior": ts.get("timelineFrameRateMismatchBehavior"),
        "colorScienceMode": ts.get("colorScienceMode"),
        "videoMonitorFormat": ts.get("videoMonitorFormat"),
        "useCustomSettings": ts.get("useCustomSettings")
    }
}`;

const READ_ONLY_MEDIA_INVENTORY_SCRIPT = `p = project
mp = p.GetMediaPool() if p else None
root = mp.GetRootFolder() if mp else None
current = mp.GetCurrentFolder() if mp else None
t = p.GetCurrentTimeline() if p else None
ts = t.GetSettings() if t else None

def number(value):
    try:
        return float(value)
    except:
        return None

def integer(value):
    try:
        return int(float(value))
    except:
        return None

def resolution(value):
    text = str(value or "").strip().lower().replace("×", "x")
    if "x" not in text:
        return None
    parts = text.split("x", 1)
    try:
        width = int(parts[0].strip())
        height = int(parts[1].strip())
        return {"width": width, "height": height} if width > 0 and height > 0 else None
    except:
        return None

reference_fps = number(ts.get("timelineFrameRate")) if ts else None
reference_resolution = None if not ts else {
    "width": integer(ts.get("timelineResolutionWidth")),
    "height": integer(ts.get("timelineResolutionHeight"))
}
if reference_resolution and (not reference_resolution["width"] or not reference_resolution["height"]):
    reference_resolution = None

MAX_FOLDERS = 200
MAX_ITEMS = 1000
MAX_FOLDER_ROWS = 50
MAX_ITEM_ROWS = 50

folders_seen = 0
items_seen = 0
source_clips = 0
timeline_items = 0
online_count = 0
offline_count = 0
online_unverified = 0
proxy_linked = 0
proxy_absent = 0
proxy_unverified = 0
frame_rate_mismatches = 0 if reference_fps is not None else None
resolution_mismatches = 0 if reference_resolution is not None else None
folders_truncated = False
items_truncated = False
type_counts = {}
motion_fps_counts = {}
motion_resolution_counts = {}
folder_rows = []
item_rows = []

stack = [(root, None)] if root else []
while stack:
    if folders_seen >= MAX_FOLDERS:
        folders_truncated = True
        break
    folder, parent_id = stack.pop()
    folders_seen += 1
    folder_id = folder.GetUniqueId()
    folder_name = folder.GetName()
    subfolders = folder.GetSubFolderList() or []
    clips = folder.GetClipList() or []
    if len(folder_rows) < MAX_FOLDER_ROWS:
        folder_rows.append({
            "id": folder_id,
            "name": folder_name,
            "parentId": parent_id,
            "directItemCount": len(clips)
        })
    for subfolder in reversed(subfolders):
        if folders_seen + len(stack) >= MAX_FOLDERS:
            folders_truncated = True
            break
        stack.append((subfolder, folder_id))

    for index, item in enumerate(clips):
        if items_seen >= MAX_ITEMS:
            items_truncated = True
            break
        items_seen += 1
        props = item.GetClipProperty() or {}
        item_timeline = item.GetTimeline()
        is_timeline = item_timeline is not None
        resolve_type = str(props.get("Type") or "").strip()
        type_counts[resolve_type] = type_counts.get(resolve_type, 0) + 1

        if is_timeline:
            timeline_items += 1
        else:
            source_clips += 1

        online_raw = str(props.get("Online Status") or "").strip().lower()
        online = True if online_raw == "online" else False if online_raw == "offline" else None
        if is_timeline:
            online = None
        if online is True:
            online_count += 1
        elif online is False:
            offline_count += 1
        elif not is_timeline:
            online_unverified += 1

        proxy_path = str(props.get("Proxy Media Path") or "").strip()
        proxy_raw = str(props.get("Proxy") or "").strip().lower()
        has_proxy = True if proxy_path else False if proxy_raw == "none" else None
        if is_timeline:
            has_proxy = None
        if has_proxy is True:
            proxy_linked += 1
        elif has_proxy is False:
            proxy_absent += 1
        elif not is_timeline:
            proxy_unverified += 1

        frames = integer(props.get("Frames"))
        fps = number(props.get("FPS"))
        item_resolution = resolution(props.get("Resolution"))
        is_motion_source = not is_timeline and frames is not None and frames > 1
        if is_motion_source and fps is not None:
            fps_key = str(fps)
            motion_fps_counts[fps_key] = motion_fps_counts.get(fps_key, 0) + 1
            if frame_rate_mismatches is not None and abs(fps - reference_fps) > 0.001:
                frame_rate_mismatches += 1
        if is_motion_source and item_resolution:
            res_key = str(item_resolution["width"]) + "x" + str(item_resolution["height"])
            motion_resolution_counts[res_key] = motion_resolution_counts.get(res_key, 0) + 1
            if resolution_mismatches is not None and (
                item_resolution["width"] != reference_resolution["width"] or
                item_resolution["height"] != reference_resolution["height"]
            ):
                resolution_mismatches += 1

        if len(item_rows) < MAX_ITEM_ROWS:
            item_rows.append({
                "id": item.GetUniqueId(),
                "name": item.GetName(),
                "folderId": folder_id,
                "folderName": folder_name,
                "resolveType": resolve_type or None,
                "isTimeline": is_timeline,
                "duration": str(props.get("Duration") or "").strip() or None,
                "frames": frames,
                "fps": fps,
                "resolution": item_resolution,
                "videoCodec": str(props.get("Video Codec") or "").strip() or None,
                "audioCodec": str(props.get("Audio Codec") or "").strip() or None,
                "online": online,
                "hasProxyMedia": has_proxy
            })
    if items_truncated:
        break

if stack:
    folders_truncated = True

observed_motion_resolutions = []
for key, count in motion_resolution_counts.items():
    dims = key.split("x", 1)
    observed_motion_resolutions.append({"width": int(dims[0]), "height": int(dims[1]), "count": count})

result = None if not mp or not root else {
    "readerId": "media.inventory_summary.v1",
    "mediaPoolId": mp.GetUniqueId(),
    "rootFolder": {"id": root.GetUniqueId(), "name": root.GetName()},
    "currentFolder": None if not current else {"id": current.GetUniqueId(), "name": current.GetName()},
    "folderCountObserved": max(0, folders_seen - 1),
    "itemsObserved": items_seen,
    "sourceClipCountObserved": source_clips,
    "timelineItemCountObserved": timeline_items,
    "onlineCountObserved": online_count,
    "offlineCountObserved": offline_count,
    "onlineUnverifiedCount": online_unverified,
    "proxyLinkedCountObserved": proxy_linked,
    "proxyAbsentCountObserved": proxy_absent,
    "proxyUnverifiedCount": proxy_unverified,
    "resolveTypeCounts": [{"type": key, "count": count} for key, count in type_counts.items()],
    "observedMotionFrameRates": [float(key) for key in motion_fps_counts.keys()],
    "observedMotionResolutions": observed_motion_resolutions,
    "referenceTimeline": None if not t else {
        "frameRate": reference_fps,
        "resolution": reference_resolution
    },
    "motionFrameRateMismatchCount": frame_rate_mismatches,
    "motionResolutionMismatchCount": resolution_mismatches,
    "folders": folder_rows,
    "items": item_rows,
    "complete": not folders_truncated and not items_truncated,
    "foldersTruncated": folders_truncated,
    "itemsTruncated": items_truncated
}`;

const MEDIA_CLIP_EVIDENCE_METHODS = [
  'GetClipProperty',
  'GetMetadata',
  'GetThirdPartyMetadata',
  'GetMarkers',
  'GetFlagList',
  'GetClipColor',
  'GetAudioMapping',
  'GetTimeline'
] as const;

function mediaClipInspectScript(itemId: string): string {
  const targetId = JSON.stringify(itemId);
  const evidenceMethods = JSON.stringify(MEDIA_CLIP_EVIDENCE_METHODS);
  return `import json
target_id = ${targetId}
p = project
mp = p.GetMediaPool() if p else None
root = mp.GetRootFolder() if mp else None
MAX_FOLDERS = 200
MAX_ITEMS = 1000
MAX_METADATA_ROWS = 50
MAX_MARKERS = 50
MAX_FLAGS = 50

folders_seen = 0
items_seen = 0
truncated = False
item = None
stack = [root] if root else []
while stack:
    if folders_seen >= MAX_FOLDERS:
        truncated = True
        break
    folder = stack.pop()
    folders_seen += 1
    subfolders = folder.GetSubFolderList() or []
    for subfolder in reversed(subfolders):
        if folders_seen + len(stack) >= MAX_FOLDERS:
            truncated = True
            break
        stack.append(subfolder)
    clips = folder.GetClipList() or []
    for candidate in clips:
        if items_seen >= MAX_ITEMS:
            truncated = True
            break
        items_seen += 1
        if candidate.GetUniqueId() == target_id:
            item = candidate
            break
    if item or (items_seen >= MAX_ITEMS):
        break

lookup = "found" if item else "unverified" if truncated else "not_found"

def text(value, limit=256):
    if value is None:
        return None
    value = str(value).strip()
    if not value:
        return None
    return value[:limit]

def number(value):
    try:
        return float(value)
    except:
        return None

def integer(value):
    try:
        return int(float(value))
    except:
        return None

def resolution(value):
    value = text(value)
    if not value:
        return None
    value = value.lower().replace("×", "x")
    if "x" not in value:
        return None
    parts = value.split("x", 1)
    try:
        width = int(parts[0].strip())
        height = int(parts[1].strip())
        return {"width": width, "height": height} if width > 0 and height > 0 else None
    except:
        return None

def path_like_key(value):
    lowered = str(value or "").strip().lower()
    return any(token in lowered for token in ["path", "directory", "folder", "location"])

def path_like_value(value):
    if not isinstance(value, str):
        return False
    lowered = value.strip().lower()
    return lowered.startswith("/") or lowered.startswith("file://") or "/users/" in lowered or "/volumes/" in lowered

def safe_metadata(raw):
    rows = []
    was_truncated = False
    if not isinstance(raw, dict):
        return rows, was_truncated
    for key in sorted(raw.keys(), key=lambda value: str(value)):
        if path_like_key(key):
            continue
        value = raw.get(key)
        if not isinstance(value, (str, int, float, bool)) or path_like_value(value):
            continue
        key_text = text(key, 128)
        value_text = text(value, 256)
        if not key_text or value_text is None:
            continue
        if len(rows) >= MAX_METADATA_ROWS:
            was_truncated = True
            break
        rows.append({"key": key_text, "value": value_text})
    return rows, was_truncated

CHECKED_METHODS = ${evidenceMethods}
method_names = set()
observed_methods = []
missing_methods = []
failed_methods = []
if item:
    try:
        method_names = set(dir(item))
        observed_methods = [name for name in CHECKED_METHODS if name in method_names]
        missing_methods = [name for name in CHECKED_METHODS if name not in method_names]
    except:
        failed_methods = list(CHECKED_METHODS)

def call_checked(name, default=None):
    if not item or name not in method_names:
        return default
    try:
        return getattr(item, name)()
    except:
        if name not in failed_methods:
            failed_methods.append(name)
        return default

props = call_checked("GetClipProperty", {}) or {}
metadata_raw = call_checked("GetMetadata", {}) or {}
third_party_raw = call_checked("GetThirdPartyMetadata", {}) or {}
metadata, metadata_truncated = safe_metadata(metadata_raw)
third_party_metadata, third_party_metadata_truncated = safe_metadata(third_party_raw)

markers = []
markers_truncated = False
marker_raw = call_checked("GetMarkers", {}) or {}
if isinstance(marker_raw, dict):
    for frame, payload in sorted(marker_raw.items(), key=lambda pair: number(pair[0]) if number(pair[0]) is not None else 0):
        if len(markers) >= MAX_MARKERS:
            markers_truncated = True
            break
        payload = payload if isinstance(payload, dict) else {}
        markers.append({
            "frame": number(frame),
            "color": text(payload.get("color"), 64),
            "duration": number(payload.get("duration")),
            "name": text(payload.get("name"), 128),
            "note": text(payload.get("note"), 512),
            "customData": text(payload.get("customData"), 256)
        })

flags = []
raw_flags = call_checked("GetFlagList", []) or []
if isinstance(raw_flags, list):
    for flag in raw_flags[:MAX_FLAGS]:
        flag_text = text(flag, 64)
        if flag_text:
            flags.append(flag_text)

clip_color = text(call_checked("GetClipColor"), 64)

audio_mapping = None
raw_mapping = call_checked("GetAudioMapping")
if raw_mapping is not None:
    try:
        parsed_mapping = json.loads(raw_mapping) if isinstance(raw_mapping, str) else raw_mapping
        if isinstance(parsed_mapping, dict):
            track_mapping = parsed_mapping.get("track_mapping") or {}
            track_count = 0
            mapped_channel_count = 0
            if isinstance(track_mapping, dict):
                for track in track_mapping.values():
                    if not isinstance(track, dict):
                        continue
                    track_count += 1
                    channels = track.get("channel_idx")
                    if isinstance(channels, list):
                        mapped_channel_count += len(channels)
            audio_mapping = {
                "embeddedAudioChannels": integer(parsed_mapping.get("embedded_audio_channels")),
                "trackCount": track_count,
                "mappedChannelCount": mapped_channel_count
            }
        else:
            failed_methods.append("GetAudioMapping")
    except:
        if "GetAudioMapping" not in failed_methods:
            failed_methods.append("GetAudioMapping")

is_timeline = None
timeline_value = call_checked("GetTimeline")
if item and "GetTimeline" in method_names and "GetTimeline" not in failed_methods:
    is_timeline = timeline_value is not None

item_result = None
if item:
    online_raw = text(props.get("Online Status"), 64)
    online_normalized = online_raw.lower() if online_raw else ""
    online = True if online_normalized == "online" else False if online_normalized == "offline" else None
    proxy_path_present = bool(text(props.get("Proxy Media Path"), 4096))
    proxy_raw = text(props.get("Proxy"), 64)
    proxy_normalized = proxy_raw.lower() if proxy_raw else ""
    has_proxy = True if proxy_path_present else False if proxy_normalized == "none" else None
    item_result = {
        "id": item.GetUniqueId(),
        "name": item.GetName(),
        "resolveType": text(props.get("Type"), 128),
        "isTimeline": is_timeline,
        "duration": text(props.get("Duration"), 64),
        "frames": integer(props.get("Frames")),
        "fps": number(props.get("FPS")),
        "resolution": resolution(props.get("Resolution")),
        "videoCodec": text(props.get("Video Codec"), 128),
        "audioCodec": text(props.get("Audio Codec"), 128),
        "audioBitDepth": integer(props.get("Audio Bit Depth")),
        "audioChannels": integer(props.get("Audio Ch")),
        "startTimecode": text(props.get("Start TC"), 64),
        "endTimecode": text(props.get("End TC"), 64),
        "online": online,
        "hasProxyMedia": has_proxy,
        "clipColor": clip_color,
        "flags": flags,
        "audioMapping": audio_mapping
    }

result = {
    "readerId": "media.clip_inspect.v1",
    "requestedItemId": target_id,
    "lookup": lookup,
    "search": {
        "foldersObserved": folders_seen,
        "itemsObserved": items_seen,
        "truncated": bool(truncated)
    },
    "item": item_result,
    "metadata": metadata,
    "metadataTruncated": bool(metadata_truncated),
    "thirdPartyMetadata": third_party_metadata,
    "thirdPartyMetadataTruncated": bool(third_party_metadata_truncated),
    "markers": markers,
    "markersTruncated": bool(markers_truncated),
    "methodEvidence": {
        "strategy": "dir",
        "checkedMethods": CHECKED_METHODS,
        "observedMethods": observed_methods,
        "missingMethods": missing_methods,
        "failedMethods": failed_methods
    }
}`;
}

const MEDIA_LINK_POOL_METHODS = ['RelinkClips', 'UnlinkClips'] as const;
const MEDIA_LINK_ITEM_METHODS = ['LinkProxyMedia', 'UnlinkProxyMedia', 'LinkFullResolutionMedia'] as const;

function mediaLinkStatusScript(itemId?: string): string {
  const targetId = itemId === undefined ? 'None' : JSON.stringify(itemId);
  const poolMethods = JSON.stringify(MEDIA_LINK_POOL_METHODS);
  const itemMethods = JSON.stringify(MEDIA_LINK_ITEM_METHODS);
  return `target_id = ${targetId}
p = project
mp = p.GetMediaPool() if p else None
root = mp.GetRootFolder() if mp else None
MAX_FOLDERS = 200
MAX_ITEMS = 1000
POOL_METHODS = ${poolMethods}
ITEM_METHODS = ${itemMethods}

pool_probed = False
pool_observed = []
pool_missing = []
if mp:
    try:
        pool_names = set(dir(mp))
        pool_probed = True
        pool_observed = [name for name in POOL_METHODS if name in pool_names]
        pool_missing = [name for name in POOL_METHODS if name not in pool_names]
    except:
        pool_probed = False

folders_seen = 0
items_seen = 0
truncated = False
item = None
if target_id is not None and root:
    stack = [root]
    while stack:
        if folders_seen >= MAX_FOLDERS:
            truncated = True
            break
        folder = stack.pop()
        folders_seen += 1
        subfolders = folder.GetSubFolderList() or []
        for subfolder in reversed(subfolders):
            if folders_seen + len(stack) >= MAX_FOLDERS:
                truncated = True
                break
            stack.append(subfolder)
        clips = folder.GetClipList() or []
        for candidate in clips:
            if items_seen >= MAX_ITEMS:
                truncated = True
                break
            items_seen += 1
            try:
                candidate_id = candidate.GetUniqueId()
            except:
                candidate_id = None
            if candidate_id == target_id:
                item = candidate
                break
        if item or items_seen >= MAX_ITEMS:
            break

item_lookup = "not_requested" if target_id is None else "found" if item else "unverified" if truncated else "not_found"
item_probed = False
item_observed = []
item_missing = []
if item:
    try:
        item_names = set(dir(item))
        item_probed = True
        item_observed = [name for name in ITEM_METHODS if name in item_names]
        item_missing = [name for name in ITEM_METHODS if name not in item_names]
    except:
        item_probed = False

result = {
    "readerId": "media.link_status.v1",
    "requestedItemId": target_id,
    "itemLookup": item_lookup,
    "search": {
        "foldersObserved": folders_seen,
        "itemsObserved": items_seen,
        "truncated": bool(truncated)
    },
    "methodEvidence": {
        "strategy": "dir",
        "mediaPool": {
            "probed": pool_probed,
            "checkedMethods": POOL_METHODS,
            "observedMethods": pool_observed,
            "missingMethods": pool_missing
        },
        "mediaPoolItem": {
            "probed": item_probed,
            "checkedMethods": ITEM_METHODS,
            "observedMethods": item_observed,
            "missingMethods": item_missing
        }
    }
}`;
}

const EDIT_STRUCTURE_METHODS = [
  'GetUniqueId', 'GetName', 'GetStart', 'GetEnd', 'GetDuration', 'GetLeftOffset', 'GetRightOffset',
  'GetSourceStartFrame', 'GetSourceEndFrame', 'GetMediaPoolItem'
] as const;

const READ_ONLY_EDIT_STRUCTURE_SCRIPT = `p = project
t = p.GetCurrentTimeline() if p else None
MAX_TRACKS = 64
MAX_ITEMS = 2000
METHODS = ["GetUniqueId", "GetName", "GetStart", "GetEnd", "GetDuration", "GetLeftOffset", "GetRightOffset", "GetSourceStartFrame", "GetSourceEndFrame", "GetMediaPoolItem"]
track_types = ["video", "audio", "subtitle"]
tracks = []
tracks_observed = 0
items_observed = 0
tracks_truncated = False
items_truncated = False
missing_methods = set()
failed_methods = set()
fully_observed = set(METHODS)


def integer(value):
    try:
        return int(value)
    except:
        return None


def item_call(item, name):
    try:
        if name == "GetUniqueId": return item.GetUniqueId()
        if name == "GetName": return item.GetName()
        if name == "GetStart": return item.GetStart()
        if name == "GetEnd": return item.GetEnd()
        if name == "GetDuration": return item.GetDuration()
        if name == "GetLeftOffset": return item.GetLeftOffset()
        if name == "GetRightOffset": return item.GetRightOffset()
        if name == "GetSourceStartFrame": return item.GetSourceStartFrame()
        if name == "GetSourceEndFrame": return item.GetSourceEndFrame()
        if name == "GetMediaPoolItem":
            media = item.GetMediaPoolItem()
            return media.GetUniqueId() if media else None
    except:
        failed_methods.add(name)
        return None
    return None

if t:
    for track_type in track_types:
        count = t.GetTrackCount(track_type)
        for track_index in range(1, count + 1):
            if tracks_observed >= MAX_TRACKS:
                tracks_truncated = True
                break
            raw_items = t.GetItemListInTrack(track_type, track_index) or []
            item_rows = []
            for item in raw_items:
                if items_observed >= MAX_ITEMS:
                    items_truncated = True
                    break
                items_observed += 1
                names = set(dir(item))
                observed = set(name for name in METHODS if name in names)
                fully_observed.intersection_update(observed)
                missing_methods.update(name for name in METHODS if name not in names)
                values = {name: item_call(item, name) if name in observed else None for name in METHODS}
                item_rows.append({
                    "id": values["GetUniqueId"],
                    "name": values["GetName"],
                    "recordStart": integer(values["GetStart"]),
                    "recordEnd": integer(values["GetEnd"]),
                    "duration": integer(values["GetDuration"]),
                    "sourceStart": integer(values["GetSourceStartFrame"]),
                    "sourceEnd": integer(values["GetSourceEndFrame"]),
                    "leftOffset": integer(values["GetLeftOffset"]),
                    "rightOffset": integer(values["GetRightOffset"]),
                    "mediaPoolItemId": values["GetMediaPoolItem"]
                })
            tracks.append({
                "type": track_type,
                "index": track_index,
                "name": t.GetTrackName(track_type, track_index),
                "enabled": t.GetIsTrackEnabled(track_type, track_index),
                "locked": t.GetIsTrackLocked(track_type, track_index),
                "items": item_rows
            })
            tracks_observed += 1
            if items_truncated:
                break
        if tracks_truncated or items_truncated:
            break

result = None if not t else {
    "readerId": "edit.structure_inspect.v1",
    "timeline": {
        "id": t.GetUniqueId(),
        "name": t.GetName(),
        "startFrame": integer(t.GetStartFrame()),
        "endFrame": integer(t.GetEndFrame())
    },
    "tracksObserved": tracks_observed,
    "itemsObserved": items_observed,
    "tracksTruncated": tracks_truncated,
    "itemsTruncated": items_truncated,
    "methodEvidence": {
        "strategy": "dir",
        "checkedMethods": METHODS,
        "fullyObservedMethods": sorted(list(fully_observed)) if items_observed else [],
        "missingMethods": sorted(list(missing_methods)),
        "failedMethods": sorted(list(failed_methods)),
        "itemsProbed": items_observed
    },
    "tracks": tracks
}`;

const EDIT_TRANSITION_METHODS = ['AddTransition', 'GetFades', 'SetFades'] as const;

const READ_ONLY_EDIT_TRANSITION_SCRIPT = `p = project
t = p.GetCurrentTimeline() if p else None
MAX_TRACKS = 64
MAX_ITEMS = 2000
METHODS = ["AddTransition", "GetFades", "SetFades"]
track_types = ["video", "audio"]
rows = []
tracks_observed = 0
items_observed = 0
tracks_truncated = False
items_truncated = False
missing_methods = set()
failed_read_methods = set()
fully_observed = set(METHODS)


def finite_number(value):
    try:
        number = float(value)
        return number if number == number and number not in (float("inf"), float("-inf")) else None
    except:
        return None


if t:
    for track_type in track_types:
        count = t.GetTrackCount(track_type) or 0
        for track_index in range(1, count + 1):
            if tracks_observed >= MAX_TRACKS:
                tracks_truncated = True
                break
            track_name = t.GetTrackName(track_type, track_index)
            raw_items = t.GetItemListInTrack(track_type, track_index) or []
            for item in raw_items:
                if items_observed >= MAX_ITEMS:
                    items_truncated = True
                    break
                items_observed += 1
                names = set(dir(item))
                observed = set(name for name in METHODS if name in names)
                fully_observed.intersection_update(observed)
                missing_methods.update(name for name in METHODS if name not in names)
                readback = "unavailable"
                fade_in = None
                fade_out = None
                if "GetFades" in observed:
                    try:
                        fades = item.GetFades()
                        readback = "observed"
                        if isinstance(fades, dict):
                            fade_in = finite_number(fades.get("FadeIn"))
                            fade_out = finite_number(fades.get("FadeOut"))
                    except:
                        readback = "failed"
                        failed_read_methods.add("GetFades")
                rows.append({
                    "trackType": track_type,
                    "trackIndex": track_index,
                    "trackName": track_name,
                    "timelineItemId": item.GetUniqueId(),
                    "name": item.GetName(),
                    "fadeIn": fade_in,
                    "fadeOut": fade_out,
                    "getFadesReadback": readback
                })
            tracks_observed += 1
            if items_truncated:
                break
        if tracks_truncated or items_truncated:
            break

result = None if not t else {
    "readerId": "edit.transition_inspect.v1",
    "timeline": {
        "id": t.GetUniqueId(),
        "name": t.GetName()
    },
    "tracksObserved": tracks_observed,
    "itemsObserved": items_observed,
    "itemsReported": len(rows),
    "tracksTruncated": tracks_truncated,
    "itemsTruncated": items_truncated,
    "methodEvidence": {
        "strategy": "dir",
        "checkedMethods": METHODS,
        "fullyObservedMethods": sorted(list(fully_observed)) if items_observed else [],
        "missingMethods": sorted(list(missing_methods)),
        "failedReadMethods": sorted(list(failed_read_methods)),
        "itemsProbed": items_observed
    },
    "items": rows
}`;

const EDIT_ANNOTATION_TIMELINE_METHODS = ['GetMarkers'] as const;
const EDIT_ANNOTATION_ITEM_METHODS = ['GetUniqueId', 'GetName', 'GetMarkers', 'GetMediaPoolItem'] as const;
const EDIT_ANNOTATION_MEDIA_METHODS = ['GetUniqueId', 'GetName', 'GetMarkers', 'GetFlagList', 'GetClipColor'] as const;

const READ_ONLY_EDIT_REVIEW_ANNOTATIONS_SCRIPT = `p = project
t = p.GetCurrentTimeline() if p else None
MAX_TRACKS = 64
MAX_ITEMS = 2000
MAX_MARKER_ROWS = 2000
MAX_FLAGS = 64
TIMELINE_METHODS = ["GetMarkers"]
ITEM_METHODS = ["GetUniqueId", "GetName", "GetMarkers", "GetMediaPoolItem"]
MEDIA_METHODS = ["GetUniqueId", "GetName", "GetMarkers", "GetFlagList", "GetClipColor"]
track_types = ["video", "audio", "subtitle"]
marker_rows = []
media_rows = []
tracks_observed = 0
items_observed = 0
tracks_truncated = False
items_truncated = False
marker_rows_truncated = False
timeline_marker_count = 0
item_marker_count = 0
media_marker_count = 0
flagged_media_count = 0
colored_media_count = 0
seen_media = set()

timeline_observed = []
timeline_missing = []
timeline_failed = []
item_missing = set()
item_failed = set()
item_fully_observed = set(ITEM_METHODS)
media_missing = set()
media_failed = set()
media_fully_observed = set(MEDIA_METHODS)
media_probed = 0


def text(value, limit):
    if value is None:
        return None
    try:
        value = str(value).strip()
    except:
        return None
    return value[:limit] if value else None


def number(value):
    try:
        value = float(value)
        return value if value == value and value not in (float("inf"), float("-inf")) else None
    except:
        return None


def append_markers(scope, target_id, target_name, track_type, track_index, raw):
    global marker_rows_truncated
    if not isinstance(raw, dict):
        return 0
    ordered = sorted(raw.items(), key=lambda pair: number(pair[0]) if number(pair[0]) is not None else 0)
    for frame, payload in ordered:
        if len(marker_rows) >= MAX_MARKER_ROWS:
            marker_rows_truncated = True
            break
        payload = payload if isinstance(payload, dict) else {}
        marker_rows.append({
            "scope": scope,
            "targetId": target_id,
            "targetName": target_name,
            "trackType": track_type,
            "trackIndex": track_index,
            "frame": number(frame),
            "color": text(payload.get("color"), 64),
            "duration": number(payload.get("duration")),
            "name": text(payload.get("name"), 128),
            "note": text(payload.get("note"), 512),
            "customData": text(payload.get("customData"), 256)
        })
    return len(raw)


if t:
    timeline_names = set(dir(t))
    timeline_observed = [name for name in TIMELINE_METHODS if name in timeline_names]
    timeline_missing = [name for name in TIMELINE_METHODS if name not in timeline_names]
    if "GetMarkers" in timeline_names:
        try:
            timeline_raw = t.GetMarkers()
            if not isinstance(timeline_raw, dict):
                timeline_failed.append("GetMarkers")
            else:
                timeline_marker_count = append_markers("timeline", t.GetUniqueId(), t.GetName(), None, None, timeline_raw)
        except:
            timeline_failed.append("GetMarkers")

    for track_type in track_types:
        count = t.GetTrackCount(track_type) or 0
        for track_index in range(1, count + 1):
            if tracks_observed >= MAX_TRACKS:
                tracks_truncated = True
                break
            raw_items = t.GetItemListInTrack(track_type, track_index) or []
            for item in raw_items:
                if items_observed >= MAX_ITEMS:
                    items_truncated = True
                    break
                items_observed += 1
                item_names = set(dir(item))
                observed = set(name for name in ITEM_METHODS if name in item_names)
                item_fully_observed.intersection_update(observed)
                item_missing.update(name for name in ITEM_METHODS if name not in item_names)
                item_id = None
                item_name = None
                media = None
                try:
                    if "GetUniqueId" in observed:
                        raw_item_id = item.GetUniqueId()
                        item_id = raw_item_id.strip() if isinstance(raw_item_id, str) and raw_item_id.strip() else None
                        if item_id is None:
                            item_failed.add("GetUniqueId")
                except:
                    item_failed.add("GetUniqueId")
                try:
                    if "GetName" in observed:
                        raw_item_name = item.GetName()
                        item_name = raw_item_name.strip() if isinstance(raw_item_name, str) and raw_item_name.strip() else None
                        if item_name is None:
                            item_failed.add("GetName")
                except:
                    item_failed.add("GetName")
                if "GetMarkers" in observed:
                    try:
                        item_raw = item.GetMarkers()
                        if not isinstance(item_raw, dict):
                            item_failed.add("GetMarkers")
                        else:
                            item_marker_count += append_markers("timeline_item", item_id, item_name, track_type, track_index, item_raw)
                    except:
                        item_failed.add("GetMarkers")
                if "GetMediaPoolItem" in observed:
                    try:
                        media = item.GetMediaPoolItem()
                    except:
                        item_failed.add("GetMediaPoolItem")

                if media:
                    media_probed += 1
                    media_names = set(dir(media))
                    media_observed = set(name for name in MEDIA_METHODS if name in media_names)
                    media_fully_observed.intersection_update(media_observed)
                    media_missing.update(name for name in MEDIA_METHODS if name not in media_names)
                    media_id = None
                    media_name = None
                    try:
                        if "GetUniqueId" in media_observed:
                            raw_media_id = media.GetUniqueId()
                            media_id = raw_media_id.strip() if isinstance(raw_media_id, str) and raw_media_id.strip() else None
                            if media_id is None:
                                media_failed.add("GetUniqueId")
                    except:
                        media_failed.add("GetUniqueId")
                    try:
                        if "GetName" in media_observed:
                            raw_media_name = media.GetName()
                            media_name = raw_media_name.strip() if isinstance(raw_media_name, str) and raw_media_name.strip() else None
                            if media_name is None:
                                media_failed.add("GetName")
                    except:
                        media_failed.add("GetName")
                    if media_id and media_id not in seen_media:
                        seen_media.add(media_id)
                        media_markers = {}
                        flags = []
                        flags_truncated = False
                        clip_color = None
                        if "GetMarkers" in media_observed:
                            try:
                                raw_media_markers = media.GetMarkers()
                                if not isinstance(raw_media_markers, dict):
                                    media_failed.add("GetMarkers")
                                else:
                                    media_markers = raw_media_markers
                                    media_marker_count += append_markers("media_pool_item", media_id, media_name, None, None, media_markers)
                            except:
                                media_failed.add("GetMarkers")
                        if "GetFlagList" in media_observed:
                            try:
                                raw_flags = media.GetFlagList()
                                if isinstance(raw_flags, list):
                                    flags_truncated = len(raw_flags) > MAX_FLAGS
                                    if any(not isinstance(flag, str) for flag in raw_flags):
                                        media_failed.add("GetFlagList")
                                    flags = [flag.strip()[:64] for flag in raw_flags[:MAX_FLAGS] if isinstance(flag, str) and flag.strip()]
                                else:
                                    media_failed.add("GetFlagList")
                            except:
                                media_failed.add("GetFlagList")
                        if "GetClipColor" in media_observed:
                            try:
                                raw_clip_color = media.GetClipColor()
                                if raw_clip_color is None or isinstance(raw_clip_color, str):
                                    clip_color = raw_clip_color.strip()[:64] if isinstance(raw_clip_color, str) and raw_clip_color.strip() else None
                                else:
                                    media_failed.add("GetClipColor")
                            except:
                                media_failed.add("GetClipColor")
                        if flags:
                            flagged_media_count += 1
                        if clip_color:
                            colored_media_count += 1
                        media_rows.append({
                            "mediaPoolItemId": media_id,
                            "name": media_name,
                            "flags": flags,
                            "flagsTruncated": flags_truncated,
                            "clipColor": clip_color,
                            "markerCountObserved": len(media_markers) if isinstance(media_markers, dict) else 0
                        })
            tracks_observed += 1
            if items_truncated:
                break
        if tracks_truncated or items_truncated:
            break

result = None if not t else {
    "readerId": "edit.review_annotations_inspect.v1",
    "timeline": {"id": t.GetUniqueId(), "name": t.GetName()},
    "tracksObserved": tracks_observed,
    "itemsObserved": items_observed,
    "mediaPoolItemsObserved": len(seen_media),
    "timelineMarkerCountObserved": timeline_marker_count,
    "timelineItemMarkerCountObserved": item_marker_count,
    "mediaPoolMarkerCountObserved": media_marker_count,
    "flaggedMediaPoolItemCountObserved": flagged_media_count,
    "coloredMediaPoolItemCountObserved": colored_media_count,
    "tracksTruncated": tracks_truncated,
    "itemsTruncated": items_truncated,
    "markerRowsTruncated": marker_rows_truncated,
    "methodEvidence": {
        "strategy": "dir",
        "timeline": {
            "checkedMethods": TIMELINE_METHODS,
            "observedMethods": sorted(timeline_observed),
            "missingMethods": sorted(timeline_missing),
            "failedMethods": sorted(timeline_failed)
        },
        "timelineItem": {
            "checkedMethods": ITEM_METHODS,
            "fullyObservedMethods": sorted(list(item_fully_observed)) if items_observed else [],
            "missingMethods": sorted(list(item_missing)),
            "failedMethods": sorted(list(item_failed)),
            "itemsProbed": items_observed
        },
        "mediaPoolItem": {
            "checkedMethods": MEDIA_METHODS,
            "fullyObservedMethods": sorted(list(media_fully_observed)) if media_probed else [],
            "missingMethods": sorted(list(media_missing)),
            "failedMethods": sorted(list(media_failed)),
            "itemsProbed": media_probed
        }
    },
    "markers": marker_rows,
    "mediaPoolAnnotations": media_rows
}`;

const FUSION_COMPOSITION_METHODS = [
  'GetUniqueId',
  'GetName',
  'GetFusionCompCount',
  'GetFusionCompNameList',
  'GetFusionCompByIndex',
  'GetFusionCompByName'
] as const;

const READ_ONLY_FUSION_COMPOSITION_SCRIPT = `p = project
t = p.GetCurrentTimeline() if p else None
MAX_VIDEO_TRACKS = 64
MAX_ITEMS = 2000
MAX_COMPOSITIONS_PER_ITEM = 64
METHODS = ["GetUniqueId", "GetName", "GetFusionCompCount", "GetFusionCompNameList", "GetFusionCompByIndex", "GetFusionCompByName"]

def text(value, limit):
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limit] if value else None

result = None
if t:
    timeline_id = text(t.GetUniqueId(), 128)
    timeline_name = text(t.GetName(), 256)
    if not timeline_id or not timeline_name:
        raise Exception("Current timeline identity is unavailable")
    raw_track_count = t.GetTrackCount("video")
    if isinstance(raw_track_count, bool) or not isinstance(raw_track_count, int) or raw_track_count < 0:
        raise Exception("Fusion composition inspection returned invalid video track count")
    tracks_truncated = raw_track_count > MAX_VIDEO_TRACKS
    tracks_scanned = min(raw_track_count, MAX_VIDEO_TRACKS)
    rows = []
    items_observed = 0
    items_truncated = False
    names_truncated_any = False
    item_list_failed = False
    items_probed = 0
    fully_observed = set(METHODS)
    missing_union = set()
    failed_union = set()

    for track_index in range(1, tracks_scanned + 1):
        raw_items = t.GetItemListInTrack("video", track_index)
        if not isinstance(raw_items, list):
            item_list_failed = True
            continue
        items_observed += len(raw_items)
        remaining = max(0, MAX_ITEMS - len(rows))
        if len(raw_items) > remaining:
            items_truncated = True
        for item_index, item in enumerate(raw_items[:remaining], start=1):
            items_probed += 1
            surface = set(dir(item))
            observed = {name for name in METHODS if name in surface}
            missing = set(METHODS) - observed
            fully_observed &= observed
            missing_union |= missing
            failed = set()
            item_id = None
            item_name = None
            comp_count = None
            comp_names = []
            names_truncated = False
            name_list_shape = None

            if "GetUniqueId" in observed:
                try:
                    item_id = text(item.GetUniqueId(), 128)
                    if not item_id:
                        failed.add("GetUniqueId")
                except:
                    failed.add("GetUniqueId")
            if "GetName" in observed:
                try:
                    item_name = text(item.GetName(), 256)
                    if not item_name:
                        failed.add("GetName")
                except:
                    failed.add("GetName")
            if "GetFusionCompCount" in observed:
                try:
                    raw_count = item.GetFusionCompCount()
                    if isinstance(raw_count, bool) or not isinstance(raw_count, int) or raw_count < 0:
                        failed.add("GetFusionCompCount")
                    else:
                        comp_count = raw_count
                        names_truncated = raw_count > MAX_COMPOSITIONS_PER_ITEM
                        names_truncated_any = names_truncated_any or names_truncated
                except:
                    failed.add("GetFusionCompCount")
            if "GetFusionCompNameList" in observed:
                try:
                    raw_names = item.GetFusionCompNameList()
                    if isinstance(raw_names, list):
                        name_list_shape = "list"
                        if comp_count is None or len(raw_names) != comp_count or any(not isinstance(name, str) or not name.strip() for name in raw_names):
                            failed.add("GetFusionCompNameList")
                        else:
                            comp_names = [name.strip()[:256] for name in raw_names[:MAX_COMPOSITIONS_PER_ITEM]]
                    elif isinstance(raw_names, dict) and len(raw_names) == 0 and comp_count == 0:
                        name_list_shape = "empty_dict_zero_count"
                    else:
                        name_list_shape = "unexpected"
                        failed.add("GetFusionCompNameList")
                except:
                    failed.add("GetFusionCompNameList")

            failed_union |= failed
            rows.append({
                "trackIndex": track_index,
                "itemIndex": item_index,
                "id": item_id,
                "name": item_name,
                "compositionCountObserved": comp_count,
                "compositionNames": comp_names,
                "namesTruncated": names_truncated,
                "nameListShape": name_list_shape,
                "missingMethods": sorted(list(missing)),
                "failedMethods": sorted(list(failed))
            })

    if items_observed > MAX_ITEMS:
        items_truncated = True
    result = {
        "readerId": "fusion.composition_inspect.v1",
        "timeline": {"id": timeline_id, "name": timeline_name},
        "videoTrackCount": raw_track_count,
        "tracksScanned": tracks_scanned,
        "videoItemsObserved": items_observed,
        "itemsReported": len(rows),
        "tracksTruncated": tracks_truncated,
        "itemsTruncated": items_truncated,
        "namesTruncated": names_truncated_any,
        "itemListFailed": item_list_failed,
        "items": rows,
        "methodEvidence": {
            "strategy": "dir",
            "checkedMethods": METHODS,
            "fullyObservedMethods": sorted(list(fully_observed)) if items_probed > 0 else [],
            "missingMethods": sorted(list(missing_union)),
            "failedMethods": sorted(list(failed_union)),
            "itemsProbed": items_probed
        }
    }
`;

const FUSION_GRAPH_METHODS = [
  'GetFusionCompByName',
  'GetToolList',
  'GetInputList',
  'GetOutputList',
  'GetConnectedInputs',
  'GetConnectedOutput'
] as const;

const READ_ONLY_FUSION_GRAPH_SCRIPT = `p = project
t = p.GetCurrentTimeline() if p else None
MAX_VIDEO_TRACKS = 64
MAX_ITEMS = 2000
MAX_COMPOSITIONS = 128
MAX_TOOLS = 512
MAX_PORTS = 4096
MAX_EDGES = 4096
METHODS = ["GetFusionCompByName", "GetToolList", "GetInputList", "GetOutputList", "GetConnectedInputs", "GetConnectedOutput"]

def text(value, limit):
    if not isinstance(value, str):
        return None
    value = value.strip()
    return value[:limit] if value else None

def ordered_values(value):
    if not isinstance(value, dict):
        return None
    return list(value.values())

result = None
if t:
    timeline_id = text(t.GetUniqueId(), 128)
    timeline_name = text(t.GetName(), 256)
    if not timeline_id or not timeline_name:
        raise Exception("Current timeline identity is unavailable")
    raw_track_count = t.GetTrackCount("video")
    if isinstance(raw_track_count, bool) or not isinstance(raw_track_count, int) or raw_track_count < 0:
        raise Exception("Fusion graph inspection returned invalid video track count")

    tracks_scanned = min(raw_track_count, MAX_VIDEO_TRACKS)
    tracks_truncated = raw_track_count > MAX_VIDEO_TRACKS
    video_items_observed = 0
    items_scanned = 0
    compositions_observed = 0
    tools_observed = 0
    edges_observed = 0
    port_budget_used = 0
    failed_methods = set()
    composition_rows = []
    tools_reported = 0
    edges_reported = 0
    compositions_truncated = False
    tools_truncated = False
    ports_truncated = False
    edges_truncated = False
    composition_objects_probed = 0
    tools_probed = 0
    outputs_probed = 0
    edges_readback_probed = 0

    for track_index in range(1, tracks_scanned + 1):
        raw_items = t.GetItemListInTrack("video", track_index)
        if not isinstance(raw_items, list):
            raise Exception("Fusion graph inspection returned invalid VIDEO item list")
        video_items_observed += len(raw_items)
        remaining_items = max(0, MAX_ITEMS - items_scanned)
        for item_index, item in enumerate(raw_items[:remaining_items], start=1):
            items_scanned += 1
            item_id = text(item.GetUniqueId(), 128)
            item_name = text(item.GetName(), 256)
            if not item_id or not item_name:
                raise Exception("Fusion graph inspection returned invalid TimelineItem identity")
            raw_count = item.GetFusionCompCount()
            raw_names = item.GetFusionCompNameList()
            if isinstance(raw_count, bool) or not isinstance(raw_count, int) or raw_count < 0:
                raise Exception("Fusion graph inspection returned invalid composition count")
            if isinstance(raw_names, list):
                if len(raw_names) != raw_count or any(not isinstance(name, str) or not name.strip() for name in raw_names):
                    raise Exception("Fusion graph inspection returned invalid composition name list")
                comp_names = [name.strip()[:256] for name in raw_names]
            elif isinstance(raw_names, dict) and len(raw_names) == 0 and raw_count == 0:
                comp_names = []
            else:
                raise Exception("Fusion graph inspection returned unsupported composition name-list shape")

            compositions_observed += raw_count
            remaining_compositions = max(0, MAX_COMPOSITIONS - len(composition_rows))
            if raw_count > remaining_compositions:
                compositions_truncated = True
            for comp_name in comp_names[:remaining_compositions]:
                composition_objects_probed += 1
                comp_row = {
                    "trackIndex": track_index,
                    "itemIndex": item_index,
                    "timelineItemId": item_id,
                    "timelineItemName": item_name,
                    "compositionName": comp_name,
                    "toolCountObserved": 0,
                    "tools": [],
                    "edges": []
                }
                try:
                    comp = item.GetFusionCompByName(comp_name)
                except:
                    comp = None
                    failed_methods.add("GetFusionCompByName")
                if comp is None:
                    failed_methods.add("GetFusionCompByName")
                    composition_rows.append(comp_row)
                    continue

                try:
                    raw_tools = comp.GetToolList(False)
                except:
                    raw_tools = None
                    failed_methods.add("GetToolList")
                tool_values = ordered_values(raw_tools)
                if tool_values is None:
                    failed_methods.add("GetToolList")
                    composition_rows.append(comp_row)
                    continue

                comp_row["toolCountObserved"] = len(tool_values)
                tools_observed += len(tool_values)
                remaining_tools = max(0, MAX_TOOLS - tools_reported)
                if len(tool_values) > remaining_tools:
                    tools_truncated = True

                for tool in tool_values[:remaining_tools]:
                    tools_probed += 1
                    tool_name = text(getattr(tool, "Name", None), 256)
                    tool_id = text(getattr(tool, "ID", None), 256)
                    if not tool_name or not tool_id:
                        failed_methods.add("GetToolList")
                        continue
                    try:
                        raw_inputs = tool.GetInputList()
                    except:
                        raw_inputs = None
                        failed_methods.add("GetInputList")
                    try:
                        raw_outputs = tool.GetOutputList()
                    except:
                        raw_outputs = None
                        failed_methods.add("GetOutputList")
                    input_values = ordered_values(raw_inputs)
                    output_values = ordered_values(raw_outputs)
                    if input_values is None:
                        failed_methods.add("GetInputList")
                        input_values = []
                    if output_values is None:
                        failed_methods.add("GetOutputList")
                        output_values = []

                    comp_row["tools"].append({
                        "name": tool_name,
                        "id": tool_id,
                        "inputCountObserved": len(input_values),
                        "outputCountObserved": len(output_values)
                    })
                    tools_reported += 1

                    tool_port_count = len(input_values) + len(output_values)
                    if port_budget_used + tool_port_count > MAX_PORTS:
                        ports_truncated = True
                        continue
                    port_budget_used += tool_port_count

                    for output in output_values:
                        outputs_probed += 1
                        source_output_id = text(getattr(output, "ID", None), 256)
                        if not source_output_id:
                            failed_methods.add("GetOutputList")
                            continue
                        try:
                            raw_connected = output.GetConnectedInputs()
                        except:
                            raw_connected = None
                            failed_methods.add("GetConnectedInputs")
                        connected_inputs = ordered_values(raw_connected)
                        if connected_inputs is None:
                            failed_methods.add("GetConnectedInputs")
                            continue
                        edges_observed += len(connected_inputs)
                        remaining_edges = max(0, MAX_EDGES - edges_reported)
                        if len(connected_inputs) > remaining_edges:
                            edges_truncated = True
                        for target_input in connected_inputs[:remaining_edges]:
                            target_input_id = text(getattr(target_input, "ID", None), 256)
                            target_tool = target_input.GetTool()
                            target_tool_name = text(getattr(target_tool, "Name", None), 256) if target_tool else None
                            target_tool_id = text(getattr(target_tool, "ID", None), 256) if target_tool else None
                            if not target_input_id or not target_tool_name or not target_tool_id:
                                failed_methods.add("GetConnectedInputs")
                                continue
                            edges_readback_probed += 1
                            bidirectional = False
                            try:
                                reverse_output = target_input.GetConnectedOutput()
                            except:
                                reverse_output = None
                                failed_methods.add("GetConnectedOutput")
                            if reverse_output is not None:
                                reverse_output_id = text(getattr(reverse_output, "ID", None), 256)
                                reverse_tool = reverse_output.GetTool()
                                reverse_tool_name = text(getattr(reverse_tool, "Name", None), 256) if reverse_tool else None
                                reverse_tool_id = text(getattr(reverse_tool, "ID", None), 256) if reverse_tool else None
                                bidirectional = reverse_output_id == source_output_id and reverse_tool_name == tool_name and reverse_tool_id == tool_id
                            if not bidirectional:
                                failed_methods.add("GetConnectedOutput")
                            comp_row["edges"].append({
                                "sourceToolName": tool_name,
                                "sourceToolId": tool_id,
                                "sourceOutputId": source_output_id,
                                "targetToolName": target_tool_name,
                                "targetToolId": target_tool_id,
                                "targetInputId": target_input_id,
                                "bidirectionalReadback": bidirectional
                            })
                            edges_reported += 1
                composition_rows.append(comp_row)

    items_truncated = video_items_observed > items_scanned
    if compositions_observed > len(composition_rows):
        compositions_truncated = compositions_truncated or len(composition_rows) >= MAX_COMPOSITIONS
    if tools_observed > tools_reported and tools_reported >= MAX_TOOLS:
        tools_truncated = True
    if edges_observed > edges_reported and edges_reported >= MAX_EDGES:
        edges_truncated = True

    result = {
        "readerId": "fusion.graph_inspect.v1",
        "timeline": {"id": timeline_id, "name": timeline_name},
        "videoTrackCount": raw_track_count,
        "tracksScanned": tracks_scanned,
        "videoItemsObserved": video_items_observed,
        "itemsScanned": items_scanned,
        "compositionsObserved": compositions_observed,
        "compositionsReported": len(composition_rows),
        "toolsObserved": tools_observed,
        "toolsReported": tools_reported,
        "edgesObserved": edges_observed,
        "edgesReported": edges_reported,
        "tracksTruncated": tracks_truncated,
        "itemsTruncated": items_truncated,
        "compositionsTruncated": compositions_truncated,
        "toolsTruncated": tools_truncated,
        "portsTruncated": ports_truncated,
        "edgesTruncated": edges_truncated,
        "compositions": composition_rows,
        "methodEvidence": {
            "checkedMethods": METHODS,
            "failedMethods": sorted(list(failed_methods)),
            "compositionObjectsProbed": composition_objects_probed,
            "toolsProbed": tools_probed,
            "outputsProbed": outputs_probed,
            "edgesReadbackProbed": edges_readback_probed
        }
    }
`;

const READ_ONLY_EDIT_TIMELINE_SUMMARY_SCRIPT = `p = project
t = p.GetCurrentTimeline() if p else None
ts = t.GetSettings() if t else None

def number(value):
    try:
        return float(value)
    except:
        return None

MAX_TRACKS = 64
MAX_SOURCE_STATE_ITEMS = 2000
track_types = ["video", "audio", "subtitle"]
tracks = []
track_counts = {track_type: (t.GetTrackCount(track_type) if t else 0) for track_type in track_types}
timeline_item_count = 0
subtitle_item_count = 0
items_scanned = 0
offline_source_items = 0
online_state_unverified_items = 0
items_without_media_pool_reference = 0
tracks_truncated = False
source_state_scan_truncated = False

if t:
    for track_type in track_types:
        count = track_counts[track_type]
        for index in range(1, count + 1):
            if len(tracks) >= MAX_TRACKS:
                tracks_truncated = True
                break
            items = t.GetItemListInTrack(track_type, index) or []
            item_count = len(items)
            timeline_item_count += item_count
            if track_type == "subtitle":
                subtitle_item_count += item_count

            track_offline = 0
            track_online_unverified = 0
            track_without_reference = 0
            for item in items:
                if items_scanned >= MAX_SOURCE_STATE_ITEMS:
                    source_state_scan_truncated = True
                    break
                items_scanned += 1
                media_pool_item = item.GetMediaPoolItem()
                if media_pool_item is None:
                    items_without_media_pool_reference += 1
                    track_without_reference += 1
                    continue
                online_raw = str(media_pool_item.GetClipProperty("Online Status") or "").strip().lower()
                if online_raw == "offline":
                    offline_source_items += 1
                    track_offline += 1
                elif online_raw != "online":
                    online_state_unverified_items += 1
                    track_online_unverified += 1

            tracks.append({
                "type": track_type,
                "index": index,
                "name": t.GetTrackName(track_type, index),
                "enabled": t.GetIsTrackEnabled(track_type, index),
                "locked": t.GetIsTrackLocked(track_type, index),
                "itemCount": item_count,
                "offlineSourceItemCountObserved": track_offline,
                "onlineStateUnverifiedItemCountObserved": track_online_unverified,
                "itemsWithoutMediaPoolReferenceCountObserved": track_without_reference
            })
        if tracks_truncated:
            break

start_frame = t.GetStartFrame() if t else None
end_frame = t.GetEndFrame() if t else None
duration_frames = None
if start_frame is not None and end_frame is not None:
    duration_frames = max(0, end_frame - start_frame)

result = None if not t else {
    "readerId": "edit.timeline_summary.v1",
    "timeline": {
        "id": t.GetUniqueId(),
        "name": t.GetName(),
        "startFrame": start_frame,
        "endFrame": end_frame,
        "durationFrames": duration_frames,
        "startTimecode": t.GetStartTimecode(),
        "frameRate": number(ts.get("timelineFrameRate")) if ts else None
    },
    "trackCounts": track_counts,
    "timelineItemCountObserved": timeline_item_count,
    "itemsScannedForSourceState": items_scanned,
    "markerCount": len(t.GetMarkers() or {}),
    "subtitleItemCount": subtitle_item_count,
    "offlineSourceItemCountObserved": offline_source_items,
    "onlineStateUnverifiedItemCountObserved": online_state_unverified_items,
    "itemsWithoutMediaPoolReferenceCountObserved": items_without_media_pool_reference,
    "tracks": tracks,
    "complete": not tracks_truncated and not source_state_scan_truncated,
    "tracksTruncated": tracks_truncated,
    "sourceStateScanTruncated": source_state_scan_truncated
}`;

const READ_ONLY_COLOR_PIPELINE_SCRIPT = `p = project
t = p.GetCurrentTimeline() if p else None
ps = p.GetSettings() if p else None
ts = t.GetSettings() if t else None
effective = ts if ts else ps

def boolean_setting(value):
    if value is True or value == 1 or value == "1":
        return True
    if value is False or value == 0 or value == "0":
        return False
    return None

MAX_ITEMS = 200
MAX_ITEM_ROWS = 50
MAX_GROUP_ROWS = 32
MAX_NODES_PER_ITEM = 128

groups = p.GetColorGroupsList() or [] if p else []
group_rows = []
for group in groups[:MAX_GROUP_ROWS]:
    group_rows.append({
        "name": group.GetName(),
        "currentTimelineItemCount": len(group.GetClipsInTimeline(t) or []) if t else 0
    })

video_item_count = 0
video_items_scanned = 0
grouped_items = 0
node_count_observed = 0
lut_reference_count = 0
items_truncated = False
nodes_truncated = False
item_rows = []

if t:
    video_track_count = t.GetTrackCount("video")
    for track_index in range(1, video_track_count + 1):
        track_items = t.GetItemListInTrack("video", track_index) or []
        video_item_count += len(track_items)
        for item in track_items:
            if video_items_scanned >= MAX_ITEMS:
                items_truncated = True
                break
            video_items_scanned += 1
            group = item.GetColorGroup()
            if group:
                grouped_items += 1
            graph = item.GetNodeGraph()
            node_count = graph.GetNumNodes() if graph else None
            if node_count is not None:
                node_count_observed += node_count
            lut_count = 0
            if graph and node_count:
                scan_nodes = min(node_count, MAX_NODES_PER_ITEM)
                if node_count > MAX_NODES_PER_ITEM:
                    nodes_truncated = True
                for node_index in range(1, scan_nodes + 1):
                    lut = graph.GetLUT(node_index)
                    if isinstance(lut, str) and lut.strip():
                        lut_count += 1
                        lut_reference_count += 1
            local_versions = item.GetVersionNameList(0) or []
            remote_versions = item.GetVersionNameList(1) or []
            current_version = item.GetCurrentVersion() or {}
            if len(item_rows) < MAX_ITEM_ROWS:
                item_rows.append({
                    "id": item.GetUniqueId(),
                    "name": item.GetName(),
                    "nodeCount": node_count,
                    "groupName": group.GetName() if group else None,
                    "currentVersionName": current_version.get("versionName"),
                    "currentVersionType": current_version.get("versionType"),
                    "localVersionCount": len(local_versions),
                    "remoteVersionCount": len(remote_versions),
                    "lutReferenceCount": lut_count
                })
        if items_truncated:
            break

result = None if not p else {
    "readerId": "color.pipeline_inspect.v1",
    "settings": None if not effective else {
        "colorScienceMode": effective.get("colorScienceMode"),
        "inputColorSpace": ps.get("colorSpaceInput") if ps else None,
        "inputGamma": ps.get("colorSpaceInputGamma") if ps else None,
        "timelineColorSpace": effective.get("colorSpaceTimeline"),
        "timelineGamma": effective.get("colorSpaceTimelineGamma"),
        "outputColorSpace": effective.get("colorSpaceOutput"),
        "outputGamma": effective.get("colorSpaceOutputGamma"),
        "outputToneMapping": effective.get("colorSpaceOutputToneMapping"),
        "outputGamutMapping": effective.get("colorSpaceOutputGamutMapping"),
        "colorSpaceAwareGradingTools": boolean_setting(effective.get("useColorSpaceAwareGradingTools"))
    },
    "colorGroupCount": len(groups),
    "colorGroups": group_rows,
    "videoItemCountObserved": video_item_count,
    "videoItemsScanned": video_items_scanned,
    "groupedItemCountObserved": grouped_items,
    "nodeCountObserved": node_count_observed,
    "lutReferenceCountObserved": lut_reference_count,
    "items": item_rows,
    "complete": not items_truncated and not nodes_truncated and len(groups) <= MAX_GROUP_ROWS,
    "itemsTruncated": items_truncated or len(groups) > MAX_GROUP_ROWS,
    "nodesTruncated": nodes_truncated
}`;

const READ_ONLY_COLOR_GRAPH_SCRIPT = `p = project
t = p.GetCurrentTimeline() if p else None

MAX_VIDEO_TRACKS = 64
MAX_ITEMS = 200
MAX_NODE_STACK_LAYERS = 32
MAX_COLOR_GROUPS = 32
MAX_NODES = 2048
MAX_TOOLS_PER_NODE = 64

GRAPH_METHODS = [
    "Graph.GetNumNodes",
    "Graph.GetNodeLabel",
    "Graph.GetLUT",
    "Graph.GetNodeCacheMode",
    "Graph.GetToolsInNode"
]

CHECKED_METHODS = [
    "Timeline.GetNodeGraph",
    "TimelineItem.GetNodeGraph",
    "ColorGroup.GetPreClipNodeGraph",
    "ColorGroup.GetPostClipNodeGraph"
] + GRAPH_METHODS

successful_methods = set()
missing_methods = set()
failed_methods = set()
graph_objects_probed = 0
nodes_probed = 0
tools_truncated_any = False

def add_missing(name, row):
    missing_methods.add(name)
    if name not in row["missingMethods"]:
        row["missingMethods"].append(name)

def add_failed(name, row):
    failed_methods.add(name)
    if name not in row["failedMethods"]:
        row["failedMethods"].append(name)

def graph_row(owner, owner_method, scope, track_index=None, item_index=None, layer_index=None, item_id=None, item_name=None, group_index=None, group_name=None, node_budget=None):
    global graph_objects_probed, nodes_probed, tools_truncated_any
    row = {
        "scope": scope,
        "trackIndex": track_index,
        "itemIndex": item_index,
        "layerIndex": layer_index,
        "timelineItemId": item_id,
        "timelineItemName": item_name,
        "colorGroupIndex": group_index,
        "colorGroupName": group_name,
        "graphAccess": "missing",
        "nodeCountObserved": None,
        "nodesReported": 0,
        "nodesTruncated": False,
        "nodes": [],
        "missingMethods": [],
        "failedMethods": []
    }
    try:
        owner_methods = set(dir(owner)) if owner else set()
    except:
        add_failed(owner_method, row)
        row["graphAccess"] = "failed"
        return row
    owner_method_name = owner_method.split(".", 1)[1]
    if owner_method_name not in owner_methods:
        add_missing(owner_method, row)
        return row
    try:
        if owner_method == "Timeline.GetNodeGraph":
            graph = owner.GetNodeGraph()
        elif owner_method == "TimelineItem.GetNodeGraph":
            graph = owner.GetNodeGraph(layer_index)
        elif owner_method == "ColorGroup.GetPreClipNodeGraph":
            graph = owner.GetPreClipNodeGraph()
        elif owner_method == "ColorGroup.GetPostClipNodeGraph":
            graph = owner.GetPostClipNodeGraph()
        else:
            raise RuntimeError("unexpected graph owner method")
        successful_methods.add(owner_method)
    except:
        add_failed(owner_method, row)
        row["graphAccess"] = "failed"
        return row
    if graph is None:
        row["graphAccess"] = "null"
        return row

    row["graphAccess"] = "observed"
    graph_objects_probed += 1
    try:
        graph_methods = set(dir(graph))
    except:
        for name in GRAPH_METHODS:
            add_failed(name, row)
        return row

    for method_name in GRAPH_METHODS:
        short_name = method_name.split(".", 1)[1]
        if short_name not in graph_methods:
            add_missing(method_name, row)

    if "GetNumNodes" not in graph_methods:
        return row
    try:
        node_count = graph.GetNumNodes()
        if not isinstance(node_count, int) or isinstance(node_count, bool) or node_count < 0:
            add_failed("Graph.GetNumNodes", row)
            return row
        successful_methods.add("Graph.GetNumNodes")
        row["nodeCountObserved"] = node_count
    except:
        add_failed("Graph.GetNumNodes", row)
        return row

    remaining = max(0, node_budget["remaining"])
    report_count = min(node_count, remaining)
    if report_count < node_count:
        row["nodesTruncated"] = True
    node_budget["remaining"] -= report_count

    for node_index in range(1, report_count + 1):
        nodes_probed += 1

        label = None
        if "GetNodeLabel" in graph_methods:
            try:
                raw_label = graph.GetNodeLabel(node_index)
                if isinstance(raw_label, str):
                    label = raw_label[:256]
                    successful_methods.add("Graph.GetNodeLabel")
                else:
                    add_failed("Graph.GetNodeLabel", row)
            except:
                add_failed("Graph.GetNodeLabel", row)

        lut_present = None
        if "GetLUT" in graph_methods:
            try:
                raw_lut = graph.GetLUT(node_index)
                if isinstance(raw_lut, str):
                    lut_present = bool(raw_lut.strip())
                    successful_methods.add("Graph.GetLUT")
                else:
                    add_failed("Graph.GetLUT", row)
            except:
                add_failed("Graph.GetLUT", row)

        cache_mode = None
        cache_mode_shape = "unavailable"
        if "GetNodeCacheMode" in graph_methods:
            try:
                raw_cache = graph.GetNodeCacheMode(node_index)
                if raw_cache is None:
                    cache_mode = None
                    cache_mode_shape = "null"
                    successful_methods.add("Graph.GetNodeCacheMode")
                elif isinstance(raw_cache, int) and not isinstance(raw_cache, bool):
                    cache_mode = raw_cache
                    cache_mode_shape = "integer"
                    successful_methods.add("Graph.GetNodeCacheMode")
                else:
                    add_failed("Graph.GetNodeCacheMode", row)
            except:
                add_failed("Graph.GetNodeCacheMode", row)

        tool_names = []
        tool_shape = "null"
        node_tools_truncated = False
        if "GetToolsInNode" in graph_methods:
            try:
                raw_tools = graph.GetToolsInNode(node_index)
                if raw_tools is None:
                    tool_shape = "null"
                    successful_methods.add("Graph.GetToolsInNode")
                elif isinstance(raw_tools, list) and all(isinstance(value, str) for value in raw_tools):
                    tool_shape = "list"
                    node_tools_truncated = len(raw_tools) > MAX_TOOLS_PER_NODE
                    tool_names = [value[:256] for value in raw_tools[:MAX_TOOLS_PER_NODE]]
                    tools_truncated_any = tools_truncated_any or node_tools_truncated
                    successful_methods.add("Graph.GetToolsInNode")
                else:
                    tool_shape = "unexpected"
                    add_failed("Graph.GetToolsInNode", row)
            except:
                tool_shape = "unexpected"
                add_failed("Graph.GetToolsInNode", row)

        row["nodes"].append({
            "index": node_index,
            "label": label,
            "lutReferencePresent": lut_present,
            "cacheMode": cache_mode,
            "cacheModeShape": cache_mode_shape,
            "toolNames": tool_names,
            "toolListShape": tool_shape,
            "toolsTruncated": node_tools_truncated
        })

    row["nodesReported"] = len(row["nodes"])
    return row

result = None
if t:
    timeline_id = t.GetUniqueId()
    timeline_name = t.GetName()
    node_stack_layers_readback = "failed"
    node_stack_layers_configured = None
    node_stack_layers_scanned = 0
    layers_truncated = False
    try:
        project_settings = p.GetSettings() if p else None
        raw_layers = project_settings.get("nodeStackLayers") if isinstance(project_settings, dict) else None
        if isinstance(raw_layers, str):
            cleaned_layers = raw_layers.strip()
            if cleaned_layers.isdigit():
                parsed_layers = int(cleaned_layers)
                if parsed_layers >= 1:
                    node_stack_layers_configured = parsed_layers
                    node_stack_layers_scanned = min(parsed_layers, MAX_NODE_STACK_LAYERS)
                    layers_truncated = parsed_layers > MAX_NODE_STACK_LAYERS
                    node_stack_layers_readback = "observed"
    except:
        pass
    raw_track_count = t.GetTrackCount("video")
    video_track_count = raw_track_count if isinstance(raw_track_count, int) and raw_track_count >= 0 else 0
    tracks_scanned = min(video_track_count, MAX_VIDEO_TRACKS)
    tracks_truncated = video_track_count > MAX_VIDEO_TRACKS
    items_truncated = False
    video_items_observed = 0
    items_scanned = 0
    item_graphs = []
    color_groups_readback = "failed"
    color_group_count_observed = None
    color_groups_scanned = 0
    color_groups_truncated = False
    color_group_graphs = []
    node_budget = {"remaining": MAX_NODES}

    timeline_graph = graph_row(t, "Timeline.GetNodeGraph", "timeline", node_budget=node_budget)

    for track_index in range(1, tracks_scanned + 1):
        track_items = t.GetItemListInTrack("video", track_index) or []
        video_items_observed += len(track_items)
        for item_index, item in enumerate(track_items, 1):
            if items_scanned >= MAX_ITEMS:
                items_truncated = True
                break
            items_scanned += 1
            item_id = item.GetUniqueId()
            item_name = item.GetName()
            for layer_index in range(1, node_stack_layers_scanned + 1):
                item_graphs.append(graph_row(
                    item,
                    "TimelineItem.GetNodeGraph",
                    "item",
                    track_index=track_index,
                    item_index=item_index,
                    layer_index=layer_index,
                    item_id=item_id,
                    item_name=item_name,
                    node_budget=node_budget
                ))
        if items_truncated:
            break

    try:
        raw_groups = p.GetColorGroupsList() if p else None
        if isinstance(raw_groups, list):
            scanned_groups = []
            group_limit = min(len(raw_groups), MAX_COLOR_GROUPS)
            identities_valid = True
            for group_index, group in enumerate(raw_groups[:group_limit], 1):
                raw_group_name = group.GetName()
                if not isinstance(raw_group_name, str) or not raw_group_name.strip():
                    identities_valid = False
                    break
                scanned_groups.append((group_index, group, raw_group_name))
            if identities_valid:
                color_groups_readback = "observed"
                color_group_count_observed = len(raw_groups)
                color_groups_scanned = group_limit
                color_groups_truncated = len(raw_groups) > MAX_COLOR_GROUPS
                for group_index, group, group_name in scanned_groups:
                    color_group_graphs.append(graph_row(
                        group,
                        "ColorGroup.GetPreClipNodeGraph",
                        "group_pre",
                        group_index=group_index,
                        group_name=group_name,
                        node_budget=node_budget
                    ))
                    color_group_graphs.append(graph_row(
                        group,
                        "ColorGroup.GetPostClipNodeGraph",
                        "group_post",
                        group_index=group_index,
                        group_name=group_name,
                        node_budget=node_budget
                    ))
    except:
        pass

    scopes = [timeline_graph] + item_graphs + color_group_graphs
    graphs_observed = sum(1 for row in scopes if row["graphAccess"] == "observed")
    nodes_observed = sum(row["nodeCountObserved"] or 0 for row in scopes)
    nodes_reported = sum(row["nodesReported"] for row in scopes)
    nodes_truncated = any(row["nodesTruncated"] for row in scopes)
    graph_access_complete = all(row["graphAccess"] == "observed" for row in scopes)

    result = {
        "readerId": "color.graph_inventory.v1",
        "timeline": {"id": timeline_id, "name": timeline_name},
        "nodeStackLayersReadback": node_stack_layers_readback,
        "nodeStackLayersConfigured": node_stack_layers_configured,
        "nodeStackLayersScanned": node_stack_layers_scanned,
        "layersTruncated": layers_truncated,
        "videoTrackCount": video_track_count,
        "tracksScanned": tracks_scanned,
        "videoItemsObserved": video_items_observed,
        "itemsScanned": items_scanned,
        "colorGroupsReadback": color_groups_readback,
        "colorGroupCountObserved": color_group_count_observed,
        "colorGroupsScanned": color_groups_scanned,
        "colorGroupsTruncated": color_groups_truncated,
        "graphsObserved": graphs_observed,
        "nodesObserved": nodes_observed,
        "nodesReported": nodes_reported,
        "tracksTruncated": tracks_truncated,
        "itemsTruncated": items_truncated,
        "nodesTruncated": nodes_truncated,
        "toolsTruncated": tools_truncated_any,
        "timelineGraph": timeline_graph,
        "itemGraphs": item_graphs,
        "colorGroupGraphs": color_group_graphs,
        "complete": node_stack_layers_readback == "observed" and color_groups_readback == "observed" and not layers_truncated and not color_groups_truncated and not tracks_truncated and not items_truncated and not nodes_truncated and not tools_truncated_any and graph_access_complete and not missing_methods and not failed_methods,
        "methodEvidence": {
            "checkedMethods": CHECKED_METHODS,
            "fullyObservedMethods": [name for name in CHECKED_METHODS if name in successful_methods and name not in missing_methods and name not in failed_methods],
            "missingMethods": [name for name in CHECKED_METHODS if name in missing_methods],
            "failedMethods": [name for name in CHECKED_METHODS if name in failed_methods],
            "graphObjectsProbed": graph_objects_probed,
            "nodesProbed": nodes_probed
        }
    }`;

const READ_ONLY_COLOR_GRADE_VERSION_SCRIPT = `p = project
t = p.GetCurrentTimeline() if p else None

MAX_VIDEO_TRACKS = 64
MAX_ITEMS = 200
MAX_VERSION_NAMES_PER_TYPE = 64
MAX_ID = 256
MAX_ITEM_NAME = 1024
MAX_VERSION_NAME = 256
CHECKED_METHODS = ["GetVersionNameList", "GetCurrentVersion"]

successful_methods = set()
missing_methods = set()
failed_methods = set()

def add_missing(name, row):
    missing_methods.add(name)
    if name not in row["missingMethods"]:
        row["missingMethods"].append(name)

def add_failed(name, row):
    failed_methods.add(name)
    if name not in row["failedMethods"]:
        row["failedMethods"].append(name)

def version_list(item, version_type, row, prefix):
    try:
        raw = item.GetVersionNameList(version_type)
    except:
        add_failed("GetVersionNameList", row)
        row[prefix + "Readback"] = "failed"
        return
    if not isinstance(raw, list) or any(not isinstance(name, str) or len(name) > MAX_VERSION_NAME for name in raw):
        add_failed("GetVersionNameList", row)
        row[prefix + "Readback"] = "failed"
        return
    row[prefix + "Readback"] = "observed"
    row[prefix + "VersionCountObserved"] = len(raw)
    row[prefix + "Versions"] = raw[:MAX_VERSION_NAMES_PER_TYPE]
    row[prefix + "VersionsTruncated"] = len(raw) > MAX_VERSION_NAMES_PER_TYPE

result = None
if t:
    timeline_id = t.GetUniqueId()
    timeline_name = t.GetName()
    raw_track_count = t.GetTrackCount("video")
    video_track_count = raw_track_count if isinstance(raw_track_count, int) and not isinstance(raw_track_count, bool) and raw_track_count >= 0 else 0
    tracks_scanned = min(video_track_count, MAX_VIDEO_TRACKS)
    tracks_truncated = video_track_count > MAX_VIDEO_TRACKS
    video_items_observed = 0
    items_scanned = 0
    items_truncated = False
    rows = []

    for track_index in range(1, tracks_scanned + 1):
        track_items = t.GetItemListInTrack("video", track_index) or []
        video_items_observed += len(track_items)
        for item_index, item in enumerate(track_items, 1):
            if items_scanned >= MAX_ITEMS:
                items_truncated = True
                break
            items_scanned += 1
            row = {
                "trackIndex": track_index,
                "itemIndex": item_index,
                "timelineItemId": item.GetUniqueId(),
                "timelineItemName": item.GetName(),
                "currentReadback": "missing",
                "currentVersion": None,
                "localReadback": "missing",
                "localVersionCountObserved": None,
                "localVersions": [],
                "localVersionsTruncated": False,
                "remoteReadback": "missing",
                "remoteVersionCountObserved": None,
                "remoteVersions": [],
                "remoteVersionsTruncated": False,
                "missingMethods": [],
                "failedMethods": []
            }
            try:
                methods = set(dir(item))
            except:
                methods = set()
                add_failed("GetVersionNameList", row)
                add_failed("GetCurrentVersion", row)
                row["localReadback"] = "failed"
                row["remoteReadback"] = "failed"
                row["currentReadback"] = "failed"
                rows.append(row)
                continue

            if "GetVersionNameList" not in methods:
                add_missing("GetVersionNameList", row)
                row["localReadback"] = "missing"
                row["remoteReadback"] = "missing"
            else:
                version_list(item, 0, row, "local")
                version_list(item, 1, row, "remote")
                if row["localReadback"] == "observed" and row["remoteReadback"] == "observed":
                    successful_methods.add("GetVersionNameList")

            if "GetCurrentVersion" not in methods:
                add_missing("GetCurrentVersion", row)
                row["currentReadback"] = "missing"
            else:
                try:
                    raw_current = item.GetCurrentVersion()
                    current_name = raw_current.get("versionName") if isinstance(raw_current, dict) else None
                    current_type = raw_current.get("versionType") if isinstance(raw_current, dict) else None
                    if (isinstance(current_name, str) and 0 < len(current_name) <= MAX_VERSION_NAME
                        and isinstance(current_type, int) and not isinstance(current_type, bool) and current_type in (0, 1)):
                        row["currentReadback"] = "observed"
                        row["currentVersion"] = {"name": current_name, "type": current_type}
                        successful_methods.add("GetCurrentVersion")
                    else:
                        row["currentReadback"] = "failed"
                        add_failed("GetCurrentVersion", row)
                except:
                    row["currentReadback"] = "failed"
                    add_failed("GetCurrentVersion", row)

            rows.append(row)
        if items_truncated:
            break

    version_names_truncated = any(row["localVersionsTruncated"] or row["remoteVersionsTruncated"] for row in rows)
    result = {
        "readerId": "color.grade_version_inspect.v1",
        "timeline": {"id": timeline_id, "name": timeline_name},
        "videoTrackCount": video_track_count,
        "tracksScanned": tracks_scanned,
        "videoItemsObserved": video_items_observed,
        "itemsScanned": items_scanned,
        "tracksTruncated": tracks_truncated,
        "itemsTruncated": items_truncated,
        "versionNamesTruncated": version_names_truncated,
        "items": rows,
        "complete": not tracks_truncated and not items_truncated and not version_names_truncated and not missing_methods and not failed_methods,
        "methodEvidence": {
            "checkedMethods": CHECKED_METHODS,
            "fullyObservedMethods": [name for name in CHECKED_METHODS if name in successful_methods and name not in missing_methods and name not in failed_methods],
            "missingMethods": [name for name in CHECKED_METHODS if name in missing_methods],
            "failedMethods": [name for name in CHECKED_METHODS if name in failed_methods],
            "itemsProbed": len(rows)
        }
    }`;

const READ_ONLY_FAIRLIGHT_MAPPING_SCRIPT = `import json
p = project
t = p.GetCurrentTimeline() if p else None

MAX_TRACKS = 64
MAX_ITEMS = 1000
audio_track_count = t.GetTrackCount("audio") if t else 0
audio_item_count = 0
if t:
    for index in range(1, audio_track_count + 1):
        audio_item_count += len(t.GetItemListInTrack("audio", index) or [])

items_scanned = 0
verified_mappings = 0
unverified_mappings = 0
tracks_truncated = audio_track_count > MAX_TRACKS
items_truncated = False
track_rows = []

if t:
    for index in range(1, min(audio_track_count, MAX_TRACKS) + 1):
        items = t.GetItemListInTrack("audio", index) or []
        track_verified = 0
        track_unverified = 0
        embedded_counts = {}
        for item in items:
            if items_scanned >= MAX_ITEMS:
                items_truncated = True
                break
            items_scanned += 1
            raw_mapping = item.GetSourceAudioChannelMapping()
            mapping = None
            if isinstance(raw_mapping, str) and raw_mapping.strip():
                try:
                    mapping = json.loads(raw_mapping)
                except:
                    mapping = None
            if isinstance(mapping, dict) and isinstance(mapping.get("track_mapping"), dict):
                verified_mappings += 1
                track_verified += 1
                channels = mapping.get("embedded_audio_channels")
                if isinstance(channels, int) and channels >= 0:
                    embedded_counts[str(channels)] = embedded_counts.get(str(channels), 0) + 1
            else:
                unverified_mappings += 1
                track_unverified += 1
        voice = t.GetVoiceIsolationState(index)
        track_rows.append({
            "index": index,
            "name": t.GetTrackName("audio", index),
            "subType": t.GetTrackSubType("audio", index),
            "enabled": t.GetIsTrackEnabled("audio", index),
            "locked": t.GetIsTrackLocked("audio", index),
            "itemCount": len(items),
            "voiceIsolation": voice,
            "sourceMappingVerifiedItemCount": track_verified,
            "sourceMappingUnverifiedItemCount": track_unverified,
            "embeddedAudioChannelCounts": [{"channels": int(key), "count": value} for key, value in embedded_counts.items()]
        })
        if items_truncated:
            break

result = None if not t else {
    "readerId": "fairlight.mapping_inspect.v1",
    "timeline": {"id": t.GetUniqueId(), "name": t.GetName()},
    "audioTrackCount": audio_track_count,
    "audioItemCountObserved": audio_item_count,
    "itemsScanned": items_scanned,
    "sourceMappingVerifiedItemCount": verified_mappings,
    "sourceMappingUnverifiedItemCount": unverified_mappings,
    "tracks": track_rows,
    "complete": not tracks_truncated and not items_truncated,
    "tracksTruncated": tracks_truncated,
    "itemsTruncated": items_truncated
}`;

const READ_ONLY_FAIRLIGHT_CLIP_PROCESSING_SCRIPT = `p = project
t = p.GetCurrentTimeline() if p else None

MAX_AUDIO_TRACKS = 64
MAX_ITEMS = 1000
CHECKED_METHODS = ["GetUniqueId", "GetName", "GetProperties", "GetVoiceIsolationState"]
PROPERTY_KEYS = [
    "AudioVolumeEnabled", "AudioVolume", "AudioPanEnabled", "AudioPan",
    "AudioPitchEnabled", "AudioPitchSemiTones", "AudioPitchCents",
    "AudioVoiceIsolationEnabled", "AudioVoiceIsolationAmount",
    "AudioDialogueLevelerEnabled", "AudioDialogueLevelerMode",
    "AudioDialogueLevelerReduceLoudDialogue", "AudioDialogueLevelerLiftSoftDialogue",
    "AudioDialogueLevelerBackgroundReduction", "AudioDialogueLevelerOutputGain"
]

missing_methods = set()
failed_methods = set()
rows = []

def mark_missing(row, name):
    missing_methods.add(name)
    if name not in row["missingMethods"]:
        row["missingMethods"].append(name)

def mark_failed(row, name):
    failed_methods.add(name)
    if name not in row["failedMethods"]:
        row["failedMethods"].append(name)

audio_track_count = t.GetTrackCount("audio") if t else 0
if not isinstance(audio_track_count, int) or isinstance(audio_track_count, bool) or audio_track_count < 0:
    audio_track_count = 0
tracks_scanned = min(audio_track_count, MAX_AUDIO_TRACKS)
tracks_truncated = audio_track_count > MAX_AUDIO_TRACKS
audio_items_observed = 0
items_scanned = 0
items_truncated = False

if t:
    for track_index in range(1, tracks_scanned + 1):
        track_items = t.GetItemListInTrack("audio", track_index) or []
        audio_items_observed += len(track_items)
        for item_index, item in enumerate(track_items, 1):
            if items_scanned >= MAX_ITEMS:
                items_truncated = True
                break
            items_scanned += 1
            row = {
                "trackIndex": track_index,
                "itemIndex": item_index,
                "timelineItemId": None,
                "timelineItemName": None,
                "propertiesReadback": "missing",
                "missingPropertyKeys": list(PROPERTY_KEYS),
                "properties": {},
                "voiceReadback": "missing",
                "voiceState": None,
                "voiceConsistency": "unavailable",
                "missingMethods": [],
                "failedMethods": []
            }
            try:
                methods = set(dir(item))
            except:
                for name in CHECKED_METHODS:
                    mark_failed(row, name)
                rows.append(row)
                continue

            if "GetUniqueId" not in methods:
                mark_missing(row, "GetUniqueId")
            else:
                try:
                    row["timelineItemId"] = item.GetUniqueId()
                except:
                    mark_failed(row, "GetUniqueId")

            if "GetName" not in methods:
                mark_missing(row, "GetName")
            else:
                try:
                    row["timelineItemName"] = item.GetName()
                except:
                    mark_failed(row, "GetName")

            props = None
            if "GetProperties" not in methods:
                mark_missing(row, "GetProperties")
            else:
                try:
                    raw_props = item.GetProperties()
                    if isinstance(raw_props, dict):
                        props = raw_props
                        missing_keys = [key for key in PROPERTY_KEYS if key not in raw_props]
                        row["missingPropertyKeys"] = missing_keys
                        row["properties"] = {key: raw_props.get(key) for key in PROPERTY_KEYS if key in raw_props}
                        row["propertiesReadback"] = "observed" if not missing_keys else "incomplete"
                    else:
                        row["propertiesReadback"] = "failed"
                        mark_failed(row, "GetProperties")
                except:
                    row["propertiesReadback"] = "failed"
                    mark_failed(row, "GetProperties")

            voice = None
            if "GetVoiceIsolationState" not in methods:
                mark_missing(row, "GetVoiceIsolationState")
            else:
                try:
                    raw_voice = item.GetVoiceIsolationState()
                    if isinstance(raw_voice, dict):
                        voice = raw_voice
                        row["voiceState"] = raw_voice
                        row["voiceReadback"] = "observed"
                    else:
                        row["voiceReadback"] = "failed"
                        mark_failed(row, "GetVoiceIsolationState")
                except:
                    row["voiceReadback"] = "failed"
                    mark_failed(row, "GetVoiceIsolationState")

            if row["propertiesReadback"] == "observed" and row["voiceReadback"] == "observed":
                prop_enabled = props.get("AudioVoiceIsolationEnabled")
                prop_amount = props.get("AudioVoiceIsolationAmount")
                voice_enabled = voice.get("isEnabled")
                voice_amount = voice.get("amount")
                row["voiceConsistency"] = "matched" if prop_enabled == voice_enabled and prop_amount == voice_amount else "contradiction"

            rows.append(row)
        if items_truncated:
            break

fully_observed = []
if rows and all(isinstance(row["timelineItemId"], str) and "GetUniqueId" not in row["missingMethods"] and "GetUniqueId" not in row["failedMethods"] for row in rows):
    fully_observed.append("GetUniqueId")
if rows and all(isinstance(row["timelineItemName"], str) and "GetName" not in row["missingMethods"] and "GetName" not in row["failedMethods"] for row in rows):
    fully_observed.append("GetName")
if rows and all(row["propertiesReadback"] == "observed" for row in rows):
    fully_observed.append("GetProperties")
if rows and all(row["voiceReadback"] == "observed" for row in rows):
    fully_observed.append("GetVoiceIsolationState")

result = None if not t else {
    "readerId": "fairlight.clip_processing_inspect.v1",
    "timeline": {"id": t.GetUniqueId(), "name": t.GetName()},
    "audioTrackCount": audio_track_count,
    "tracksScanned": tracks_scanned,
    "audioItemsObserved": audio_items_observed,
    "itemsScanned": items_scanned,
    "tracksTruncated": tracks_truncated,
    "itemsTruncated": items_truncated,
    "items": rows,
    "complete": not tracks_truncated and not items_truncated and not missing_methods and not failed_methods and all(row["propertiesReadback"] == "observed" and row["voiceReadback"] == "observed" and row["voiceConsistency"] != "contradiction" for row in rows),
    "methodEvidence": {
        "checkedMethods": CHECKED_METHODS,
        "fullyObservedMethods": fully_observed,
        "missingMethods": [name for name in CHECKED_METHODS if name in missing_methods],
        "failedMethods": [name for name in CHECKED_METHODS if name in failed_methods],
        "itemsProbed": len(rows)
    }
}`;

const READ_ONLY_DELIVER_SUMMARY_SCRIPT = `p = project
MAX_FORMATS = 64
MAX_CODECS_PER_FORMAT = 16
MAX_AUDIO_FORMATS = 32
MAX_RESOLUTIONS = 64
MAX_JOBS = 50
MAX_PRESET_NAMES = 64

video_formats = p.GetRenderFormats() or {} if p else {}
audio_formats = p.GetAudioRenderFormats() or {} if p else {}
video_rows = []
audio_rows = []
video_codec_count = 0
audio_codec_count = 0
codec_samples_truncated = False

if p:
    for name, extension in list(video_formats.items())[:MAX_FORMATS]:
        codecs = p.GetRenderCodecs(extension) or {}
        video_codec_count += len(codecs)
        if len(codecs) > MAX_CODECS_PER_FORMAT:
            codec_samples_truncated = True
        video_rows.append({
            "name": name,
            "extension": extension,
            "codecCount": len(codecs),
            "codecs": [{"name": codec_name, "id": codec_id} for codec_name, codec_id in list(codecs.items())[:MAX_CODECS_PER_FORMAT]],
            "codecSampleTruncated": len(codecs) > MAX_CODECS_PER_FORMAT
        })
    for name, extension in list(audio_formats.items())[:MAX_AUDIO_FORMATS]:
        codecs = p.GetAudioRenderCodecs(extension) or {}
        audio_codec_count += len(codecs)
        if len(codecs) > MAX_CODECS_PER_FORMAT:
            codec_samples_truncated = True
        audio_rows.append({
            "name": name,
            "extension": extension,
            "codecCount": len(codecs),
            "codecs": [{"name": codec_name, "id": codec_id} for codec_name, codec_id in list(codecs.items())[:MAX_CODECS_PER_FORMAT]],
            "codecSampleTruncated": len(codecs) > MAX_CODECS_PER_FORMAT
        })

resolutions = p.GetRenderResolutions() or [] if p else []
current = p.GetCurrentRenderFormatAndCodec() or {} if p else {}
render_presets = p.GetRenderPresetList() if p else None
quick_export_presets = p.GetQuickExportRenderPresets() if p else None
current_selection = None
if p and isinstance(current, dict):
    current_format = current.get("format")
    current_codec = current.get("codec")
    if isinstance(current_format, str) and current_format and isinstance(current_codec, str) and current_codec:
        current_resolutions = p.GetRenderResolutions(current_format, current_codec)
        if isinstance(current_resolutions, list):
            current_selection = {
                "format": current_format,
                "codec": current_codec,
                "resolutionCount": len(current_resolutions),
                "resolutions": [{"width": row.get("Width"), "height": row.get("Height")} for row in current_resolutions[:MAX_RESOLUTIONS]],
                "resolutionsTruncated": len(current_resolutions) > MAX_RESOLUTIONS
            }
jobs = p.GetRenderJobList() or [] if p else []
job_rows = []
if p:
    for job in jobs[:MAX_JOBS]:
        job_id = job.get("JobId")
        status = p.GetRenderJobStatus(job_id) if job_id else {}
        job_rows.append({
            "id": job_id,
            "name": job.get("RenderJobName"),
            "timelineName": job.get("TimelineName"),
            "status": status.get("JobStatus") if status else None,
            "completionPercentage": status.get("CompletionPercentage") if status else None,
            "outputWidth": job.get("FormatWidth"),
            "outputHeight": job.get("FormatHeight"),
            "frameRate": job.get("FrameRate"),
            "exportVideo": job.get("IsExportVideo"),
            "exportAudio": job.get("IsExportAudio"),
            "videoFormat": job.get("VideoFormat"),
            "videoCodec": job.get("VideoCodec"),
            "audioCodec": job.get("AudioCodec"),
            "renderMode": job.get("RenderMode"),
            "targetDirectoryConfigured": bool(str(job.get("TargetDir") or "").strip()),
            "outputFilenameConfigured": bool(str(job.get("OutputFilename") or "").strip())
        })

result = None if not p else {
    "capabilities": {
        "readerId": "deliver.capability_matrix.v1",
        "videoFormatCount": len(video_formats),
        "videoCodecCountObserved": video_codec_count,
        "videoFormats": video_rows,
        "audioFormatCount": len(audio_formats),
        "audioCodecCountObserved": audio_codec_count,
        "audioFormats": audio_rows,
        "generalResolutions": [{"width": row.get("Width"), "height": row.get("Height")} for row in resolutions[:MAX_RESOLUTIONS]],
        "currentSelection": current_selection,
        "renderPresetCount": len(render_presets) if isinstance(render_presets, list) else 0,
        "renderPresets": render_presets[:MAX_PRESET_NAMES] if isinstance(render_presets, list) else None,
        "renderPresetsTruncated": isinstance(render_presets, list) and len(render_presets) > MAX_PRESET_NAMES,
        "quickExportPresetCount": len(quick_export_presets) if isinstance(quick_export_presets, list) else 0,
        "quickExportPresets": quick_export_presets[:MAX_PRESET_NAMES] if isinstance(quick_export_presets, list) else None,
        "quickExportPresetsTruncated": isinstance(quick_export_presets, list) and len(quick_export_presets) > MAX_PRESET_NAMES,
        "complete": len(video_formats) <= MAX_FORMATS and len(audio_formats) <= MAX_AUDIO_FORMATS and len(resolutions) <= MAX_RESOLUTIONS and not codec_samples_truncated and current_selection is not None and not current_selection["resolutionsTruncated"] and isinstance(render_presets, list) and len(render_presets) <= MAX_PRESET_NAMES and isinstance(quick_export_presets, list) and len(quick_export_presets) <= MAX_PRESET_NAMES,
        "formatsTruncated": len(video_formats) > MAX_FORMATS or len(audio_formats) > MAX_AUDIO_FORMATS,
        "codecSamplesTruncated": codec_samples_truncated,
        "resolutionsTruncated": len(resolutions) > MAX_RESOLUTIONS
    },
    "settings": {
        "readerId": "deliver.settings_inspect.v1",
        "currentFormat": current.get("format"),
        "currentCodec": current.get("codec"),
        "renderMode": p.GetCurrentRenderMode(),
        "renderingInProgress": p.IsRenderingInProgress(),
        "renderJobCountObserved": len(jobs),
        "renderJobs": job_rows,
        "jobsTruncated": len(jobs) > MAX_JOBS
    }
}`;

const WORKFLOW_TOOLS: Tool[] = [
  {
    name: 'status',
    description: 'Read the current DaVinci Resolve connection status. This protected workflow tool performs no project writes.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'inspect',
    description: 'Inspect protected connection, capability and bounded read-only production snapshots. Domain inspection uses app-owned fixed getter-only scripts and performs no project writes.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['connection', 'capabilities', 'project', 'media', 'edit', 'fusion', 'color', 'fairlight', 'deliver', 'preflight'] },
        profile: { type: 'string', enum: ['general', 'media', 'edit', 'fusion', 'color', 'fairlight', 'delivery'] },
        itemId: { type: 'string', minLength: 1, maxLength: 128, description: 'Exact MediaPoolItem unique ID. Supported only for target=media.' },
        view: { type: 'string', enum: ['link_status', 'structure', 'gaps_overlaps', 'source_ranges', 'transitions', 'annotations', 'graph', 'versions', 'audio_processing'], description: 'Optional specialized domain view. link_status is Media-only; structure, gaps_overlaps, source_ranges, transitions and annotations are Edit-only; graph is supported for Fusion and Color; versions is Color-only; audio_processing is Fairlight-only. All are fixed read-only inspections.' }
      },
      required: ['target'],
      additionalProperties: false
    },
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'inspect_operation',
    description: 'Inspect the versioned risk, blast radius, approval, recovery, preview and verification metadata of a protected workflow ID.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { type: 'string' },
        tool: { type: 'string', description: 'Legacy alias for workflowId.' }
      },
      anyOf: [{ required: ['workflowId'] }, { required: ['tool'] }],
      additionalProperties: false
    },
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'audit',
    description: 'Read recent protected workflow execution summaries. Arguments and Resolve results are not recorded.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 20 }
      },
      additionalProperties: false
    },
    annotations: READ_ONLY_ANNOTATIONS
  },
  {
    name: 'plan',
    description: 'Create a durable, non-executing plan for one registered protected mutation. Planning reads live Resolve state but does not call a writer.',
    inputSchema: {
      type: 'object',
      oneOf: [
        {
          type: 'object',
          properties: {
            workflowId: { type: 'string', enum: ['edit.review_marker_add.v1'] },
            target: { type: 'string', enum: ['timeline_item'] },
            itemRef: { type: 'string', minLength: 1, maxLength: 32, description: 'Current semantic TimelineItem handle such as I3.' },
            generation: { type: 'integer', minimum: 1, description: 'World-model generation that supplied itemRef.' },
            frameOffset: { type: 'integer', minimum: 0 },
            color: { type: 'string', enum: ['Blue', 'Cyan', 'Green', 'Yellow', 'Red', 'Pink', 'Purple', 'Fuchsia', 'Rose', 'Lavender', 'Sky', 'Mint', 'Lemon', 'Sand', 'Cocoa', 'Cream'] },
            name: { type: 'string', minLength: 1, maxLength: 80 },
            note: { type: 'string', maxLength: 500 },
            duration: { type: 'integer', minimum: 1, maximum: 10000 }
          },
          required: ['workflowId', 'target', 'itemRef', 'generation', 'frameOffset', 'color', 'name'],
          additionalProperties: false
        },
        {
          type: 'object',
          properties: {
            workflowId: { type: 'string', enum: ['edit.track_add.v1'] },
            target: { type: 'string', enum: ['current_timeline'] },
            trackType: { type: 'string', enum: ['video'] },
            placement: { type: 'string', enum: ['append'] }
          },
          required: ['workflowId', 'target', 'trackType', 'placement'],
          additionalProperties: false
        },
        {
          type: 'object',
          properties: {
            workflowId: { type: 'string', enum: ['color.grade_version_create.v1'] },
            target: { type: 'string', enum: ['timeline_item'] },
            itemRef: { type: 'string', minLength: 1, maxLength: 32, description: 'Current semantic TimelineItem handle such as I3.' },
            generation: { type: 'integer', minimum: 1, description: 'World-model generation that supplied itemRef.' },
            name: { type: 'string', minLength: 1, maxLength: 80 }
          },
          required: ['workflowId', 'target', 'itemRef', 'generation', 'name'],
          additionalProperties: false
        }
      ]
    },
    annotations: PLAN_ANNOTATIONS
  },
  {
    name: 'execute',
    description: 'Execute one previously created and locally approved immutable workflow plan. No mutation is dispatched without exact plan-hash approval and live precondition revalidation.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', minLength: 1 }
      },
      required: ['planId'],
      additionalProperties: false
    },
    annotations: EXECUTE_ANNOTATIONS
  }
];

export function workflowTools(): Tool[] {
  return structuredClone(WORKFLOW_TOOLS);
}

function textResult(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}

function protectedTextResult<T>(value: ProtectedWorkflowResult<T>): CallToolResult {
  return textResult(value);
}

function readOnlyOperation(options: {
  workflowId: ProtectedWorkflowId;
  status: ProtectedOperation['status'];
  verificationStatus: ProtectedOperation['verification']['status'];
  verificationLevel?: ProtectedVerificationLevel;
  checks: string[];
  warnings?: string[];
  changeSetId?: string;
}): ProtectedOperation {
  const definition = getWorkflowDefinition(options.workflowId);
  if (!definition) throw new Error(`Protected workflow is missing runtime metadata: ${options.workflowId}`);
  return {
    status: options.status,
    workflow_id: options.workflowId,
    workflow_version: '1',
    ...(options.changeSetId ? { changeset_id: options.changeSetId } : {}),
    risk: definition.risk,
    blast_radius: definition.blastRadius,
    ...(options.warnings?.length ? { warnings: options.warnings } : {}),
    verification: {
      status: options.verificationStatus,
      ...(options.verificationLevel ? { level_reached: options.verificationLevel } : {}),
      checks: options.checks
    }
  };
}

function executionOperation(projection: WorkflowPlanProjection): ProtectedOperation {
  const execution = projection.execution;
  if (!execution) throw new Error('Workflow execution result is missing execution evidence');
  if (projection.plan.plan_kind === 'edit_track_add') {
    const change = projection.plan.proposed_changes[0];
    const state = execution.state;
    const verified = state === 'verified';
    const contradiction = state === 'contradiction' || state === 'recovered' || state === 'recovery_failed';
    const ambiguous = state === 'ambiguous';
    const failed = state === 'failed' || contradiction;
    return {
      status: verified ? 'success' : ambiguous ? 'ambiguous' : failed ? 'failed' : 'ambiguous',
      workflow_id: projection.plan.workflow_id,
      workflow_version: projection.plan.workflow_version,
      changeset_id: projection.change_set.changeset_id,
      execution_id: execution.execution_id,
      risk: projection.plan.risk_level,
      blast_radius: projection.plan.blast_radius,
      ...(verified && change ? {
        changes: [{
          kind: 'track_added' as const,
          track_type: change.track_type,
          track_index: change.expected_track_index
        }]
      } : {}),
      ...(execution.reason ? { warnings: [execution.reason] } : {}),
      verification: {
        status: verified ? 'passed' : contradiction ? 'contradiction' : ambiguous ? 'unverified' : 'failed',
        ...(verified || contradiction || failed ? { level_reached: 'STRUCTURAL_READBACK' as const } : {}),
        checks: verified
          ? ['Exactly one appended empty VIDEO track was read back and all pre-existing bounded timeline structure still matched the approved Plan fingerprint.']
          : contradiction
            ? ['Structural readback contradicted the approved empty-track addition or showed unrelated timeline drift.']
            : ambiguous
              ? ['Dispatch may have occurred, but definitive structural readback was unavailable; the writer was not retried.']
              : ['Structural readback established that the approved empty VIDEO track addition was not present.']
      },
      recovery: {
        status: execution.recovery_status,
        checks: projection.backup
          ? [`Class C timeline backup ${projection.backup.backup_timeline_name} is durably recorded; no automatic rollback was attempted.`]
          : ['No verified Class C timeline backup is available in the execution projection.']
      }
    };
  }
  if (projection.plan.plan_kind === 'color_grade_version_create') {
    const change = projection.plan.proposed_changes[0];
    const state = execution.state;
    const verified = state === 'verified';
    const contradiction = state === 'contradiction' || state === 'recovered' || state === 'recovery_failed';
    const ambiguous = state === 'ambiguous';
    const failed = state === 'failed' || contradiction;
    return {
      status: verified ? 'success' : ambiguous ? 'ambiguous' : failed ? 'failed' : 'ambiguous',
      workflow_id: projection.plan.workflow_id,
      workflow_version: projection.plan.workflow_version,
      changeset_id: projection.change_set.changeset_id,
      execution_id: execution.execution_id,
      risk: projection.plan.risk_level,
      blast_radius: projection.plan.blast_radius,
      ...(verified && change ? {
        changes: [{
          kind: 'grade_version_created' as const,
          name: change.name
        }]
      } : {}),
      ...(execution.reason ? { warnings: [execution.reason] } : {}),
      verification: {
        status: verified ? 'passed' : contradiction ? 'contradiction' : ambiguous ? 'unverified' : 'failed',
        ...(verified || contradiction || failed ? { level_reached: 'API_READBACK' as const } : {}),
        checks: verified
          ? ['Exact API readback established one new LOCAL grade version and confirmed it became current on the approved TimelineItem.']
          : contradiction
            ? ['Grade-version readback contradicted the approved create-version Plan.']
            : ambiguous
              ? ['Dispatch may have occurred, but definitive grade-version readback was unavailable; AddVersion was not retried.']
              : ['Exact API readback established that the approved grade version was not created.']
      },
      recovery: {
        status: execution.recovery_status,
        checks: execution.recovery_status === 'recovered'
          ? ['Class B compensation restored the original LOCAL current version, deleted the plan-owned version, and read back the exact baseline version state.']
          : execution.recovery_status === 'failed'
            ? ['Class B compensation was attempted but the exact baseline grade-version state was not re-established.']
            : execution.recovery_status === 'unavailable'
              ? ['Automatic compensation was not safe or could not be verified.']
              : ['No compensation was required.']
      }
    };
  }
  if (projection.plan.plan_kind !== 'review_marker_add') {
    throw new Error('Protected execution envelope is not registered for this plan kind');
  }
  const change = projection.plan.proposed_changes[0];
  const state = execution.state;
  const verified = state === 'verified';
  const contradiction = state === 'contradiction' || state === 'recovered' || state === 'recovery_failed';
  const ambiguous = state === 'ambiguous';
  const failed = state === 'failed' || contradiction;
  return {
    status: verified ? 'success' : ambiguous ? 'ambiguous' : failed ? 'failed' : 'ambiguous',
    workflow_id: projection.plan.workflow_id,
    workflow_version: projection.plan.workflow_version,
    changeset_id: projection.change_set.changeset_id,
    execution_id: execution.execution_id,
    risk: projection.plan.risk_level,
    blast_radius: projection.plan.blast_radius,
    ...(verified && change ? {
      changes: [{
        kind: 'review_marker_added' as const,
        target_item_id: change.target_item_id,
        frame_offset: change.frame_offset,
        custom_data: change.custom_data
      }]
    } : {}),
    ...(execution.reason ? { warnings: [execution.reason] } : {}),
    verification: {
      status: verified ? 'passed' : contradiction ? 'contradiction' : ambiguous ? 'unverified' : 'failed',
      ...(verified || contradiction || failed ? { level_reached: 'API_READBACK' as const } : {}),
      checks: verified
        ? ['Exact marker payload was read back at the approved frame and unique customData.']
        : contradiction
          ? ['Required marker readback contradicted the approved plan.']
          : ambiguous
            ? ['Dispatch may have occurred, but a definitive marker readback was unavailable.']
            : ['Direct API readback established that the requested marker was not present.']
    },
    recovery: {
      status: execution.recovery_status,
      checks: execution.recovery_status === 'recovered'
        ? ['The plan-owned marker was removed by unique customData and absence was read back.']
        : execution.recovery_status === 'failed'
          ? ['Class B compensation was attempted but marker absence was not established.']
          : execution.recovery_status === 'unavailable'
            ? ['Automatic compensation was not safe or could not be verified.']
            : ['No compensation was required.']
    }
  };
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstTextContent(value: unknown): string | null {
  const result = objectValue(value);
  const content = Array.isArray(result?.['content']) ? result['content'] : [];
  for (const item of content) {
    const row = objectValue(item);
    if (typeof row?.['text'] === 'string') return row['text'];
  }
  return null;
}

function isOpaqueEmptyResolveScriptError(value: unknown): boolean {
  const text = firstTextContent(value);
  if (!text) return false;
  try {
    const parsed = objectValue(JSON.parse(text));
    return parsed !== null && Object.keys(parsed).length === 1 && parsed['error'] === '';
  } catch {
    return false;
  }
}

async function callReadOnlyResolveScript(broker: ResolveClient, script: string): Promise<unknown> {
  const call = async (): Promise<unknown> => await broker.callTool('run_script', { script, timeout: 10 });
  const first = await call();
  return isOpaqueEmptyResolveScriptError(first) ? await call() : first;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function settingsFacts(value: unknown): ProjectSettingsFacts | null {
  const settings = objectValue(value);
  if (!settings) return null;
  const width = finiteNumber(settings['timelineResolutionWidth']);
  const height = finiteNumber(settings['timelineResolutionHeight']);
  const outputWidth = finiteNumber(settings['timelineOutputResolutionWidth']);
  const outputHeight = finiteNumber(settings['timelineOutputResolutionHeight']);
  const facts: Omit<ProjectSettingsFacts, 'unverified'> = {
    timelineResolution: width !== null && height !== null ? { width, height } : null,
    timelineFrameRate: finiteNumber(settings['timelineFrameRate']),
    timelinePlaybackFrameRate: finiteNumber(settings['timelinePlaybackFrameRate']),
    outputResolution: outputWidth !== null && outputHeight !== null ? { width: outputWidth, height: outputHeight } : null,
    frameRateMismatchBehavior: nonEmptyString(settings['timelineFrameRateMismatchBehavior']),
    colorScienceMode: nonEmptyString(settings['colorScienceMode']),
    videoMonitorFormat: nonEmptyString(settings['videoMonitorFormat'])
  };
  const unverified: ProjectSettingsFactKey[] = [];
  for (const key of Object.keys(facts) as ProjectSettingsFactKey[]) {
    if (facts[key] === null) unverified.push(key);
  }
  return { ...facts, unverified };
}

function customTimelineSettings(value: unknown): boolean | null {
  if (value === true || value === '1' || value === 1) return true;
  if (value === false || value === '0' || value === 0) return false;
  return null;
}

function requiredCount(value: unknown, field: string): number {
  const count = finiteNumber(value);
  if (count === null || count < 0 || !Number.isInteger(count)) throw new Error(`Media inventory returned invalid ${field}`);
  return count;
}

function resolutionValue(value: unknown): { width: number; height: number } | null {
  const row = objectValue(value);
  if (!row) return null;
  const width = finiteNumber(row['width']);
  const height = finiteNumber(row['height']);
  return width !== null && height !== null && width > 0 && height > 0 ? { width, height } : null;
}

function nullableBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function mediaInventorySummary(value: unknown): MediaInventorySummary | null {
  if (value === null) return null;
  const inventory = objectValue(value);
  if (!inventory || inventory['readerId'] !== 'media.inventory_summary.v1') {
    throw new Error('Media inventory returned invalid structured result');
  }
  const root = objectValue(inventory['rootFolder']);
  const current = objectValue(inventory['currentFolder']);
  const reference = objectValue(inventory['referenceTimeline']);
  const folders = Array.isArray(inventory['folders']) ? inventory['folders'] : [];
  const items = Array.isArray(inventory['items']) ? inventory['items'] : [];
  const typeCounts = Array.isArray(inventory['resolveTypeCounts']) ? inventory['resolveTypeCounts'] : [];
  const motionFrameRates = Array.isArray(inventory['observedMotionFrameRates']) ? inventory['observedMotionFrameRates'] : [];
  const motionResolutions = Array.isArray(inventory['observedMotionResolutions']) ? inventory['observedMotionResolutions'] : [];
  return {
    readerId: 'media.inventory_summary.v1',
    mediaPoolId: nonEmptyString(inventory['mediaPoolId']),
    rootFolder: root && typeof root['id'] === 'string' && typeof root['name'] === 'string'
      ? { id: root['id'], name: root['name'] }
      : null,
    currentFolder: current && typeof current['id'] === 'string' && typeof current['name'] === 'string'
      ? { id: current['id'], name: current['name'] }
      : null,
    folderCountObserved: requiredCount(inventory['folderCountObserved'], 'folder count'),
    itemsObserved: requiredCount(inventory['itemsObserved'], 'item count'),
    sourceClipCountObserved: requiredCount(inventory['sourceClipCountObserved'], 'source clip count'),
    timelineItemCountObserved: requiredCount(inventory['timelineItemCountObserved'], 'timeline item count'),
    onlineCountObserved: requiredCount(inventory['onlineCountObserved'], 'online count'),
    offlineCountObserved: requiredCount(inventory['offlineCountObserved'], 'offline count'),
    onlineUnverifiedCount: requiredCount(inventory['onlineUnverifiedCount'], 'online unverified count'),
    proxyLinkedCountObserved: requiredCount(inventory['proxyLinkedCountObserved'], 'proxy linked count'),
    proxyAbsentCountObserved: requiredCount(inventory['proxyAbsentCountObserved'], 'proxy absent count'),
    proxyUnverifiedCount: requiredCount(inventory['proxyUnverifiedCount'], 'proxy unverified count'),
    resolveTypeCounts: typeCounts.flatMap((value) => {
      const row = objectValue(value);
      if (!row || typeof row['type'] !== 'string') return [];
      const count = finiteNumber(row['count']);
      return count !== null && Number.isInteger(count) && count >= 0 ? [{ type: row['type'], count }] : [];
    }),
    observedMotionFrameRates: motionFrameRates.flatMap((value) => {
      const fps = finiteNumber(value);
      return fps === null ? [] : [fps];
    }),
    observedMotionResolutions: motionResolutions.flatMap((value) => {
      const row = objectValue(value);
      const resolution = resolutionValue(row);
      if (!row || !resolution) return [];
      const count = finiteNumber(row['count']);
      return count !== null && Number.isInteger(count) && count >= 0 ? [{ ...resolution, count }] : [];
    }),
    referenceTimeline: reference
      ? { frameRate: finiteNumber(reference['frameRate']), resolution: resolutionValue(reference['resolution']) }
      : null,
    motionFrameRateMismatchCount: inventory['motionFrameRateMismatchCount'] === null
      ? null
      : requiredCount(inventory['motionFrameRateMismatchCount'], 'frame-rate mismatch count'),
    motionResolutionMismatchCount: inventory['motionResolutionMismatchCount'] === null
      ? null
      : requiredCount(inventory['motionResolutionMismatchCount'], 'resolution mismatch count'),
    folders: folders.flatMap((value) => {
      const row = objectValue(value);
      if (!row || typeof row['id'] !== 'string' || typeof row['name'] !== 'string') return [];
      const directItemCount = finiteNumber(row['directItemCount']);
      return [{
        id: row['id'],
        name: row['name'],
        parentId: typeof row['parentId'] === 'string' ? row['parentId'] : null,
        directItemCount: directItemCount !== null && Number.isInteger(directItemCount) && directItemCount >= 0 ? directItemCount : null
      }];
    }),
    items: items.flatMap((value) => {
      const row = objectValue(value);
      if (!row || typeof row['id'] !== 'string' || typeof row['name'] !== 'string'
        || typeof row['folderId'] !== 'string' || typeof row['folderName'] !== 'string'
        || typeof row['isTimeline'] !== 'boolean') return [];
      const frames = finiteNumber(row['frames']);
      return [{
        id: row['id'],
        name: row['name'],
        folderId: row['folderId'],
        folderName: row['folderName'],
        resolveType: nonEmptyString(row['resolveType']),
        isTimeline: row['isTimeline'],
        duration: nonEmptyString(row['duration']),
        frames: frames !== null && Number.isInteger(frames) && frames >= 0 ? frames : null,
        fps: finiteNumber(row['fps']),
        resolution: resolutionValue(row['resolution']),
        videoCodec: nonEmptyString(row['videoCodec']),
        audioCodec: nonEmptyString(row['audioCodec']),
        online: nullableBoolean(row['online']),
        hasProxyMedia: nullableBoolean(row['hasProxyMedia'])
      }];
    }),
    complete: inventory['complete'] === true,
    foldersTruncated: inventory['foldersTruncated'] === true,
    itemsTruncated: inventory['itemsTruncated'] === true,
    unverified: ['optimizedMediaState', 'fullResolutionLinkState']
  };
}

function mediaClipRequiredCount(value: unknown, field: string): number {
  const count = finiteNumber(value);
  if (count === null || count < 0 || !Number.isInteger(count)) throw new Error(`Media clip inspection returned invalid ${field}`);
  return count;
}

function mediaClipInspect(value: unknown): MediaClipInspect {
  const detail = objectValue(value);
  if (!detail || detail['readerId'] !== 'media.clip_inspect.v1') {
    throw new Error('Media clip inspection returned invalid structured result');
  }
  const requestedItemId = nonEmptyString(detail['requestedItemId']);
  const lookup = detail['lookup'];
  const search = objectValue(detail['search']);
  if (!requestedItemId || (lookup !== 'found' && lookup !== 'not_found' && lookup !== 'unverified') || !search) {
    throw new Error('Media clip inspection returned invalid target evidence');
  }

  const rawMethodEvidence = objectValue(detail['methodEvidence']);
  if (!rawMethodEvidence || rawMethodEvidence['strategy'] !== 'dir') {
    throw new Error('Media clip inspection returned invalid method evidence');
  }
  const methodList = (value: unknown): string[] => (Array.isArray(value) ? value : [])
    .flatMap((entry) => typeof entry === 'string' && MEDIA_CLIP_EVIDENCE_METHODS.includes(entry as typeof MEDIA_CLIP_EVIDENCE_METHODS[number]) ? [entry] : []);
  const methodEvidence: MediaClipInspect['methodEvidence'] = {
    strategy: 'dir',
    checkedMethods: methodList(rawMethodEvidence['checkedMethods']),
    observedMethods: methodList(rawMethodEvidence['observedMethods']),
    missingMethods: methodList(rawMethodEvidence['missingMethods']),
    failedMethods: methodList(rawMethodEvidence['failedMethods'])
  };
  if (methodEvidence.checkedMethods.length !== MEDIA_CLIP_EVIDENCE_METHODS.length
    || MEDIA_CLIP_EVIDENCE_METHODS.some((name) => !methodEvidence.checkedMethods.includes(name))) {
    throw new Error('Media clip inspection returned incomplete method evidence');
  }

  const rawItem = objectValue(detail['item']);
  let item: MediaClipInspect['item'] = null;
  if (lookup === 'found') {
    if (!rawItem || typeof rawItem['id'] !== 'string' || rawItem['id'] !== requestedItemId
      || typeof rawItem['name'] !== 'string'
      || (typeof rawItem['isTimeline'] !== 'boolean' && rawItem['isTimeline'] !== null)) {
      throw new Error('Media clip inspection returned mismatched exact target');
    }
    const rawAudioMapping = objectValue(rawItem['audioMapping']);
    const audioMapping = rawAudioMapping
      ? {
          embeddedAudioChannels: finiteNumber(rawAudioMapping['embeddedAudioChannels']),
          trackCount: mediaClipRequiredCount(rawAudioMapping['trackCount'], 'audio mapping track count'),
          mappedChannelCount: mediaClipRequiredCount(rawAudioMapping['mappedChannelCount'], 'audio mapping channel count')
        }
      : null;
    const rawFlags = Array.isArray(rawItem['flags']) ? rawItem['flags'] : [];
    const frames = finiteNumber(rawItem['frames']);
    const audioBitDepth = finiteNumber(rawItem['audioBitDepth']);
    const audioChannels = finiteNumber(rawItem['audioChannels']);
    item = {
      id: rawItem['id'],
      name: rawItem['name'],
      resolveType: nonEmptyString(rawItem['resolveType']),
      isTimeline: typeof rawItem['isTimeline'] === 'boolean' ? rawItem['isTimeline'] : null,
      duration: nonEmptyString(rawItem['duration']),
      frames: frames !== null && Number.isInteger(frames) && frames >= 0 ? frames : null,
      fps: finiteNumber(rawItem['fps']),
      resolution: resolutionValue(rawItem['resolution']),
      videoCodec: nonEmptyString(rawItem['videoCodec']),
      audioCodec: nonEmptyString(rawItem['audioCodec']),
      audioBitDepth: audioBitDepth !== null && Number.isInteger(audioBitDepth) && audioBitDepth >= 0 ? audioBitDepth : null,
      audioChannels: audioChannels !== null && Number.isInteger(audioChannels) && audioChannels >= 0 ? audioChannels : null,
      startTimecode: nonEmptyString(rawItem['startTimecode']),
      endTimecode: nonEmptyString(rawItem['endTimecode']),
      online: nullableBoolean(rawItem['online']),
      hasProxyMedia: nullableBoolean(rawItem['hasProxyMedia']),
      clipColor: nonEmptyString(rawItem['clipColor']),
      flags: rawFlags.flatMap((flag) => typeof flag === 'string' && flag.trim().length > 0 ? [flag] : []),
      audioMapping
    };
  } else if (rawItem !== null) {
    throw new Error('Media clip inspection returned target data without an exact match');
  }

  const metadataRows = (input: unknown): Array<{ key: string; value: string }> =>
    (Array.isArray(input) ? input : []).flatMap((entry) => {
      const row = objectValue(entry);
      const key = nonEmptyString(row?.['key']);
      const rowValue = nonEmptyString(row?.['value']);
      return key && rowValue ? [{ key, value: rowValue }] : [];
    });
  const markerRows = (Array.isArray(detail['markers']) ? detail['markers'] : []).flatMap((entry) => {
    const row = objectValue(entry);
    const frame = finiteNumber(row?.['frame']);
    if (frame === null) return [];
    return [{
      frame,
      color: nonEmptyString(row?.['color']),
      duration: finiteNumber(row?.['duration']),
      name: nonEmptyString(row?.['name']),
      note: nonEmptyString(row?.['note']),
      customData: nonEmptyString(row?.['customData'])
    }];
  });
  const unverified: MediaClipInspect['unverified'] = ['fullResolutionLinkState'];
  const unavailableMethods = new Set([...methodEvidence.missingMethods, ...methodEvidence.failedMethods]);
  if (unavailableMethods.has('GetClipProperty')) unverified.push('clipProperties');
  if (unavailableMethods.has('GetMetadata')) unverified.push('metadata');
  if (unavailableMethods.has('GetThirdPartyMetadata')) unverified.push('thirdPartyMetadata');
  if (unavailableMethods.has('GetMarkers')) unverified.push('markers');
  if (unavailableMethods.has('GetFlagList')) unverified.push('flags');
  if (unavailableMethods.has('GetClipColor')) unverified.push('clipColor');
  if (unavailableMethods.has('GetAudioMapping')) unverified.push('audioMapping');
  if (unavailableMethods.has('GetTimeline')) unverified.push('timelineIdentity');
  if (item?.online === null) unverified.push('onlineState');
  if (item?.hasProxyMedia === null) unverified.push('proxyState');

  return {
    readerId: 'media.clip_inspect.v1',
    requestedItemId,
    lookup,
    search: {
      foldersObserved: mediaClipRequiredCount(search['foldersObserved'], 'folder count'),
      itemsObserved: mediaClipRequiredCount(search['itemsObserved'], 'item count'),
      truncated: search['truncated'] === true
    },
    item,
    metadata: metadataRows(detail['metadata']),
    metadataTruncated: detail['metadataTruncated'] === true,
    thirdPartyMetadata: metadataRows(detail['thirdPartyMetadata']),
    thirdPartyMetadataTruncated: detail['thirdPartyMetadataTruncated'] === true,
    markers: markerRows,
    markersTruncated: detail['markersTruncated'] === true,
    methodEvidence,
    unverified: [...new Set(unverified)]
  };
}

function mediaLinkStatus(value: unknown): MediaLinkStatus {
  const detail = objectValue(value);
  if (!detail || detail['readerId'] !== 'media.link_status.v1') {
    throw new Error('Media link status returned invalid structured result');
  }
  const requestedItemId = detail['requestedItemId'] === null ? null : nonEmptyString(detail['requestedItemId']);
  if (detail['requestedItemId'] !== null && !requestedItemId) throw new Error('Media link status returned invalid target ID');
  const itemLookup = detail['itemLookup'];
  if (itemLookup !== 'not_requested' && itemLookup !== 'found' && itemLookup !== 'not_found' && itemLookup !== 'unverified') {
    throw new Error('Media link status returned invalid item lookup evidence');
  }
  if ((requestedItemId === null) !== (itemLookup === 'not_requested')) {
    throw new Error('Media link status returned inconsistent target evidence');
  }
  const search = objectValue(detail['search']);
  const rawEvidence = objectValue(detail['methodEvidence']);
  const rawPool = objectValue(rawEvidence?.['mediaPool']);
  const rawItem = objectValue(rawEvidence?.['mediaPoolItem']);
  if (!search || !rawEvidence || rawEvidence['strategy'] !== 'dir' || !rawPool || !rawItem) {
    throw new Error('Media link status returned invalid method evidence');
  }
  const readMethodSet = <T extends readonly string[]>(input: unknown, allowed: T): string[] =>
    (Array.isArray(input) ? input : []).flatMap((entry) => typeof entry === 'string' && allowed.includes(entry) ? [entry] : []);
  const poolChecked = readMethodSet(rawPool['checkedMethods'], MEDIA_LINK_POOL_METHODS);
  const itemChecked = readMethodSet(rawItem['checkedMethods'], MEDIA_LINK_ITEM_METHODS);
  if (poolChecked.length !== MEDIA_LINK_POOL_METHODS.length || MEDIA_LINK_POOL_METHODS.some((name) => !poolChecked.includes(name))
    || itemChecked.length !== MEDIA_LINK_ITEM_METHODS.length || MEDIA_LINK_ITEM_METHODS.some((name) => !itemChecked.includes(name))) {
    throw new Error('Media link status returned incomplete method allowlist evidence');
  }
  const poolProbed = rawPool['probed'] === true;
  const itemProbed = rawItem['probed'] === true;
  const poolObserved = readMethodSet(rawPool['observedMethods'], MEDIA_LINK_POOL_METHODS);
  const poolMissing = readMethodSet(rawPool['missingMethods'], MEDIA_LINK_POOL_METHODS);
  const itemObserved = readMethodSet(rawItem['observedMethods'], MEDIA_LINK_ITEM_METHODS);
  const itemMissing = readMethodSet(rawItem['missingMethods'], MEDIA_LINK_ITEM_METHODS);
  const surface = (owner: 'MediaPool' | 'MediaPoolItem', symbol: string): 'observed' | 'missing' | 'unverified' => {
    const probed = owner === 'MediaPool' ? poolProbed : itemProbed;
    if (!probed) return 'unverified';
    const observed = owner === 'MediaPool' ? poolObserved : itemObserved;
    return observed.includes(symbol) ? 'observed' : 'missing';
  };
  const capability = (
    id: MediaLinkStatus['capabilities'][number]['id'],
    symbol: string,
    owner: 'MediaPool' | 'MediaPoolItem',
    limitations: string[]
  ): MediaLinkStatus['capabilities'][number] => {
    const observedSurface = surface(owner, symbol);
    return {
      id,
      symbol,
      owner,
      surface: observedSurface,
      qualification: observedSurface === 'unverified' ? 'unknown' : 'runtime_observed',
      protectedWrite: 'not_registered',
      limitations
    };
  };
  const capabilities: MediaLinkStatus['capabilities'] = [
    capability('relink', 'RelinkClips', 'MediaPool', [
      'Method presence does not prove a relink would succeed for a specific offline clip or target directory.',
      'No protected relink writer is registered.'
    ]),
    capability('unlink', 'UnlinkClips', 'MediaPool', [
      'Unlink changes Resolve project references and is not called by this reader.',
      'No protected unlink writer is registered.'
    ]),
    capability('linkProxy', 'LinkProxyMedia', 'MediaPoolItem', [
      'Links an existing proxy only; this reader does not generate or attach media.',
      'No protected proxy-link writer is registered.'
    ]),
    capability('unlinkProxy', 'UnlinkProxyMedia', 'MediaPoolItem', [
      'Detaches a Resolve proxy reference and is not called by this reader.',
      'No protected proxy-unlink writer is registered.'
    ]),
    capability('linkFullResolution', 'LinkFullResolutionMedia', 'MediaPoolItem', [
      'No dedicated qualified getter proves current full-resolution link state.',
      'No protected full-resolution-link writer is registered.'
    ])
  ];
  const unverified: MediaLinkStatus['unverified'] = [
    'behavioralWriteQualification',
    'fullResolutionLinkState',
    'proxyGeneration',
    'optimizedMediaGeneration'
  ];
  if (!itemProbed) unverified.push('itemSurface');
  return {
    readerId: 'media.link_status.v1',
    requestedItemId,
    itemLookup,
    search: {
      foldersObserved: mediaClipRequiredCount(search['foldersObserved'], 'link-status folder count'),
      itemsObserved: mediaClipRequiredCount(search['itemsObserved'], 'link-status item count'),
      truncated: search['truncated'] === true
    },
    methodEvidence: {
      strategy: 'dir',
      mediaPool: {
        probed: poolProbed,
        checkedMethods: [...MEDIA_LINK_POOL_METHODS],
        observedMethods: poolObserved,
        missingMethods: poolMissing
      },
      mediaPoolItem: {
        probed: itemProbed,
        checkedMethods: [...MEDIA_LINK_ITEM_METHODS],
        observedMethods: itemObserved,
        missingMethods: itemMissing
      }
    },
    capabilities,
    unverified: [...new Set(unverified)]
  };
}

function editRequiredCount(value: unknown, field: string): number {
  const count = finiteNumber(value);
  if (count === null || count < 0 || !Number.isInteger(count)) throw new Error(`Edit timeline summary returned invalid ${field}`);
  return count;
}

function editStructureInspect(value: unknown): EditStructureInspect | null {
  if (value === null) return null;
  const detail = objectValue(value);
  if (!detail || detail['readerId'] !== 'edit.structure_inspect.v1') {
    throw new Error('Edit structure inspection returned invalid structured result');
  }
  const timeline = objectValue(detail['timeline']);
  const evidence = objectValue(detail['methodEvidence']);
  const rawTracks = Array.isArray(detail['tracks']) ? detail['tracks'] : [];
  if (!timeline || typeof timeline['id'] !== 'string' || typeof timeline['name'] !== 'string' || !evidence || evidence['strategy'] !== 'dir') {
    throw new Error('Edit structure inspection returned invalid timeline or method evidence');
  }
  const stringList = (value: unknown): string[] => (Array.isArray(value) ? value : []).flatMap((entry) =>
    typeof entry === 'string' && EDIT_STRUCTURE_METHODS.includes(entry as (typeof EDIT_STRUCTURE_METHODS)[number]) ? [entry] : []);
  const checkedMethods = stringList(evidence['checkedMethods']);
  if (checkedMethods.length !== EDIT_STRUCTURE_METHODS.length || EDIT_STRUCTURE_METHODS.some((name) => !checkedMethods.includes(name))) {
    throw new Error('Edit structure inspection returned incomplete method allowlist evidence');
  }
  const integerOrNull = (value: unknown): number | null => {
    const parsed = finiteNumber(value);
    return parsed !== null && Number.isInteger(parsed) ? parsed : null;
  };
  const tracks: EditStructureInspect['tracks'] = rawTracks.flatMap((entry) => {
    const row = objectValue(entry);
    if (!row || (row['type'] !== 'video' && row['type'] !== 'audio' && row['type'] !== 'subtitle')) return [];
    const index = integerOrNull(row['index']);
    if (index === null || index < 1) return [];
    const rawItems = Array.isArray(row['items']) ? row['items'] : [];
    const items = rawItems.flatMap((itemEntry) => {
      const item = objectValue(itemEntry);
      const id = nonEmptyString(item?.['id']);
      const name = nonEmptyString(item?.['name']);
      if (!item || !id || !name) return [];
      const recordStart = integerOrNull(item['recordStart']);
      const recordEnd = integerOrNull(item['recordEnd']);
      const duration = integerOrNull(item['duration']);
      return [{
        id,
        name,
        recordStart,
        recordEnd,
        duration,
        sourceStart: integerOrNull(item['sourceStart']),
        sourceEnd: integerOrNull(item['sourceEnd']),
        leftOffset: integerOrNull(item['leftOffset']),
        rightOffset: integerOrNull(item['rightOffset']),
        mediaPoolItemId: nonEmptyString(item['mediaPoolItemId']),
        recordRangeConsistent: recordStart !== null && recordEnd !== null && duration !== null
          ? recordEnd - recordStart === duration
          : null
      }];
    });
    return [{
      type: row['type'],
      index,
      name: nonEmptyString(row['name']),
      enabled: nullableBoolean(row['enabled']),
      locked: nullableBoolean(row['locked']),
      items
    }];
  });
  const itemsObserved = editRequiredCount(detail['itemsObserved'], 'structure item count');
  const itemsProbed = editRequiredCount(evidence['itemsProbed'], 'structure probed item count');
  if (itemsObserved !== itemsProbed) throw new Error('Edit structure inspection returned inconsistent item probe count');
  const missingMethods = stringList(evidence['missingMethods']);
  const failedMethods = stringList(evidence['failedMethods']);
  return {
    readerId: 'edit.structure_inspect.v1',
    timeline: {
      id: timeline['id'],
      name: timeline['name'],
      startFrame: integerOrNull(timeline['startFrame']),
      endFrame: integerOrNull(timeline['endFrame'])
    },
    tracksObserved: editRequiredCount(detail['tracksObserved'], 'structure track count'),
    itemsObserved,
    tracksTruncated: detail['tracksTruncated'] === true,
    itemsTruncated: detail['itemsTruncated'] === true,
    methodEvidence: {
      strategy: 'dir',
      checkedMethods: [...EDIT_STRUCTURE_METHODS],
      fullyObservedMethods: stringList(evidence['fullyObservedMethods']),
      missingMethods,
      failedMethods,
      itemsProbed
    },
    tracks,
    unverified: ['recordRangeBoundarySemantics', 'sourceRangeBoundarySemantics', 'transitionState', 'linkedAudioRelationships']
  };
}

const EDIT_GAP_REQUIRED_METHODS = ['GetUniqueId', 'GetName', 'GetStart', 'GetEnd'] as const;

export function deriveEditGapsOverlaps(structure: EditStructureInspect): EditGapsOverlapsInspect {
  const relationships: EditGapsOverlapsInspect['relationships'] = [];
  let adjacentPairsObserved = 0;
  let comparablePairsObserved = 0;
  let unverifiedTrackCount = 0;

  for (const track of structure.tracks) {
    adjacentPairsObserved += Math.max(0, track.items.length - 1);
    if (track.items.length < 2) continue;
    if (track.items.some((item) => item.recordStart === null || item.recordEnd === null)) {
      unverifiedTrackCount += 1;
      continue;
    }

    const ordered = [...track.items].sort((left, right) =>
      (left.recordStart! - right.recordStart!)
      || (left.recordEnd! - right.recordEnd!)
      || left.id.localeCompare(right.id));
    let coverageItem = ordered[0]!;
    for (let index = 1; index < ordered.length; index += 1) {
      const right = ordered[index]!;
      const boundaryDelta = right.recordStart! - coverageItem.recordEnd!;
      const kind = boundaryDelta < 0
        ? 'overlap'
        : boundaryDelta > 1
          ? 'gap'
          : 'boundary_ambiguous';
      relationships.push({
        kind,
        trackType: track.type,
        trackIndex: track.index,
        trackName: track.name,
        leftItem: {
          id: coverageItem.id,
          name: coverageItem.name,
          recordStart: coverageItem.recordStart!,
          recordEnd: coverageItem.recordEnd!
        },
        rightItem: {
          id: right.id,
          name: right.name,
          recordStart: right.recordStart!,
          recordEnd: right.recordEnd!
        },
        boundaryDelta
      });
      comparablePairsObserved += 1;
      if (right.recordEnd! > coverageItem.recordEnd!) coverageItem = right;
    }
  }

  const gapCountObserved = relationships.filter((item) => item.kind === 'gap').length;
  const overlapCountObserved = relationships.filter((item) => item.kind === 'overlap').length;
  const boundaryAmbiguousCountObserved = relationships.filter((item) => item.kind === 'boundary_ambiguous').length;
  const missingMethods = structure.methodEvidence.missingMethods.filter((name) => EDIT_GAP_REQUIRED_METHODS.includes(name as (typeof EDIT_GAP_REQUIRED_METHODS)[number]));
  const failedMethods = structure.methodEvidence.failedMethods.filter((name) => EDIT_GAP_REQUIRED_METHODS.includes(name as (typeof EDIT_GAP_REQUIRED_METHODS)[number]));
  const fullyObservedMethods = structure.methodEvidence.fullyObservedMethods.filter((name) => EDIT_GAP_REQUIRED_METHODS.includes(name as (typeof EDIT_GAP_REQUIRED_METHODS)[number]));
  const unverified: EditGapsOverlapsInspect['unverified'] = ['recordRangeBoundarySemantics'];
  if (boundaryAmbiguousCountObserved > 0) unverified.push('ambiguousBoundaryClassification');
  if (unverifiedTrackCount > 0) unverified.push('incompleteRecordRanges');

  return {
    readerId: 'edit.gaps_overlaps.v1',
    timeline: { id: structure.timeline.id, name: structure.timeline.name },
    tracksObserved: structure.tracksObserved,
    itemsObserved: structure.itemsObserved,
    adjacentPairsObserved,
    comparablePairsObserved,
    unverifiedTrackCount,
    gapCountObserved,
    overlapCountObserved,
    boundaryAmbiguousCountObserved,
    complete: !structure.tracksTruncated && !structure.itemsTruncated && unverifiedTrackCount === 0,
    methodEvidence: {
      sourceReaderId: 'edit.structure_inspect.v1',
      requiredMethods: [...EDIT_GAP_REQUIRED_METHODS],
      fullyObservedMethods,
      missingMethods,
      failedMethods
    },
    relationships,
    unverified
  };
}

const EDIT_SOURCE_RANGE_REQUIRED_METHODS = [
  'GetUniqueId',
  'GetName',
  'GetStart',
  'GetEnd',
  'GetDuration',
  'GetSourceStartFrame',
  'GetSourceEndFrame',
  'GetMediaPoolItem'
] as const;

function deriveEditSourceRangeReport(structure: EditStructureInspect): EditSourceRangeReport {
  const items = structure.tracks.flatMap((track) => track.items.map((item) => ({
    trackType: track.type,
    trackIndex: track.index,
    trackName: track.name,
    timelineItemId: item.id,
    name: item.name,
    mediaPoolItemId: item.mediaPoolItemId,
    recordStartGetterValue: item.recordStart,
    recordEndGetterValue: item.recordEnd,
    durationGetterValue: item.duration,
    sourceStartFrameGetterValue: item.sourceStart,
    sourceEndFrameGetterValue: item.sourceEnd,
    recordRangeArithmeticConsistent: item.recordRangeConsistent
  })));
  const required = new Set<string>(EDIT_SOURCE_RANGE_REQUIRED_METHODS);
  const fullyObservedMethods = structure.methodEvidence.fullyObservedMethods.filter((name) => required.has(name));
  const missingMethods = structure.methodEvidence.missingMethods.filter((name) => required.has(name));
  const failedMethods = structure.methodEvidence.failedMethods.filter((name) => required.has(name));
  return {
    readerId: 'edit.source_range_report.v1',
    timeline: { id: structure.timeline.id, name: structure.timeline.name },
    tracksObserved: structure.tracksObserved,
    itemsObserved: structure.itemsObserved,
    itemsReported: items.length,
    itemsWithMediaPoolReference: items.filter((item) => item.mediaPoolItemId !== null).length,
    itemsWithoutMediaPoolReference: items.filter((item) => item.mediaPoolItemId === null).length,
    itemsWithCompleteRecordGetterValues: items.filter((item) => item.recordStartGetterValue !== null && item.recordEndGetterValue !== null && item.durationGetterValue !== null).length,
    itemsWithCompleteSourceGetterValues: items.filter((item) => item.sourceStartFrameGetterValue !== null && item.sourceEndFrameGetterValue !== null).length,
    complete: !structure.tracksTruncated && !structure.itemsTruncated && items.length === structure.itemsObserved,
    methodEvidence: {
      sourceReaderId: 'edit.structure_inspect.v1',
      requiredMethods: [...EDIT_SOURCE_RANGE_REQUIRED_METHODS],
      fullyObservedMethods,
      missingMethods,
      failedMethods
    },
    items,
    unverified: [
      'recordRangeBoundarySemantics',
      'sourceRangeBoundarySemantics',
      'sourceCoordinateSemantics',
      'sourceRangeArithmetic',
      'conformMatch'
    ]
  };
}

function editTransitionInspect(value: unknown): EditTransitionInspect | null {
  if (value === null) return null;
  const detail = objectValue(value);
  if (!detail || detail['readerId'] !== 'edit.transition_inspect.v1') {
    throw new Error('Edit transition inspection returned invalid structured result');
  }
  const timeline = objectValue(detail['timeline']);
  const evidence = objectValue(detail['methodEvidence']);
  if (!timeline || typeof timeline['id'] !== 'string' || typeof timeline['name'] !== 'string' || !evidence || evidence['strategy'] !== 'dir') {
    throw new Error('Edit transition inspection returned invalid timeline or method evidence');
  }
  const methodList = (raw: unknown): string[] => (Array.isArray(raw) ? raw : []).flatMap((entry) =>
    typeof entry === 'string' && EDIT_TRANSITION_METHODS.includes(entry as (typeof EDIT_TRANSITION_METHODS)[number]) ? [entry] : []);
  const checkedMethods = methodList(evidence['checkedMethods']);
  if (checkedMethods.length !== EDIT_TRANSITION_METHODS.length || EDIT_TRANSITION_METHODS.some((name) => !checkedMethods.includes(name))) {
    throw new Error('Edit transition inspection returned incomplete method allowlist evidence');
  }
  const rawItems = Array.isArray(detail['items']) ? detail['items'] : [];
  const items: EditTransitionInspect['items'] = rawItems.flatMap((entry) => {
    const row = objectValue(entry);
    if (!row || (row['trackType'] !== 'video' && row['trackType'] !== 'audio')) return [];
    const trackIndex = finiteNumber(row['trackIndex']);
    const timelineItemId = nonEmptyString(row['timelineItemId']);
    const name = nonEmptyString(row['name']);
    const readback = row['getFadesReadback'];
    if (trackIndex === null || !Number.isInteger(trackIndex) || trackIndex < 1 || !timelineItemId || !name
      || (readback !== 'observed' && readback !== 'failed' && readback !== 'unavailable')) return [];
    return [{
      trackType: row['trackType'],
      trackIndex,
      trackName: nonEmptyString(row['trackName']),
      timelineItemId,
      name,
      fadeInGetterValue: finiteNumber(row['fadeIn']),
      fadeOutGetterValue: finiteNumber(row['fadeOut']),
      getFadesReadback: readback
    }];
  });
  const itemsObserved = editRequiredCount(detail['itemsObserved'], 'transition item count');
  const itemsReported = editRequiredCount(detail['itemsReported'], 'transition reported item count');
  const itemsProbed = editRequiredCount(evidence['itemsProbed'], 'transition probed item count');
  if (itemsObserved !== itemsProbed || itemsReported !== items.length) {
    throw new Error('Edit transition inspection returned inconsistent item evidence');
  }
  const fullyObservedMethods = methodList(evidence['fullyObservedMethods']);
  const missingMethods = methodList(evidence['missingMethods']);
  const failedReadMethods = methodList(evidence['failedReadMethods']);
  const observedReadbacks = items.filter((item) => item.getFadesReadback === 'observed').length;
  const failedReadbacks = items.filter((item) => item.getFadesReadback === 'failed').length;
  const unavailableReadbacks = items.filter((item) => item.getFadesReadback === 'unavailable').length;
  const tracksTruncated = detail['tracksTruncated'] === true;
  const itemsTruncated = detail['itemsTruncated'] === true;
  const unverified: EditTransitionInspect['unverified'] = [
    'editTransitionState',
    'transitionReadback',
    'fadeValueSemantics',
    'transitionWriterQualification',
    'fadeWriterQualification'
  ];
  if (itemsObserved === 0) unverified.push('itemMethodSurface');
  return {
    readerId: 'edit.transition_inspect.v1',
    timeline: { id: timeline['id'], name: timeline['name'] },
    tracksObserved: editRequiredCount(detail['tracksObserved'], 'transition track count'),
    itemsObserved,
    itemsReported,
    tracksTruncated,
    itemsTruncated,
    getFadesReadbackObservedCount: observedReadbacks,
    getFadesReadbackFailureCount: failedReadbacks,
    getFadesUnavailableCount: unavailableReadbacks,
    complete: !tracksTruncated && !itemsTruncated && itemsReported === itemsObserved && failedReadbacks === 0 && unavailableReadbacks === 0,
    methodEvidence: {
      strategy: 'dir',
      checkedMethods: [...EDIT_TRANSITION_METHODS],
      fullyObservedMethods,
      missingMethods,
      failedReadMethods,
      itemsProbed
    },
    items,
    unverified
  };
}

function editReviewAnnotationsInspect(value: unknown): EditReviewAnnotationsInspect | null {
  if (value === null) return null;
  const detail = objectValue(value);
  if (!detail || detail['readerId'] !== 'edit.review_annotations_inspect.v1') {
    throw new Error('Edit review annotations inspection returned invalid structured result');
  }
  const timeline = objectValue(detail['timeline']);
  const evidence = objectValue(detail['methodEvidence']);
  const timelineEvidence = objectValue(evidence?.['timeline']);
  const itemEvidence = objectValue(evidence?.['timelineItem']);
  const mediaEvidence = objectValue(evidence?.['mediaPoolItem']);
  if (!timeline || typeof timeline['id'] !== 'string' || typeof timeline['name'] !== 'string'
    || !evidence || evidence['strategy'] !== 'dir' || !timelineEvidence || !itemEvidence || !mediaEvidence) {
    throw new Error('Edit review annotations inspection returned invalid timeline or method evidence');
  }
  const validateMethodSubset = (raw: unknown, allowed: readonly string[], label: string): string[] => {
    if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string' || !allowed.includes(entry))
      || new Set(raw).size !== raw.length) {
      throw new Error(`Edit review annotations inspection returned invalid ${label} method evidence`);
    }
    return raw as string[];
  };
  const validateChecked = (raw: unknown, allowed: readonly string[], label: string): string[] => {
    if (!Array.isArray(raw) || raw.length !== allowed.length || raw.some((entry) => typeof entry !== 'string')
      || new Set(raw).size !== raw.length || raw.some((entry) => typeof entry === 'string' && !allowed.includes(entry))) {
      throw new Error(`Edit review annotations inspection returned invalid ${label} allowlist evidence`);
    }
    const checked = validateMethodSubset(raw, allowed, `${label} checked`);
    if (checked.length !== allowed.length || allowed.some((name) => !checked.includes(name))) {
      throw new Error(`Edit review annotations inspection returned incomplete ${label} allowlist evidence`);
    }
    return checked;
  };
  const timelineChecked = validateChecked(timelineEvidence['checkedMethods'], EDIT_ANNOTATION_TIMELINE_METHODS, 'timeline');
  const itemChecked = validateChecked(itemEvidence['checkedMethods'], EDIT_ANNOTATION_ITEM_METHODS, 'timeline item');
  const mediaChecked = validateChecked(mediaEvidence['checkedMethods'], EDIT_ANNOTATION_MEDIA_METHODS, 'MediaPoolItem');
  const timelineObserved = validateMethodSubset(timelineEvidence['observedMethods'], EDIT_ANNOTATION_TIMELINE_METHODS, 'timeline observed');
  const timelineMissing = validateMethodSubset(timelineEvidence['missingMethods'], EDIT_ANNOTATION_TIMELINE_METHODS, 'timeline missing');
  const timelineFailed = validateMethodSubset(timelineEvidence['failedMethods'], EDIT_ANNOTATION_TIMELINE_METHODS, 'timeline failed');
  const itemFullyObserved = validateMethodSubset(itemEvidence['fullyObservedMethods'], EDIT_ANNOTATION_ITEM_METHODS, 'timeline item fully-observed');
  const itemMissing = validateMethodSubset(itemEvidence['missingMethods'], EDIT_ANNOTATION_ITEM_METHODS, 'timeline item missing');
  const itemFailed = validateMethodSubset(itemEvidence['failedMethods'], EDIT_ANNOTATION_ITEM_METHODS, 'timeline item failed');
  const mediaFullyObserved = validateMethodSubset(mediaEvidence['fullyObservedMethods'], EDIT_ANNOTATION_MEDIA_METHODS, 'MediaPoolItem fully-observed');
  const mediaMissing = validateMethodSubset(mediaEvidence['missingMethods'], EDIT_ANNOTATION_MEDIA_METHODS, 'MediaPoolItem missing');
  const mediaFailed = validateMethodSubset(mediaEvidence['failedMethods'], EDIT_ANNOTATION_MEDIA_METHODS, 'MediaPoolItem failed');
  const itemsObserved = editRequiredCount(detail['itemsObserved'], 'annotation item count');
  const itemProbed = editRequiredCount(itemEvidence['itemsProbed'], 'annotation item probe count');
  if (itemsObserved !== itemProbed) throw new Error('Edit review annotations inspection returned inconsistent TimelineItem probe count');

  const tracksObserved = editRequiredCount(detail['tracksObserved'], 'annotation track count');
  const mediaPoolItemsObserved = editRequiredCount(detail['mediaPoolItemsObserved'], 'annotation MediaPoolItem count');
  const mediaProbed = editRequiredCount(mediaEvidence['itemsProbed'], 'annotation MediaPoolItem probe count');
  if (tracksObserved > 64 || itemsObserved > 2000 || mediaPoolItemsObserved > 2000 || mediaProbed > 2000) {
    throw new Error('Edit review annotations inspection exceeded its fixed traversal bounds');
  }
  if (mediaPoolItemsObserved > itemsObserved || mediaProbed > itemsObserved || mediaProbed < mediaPoolItemsObserved) {
    throw new Error('Edit review annotations inspection returned invalid MediaPoolItem probe count');
  }

  const requireSurfacePartition = (
    checked: readonly string[],
    observed: readonly string[],
    missing: readonly string[],
    label: string,
    probed = 1
  ): void => {
    if (probed === 0) {
      if (observed.length || missing.length) throw new Error(`Edit review annotations inspection returned invalid empty ${label} method evidence`);
      return;
    }
    if (checked.some((name) => observed.includes(name) === missing.includes(name))) {
      throw new Error(`Edit review annotations inspection returned inconsistent ${label} method evidence`);
    }
  };
  requireSurfacePartition(timelineChecked, timelineObserved, timelineMissing, 'timeline');
  requireSurfacePartition(itemChecked, itemFullyObserved, itemMissing, 'timeline item', itemProbed);
  requireSurfacePartition(mediaChecked, mediaFullyObserved, mediaMissing, 'MediaPoolItem', mediaProbed);
  if (timelineFailed.some((name) => !timelineObserved.includes(name))) {
    throw new Error('Edit review annotations inspection returned failed timeline getter without an observed method surface');
  }

  const rawMarkers = Array.isArray(detail['markers']) ? detail['markers'] : [];
  if (rawMarkers.length > 2000) throw new Error('Edit review annotations inspection exceeded its marker row bound');
  const markers: EditReviewAnnotationsInspect['markers'] = rawMarkers.flatMap((entry) => {
    const row = objectValue(entry);
    const scope = row?.['scope'];
    const targetId = nonEmptyString(row?.['targetId']);
    const targetName = typeof row?.['targetName'] === 'string' ? row['targetName'] : '';
    const frame = finiteNumber(row?.['frame']);
    if (!row || (scope !== 'timeline' && scope !== 'timeline_item' && scope !== 'media_pool_item') || !targetId || frame === null) return [];
    const trackType = row['trackType'] === 'video' || row['trackType'] === 'audio' || row['trackType'] === 'subtitle' ? row['trackType'] : null;
    const rawTrackIndex = finiteNumber(row['trackIndex']);
    const trackIndex = rawTrackIndex !== null && Number.isInteger(rawTrackIndex) && rawTrackIndex >= 1 ? rawTrackIndex : null;
    return [{
      scope,
      targetId,
      targetName,
      trackType,
      trackIndex,
      frame,
      color: nonEmptyString(row['color']),
      duration: finiteNumber(row['duration']),
      name: nonEmptyString(row['name']),
      note: nonEmptyString(row['note']),
      customData: nonEmptyString(row['customData'])
    }];
  });
  const rawMediaPoolAnnotations = Array.isArray(detail['mediaPoolAnnotations']) ? detail['mediaPoolAnnotations'] : [];
  if (rawMediaPoolAnnotations.length > 2000) throw new Error('Edit review annotations inspection exceeded its MediaPoolItem row bound');
  const mediaPoolAnnotations: EditReviewAnnotationsInspect['mediaPoolAnnotations'] = rawMediaPoolAnnotations.flatMap((entry) => {
    const row = objectValue(entry);
    const mediaPoolItemId = nonEmptyString(row?.['mediaPoolItemId']);
    const name = typeof row?.['name'] === 'string' ? row['name'] : '';
    if (!row || !mediaPoolItemId) return [];
    const rawFlags = Array.isArray(row['flags']) ? row['flags'] : [];
    if (rawFlags.length > 64) throw new Error('Edit review annotations inspection exceeded its flag row bound');
    const flags = rawFlags.flatMap((flag) => typeof flag === 'string' && flag.trim() ? [flag.trim()] : []);
    return [{
      mediaPoolItemId,
      name,
      flags,
      flagsTruncated: row['flagsTruncated'] === true,
      clipColor: nonEmptyString(row['clipColor']),
      markerCountObserved: editRequiredCount(row['markerCountObserved'], 'MediaPoolItem marker count')
    }];
  });
  if (mediaPoolAnnotations.length !== mediaPoolItemsObserved) {
    throw new Error('Edit review annotations inspection returned inconsistent MediaPoolItem rows');
  }
  const tracksTruncated = detail['tracksTruncated'] === true;
  const itemsTruncated = detail['itemsTruncated'] === true;
  const markerRowsTruncated = detail['markerRowsTruncated'] === true;
  const flagsTruncated = mediaPoolAnnotations.some((item) => item.flagsTruncated);
  const timelineMarkerCountObserved = editRequiredCount(detail['timelineMarkerCountObserved'], 'timeline marker count');
  const timelineItemMarkerCountObserved = editRequiredCount(detail['timelineItemMarkerCountObserved'], 'timeline item marker count');
  const mediaPoolMarkerCountObserved = editRequiredCount(detail['mediaPoolMarkerCountObserved'], 'MediaPool marker count');
  const flaggedMediaPoolItemCountObserved = editRequiredCount(detail['flaggedMediaPoolItemCountObserved'], 'flagged MediaPoolItem count');
  const coloredMediaPoolItemCountObserved = editRequiredCount(detail['coloredMediaPoolItemCountObserved'], 'colored MediaPoolItem count');
  if (flaggedMediaPoolItemCountObserved !== mediaPoolAnnotations.filter((item) => item.flags.length > 0).length
    || coloredMediaPoolItemCountObserved !== mediaPoolAnnotations.filter((item) => item.clipColor !== null).length
    || mediaPoolMarkerCountObserved !== mediaPoolAnnotations.reduce((sum, item) => sum + item.markerCountObserved, 0)) {
    throw new Error('Edit review annotations inspection returned inconsistent MediaPoolItem annotation counts');
  }
  const totalMarkerCountObserved = timelineMarkerCountObserved + timelineItemMarkerCountObserved + mediaPoolMarkerCountObserved;
  if (!markerRowsTruncated && rawMarkers.length !== totalMarkerCountObserved) {
    throw new Error('Edit review annotations inspection returned inconsistent marker row count');
  }
  const timelineItemIdentityIncomplete = itemMissing.some((name) => name === 'GetUniqueId' || name === 'GetName')
    || itemFailed.some((name) => name === 'GetUniqueId' || name === 'GetName');
  const mediaPoolAssociationIncomplete = itemMissing.includes('GetMediaPoolItem') || itemFailed.includes('GetMediaPoolItem');
  const mediaPoolIdentityIncomplete = mediaMissing.some((name) => name === 'GetUniqueId' || name === 'GetName')
    || mediaFailed.some((name) => name === 'GetUniqueId' || name === 'GetName');
  const markerRowsIncomplete = markers.length !== rawMarkers.length;
  const unverified: EditReviewAnnotationsInspect['unverified'] = [];
  if (timelineMissing.includes('GetMarkers') || timelineFailed.includes('GetMarkers')) unverified.push('timelineMarkers');
  if (itemMissing.includes('GetMarkers') || itemFailed.includes('GetMarkers')) unverified.push('timelineItemMarkers');
  if (mediaMissing.includes('GetMarkers') || mediaFailed.includes('GetMarkers')) unverified.push('mediaPoolMarkers');
  if (mediaMissing.includes('GetFlagList') || mediaFailed.includes('GetFlagList')) unverified.push('flags');
  if (mediaMissing.includes('GetClipColor') || mediaFailed.includes('GetClipColor')) unverified.push('clipColor');
  if (timelineItemIdentityIncomplete) unverified.push('timelineItemIdentity');
  if (mediaPoolAssociationIncomplete) unverified.push('mediaPoolAssociation');
  if (mediaPoolIdentityIncomplete) unverified.push('mediaPoolIdentity');
  if (markerRowsTruncated || markerRowsIncomplete) unverified.push('markerRows');
  return {
    readerId: 'edit.review_annotations_inspect.v1',
    timeline: { id: timeline['id'], name: timeline['name'] },
    tracksObserved,
    itemsObserved,
    mediaPoolItemsObserved,
    timelineMarkerCountObserved,
    timelineItemMarkerCountObserved,
    mediaPoolMarkerCountObserved,
    flaggedMediaPoolItemCountObserved,
    coloredMediaPoolItemCountObserved,
    tracksTruncated,
    itemsTruncated,
    markerRowsTruncated,
    complete: !tracksTruncated && !itemsTruncated && !markerRowsTruncated && !flagsTruncated
      && !timelineItemIdentityIncomplete && !mediaPoolAssociationIncomplete && !mediaPoolIdentityIncomplete
      && !markerRowsIncomplete && unverified.length === 0,
    methodEvidence: {
      strategy: 'dir',
      timeline: {
        checkedMethods: timelineChecked as EditReviewAnnotationsInspect['methodEvidence']['timeline']['checkedMethods'],
        observedMethods: timelineObserved,
        missingMethods: timelineMissing,
        failedMethods: timelineFailed
      },
      timelineItem: {
        checkedMethods: itemChecked as EditReviewAnnotationsInspect['methodEvidence']['timelineItem']['checkedMethods'],
        fullyObservedMethods: itemFullyObserved,
        missingMethods: itemMissing,
        failedMethods: itemFailed,
        itemsProbed: itemProbed
      },
      mediaPoolItem: {
        checkedMethods: mediaChecked as EditReviewAnnotationsInspect['methodEvidence']['mediaPoolItem']['checkedMethods'],
        fullyObservedMethods: mediaFullyObserved,
        missingMethods: mediaMissing,
        failedMethods: mediaFailed,
        itemsProbed: mediaProbed
      }
    },
    markers,
    mediaPoolAnnotations,
    unverified
  };
}

function fusionCompositionInspect(value: unknown): FusionCompositionInspect | null {
  if (value === null) return null;
  const detail = objectValue(value);
  if (!detail || detail['readerId'] !== 'fusion.composition_inspect.v1') {
    throw new Error('Fusion composition inspection returned invalid structured result');
  }
  const timeline = objectValue(detail['timeline']);
  const evidence = objectValue(detail['methodEvidence']);
  const timelineId = timeline ? nonEmptyString(timeline['id']) : null;
  const timelineName = timeline ? nonEmptyString(timeline['name']) : null;
  if (!timeline || !timelineId || !timelineName || !evidence || evidence['strategy'] !== 'dir') {
    throw new Error('Fusion composition inspection returned invalid identity or method evidence');
  }
  const validateMethods = (raw: unknown, label: string, exact = false): string[] => {
    if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string' || !FUSION_COMPOSITION_METHODS.includes(entry as typeof FUSION_COMPOSITION_METHODS[number]))
      || new Set(raw).size !== raw.length) {
      throw new Error(`Fusion composition inspection returned invalid ${label} method evidence`);
    }
    const methods = raw as string[];
    if (exact && (methods.length !== FUSION_COMPOSITION_METHODS.length
      || FUSION_COMPOSITION_METHODS.some((name) => !methods.includes(name)))) {
      throw new Error('Fusion composition inspection returned incomplete checked-method allowlist evidence');
    }
    return methods;
  };
  const checked = validateMethods(evidence['checkedMethods'], 'checked', true);
  const fullyObserved = validateMethods(evidence['fullyObservedMethods'], 'fully observed');
  const missing = validateMethods(evidence['missingMethods'], 'missing');
  const failed = validateMethods(evidence['failedMethods'], 'failed');
  const rawItemsProbed = evidence['itemsProbed'];
  if (typeof rawItemsProbed !== 'number' || !Number.isInteger(rawItemsProbed) || rawItemsProbed < 0
    || fullyObserved.some((name) => missing.includes(name))) {
    throw new Error('Fusion composition inspection returned inconsistent method evidence');
  }

  const integerField = (key: string, max?: number): number => {
    const raw = detail[key];
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || (max !== undefined && raw > max)) {
      throw new Error(`Fusion composition inspection returned invalid ${key}`);
    }
    return raw;
  };
  const videoTrackCount = integerField('videoTrackCount');
  const tracksScanned = integerField('tracksScanned', 64);
  const videoItemsObserved = integerField('videoItemsObserved');
  const itemsReported = integerField('itemsReported', 2000);
  const tracksTruncated = detail['tracksTruncated'];
  const itemsTruncated = detail['itemsTruncated'];
  const namesTruncated = detail['namesTruncated'];
  const itemListFailed = detail['itemListFailed'];
  if (typeof tracksTruncated !== 'boolean' || typeof itemsTruncated !== 'boolean'
    || typeof namesTruncated !== 'boolean' || typeof itemListFailed !== 'boolean') {
    throw new Error('Fusion composition inspection returned invalid truncation or item-list evidence');
  }
  if (tracksScanned !== Math.min(videoTrackCount, 64) || tracksTruncated !== (videoTrackCount > 64)) {
    throw new Error('Fusion composition inspection returned inconsistent video track bounds');
  }
  const rawItems = detail['items'];
  if (!Array.isArray(rawItems) || rawItems.length !== itemsReported || rawItems.length > 2000 || rawItemsProbed !== itemsReported) {
    throw new Error('Fusion composition inspection returned inconsistent bounded item rows');
  }

  let derivedNamesTruncated = false;
  let itemIdentityIncomplete = false;
  let compositionCountIncomplete = false;
  let compositionNamesIncomplete = false;
  const seenPositions = new Set<string>();
  const items: FusionCompositionInspect['items'] = rawItems.map((raw) => {
    const row = objectValue(raw);
    if (!row) throw new Error('Fusion composition inspection returned invalid item row');
    const trackIndex = row['trackIndex'];
    const itemIndex = row['itemIndex'];
    if (typeof trackIndex !== 'number' || !Number.isInteger(trackIndex) || trackIndex < 1 || trackIndex > tracksScanned
      || typeof itemIndex !== 'number' || !Number.isInteger(itemIndex) || itemIndex < 1) {
      throw new Error('Fusion composition inspection returned invalid item position');
    }
    const positionKey = `${trackIndex}:${itemIndex}`;
    if (seenPositions.has(positionKey)) throw new Error('Fusion composition inspection returned duplicate item position');
    seenPositions.add(positionKey);

    const rawId = row['id'];
    const rawName = row['name'];
    const rowMissing = validateMethods(row['missingMethods'], 'item missing');
    const rowFailed = validateMethods(row['failedMethods'], 'item failed');
    if (rowFailed.some((method) => rowMissing.includes(method))) {
      throw new Error('Fusion composition inspection returned inconsistent per-item method evidence');
    }
    const id = rawId === null ? null : nonEmptyString(rawId);
    const name = rawName === null ? null : nonEmptyString(rawName);
    if ((rawId !== null && !id) || (rawName !== null && !name)) {
      throw new Error('Fusion composition inspection returned invalid exact item identity');
    }
    if ((!id && !rowMissing.includes('GetUniqueId') && !rowFailed.includes('GetUniqueId'))
      || (!name && !rowMissing.includes('GetName') && !rowFailed.includes('GetName'))) {
      throw new Error('Fusion composition inspection returned missing item identity without method evidence');
    }
    if (!id || !name) itemIdentityIncomplete = true;

    const rawCount = row['compositionCountObserved'];
    const compositionCountObserved = rawCount === null
      ? null
      : typeof rawCount === 'number' && Number.isInteger(rawCount) && rawCount >= 0
        ? rawCount
        : (() => { throw new Error('Fusion composition inspection returned invalid item composition count'); })();
    if (compositionCountObserved === null
      && !rowMissing.includes('GetFusionCompCount') && !rowFailed.includes('GetFusionCompCount')) {
      throw new Error('Fusion composition inspection returned missing item composition count without method evidence');
    }
    if (compositionCountObserved === null) compositionCountIncomplete = true;
    const rawNames = row['compositionNames'];
    if (!Array.isArray(rawNames) || rawNames.length > 64
      || rawNames.some((value) => typeof value !== 'string' || !value.trim() || value.length > 256)) {
      throw new Error('Fusion composition inspection returned invalid bounded item composition names');
    }
    const compositionNames = rawNames.map((value) => (value as string).trim());
    const rowNamesTruncated = row['namesTruncated'];
    if (typeof rowNamesTruncated !== 'boolean') throw new Error('Fusion composition inspection returned invalid item name bound');
    const nameListShape = row['nameListShape'];
    if (nameListShape !== 'list' && nameListShape !== 'empty_dict_zero_count'
      && nameListShape !== 'unexpected' && nameListShape !== null) {
      throw new Error('Fusion composition inspection returned invalid item name-list shape evidence');
    }
    if (nameListShape === 'empty_dict_zero_count' && compositionCountObserved !== 0) {
      throw new Error('Fusion composition inspection accepted the zero-count dict quirk for a nonzero item composition count');
    }
    const nameGetterIncomplete = rowMissing.includes('GetFusionCompNameList') || rowFailed.includes('GetFusionCompNameList');
    if (nameListShape === 'unexpected' && !rowFailed.includes('GetFusionCompNameList')) {
      throw new Error('Fusion composition inspection returned unexpected item name-list shape without failed evidence');
    }
    if (nameListShape === null && !nameGetterIncomplete) {
      throw new Error('Fusion composition inspection returned missing item name-list shape without method evidence');
    }
    if (!nameGetterIncomplete && compositionCountObserved !== null) {
      const expectedNames = Math.min(compositionCountObserved, 64);
      if (compositionNames.length !== expectedNames || rowNamesTruncated !== (compositionCountObserved > 64)) {
        throw new Error('Fusion composition inspection returned inconsistent item composition name count');
      }
      if (compositionCountObserved === 0) {
        if (nameListShape !== 'list' && nameListShape !== 'empty_dict_zero_count') {
          throw new Error('Fusion composition inspection returned invalid zero-count item name-list shape');
        }
      } else if (nameListShape !== 'list') {
        throw new Error('Fusion composition inspection returned invalid nonzero item name-list shape');
      }
    }
    if (nameGetterIncomplete || nameListShape === 'unexpected' || nameListShape === null) compositionNamesIncomplete = true;
    derivedNamesTruncated = derivedNamesTruncated || rowNamesTruncated;
    return {
      trackIndex,
      itemIndex,
      id,
      name,
      compositionCountObserved,
      compositionNames,
      namesTruncated: rowNamesTruncated,
      nameListShape,
      missingMethods: rowMissing,
      failedMethods: rowFailed
    };
  });

  if (namesTruncated !== derivedNamesTruncated) {
    throw new Error('Fusion composition inspection returned inconsistent aggregate name truncation');
  }
  if (!itemsTruncated && !itemListFailed && videoItemsObserved !== itemsReported) {
    throw new Error('Fusion composition inspection returned inconsistent video item count');
  }

  const unverified: FusionCompositionInspect['unverified'] = ['compositionGraph', 'pixelOutput'];
  if (itemListFailed) unverified.push('timelineItemList');
  if (itemIdentityIncomplete || missing.includes('GetUniqueId') || missing.includes('GetName')
    || failed.includes('GetUniqueId') || failed.includes('GetName')) unverified.push('itemIdentity');
  if (compositionCountIncomplete || missing.includes('GetFusionCompCount') || failed.includes('GetFusionCompCount')) unverified.push('compositionCount');
  if (compositionNamesIncomplete || missing.includes('GetFusionCompNameList') || failed.includes('GetFusionCompNameList')) unverified.push('compositionNames');
  if (missing.includes('GetFusionCompByIndex') || missing.includes('GetFusionCompByName')) unverified.push('compositionAccessSurface');
  const scopeComplete = !tracksTruncated && !itemsTruncated && !namesTruncated
    && !unverified.some((key) => key !== 'compositionGraph' && key !== 'pixelOutput');
  return {
    readerId: 'fusion.composition_inspect.v1',
    timeline: { id: timelineId, name: timelineName },
    videoTrackCount,
    tracksScanned,
    videoItemsObserved,
    itemsReported,
    tracksTruncated,
    itemsTruncated,
    namesTruncated,
    items,
    complete: scopeComplete,
    methodEvidence: {
      strategy: 'dir',
      checkedMethods: checked as FusionCompositionInspect['methodEvidence']['checkedMethods'],
      fullyObservedMethods: fullyObserved,
      missingMethods: missing,
      failedMethods: failed,
      itemsProbed: rawItemsProbed
    },
    unverified
  };
}

function fusionGraphInspect(value: unknown): FusionGraphInspect | null {
  if (value === null) return null;
  const detail = objectValue(value);
  if (!detail || detail['readerId'] !== 'fusion.graph_inspect.v1') {
    throw new Error('Fusion graph inspection returned invalid structured result');
  }
  const timeline = objectValue(detail['timeline']);
  const timelineId = timeline ? nonEmptyString(timeline['id']) : null;
  const timelineName = timeline ? nonEmptyString(timeline['name']) : null;
  const evidence = objectValue(detail['methodEvidence']);
  if (!timelineId || !timelineName || timelineId.length > 128 || timelineName.length > 256 || !evidence) {
    throw new Error('Fusion graph inspection returned invalid identity or method evidence');
  }

  const validateMethods = (raw: unknown, label: string, exact = false): string[] => {
    if (!Array.isArray(raw) || raw.some((entry) => typeof entry !== 'string'
      || !FUSION_GRAPH_METHODS.includes(entry as typeof FUSION_GRAPH_METHODS[number]))
      || new Set(raw).size !== raw.length) {
      throw new Error(`Fusion graph inspection returned invalid ${label} method evidence`);
    }
    const methods = raw as string[];
    if (exact && (methods.length !== FUSION_GRAPH_METHODS.length
      || FUSION_GRAPH_METHODS.some((name) => !methods.includes(name)))) {
      throw new Error('Fusion graph inspection returned incomplete checked-method allowlist evidence');
    }
    return methods;
  };
  const checkedMethods = validateMethods(evidence['checkedMethods'], 'checked', true);
  const failedMethods = validateMethods(evidence['failedMethods'], 'failed');

  const integer = (raw: unknown, label: string, max?: number): number => {
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0 || (max !== undefined && raw > max)) {
      throw new Error(`Fusion graph inspection returned invalid ${label}`);
    }
    return raw;
  };
  const boolean = (raw: unknown, label: string): boolean => {
    if (typeof raw !== 'boolean') throw new Error(`Fusion graph inspection returned invalid ${label}`);
    return raw;
  };
  const boundedText = (raw: unknown, label: string): string => {
    const value = nonEmptyString(raw);
    if (!value || value.length > 256) throw new Error(`Fusion graph inspection returned invalid ${label}`);
    return value;
  };

  const videoTrackCount = integer(detail['videoTrackCount'], 'videoTrackCount');
  const tracksScanned = integer(detail['tracksScanned'], 'tracksScanned', 64);
  const videoItemsObserved = integer(detail['videoItemsObserved'], 'videoItemsObserved');
  const itemsScanned = integer(detail['itemsScanned'], 'itemsScanned', 2000);
  const compositionsObserved = integer(detail['compositionsObserved'], 'compositionsObserved');
  const compositionsReported = integer(detail['compositionsReported'], 'compositionsReported', 128);
  const toolsObserved = integer(detail['toolsObserved'], 'toolsObserved');
  const toolsReported = integer(detail['toolsReported'], 'toolsReported', 512);
  const edgesObserved = integer(detail['edgesObserved'], 'edgesObserved');
  const edgesReported = integer(detail['edgesReported'], 'edgesReported', 4096);
  const tracksTruncated = boolean(detail['tracksTruncated'], 'tracksTruncated');
  const itemsTruncated = boolean(detail['itemsTruncated'], 'itemsTruncated');
  const compositionsTruncated = boolean(detail['compositionsTruncated'], 'compositionsTruncated');
  const toolsTruncated = boolean(detail['toolsTruncated'], 'toolsTruncated');
  const portsTruncated = boolean(detail['portsTruncated'], 'portsTruncated');
  const edgesTruncated = boolean(detail['edgesTruncated'], 'edgesTruncated');
  if (tracksScanned !== Math.min(videoTrackCount, 64) || tracksTruncated !== (videoTrackCount > 64)) {
    throw new Error('Fusion graph inspection returned inconsistent track bounds');
  }
  if (itemsScanned > videoItemsObserved || itemsTruncated !== (videoItemsObserved > itemsScanned)) {
    throw new Error('Fusion graph inspection returned inconsistent item bounds');
  }
  if (compositionsReported > compositionsObserved
    || (compositionsObserved > 128 && !compositionsTruncated)
    || (compositionsTruncated && compositionsReported >= compositionsObserved)) {
    throw new Error('Fusion graph inspection returned inconsistent composition bounds');
  }
  if (toolsReported > toolsObserved
    || (toolsObserved > 512 && !toolsTruncated)
    || (toolsTruncated && toolsReported >= toolsObserved)) {
    throw new Error('Fusion graph inspection returned inconsistent tool bounds');
  }
  if (edgesReported > edgesObserved
    || (edgesObserved > 4096 && !edgesTruncated)
    || (edgesTruncated && edgesReported >= edgesObserved)) {
    throw new Error('Fusion graph inspection returned inconsistent edge bounds');
  }

  const rawCompositions = detail['compositions'];
  if (!Array.isArray(rawCompositions) || rawCompositions.length !== compositionsReported) {
    throw new Error('Fusion graph inspection returned inconsistent composition rows');
  }
  let derivedToolsReported = 0;
  let derivedEdgesReported = 0;
  let reportedOutputCount = 0;
  const compositionKeys = new Set<string>();
  const compositions: FusionGraphInspect['compositions'] = rawCompositions.map((raw) => {
    const row = objectValue(raw);
    if (!row) throw new Error('Fusion graph inspection returned invalid composition row');
    const trackIndex = integer(row['trackIndex'], 'composition trackIndex');
    const itemIndex = integer(row['itemIndex'], 'composition itemIndex');
    if (trackIndex < 1 || trackIndex > tracksScanned || itemIndex < 1) {
      throw new Error('Fusion graph inspection returned invalid composition position');
    }
    const timelineItemId = boundedText(row['timelineItemId'], 'TimelineItem ID');
    const timelineItemName = boundedText(row['timelineItemName'], 'TimelineItem name');
    const compositionName = boundedText(row['compositionName'], 'composition name');
    const compositionKey = `${trackIndex}:${itemIndex}:${timelineItemId}:${compositionName}`;
    if (compositionKeys.has(compositionKey)) throw new Error('Fusion graph inspection returned duplicate composition row');
    compositionKeys.add(compositionKey);
    const toolCountObserved = integer(row['toolCountObserved'], 'toolCountObserved');
    const rawTools = row['tools'];
    const rawEdges = row['edges'];
    if (!Array.isArray(rawTools) || !Array.isArray(rawEdges)) {
      throw new Error('Fusion graph inspection returned invalid tool or edge rows');
    }
    if (rawTools.length > toolCountObserved) {
      throw new Error('Fusion graph inspection returned more tool rows than observed');
    }

    const toolKeys = new Set<string>();
    const tools: FusionGraphInspect['compositions'][number]['tools'] = rawTools.map((rawTool) => {
      const tool = objectValue(rawTool);
      if (!tool) throw new Error('Fusion graph inspection returned invalid tool row');
      const name = boundedText(tool['name'], 'tool name');
      const id = boundedText(tool['id'], 'tool ID');
      const key = `${name}:${id}`;
      if (toolKeys.has(key)) throw new Error('Fusion graph inspection returned duplicate tool identity');
      toolKeys.add(key);
      const inputCountObserved = integer(tool['inputCountObserved'], 'inputCountObserved');
      const outputCountObserved = integer(tool['outputCountObserved'], 'outputCountObserved');
      reportedOutputCount += outputCountObserved;
      return { name, id, inputCountObserved, outputCountObserved };
    });
    derivedToolsReported += tools.length;

    const edgeKeys = new Set<string>();
    const edges: FusionGraphInspect['compositions'][number]['edges'] = rawEdges.map((rawEdge) => {
      const edge = objectValue(rawEdge);
      if (!edge) throw new Error('Fusion graph inspection returned invalid edge row');
      const sourceToolName = boundedText(edge['sourceToolName'], 'source tool name');
      const sourceToolId = boundedText(edge['sourceToolId'], 'source tool ID');
      const sourceOutputId = boundedText(edge['sourceOutputId'], 'source output ID');
      const targetToolName = boundedText(edge['targetToolName'], 'target tool name');
      const targetToolId = boundedText(edge['targetToolId'], 'target tool ID');
      const targetInputId = boundedText(edge['targetInputId'], 'target input ID');
      const bidirectionalReadback = boolean(edge['bidirectionalReadback'], 'bidirectionalReadback');
      if (!toolKeys.has(`${sourceToolName}:${sourceToolId}`)) {
        throw new Error('Fusion graph inspection returned edge from an unreported source tool');
      }
      const edgeKey = `${sourceToolName}:${sourceToolId}:${sourceOutputId}:${targetToolName}:${targetToolId}:${targetInputId}`;
      if (edgeKeys.has(edgeKey)) throw new Error('Fusion graph inspection returned duplicate edge identity');
      edgeKeys.add(edgeKey);
      return {
        sourceToolName,
        sourceToolId,
        sourceOutputId,
        targetToolName,
        targetToolId,
        targetInputId,
        bidirectionalReadback
      };
    });
    derivedEdgesReported += edges.length;
    return {
      trackIndex,
      itemIndex,
      timelineItemId,
      timelineItemName,
      compositionName,
      toolCountObserved,
      tools,
      edges
    };
  });
  if (derivedToolsReported !== toolsReported || derivedEdgesReported !== edgesReported) {
    throw new Error('Fusion graph inspection returned inconsistent aggregate row counts');
  }

  const compositionObjectsProbed = integer(evidence['compositionObjectsProbed'], 'compositionObjectsProbed', 128);
  const toolsProbed = integer(evidence['toolsProbed'], 'toolsProbed', 512);
  const outputsProbed = integer(evidence['outputsProbed'], 'outputsProbed', 4096);
  const edgesReadbackProbed = integer(evidence['edgesReadbackProbed'], 'edgesReadbackProbed', 4096);
  if (compositionObjectsProbed !== compositionsReported || toolsProbed < toolsReported
    || outputsProbed > reportedOutputCount || edgesReadbackProbed !== edgesReported) {
    throw new Error('Fusion graph inspection returned inconsistent method probe counts');
  }

  const unverified: FusionGraphInspect['unverified'] = ['controlValues', 'pixelOutput', 'graphWrites'];
  if (failedMethods.includes('GetFusionCompByName')) unverified.unshift('compositionObjectAccess');
  if (failedMethods.includes('GetToolList')) unverified.unshift('toolInventory');
  if (failedMethods.includes('GetInputList') || failedMethods.includes('GetOutputList')) unverified.unshift('portInventory');
  if (failedMethods.includes('GetConnectedInputs') || failedMethods.includes('GetConnectedOutput')
    || compositions.some((composition) => composition.edges.some((edge) => !edge.bidirectionalReadback))) {
    unverified.unshift('edgeReadback');
  }
  const complete = !tracksTruncated && !itemsTruncated && !compositionsTruncated && !toolsTruncated && !portsTruncated && !edgesTruncated
    && !unverified.some((key) => key !== 'controlValues' && key !== 'pixelOutput' && key !== 'graphWrites');
  return {
    readerId: 'fusion.graph_inspect.v1',
    timeline: { id: timelineId, name: timelineName },
    videoTrackCount,
    tracksScanned,
    videoItemsObserved,
    itemsScanned,
    compositionsObserved,
    compositionsReported,
    toolsObserved,
    toolsReported,
    edgesObserved,
    edgesReported,
    tracksTruncated,
    itemsTruncated,
    compositionsTruncated,
    toolsTruncated,
    portsTruncated,
    edgesTruncated,
    compositions,
    complete,
    methodEvidence: {
      checkedMethods: checkedMethods as FusionGraphInspect['methodEvidence']['checkedMethods'],
      failedMethods,
      compositionObjectsProbed,
      toolsProbed,
      outputsProbed,
      edgesReadbackProbed
    },
    unverified
  };
}

function editTimelineSummary(value: unknown): EditTimelineSummary | null {
  if (value === null) return null;
  const summary = objectValue(value);
  if (!summary || summary['readerId'] !== 'edit.timeline_summary.v1') {
    throw new Error('Edit timeline summary returned invalid structured result');
  }
  const timeline = objectValue(summary['timeline']);
  const trackCounts = objectValue(summary['trackCounts']);
  const tracks = Array.isArray(summary['tracks']) ? summary['tracks'] : [];
  if (!timeline || typeof timeline['id'] !== 'string' || typeof timeline['name'] !== 'string' || !trackCounts) {
    throw new Error('Edit timeline summary returned invalid timeline identity');
  }
  const startFrame = finiteNumber(timeline['startFrame']);
  const endFrame = finiteNumber(timeline['endFrame']);
  const durationFrames = finiteNumber(timeline['durationFrames']);
  return {
    readerId: 'edit.timeline_summary.v1',
    timeline: {
      id: timeline['id'],
      name: timeline['name'],
      startFrame: startFrame !== null && Number.isInteger(startFrame) ? startFrame : null,
      endFrame: endFrame !== null && Number.isInteger(endFrame) ? endFrame : null,
      durationFrames: durationFrames !== null && Number.isInteger(durationFrames) && durationFrames >= 0 ? durationFrames : null,
      startTimecode: nonEmptyString(timeline['startTimecode']),
      frameRate: finiteNumber(timeline['frameRate'])
    },
    trackCounts: {
      video: editRequiredCount(trackCounts['video'], 'video track count'),
      audio: editRequiredCount(trackCounts['audio'], 'audio track count'),
      subtitle: editRequiredCount(trackCounts['subtitle'], 'subtitle track count')
    },
    timelineItemCountObserved: editRequiredCount(summary['timelineItemCountObserved'], 'timeline item count'),
    itemsScannedForSourceState: editRequiredCount(summary['itemsScannedForSourceState'], 'source-state scan count'),
    markerCount: editRequiredCount(summary['markerCount'], 'marker count'),
    subtitleItemCount: editRequiredCount(summary['subtitleItemCount'], 'subtitle item count'),
    offlineSourceItemCountObserved: editRequiredCount(summary['offlineSourceItemCountObserved'], 'offline source item count'),
    onlineStateUnverifiedItemCountObserved: editRequiredCount(summary['onlineStateUnverifiedItemCountObserved'], 'online-state unverified item count'),
    itemsWithoutMediaPoolReferenceCountObserved: editRequiredCount(summary['itemsWithoutMediaPoolReferenceCountObserved'], 'items without Media Pool reference count'),
    tracks: tracks.flatMap((value) => {
      const row = objectValue(value);
      if (!row || (row['type'] !== 'video' && row['type'] !== 'audio' && row['type'] !== 'subtitle')) return [];
      const index = finiteNumber(row['index']);
      if (index === null || !Number.isInteger(index) || index < 1) return [];
      return [{
        type: row['type'],
        index,
        name: nonEmptyString(row['name']),
        enabled: nullableBoolean(row['enabled']),
        locked: nullableBoolean(row['locked']),
        itemCount: editRequiredCount(row['itemCount'], 'track item count'),
        offlineSourceItemCountObserved: editRequiredCount(row['offlineSourceItemCountObserved'], 'track offline source item count'),
        onlineStateUnverifiedItemCountObserved: editRequiredCount(row['onlineStateUnverifiedItemCountObserved'], 'track online-state unverified item count'),
        itemsWithoutMediaPoolReferenceCountObserved: editRequiredCount(row['itemsWithoutMediaPoolReferenceCountObserved'], 'track items without Media Pool reference count')
      }];
    }),
    complete: summary['complete'] === true,
    tracksTruncated: summary['tracksTruncated'] === true,
    sourceStateScanTruncated: summary['sourceStateScanTruncated'] === true,
    unverified: ['gapOverlapIndicators', 'sourceRangeConflicts']
  };
}

function colorRequiredCount(value: unknown, field: string): number {
  const count = finiteNumber(value);
  if (count === null || count < 0 || !Number.isInteger(count)) throw new Error(`Color pipeline inspection returned invalid ${field}`);
  return count;
}

function colorPipelineSummary(value: unknown): ColorPipelineSummary | null {
  if (value === null) return null;
  const summary = objectValue(value);
  if (!summary || summary['readerId'] !== 'color.pipeline_inspect.v1') {
    throw new Error('Color pipeline inspection returned invalid structured result');
  }
  const settings = objectValue(summary['settings']);
  const groups = Array.isArray(summary['colorGroups']) ? summary['colorGroups'] : [];
  const items = Array.isArray(summary['items']) ? summary['items'] : [];
  return {
    readerId: 'color.pipeline_inspect.v1',
    settings: settings ? {
      colorScienceMode: nonEmptyString(settings['colorScienceMode']),
      inputColorSpace: nonEmptyString(settings['inputColorSpace']),
      inputGamma: nonEmptyString(settings['inputGamma']),
      timelineColorSpace: nonEmptyString(settings['timelineColorSpace']),
      timelineGamma: nonEmptyString(settings['timelineGamma']),
      outputColorSpace: nonEmptyString(settings['outputColorSpace']),
      outputGamma: nonEmptyString(settings['outputGamma']),
      outputToneMapping: nonEmptyString(settings['outputToneMapping']),
      outputGamutMapping: nonEmptyString(settings['outputGamutMapping']),
      colorSpaceAwareGradingTools: nullableBoolean(settings['colorSpaceAwareGradingTools'])
    } : null,
    colorGroupCount: colorRequiredCount(summary['colorGroupCount'], 'Color Group count'),
    colorGroups: groups.flatMap((value) => {
      const row = objectValue(value);
      if (!row || typeof row['name'] !== 'string') return [];
      return [{
        name: row['name'],
        currentTimelineItemCount: colorRequiredCount(row['currentTimelineItemCount'], 'Color Group timeline item count')
      }];
    }),
    videoItemCountObserved: colorRequiredCount(summary['videoItemCountObserved'], 'video item count'),
    videoItemsScanned: colorRequiredCount(summary['videoItemsScanned'], 'video item scan count'),
    groupedItemCountObserved: colorRequiredCount(summary['groupedItemCountObserved'], 'grouped item count'),
    nodeCountObserved: colorRequiredCount(summary['nodeCountObserved'], 'node count'),
    lutReferenceCountObserved: colorRequiredCount(summary['lutReferenceCountObserved'], 'LUT reference count'),
    items: items.flatMap((value) => {
      const row = objectValue(value);
      if (!row || typeof row['id'] !== 'string' || typeof row['name'] !== 'string') return [];
      const nodeCount = finiteNumber(row['nodeCount']);
      const versionType = finiteNumber(row['currentVersionType']);
      return [{
        id: row['id'],
        name: row['name'],
        nodeCount: nodeCount !== null && Number.isInteger(nodeCount) && nodeCount >= 0 ? nodeCount : null,
        groupName: nonEmptyString(row['groupName']),
        currentVersionName: nonEmptyString(row['currentVersionName']),
        currentVersionType: versionType !== null && Number.isInteger(versionType) ? versionType : null,
        localVersionCount: colorRequiredCount(row['localVersionCount'], 'local version count'),
        remoteVersionCount: colorRequiredCount(row['remoteVersionCount'], 'remote version count'),
        lutReferenceCount: colorRequiredCount(row['lutReferenceCount'], 'item LUT reference count')
      }];
    }),
    complete: summary['complete'] === true,
    itemsTruncated: summary['itemsTruncated'] === true,
    nodesTruncated: summary['nodesTruncated'] === true,
    unverified: ['dctlReferences', 'additionalNodeStackLayers']
  };
}

const COLOR_GRAPH_METHODS: ColorGraphInventory['methodEvidence']['checkedMethods'] = [
  'Timeline.GetNodeGraph',
  'TimelineItem.GetNodeGraph',
  'ColorGroup.GetPreClipNodeGraph',
  'ColorGroup.GetPostClipNodeGraph',
  'Graph.GetNumNodes',
  'Graph.GetNodeLabel',
  'Graph.GetLUT',
  'Graph.GetNodeCacheMode',
  'Graph.GetToolsInNode'
];

const COLOR_GRAPH_MAX_VIDEO_TRACKS = 64;
const COLOR_GRAPH_MAX_ITEMS = 200;
const COLOR_GRAPH_MAX_NODE_STACK_LAYERS = 32;
const COLOR_GRAPH_MAX_COLOR_GROUPS = 32;
const COLOR_GRAPH_MAX_NODES = 2048;
const COLOR_GRAPH_MAX_TOOLS_PER_NODE = 64;
const COLOR_GRAPH_MAX_TEXT = 256;
const COLOR_GRAPH_MAX_ID = 256;
const COLOR_GRAPH_MAX_NAME = 1024;

function colorGraphStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Color graph inspection returned invalid ${field}`);
  }
  return value as string[];
}

function colorGraphScope(value: unknown, expectedScope: ColorGraphInventory['timelineGraph']['scope']): ColorGraphInventory['timelineGraph'] {
  const row = objectValue(value);
  if (!row || row['scope'] !== expectedScope) throw new Error('Color graph inspection returned invalid graph scope');
  const graphAccess = row['graphAccess'];
  if (graphAccess !== 'observed' && graphAccess !== 'null' && graphAccess !== 'missing' && graphAccess !== 'failed') {
    throw new Error('Color graph inspection returned invalid graph access state');
  }
  const trackIndex = finiteNumber(row['trackIndex']);
  const itemIndex = finiteNumber(row['itemIndex']);
  const layerIndex = finiteNumber(row['layerIndex']);
  const itemId = row['timelineItemId'];
  const itemName = row['timelineItemName'];
  const colorGroupIndex = finiteNumber(row['colorGroupIndex']);
  const colorGroupName = row['colorGroupName'];
  if (expectedScope === 'timeline') {
    if (row['trackIndex'] !== null || row['itemIndex'] !== null || row['layerIndex'] !== null || row['timelineItemId'] !== null || row['timelineItemName'] !== null
      || row['colorGroupIndex'] !== null || row['colorGroupName'] !== null) {
      throw new Error('Color graph inspection returned invalid timeline graph identity');
    }
  } else if (expectedScope === 'item') {
    if (
    trackIndex === null || !Number.isInteger(trackIndex) || trackIndex < 1
    || itemIndex === null || !Number.isInteger(itemIndex) || itemIndex < 1
    || layerIndex === null || !Number.isInteger(layerIndex) || layerIndex < 1
    || typeof itemId !== 'string' || itemId.trim().length === 0 || itemId.length > COLOR_GRAPH_MAX_ID
    || typeof itemName !== 'string' || itemName.length > COLOR_GRAPH_MAX_NAME
    || row['colorGroupIndex'] !== null || row['colorGroupName'] !== null
    ) {
      throw new Error('Color graph inspection returned invalid item graph identity');
    }
  } else if (
    row['trackIndex'] !== null || row['itemIndex'] !== null || row['layerIndex'] !== null
    || row['timelineItemId'] !== null || row['timelineItemName'] !== null
    || colorGroupIndex === null || !Number.isInteger(colorGroupIndex) || colorGroupIndex < 1
    || typeof colorGroupName !== 'string' || colorGroupName.trim().length === 0 || colorGroupName.length > COLOR_GRAPH_MAX_NAME
  ) {
    throw new Error('Color graph inspection returned invalid Color Group graph identity');
  }

  const nodeCount = row['nodeCountObserved'] === null ? null : finiteNumber(row['nodeCountObserved']);
  if (nodeCount !== null && (!Number.isInteger(nodeCount) || nodeCount < 0)) {
    throw new Error('Color graph inspection returned invalid node count');
  }
  const nodesReported = colorRequiredCount(row['nodesReported'], 'reported graph node count');
  const nodesTruncated = row['nodesTruncated'] === true;
  const missingMethods = colorGraphStringArray(row['missingMethods'], 'graph missing-method evidence');
  const failedMethods = colorGraphStringArray(row['failedMethods'], 'graph failed-method evidence');
  const rawNodes = Array.isArray(row['nodes']) ? row['nodes'] : null;
  if (!rawNodes || rawNodes.length !== nodesReported) throw new Error('Color graph inspection returned inconsistent node rows');
  if (nodeCount !== null && nodesReported > nodeCount) throw new Error('Color graph inspection reported more nodes than observed');
  if (graphAccess !== 'observed' && (nodeCount !== null || nodesReported !== 0)) {
    throw new Error('Color graph inspection returned node evidence without an observed graph');
  }

  const nodes = rawNodes.map((value, offset) => {
    const node = objectValue(value);
    if (!node) throw new Error('Color graph inspection returned invalid node row');
    const index = finiteNumber(node['index']);
    if (index === null || !Number.isInteger(index) || index !== offset + 1) {
      throw new Error('Color graph inspection returned invalid node index');
    }
    if (typeof node['label'] !== 'string' || node['label'].length > COLOR_GRAPH_MAX_TEXT) {
      throw new Error('Color graph inspection returned invalid node label');
    }
    const lutReferencePresent = node['lutReferencePresent'];
    if (lutReferencePresent !== null && typeof lutReferencePresent !== 'boolean') {
      throw new Error('Color graph inspection returned invalid LUT reference evidence');
    }
    if (lutReferencePresent === null
      && !missingMethods.includes('Graph.GetLUT')
      && !failedMethods.includes('Graph.GetLUT')) {
      throw new Error('Color graph inspection returned missing LUT evidence without getter failure');
    }
    const cacheMode = node['cacheMode'] === null ? null : finiteNumber(node['cacheMode']);
    if (cacheMode !== null && !Number.isInteger(cacheMode)) throw new Error('Color graph inspection returned invalid node cache mode');
    const cacheModeShape = node['cacheModeShape'];
    if (cacheModeShape !== 'integer' && cacheModeShape !== 'null' && cacheModeShape !== 'unavailable') {
      throw new Error('Color graph inspection returned invalid node cache shape');
    }
    const cacheUnavailable = missingMethods.includes('Graph.GetNodeCacheMode') || failedMethods.includes('Graph.GetNodeCacheMode');
    if ((cacheModeShape === 'integer' && (cacheMode === null || cacheUnavailable))
      || (cacheModeShape === 'null' && (cacheMode !== null || cacheUnavailable))
      || (cacheModeShape === 'unavailable' && (cacheMode !== null || !cacheUnavailable))) {
      throw new Error('Color graph inspection returned inconsistent node cache evidence');
    }
    const toolListShape = node['toolListShape'];
    if (toolListShape !== 'list' && toolListShape !== 'null') throw new Error('Color graph inspection returned invalid tool-list shape');
    const toolNames = colorGraphStringArray(node['toolNames'], 'node tool names');
    if (toolListShape === 'null' && toolNames.length !== 0) throw new Error('Color graph inspection returned tools for null tool-list shape');
    if (toolNames.length > COLOR_GRAPH_MAX_TOOLS_PER_NODE || toolNames.some((name) => name.length > COLOR_GRAPH_MAX_TEXT)) {
      throw new Error('Color graph inspection returned out-of-bounds node tools');
    }
    const toolsTruncated = node['toolsTruncated'] === true;
    if (toolsTruncated && (toolListShape !== 'list' || toolNames.length !== COLOR_GRAPH_MAX_TOOLS_PER_NODE)) {
      throw new Error('Color graph inspection returned inconsistent node tool truncation');
    }
    if (toolListShape === 'null' && toolsTruncated) {
      throw new Error('Color graph inspection returned truncated null node tools');
    }
    return {
      index,
      label: node['label'],
      lutReferencePresent,
      cacheMode,
      cacheModeShape: cacheModeShape as 'integer' | 'null' | 'unavailable',
      toolNames,
      toolListShape: toolListShape as 'list' | 'null',
      toolsTruncated
    };
  });

  if (nodeCount !== null && nodesTruncated !== (nodesReported < nodeCount)) {
    throw new Error('Color graph inspection returned inconsistent graph node truncation');
  }

  return {
    scope: expectedScope,
    trackIndex: expectedScope === 'item' ? trackIndex : null,
    itemIndex: expectedScope === 'item' ? itemIndex : null,
    layerIndex: expectedScope === 'item' ? layerIndex : null,
    timelineItemId: expectedScope === 'item' ? itemId as string : null,
    timelineItemName: expectedScope === 'item' ? itemName as string : null,
    colorGroupIndex: expectedScope === 'group_pre' || expectedScope === 'group_post' ? colorGroupIndex : null,
    colorGroupName: expectedScope === 'group_pre' || expectedScope === 'group_post' ? colorGroupName as string : null,
    graphAccess,
    nodeCountObserved: nodeCount,
    nodesReported,
    nodesTruncated,
    nodes,
    missingMethods,
    failedMethods
  };
}

function colorGraphInventory(value: unknown): ColorGraphInventory | null {
  if (value === null) return null;
  const summary = objectValue(value);
  if (!summary || summary['readerId'] !== 'color.graph_inventory.v1') {
    throw new Error('Color graph inspection returned invalid structured result');
  }
  const timeline = objectValue(summary['timeline']);
  if (!timeline || typeof timeline['id'] !== 'string' || timeline['id'].trim().length === 0 || timeline['id'].length > COLOR_GRAPH_MAX_ID
    || typeof timeline['name'] !== 'string' || timeline['name'].trim().length === 0 || timeline['name'].length > COLOR_GRAPH_MAX_NAME) {
    throw new Error('Color graph inspection returned invalid timeline identity');
  }
  const timelineGraph = colorGraphScope(summary['timelineGraph'], 'timeline');
  const rawItemGraphs = Array.isArray(summary['itemGraphs']) ? summary['itemGraphs'] : null;
  if (!rawItemGraphs) throw new Error('Color graph inspection returned invalid item graph rows');
  const itemGraphs = rawItemGraphs.map((row) => colorGraphScope(row, 'item'));
  const rawColorGroupGraphs = Array.isArray(summary['colorGroupGraphs']) ? summary['colorGroupGraphs'] : null;
  if (!rawColorGroupGraphs) throw new Error('Color graph inspection returned invalid Color Group graph rows');
  const colorGroupGraphs = rawColorGroupGraphs.map((row) => {
    const scope = objectValue(row)?.['scope'];
    if (scope !== 'group_pre' && scope !== 'group_post') {
      throw new Error('Color graph inspection returned invalid Color Group graph scope');
    }
    return colorGraphScope(row, scope);
  });

  const nodeStackLayersReadback = summary['nodeStackLayersReadback'];
  if (nodeStackLayersReadback !== 'observed' && nodeStackLayersReadback !== 'failed') {
    throw new Error('Color graph inspection returned invalid Node Stack Layer readback state');
  }
  const nodeStackLayersConfigured = summary['nodeStackLayersConfigured'] === null
    ? null
    : finiteNumber(summary['nodeStackLayersConfigured']);
  const nodeStackLayersScanned = colorRequiredCount(summary['nodeStackLayersScanned'], 'Node Stack Layer scan count');
  const layersTruncated = summary['layersTruncated'] === true;
  if (nodeStackLayersReadback === 'observed') {
    if (nodeStackLayersConfigured === null || !Number.isSafeInteger(nodeStackLayersConfigured) || nodeStackLayersConfigured < 1
      || nodeStackLayersScanned !== Math.min(nodeStackLayersConfigured, COLOR_GRAPH_MAX_NODE_STACK_LAYERS)
      || layersTruncated !== (nodeStackLayersConfigured > COLOR_GRAPH_MAX_NODE_STACK_LAYERS)) {
      throw new Error('Color graph inspection returned inconsistent Node Stack Layer bounds');
    }
  } else if (nodeStackLayersConfigured !== null || nodeStackLayersScanned !== 0 || layersTruncated) {
    throw new Error('Color graph inspection returned Node Stack Layer evidence without observed settings');
  }

  const colorGroupsReadback = summary['colorGroupsReadback'];
  if (colorGroupsReadback !== 'observed' && colorGroupsReadback !== 'failed') {
    throw new Error('Color graph inspection returned invalid Color Group readback state');
  }
  const colorGroupCountObserved = summary['colorGroupCountObserved'] === null
    ? null
    : colorRequiredCount(summary['colorGroupCountObserved'], 'Color Group count');
  const colorGroupsScanned = colorRequiredCount(summary['colorGroupsScanned'], 'Color Group scan count');
  const colorGroupsTruncated = summary['colorGroupsTruncated'] === true;
  if (colorGroupsReadback === 'observed') {
    if (colorGroupCountObserved === null
      || colorGroupsScanned !== Math.min(colorGroupCountObserved, COLOR_GRAPH_MAX_COLOR_GROUPS)
      || colorGroupsTruncated !== (colorGroupCountObserved > COLOR_GRAPH_MAX_COLOR_GROUPS)
      || rawColorGroupGraphs.length !== colorGroupsScanned * 2) {
      throw new Error('Color graph inspection returned inconsistent Color Group bounds');
    }
  } else if (colorGroupCountObserved !== null || colorGroupsScanned !== 0 || colorGroupsTruncated || rawColorGroupGraphs.length !== 0) {
    throw new Error('Color graph inspection returned Color Group evidence without observed group list');
  }
  const colorGroupScopeKeys = new Set<string>();
  const colorGroupCoverage = new Map<number, { name: string; scopes: Set<string> }>();
  for (const row of colorGroupGraphs) {
    if (row.colorGroupIndex === null || row.colorGroupIndex > colorGroupsScanned || row.colorGroupName === null) {
      throw new Error('Color graph inspection returned out-of-bounds Color Group graph');
    }
    const key = `${row.colorGroupIndex}:${row.scope}`;
    if (colorGroupScopeKeys.has(key)) throw new Error('Color graph inspection returned duplicate Color Group graph identity');
    colorGroupScopeKeys.add(key);
    const existing = colorGroupCoverage.get(row.colorGroupIndex);
    if (existing && existing.name !== row.colorGroupName) {
      throw new Error('Color graph inspection returned inconsistent Color Group name');
    }
    const coverage = existing ?? { name: row.colorGroupName, scopes: new Set<string>() };
    coverage.scopes.add(row.scope);
    colorGroupCoverage.set(row.colorGroupIndex, coverage);
  }
  if (colorGroupsReadback === 'observed' && (
    colorGroupCoverage.size !== colorGroupsScanned
    || [...colorGroupCoverage.entries()].some(([index, coverage]) => index < 1 || index > colorGroupsScanned
      || coverage.scopes.size !== 2 || !coverage.scopes.has('group_pre') || !coverage.scopes.has('group_post'))
  )) {
    throw new Error('Color graph inspection returned incomplete Color Group graph coverage');
  }

  const videoTrackCount = colorRequiredCount(summary['videoTrackCount'], 'video track count');
  const tracksScanned = colorRequiredCount(summary['tracksScanned'], 'video track scan count');
  const videoItemsObserved = colorRequiredCount(summary['videoItemsObserved'], 'video item count');
  const itemsScanned = colorRequiredCount(summary['itemsScanned'], 'video item scan count');
  const tracksTruncated = summary['tracksTruncated'] === true;
  const itemsTruncated = summary['itemsTruncated'] === true;
  if (tracksScanned !== Math.min(videoTrackCount, COLOR_GRAPH_MAX_VIDEO_TRACKS)
    || tracksTruncated !== (videoTrackCount > COLOR_GRAPH_MAX_VIDEO_TRACKS)) {
    throw new Error('Color graph inspection returned inconsistent track bounds');
  }
  const expectedItemGraphRows = itemsScanned * nodeStackLayersScanned;
  if (itemsScanned > COLOR_GRAPH_MAX_ITEMS || rawItemGraphs.length !== expectedItemGraphRows || videoItemsObserved < itemsScanned) {
    throw new Error('Color graph inspection returned inconsistent item bounds');
  }
  if ((itemsTruncated && itemsScanned !== COLOR_GRAPH_MAX_ITEMS)
    || (!itemsTruncated && videoItemsObserved !== itemsScanned)) {
    throw new Error('Color graph inspection returned inconsistent item truncation');
  }
  const itemLayerKeys = new Set<string>();
  const itemLayers = new Map<string, Set<number>>();
  for (const row of itemGraphs) {
    if (row.trackIndex === null || row.trackIndex > tracksScanned || row.layerIndex === null || row.layerIndex > nodeStackLayersScanned) {
      throw new Error('Color graph inspection returned out-of-bounds item track');
    }
    const itemKey = `${row.trackIndex}:${row.itemIndex}`;
    const layerKey = `${itemKey}:${row.layerIndex}`;
    if (itemLayerKeys.has(layerKey)) throw new Error('Color graph inspection returned duplicate item graph identity');
    itemLayerKeys.add(layerKey);
    const layers = itemLayers.get(itemKey) ?? new Set<number>();
    layers.add(row.layerIndex);
    itemLayers.set(itemKey, layers);
  }
  if (nodeStackLayersReadback === 'observed') {
    if (itemLayers.size !== itemsScanned
      || [...itemLayers.values()].some((layers) => layers.size !== nodeStackLayersScanned
        || [...layers].some((layer) => layer < 1 || layer > nodeStackLayersScanned))) {
      throw new Error('Color graph inspection returned incomplete item layer coverage');
    }
  }
  const checkedMethods = colorGraphStringArray(objectValue(summary['methodEvidence'])?.['checkedMethods'], 'checked-method evidence');
  if (checkedMethods.length !== COLOR_GRAPH_METHODS.length || checkedMethods.some((name, index) => name !== COLOR_GRAPH_METHODS[index])) {
    throw new Error('Color graph inspection returned unexpected checked-method evidence');
  }
  const evidence = objectValue(summary['methodEvidence']);
  if (!evidence) throw new Error('Color graph inspection returned invalid method evidence');
  const fullyObservedMethods = colorGraphStringArray(evidence['fullyObservedMethods'], 'fully-observed method evidence');
  const missingMethods = colorGraphStringArray(evidence['missingMethods'], 'missing-method evidence');
  const failedMethods = colorGraphStringArray(evidence['failedMethods'], 'failed-method evidence');
  const allowedMethods = new Set<string>(COLOR_GRAPH_METHODS);
  if ([...fullyObservedMethods, ...missingMethods, ...failedMethods].some((name) => !allowedMethods.has(name))) {
    throw new Error('Color graph inspection returned unknown method evidence');
  }
  const scopes = [timelineGraph, ...itemGraphs, ...colorGroupGraphs];
  const expectedMissingMethods = COLOR_GRAPH_METHODS.filter((name) => scopes.some((row) => row.missingMethods.includes(name)));
  const expectedFailedMethods = COLOR_GRAPH_METHODS.filter((name) => scopes.some((row) => row.failedMethods.includes(name)));
  if (missingMethods.length !== expectedMissingMethods.length
    || missingMethods.some((name, index) => name !== expectedMissingMethods[index])
    || failedMethods.length !== expectedFailedMethods.length
    || failedMethods.some((name, index) => name !== expectedFailedMethods[index])) {
    throw new Error('Color graph inspection returned inconsistent method evidence');
  }
  const successfulMethods = new Set<string>();
  if (timelineGraph.graphAccess === 'observed' || timelineGraph.graphAccess === 'null') successfulMethods.add('Timeline.GetNodeGraph');
  if (itemGraphs.some((row) => row.graphAccess === 'observed' || row.graphAccess === 'null')) successfulMethods.add('TimelineItem.GetNodeGraph');
  if (colorGroupGraphs.some((row) => row.scope === 'group_pre' && (row.graphAccess === 'observed' || row.graphAccess === 'null'))) {
    successfulMethods.add('ColorGroup.GetPreClipNodeGraph');
  }
  if (colorGroupGraphs.some((row) => row.scope === 'group_post' && (row.graphAccess === 'observed' || row.graphAccess === 'null'))) {
    successfulMethods.add('ColorGroup.GetPostClipNodeGraph');
  }
  if (scopes.some((row) => row.nodeCountObserved !== null)) successfulMethods.add('Graph.GetNumNodes');
  const observedNodes = scopes.flatMap((row) => row.nodes);
  if (observedNodes.length > 0) successfulMethods.add('Graph.GetNodeLabel');
  if (observedNodes.some((node) => node.lutReferencePresent !== null)) successfulMethods.add('Graph.GetLUT');
  if (observedNodes.some((node) => node.cacheModeShape === 'integer' || node.cacheModeShape === 'null')) {
    successfulMethods.add('Graph.GetNodeCacheMode');
  }
  if (observedNodes.some((node) => node.toolListShape === 'list' || node.toolListShape === 'null')) successfulMethods.add('Graph.GetToolsInNode');
  const expectedFullyObservedMethods = COLOR_GRAPH_METHODS.filter((name) => (
    successfulMethods.has(name) && !expectedMissingMethods.includes(name) && !expectedFailedMethods.includes(name)
  ));
  if (fullyObservedMethods.length !== expectedFullyObservedMethods.length
    || fullyObservedMethods.some((name, index) => name !== expectedFullyObservedMethods[index])) {
    throw new Error('Color graph inspection returned inconsistent fully-observed method evidence');
  }
  const graphsObserved = colorRequiredCount(summary['graphsObserved'], 'observed graph count');
  const nodesObserved = colorRequiredCount(summary['nodesObserved'], 'observed graph node count');
  const nodesReported = colorRequiredCount(summary['nodesReported'], 'reported graph node count');
  if (nodesReported > COLOR_GRAPH_MAX_NODES) throw new Error('Color graph inspection returned out-of-bounds node rows');
  if (graphsObserved !== scopes.filter((row) => row.graphAccess === 'observed').length) {
    throw new Error('Color graph inspection returned inconsistent graph count');
  }
  if (nodesObserved !== scopes.reduce((sum, row) => sum + (row.nodeCountObserved ?? 0), 0)
    || nodesReported !== scopes.reduce((sum, row) => sum + row.nodesReported, 0)) {
    throw new Error('Color graph inspection returned inconsistent node totals');
  }
  const nodesTruncated = summary['nodesTruncated'] === true;
  const toolsTruncated = summary['toolsTruncated'] === true;
  if (nodesTruncated !== scopes.some((row) => row.nodesTruncated)
    || toolsTruncated !== scopes.some((row) => row.nodes.some((node) => node.toolsTruncated))) {
    throw new Error('Color graph inspection returned inconsistent truncation evidence');
  }
  const complete = summary['complete'] === true;
  if (complete && (nodeStackLayersReadback !== 'observed' || colorGroupsReadback !== 'observed' || layersTruncated || colorGroupsTruncated || tracksTruncated || itemsTruncated || nodesTruncated || toolsTruncated
    || scopes.some((row) => row.graphAccess !== 'observed') || missingMethods.length || failedMethods.length)) {
    throw new Error('Color graph inspection marked incomplete evidence complete');
  }

  const graphObjectsProbed = colorRequiredCount(evidence['graphObjectsProbed'], 'graph object probe count');
  const nodesProbed = colorRequiredCount(evidence['nodesProbed'], 'node probe count');
  if (graphObjectsProbed !== graphsObserved || nodesProbed !== nodesReported) {
    throw new Error('Color graph inspection returned inconsistent probe evidence');
  }

  return {
    readerId: 'color.graph_inventory.v1',
    timeline: { id: timeline['id'], name: timeline['name'] },
    nodeStackLayersReadback,
    nodeStackLayersConfigured,
    nodeStackLayersScanned,
    layersTruncated,
    videoTrackCount,
    tracksScanned,
    videoItemsObserved,
    itemsScanned,
    colorGroupsReadback,
    colorGroupCountObserved,
    colorGroupsScanned,
    colorGroupsTruncated,
    graphsObserved,
    nodesObserved,
    nodesReported,
    tracksTruncated,
    itemsTruncated,
    nodesTruncated,
    toolsTruncated,
    timelineGraph,
    itemGraphs,
    colorGroupGraphs,
    complete,
    methodEvidence: {
      checkedMethods: checkedMethods as ColorGraphInventory['methodEvidence']['checkedMethods'],
      fullyObservedMethods,
      missingMethods,
      failedMethods,
      graphObjectsProbed,
      nodesProbed
    },
    unverified: ['nodeTopology', 'nodeValues', 'pixelOutput', 'graphWrites']
  };
}

const COLOR_VERSION_METHODS: ColorGradeVersionInspect['methodEvidence']['checkedMethods'] = [
  'GetVersionNameList',
  'GetCurrentVersion'
];
const COLOR_VERSION_MAX_VIDEO_TRACKS = 64;
const COLOR_VERSION_MAX_ITEMS = 200;
const COLOR_VERSION_MAX_NAMES_PER_TYPE = 64;
const COLOR_VERSION_MAX_ID = 256;
const COLOR_VERSION_MAX_ITEM_NAME = 1024;
const COLOR_VERSION_MAX_NAME = 256;

function colorVersionReadback(value: unknown, field: string): 'observed' | 'missing' | 'failed' {
  if (value !== 'observed' && value !== 'missing' && value !== 'failed') {
    throw new Error(`Color grade-version inspection returned invalid ${field} readback state`);
  }
  return value;
}

function colorVersionNames(
  row: Record<string, unknown>,
  prefix: 'local' | 'remote'
): { readback: 'observed' | 'missing' | 'failed'; count: number | null; names: string[]; truncated: boolean } {
  const readback = colorVersionReadback(row[`${prefix}Readback`], prefix);
  const countRaw = row[`${prefix}VersionCountObserved`];
  const count = countRaw === null ? null : colorRequiredCount(countRaw, `${prefix} version count`);
  const namesRaw = row[`${prefix}Versions`];
  if (!Array.isArray(namesRaw) || namesRaw.some((name) => typeof name !== 'string' || name.length > COLOR_VERSION_MAX_NAME)) {
    throw new Error(`Color grade-version inspection returned invalid ${prefix} version names`);
  }
  const names = namesRaw as string[];
  const truncated = row[`${prefix}VersionsTruncated`] === true;
  if (readback === 'observed') {
    if (count === null || count < names.length || names.length > COLOR_VERSION_MAX_NAMES_PER_TYPE) {
      throw new Error(`Color grade-version inspection returned inconsistent ${prefix} version count`);
    }
    if (truncated !== (count > COLOR_VERSION_MAX_NAMES_PER_TYPE)
      || names.length !== Math.min(count, COLOR_VERSION_MAX_NAMES_PER_TYPE)) {
      throw new Error(`Color grade-version inspection returned inconsistent ${prefix} version truncation`);
    }
  } else if (count !== null || names.length !== 0 || truncated) {
    throw new Error(`Color grade-version inspection returned ${prefix} version evidence without observed readback`);
  }
  return { readback, count, names, truncated };
}

function colorGradeVersionInspect(value: unknown): ColorGradeVersionInspect | null {
  if (value === null) return null;
  const summary = objectValue(value);
  if (!summary || summary['readerId'] !== 'color.grade_version_inspect.v1') {
    throw new Error('Color grade-version inspection returned invalid structured result');
  }
  const timeline = objectValue(summary['timeline']);
  if (!timeline
    || typeof timeline['id'] !== 'string' || timeline['id'].trim().length === 0 || timeline['id'].length > COLOR_VERSION_MAX_ID
    || typeof timeline['name'] !== 'string' || timeline['name'].trim().length === 0 || timeline['name'].length > COLOR_VERSION_MAX_ITEM_NAME) {
    throw new Error('Color grade-version inspection returned invalid timeline identity');
  }

  const videoTrackCount = colorRequiredCount(summary['videoTrackCount'], 'grade-version video track count');
  const tracksScanned = colorRequiredCount(summary['tracksScanned'], 'grade-version track scan count');
  const videoItemsObserved = colorRequiredCount(summary['videoItemsObserved'], 'grade-version video item count');
  const itemsScanned = colorRequiredCount(summary['itemsScanned'], 'grade-version item scan count');
  const tracksTruncated = summary['tracksTruncated'] === true;
  const itemsTruncated = summary['itemsTruncated'] === true;
  if (tracksScanned !== Math.min(videoTrackCount, COLOR_VERSION_MAX_VIDEO_TRACKS)
    || tracksTruncated !== (videoTrackCount > COLOR_VERSION_MAX_VIDEO_TRACKS)) {
    throw new Error('Color grade-version inspection returned inconsistent track bounds');
  }
  if (itemsScanned > COLOR_VERSION_MAX_ITEMS || videoItemsObserved < itemsScanned
    || (itemsTruncated && itemsScanned !== COLOR_VERSION_MAX_ITEMS)
    || (!itemsTruncated && videoItemsObserved !== itemsScanned)) {
    throw new Error('Color grade-version inspection returned inconsistent item bounds');
  }

  const rawItems = Array.isArray(summary['items']) ? summary['items'] : null;
  if (!rawItems || rawItems.length !== itemsScanned) {
    throw new Error('Color grade-version inspection returned inconsistent item rows');
  }
  const itemKeys = new Set<string>();
  const items = rawItems.map((value): ColorGradeVersionInspect['items'][number] => {
    const row = objectValue(value);
    if (!row) throw new Error('Color grade-version inspection returned invalid item row');
    const trackIndex = finiteNumber(row['trackIndex']);
    const itemIndex = finiteNumber(row['itemIndex']);
    const itemId = row['timelineItemId'];
    const itemName = row['timelineItemName'];
    if (trackIndex === null || !Number.isInteger(trackIndex) || trackIndex < 1 || trackIndex > tracksScanned
      || itemIndex === null || !Number.isInteger(itemIndex) || itemIndex < 1
      || typeof itemId !== 'string' || itemId.trim().length === 0 || itemId.length > COLOR_VERSION_MAX_ID
      || typeof itemName !== 'string' || itemName.length > COLOR_VERSION_MAX_ITEM_NAME) {
      throw new Error('Color grade-version inspection returned invalid item identity');
    }
    const itemKey = `${trackIndex}:${itemIndex}`;
    if (itemKeys.has(itemKey)) throw new Error('Color grade-version inspection returned duplicate item identity');
    itemKeys.add(itemKey);

    const missingMethods = colorGraphStringArray(row['missingMethods'], 'grade-version item missing-method evidence');
    const failedMethods = colorGraphStringArray(row['failedMethods'], 'grade-version item failed-method evidence');
    const allowedMethods = new Set<string>(COLOR_VERSION_METHODS);
    if ([...missingMethods, ...failedMethods].some((name) => !allowedMethods.has(name))) {
      throw new Error('Color grade-version inspection returned unknown item method evidence');
    }

    const local = colorVersionNames(row, 'local');
    const remote = colorVersionNames(row, 'remote');
    if (local.readback === 'missing' || remote.readback === 'missing') {
      if (local.readback !== 'missing' || remote.readback !== 'missing' || !missingMethods.includes('GetVersionNameList')) {
        throw new Error('Color grade-version inspection returned inconsistent missing version-list evidence');
      }
    } else if (missingMethods.includes('GetVersionNameList')) {
      throw new Error('Color grade-version inspection returned stale missing version-list evidence');
    }
    if ((local.readback === 'failed' || remote.readback === 'failed') !== failedMethods.includes('GetVersionNameList')) {
      throw new Error('Color grade-version inspection returned inconsistent failed version-list evidence');
    }

    const currentReadback = colorVersionReadback(row['currentReadback'], 'current version');
    const currentRaw = objectValue(row['currentVersion']);
    let currentVersion: { name: string; type: 0 | 1 } | null = null;
    if (currentReadback === 'observed') {
      const name = currentRaw?.['name'];
      const type = currentRaw?.['type'];
      if (typeof name !== 'string' || name.length < 1 || name.length > COLOR_VERSION_MAX_NAME || (type !== 0 && type !== 1)) {
        throw new Error('Color grade-version inspection returned invalid current version');
      }
      currentVersion = { name, type };
      if (missingMethods.includes('GetCurrentVersion') || failedMethods.includes('GetCurrentVersion')) {
        throw new Error('Color grade-version inspection returned contradictory current-version evidence');
      }
    } else {
      if (row['currentVersion'] !== null) throw new Error('Color grade-version inspection returned current version without observed readback');
      if (currentReadback === 'missing' ? !missingMethods.includes('GetCurrentVersion') : !failedMethods.includes('GetCurrentVersion')) {
        throw new Error('Color grade-version inspection returned inconsistent current-version failure evidence');
      }
    }

    return {
      trackIndex,
      itemIndex,
      timelineItemId: itemId,
      timelineItemName: itemName,
      currentReadback,
      currentVersion,
      localReadback: local.readback,
      localVersionCountObserved: local.count,
      localVersions: local.names,
      localVersionsTruncated: local.truncated,
      remoteReadback: remote.readback,
      remoteVersionCountObserved: remote.count,
      remoteVersions: remote.names,
      remoteVersionsTruncated: remote.truncated,
      missingMethods,
      failedMethods
    };
  });

  const evidence = objectValue(summary['methodEvidence']);
  if (!evidence) throw new Error('Color grade-version inspection returned invalid method evidence');
  const checkedMethods = colorGraphStringArray(evidence['checkedMethods'], 'grade-version checked-method evidence');
  if (checkedMethods.length !== COLOR_VERSION_METHODS.length || checkedMethods.some((name, index) => name !== COLOR_VERSION_METHODS[index])) {
    throw new Error('Color grade-version inspection returned unexpected checked methods');
  }
  const fullyObservedMethods = colorGraphStringArray(evidence['fullyObservedMethods'], 'grade-version fully-observed evidence');
  const missingMethods = colorGraphStringArray(evidence['missingMethods'], 'grade-version missing-method evidence');
  const failedMethods = colorGraphStringArray(evidence['failedMethods'], 'grade-version failed-method evidence');
  const allowedMethods = new Set<string>(COLOR_VERSION_METHODS);
  if ([...fullyObservedMethods, ...missingMethods, ...failedMethods].some((name) => !allowedMethods.has(name))) {
    throw new Error('Color grade-version inspection returned unknown method evidence');
  }
  const itemMissing = new Set(items.flatMap((item) => item.missingMethods));
  const itemFailed = new Set(items.flatMap((item) => item.failedMethods));
  if (itemMissing.size !== new Set(missingMethods).size || [...itemMissing].some((name) => !missingMethods.includes(name))
    || itemFailed.size !== new Set(failedMethods).size || [...itemFailed].some((name) => !failedMethods.includes(name))) {
    throw new Error('Color grade-version inspection returned inconsistent aggregate method evidence');
  }
  const expectedFullyObserved = items.length === 0 ? [] : COLOR_VERSION_METHODS.filter((name) => (
    name === 'GetVersionNameList'
      ? items.every((item) => item.localReadback === 'observed' && item.remoteReadback === 'observed')
      : items.every((item) => item.currentReadback === 'observed')
  ));
  if (fullyObservedMethods.length !== expectedFullyObserved.length
    || expectedFullyObserved.some((name) => !fullyObservedMethods.includes(name))) {
    throw new Error('Color grade-version inspection returned inconsistent fully-observed evidence');
  }
  const itemsProbed = colorRequiredCount(evidence['itemsProbed'], 'grade-version item probe count');
  if (itemsProbed !== itemsScanned) throw new Error('Color grade-version inspection returned inconsistent item probe count');

  const versionNamesTruncated = summary['versionNamesTruncated'] === true;
  if (versionNamesTruncated !== items.some((item) => item.localVersionsTruncated || item.remoteVersionsTruncated)) {
    throw new Error('Color grade-version inspection returned inconsistent name truncation evidence');
  }
  const complete = summary['complete'] === true;
  const expectedComplete = !tracksTruncated && !itemsTruncated && !versionNamesTruncated
    && missingMethods.length === 0 && failedMethods.length === 0;
  if (complete !== expectedComplete) throw new Error('Color grade-version inspection returned inconsistent completeness');

  return {
    readerId: 'color.grade_version_inspect.v1',
    timeline: { id: timeline['id'], name: timeline['name'] },
    videoTrackCount,
    tracksScanned,
    videoItemsObserved,
    itemsScanned,
    tracksTruncated,
    itemsTruncated,
    versionNamesTruncated,
    items,
    complete,
    methodEvidence: {
      checkedMethods: checkedMethods as ColorGradeVersionInspect['methodEvidence']['checkedMethods'],
      fullyObservedMethods,
      missingMethods,
      failedMethods,
      itemsProbed
    },
    unverified: ['versionOrdering', 'versionNameUniqueness', 'crossTypeNameIdentity', 'colorGroupVersions', 'pixelOutput', 'versionWrites']
  };
}

function fairlightRequiredCount(value: unknown, field: string): number {
  const count = finiteNumber(value);
  if (count === null || count < 0 || !Number.isInteger(count)) throw new Error(`Fairlight mapping inspection returned invalid ${field}`);
  return count;
}

function voiceIsolationState(value: unknown): { isEnabled: boolean; amount: number | null } | null {
  const row = objectValue(value);
  if (!row || typeof row['isEnabled'] !== 'boolean') return null;
  const amount = finiteNumber(row['amount']);
  return {
    isEnabled: row['isEnabled'],
    amount: amount !== null && Number.isInteger(amount) && amount >= 0 && amount <= 100 ? amount : null
  };
}

function fairlightMappingSummary(value: unknown): FairlightMappingSummary | null {
  if (value === null) return null;
  const summary = objectValue(value);
  if (!summary || summary['readerId'] !== 'fairlight.mapping_inspect.v1') {
    throw new Error('Fairlight mapping inspection returned invalid structured result');
  }
  const timeline = objectValue(summary['timeline']);
  const tracks = Array.isArray(summary['tracks']) ? summary['tracks'] : [];
  if (!timeline || typeof timeline['id'] !== 'string' || typeof timeline['name'] !== 'string') {
    throw new Error('Fairlight mapping inspection returned invalid timeline identity');
  }
  return {
    readerId: 'fairlight.mapping_inspect.v1',
    timeline: { id: timeline['id'], name: timeline['name'] },
    audioTrackCount: fairlightRequiredCount(summary['audioTrackCount'], 'audio track count'),
    audioItemCountObserved: fairlightRequiredCount(summary['audioItemCountObserved'], 'audio item count'),
    itemsScanned: fairlightRequiredCount(summary['itemsScanned'], 'item scan count'),
    sourceMappingVerifiedItemCount: fairlightRequiredCount(summary['sourceMappingVerifiedItemCount'], 'verified source mapping count'),
    sourceMappingUnverifiedItemCount: fairlightRequiredCount(summary['sourceMappingUnverifiedItemCount'], 'unverified source mapping count'),
    tracks: tracks.flatMap((value) => {
      const row = objectValue(value);
      if (!row) return [];
      const index = finiteNumber(row['index']);
      if (index === null || !Number.isInteger(index) || index < 1) return [];
      const channelCounts = Array.isArray(row['embeddedAudioChannelCounts']) ? row['embeddedAudioChannelCounts'] : [];
      return [{
        index,
        name: nonEmptyString(row['name']),
        subType: nonEmptyString(row['subType']),
        enabled: nullableBoolean(row['enabled']),
        locked: nullableBoolean(row['locked']),
        itemCount: fairlightRequiredCount(row['itemCount'], 'track item count'),
        voiceIsolation: voiceIsolationState(row['voiceIsolation']),
        sourceMappingVerifiedItemCount: fairlightRequiredCount(row['sourceMappingVerifiedItemCount'], 'track verified mapping count'),
        sourceMappingUnverifiedItemCount: fairlightRequiredCount(row['sourceMappingUnverifiedItemCount'], 'track unverified mapping count'),
        embeddedAudioChannelCounts: channelCounts.flatMap((entry) => {
          const channelRow = objectValue(entry);
          if (!channelRow) return [];
          const channels = finiteNumber(channelRow['channels']);
          const count = finiteNumber(channelRow['count']);
          return channels !== null && Number.isInteger(channels) && channels >= 0
            && count !== null && Number.isInteger(count) && count >= 0
            ? [{ channels, count }]
            : [];
        })
      }];
    }),
    complete: summary['complete'] === true,
    tracksTruncated: summary['tracksTruncated'] === true,
    itemsTruncated: summary['itemsTruncated'] === true,
    unverified: ['syncEvidence', 'transcriptionState']
  };
}

const FAIRLIGHT_PROCESSING_METHODS: FairlightClipProcessingInspect['methodEvidence']['checkedMethods'] = [
  'GetUniqueId', 'GetName', 'GetProperties', 'GetVoiceIsolationState'
];
const FAIRLIGHT_PROCESSING_PROPERTY_KEYS = [
  'AudioVolumeEnabled', 'AudioVolume', 'AudioPanEnabled', 'AudioPan',
  'AudioPitchEnabled', 'AudioPitchSemiTones', 'AudioPitchCents',
  'AudioVoiceIsolationEnabled', 'AudioVoiceIsolationAmount',
  'AudioDialogueLevelerEnabled', 'AudioDialogueLevelerMode',
  'AudioDialogueLevelerReduceLoudDialogue', 'AudioDialogueLevelerLiftSoftDialogue',
  'AudioDialogueLevelerBackgroundReduction', 'AudioDialogueLevelerOutputGain'
] as const;
const FAIRLIGHT_PROCESSING_MAX_AUDIO_TRACKS = 64;
const FAIRLIGHT_PROCESSING_MAX_ITEMS = 1000;
const FAIRLIGHT_PROCESSING_MAX_ID = 256;
const FAIRLIGHT_PROCESSING_MAX_NAME = 1024;

function fairlightProcessingStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`Fairlight clip-processing inspection returned invalid ${field}`);
  }
  const values = value as string[];
  if (new Set(values).size !== values.length) throw new Error(`Fairlight clip-processing inspection returned duplicate ${field}`);
  return values;
}

function fairlightProcessingNumber(value: unknown, field: string, min: number, max: number, integer = false): number {
  const parsed = finiteNumber(value);
  if (parsed === null || parsed < min || parsed > max || (integer && !Number.isInteger(parsed))) {
    throw new Error(`Fairlight clip-processing inspection returned invalid ${field}`);
  }
  return parsed;
}

function fairlightClipProcessingInspect(value: unknown): FairlightClipProcessingInspect | null {
  if (value === null) return null;
  const summary = objectValue(value);
  if (!summary || summary['readerId'] !== 'fairlight.clip_processing_inspect.v1') {
    throw new Error('Fairlight clip-processing inspection returned invalid structured result');
  }
  const timeline = objectValue(summary['timeline']);
  if (!timeline || typeof timeline['id'] !== 'string' || timeline['id'].trim().length === 0 || timeline['id'].length > FAIRLIGHT_PROCESSING_MAX_ID
    || typeof timeline['name'] !== 'string' || timeline['name'].trim().length === 0 || timeline['name'].length > FAIRLIGHT_PROCESSING_MAX_NAME) {
    throw new Error('Fairlight clip-processing inspection returned invalid timeline identity');
  }
  const audioTrackCount = fairlightRequiredCount(summary['audioTrackCount'], 'processing audio track count');
  const tracksScanned = fairlightRequiredCount(summary['tracksScanned'], 'processing track scan count');
  const audioItemsObserved = fairlightRequiredCount(summary['audioItemsObserved'], 'processing audio item count');
  const itemsScanned = fairlightRequiredCount(summary['itemsScanned'], 'processing item scan count');
  const tracksTruncated = summary['tracksTruncated'] === true;
  const itemsTruncated = summary['itemsTruncated'] === true;
  if (tracksScanned !== Math.min(audioTrackCount, FAIRLIGHT_PROCESSING_MAX_AUDIO_TRACKS)
    || tracksTruncated !== (audioTrackCount > FAIRLIGHT_PROCESSING_MAX_AUDIO_TRACKS)) {
    throw new Error('Fairlight clip-processing inspection returned inconsistent track bounds');
  }
  if (itemsScanned > FAIRLIGHT_PROCESSING_MAX_ITEMS || audioItemsObserved < itemsScanned
    || (itemsTruncated && itemsScanned !== FAIRLIGHT_PROCESSING_MAX_ITEMS)
    || (!itemsTruncated && audioItemsObserved !== itemsScanned)) {
    throw new Error('Fairlight clip-processing inspection returned inconsistent item bounds');
  }
  const rawItems = Array.isArray(summary['items']) ? summary['items'] : null;
  if (!rawItems || rawItems.length !== itemsScanned) {
    throw new Error('Fairlight clip-processing inspection returned inconsistent item rows');
  }

  const allowedMethods = new Set<string>(FAIRLIGHT_PROCESSING_METHODS);
  const propertyKeys = new Set<string>(FAIRLIGHT_PROCESSING_PROPERTY_KEYS);
  const positionKeys = new Set<string>();
  const items = rawItems.map((value) => {
    const row = objectValue(value);
    if (!row) throw new Error('Fairlight clip-processing inspection returned invalid item row');
    const trackIndex = finiteNumber(row['trackIndex']);
    const itemIndex = finiteNumber(row['itemIndex']);
    const itemId = row['timelineItemId'];
    const itemName = row['timelineItemName'];
    if (trackIndex === null || !Number.isInteger(trackIndex) || trackIndex < 1 || trackIndex > tracksScanned
      || itemIndex === null || !Number.isInteger(itemIndex) || itemIndex < 1
      || typeof itemId !== 'string' || itemId.trim().length === 0 || itemId.length > FAIRLIGHT_PROCESSING_MAX_ID
      || typeof itemName !== 'string' || itemName.length > FAIRLIGHT_PROCESSING_MAX_NAME) {
      throw new Error('Fairlight clip-processing inspection returned invalid item identity');
    }
    const positionKey = `${trackIndex}:${itemIndex}`;
    if (positionKeys.has(positionKey)) throw new Error('Fairlight clip-processing inspection returned duplicate item position');
    positionKeys.add(positionKey);

    const missingMethods = fairlightProcessingStringArray(row['missingMethods'], 'item missing-method evidence');
    const failedMethods = fairlightProcessingStringArray(row['failedMethods'], 'item failed-method evidence');
    if ([...missingMethods, ...failedMethods].some((name) => !allowedMethods.has(name))
      || missingMethods.some((name) => failedMethods.includes(name))) {
      throw new Error('Fairlight clip-processing inspection returned contradictory item method evidence');
    }
    if (missingMethods.includes('GetUniqueId') || failedMethods.includes('GetUniqueId')
      || missingMethods.includes('GetName') || failedMethods.includes('GetName')) {
      throw new Error('Fairlight clip-processing inspection returned identity despite identity getter failure');
    }

    const rawPropertiesReadback = row['propertiesReadback'];
    const propertiesReadback = rawPropertiesReadback as FairlightClipProcessingInspect['items'][number]['propertiesReadback'];
    if (propertiesReadback !== 'observed' && propertiesReadback !== 'missing' && propertiesReadback !== 'failed' && propertiesReadback !== 'incomplete') {
      throw new Error('Fairlight clip-processing inspection returned invalid properties readback state');
    }
    const missingPropertyKeys = fairlightProcessingStringArray(row['missingPropertyKeys'], 'missing property keys');
    if (missingPropertyKeys.some((key) => !propertyKeys.has(key))) {
      throw new Error('Fairlight clip-processing inspection returned unknown property key');
    }
    const properties = objectValue(row['properties']);
    if (!properties) throw new Error('Fairlight clip-processing inspection returned invalid property object');
    const returnedKeys = Object.keys(properties);
    if (returnedKeys.some((key) => !propertyKeys.has(key)) || returnedKeys.some((key) => missingPropertyKeys.includes(key))) {
      throw new Error('Fairlight clip-processing inspection returned inconsistent property keys');
    }
    const expectedMissing = FAIRLIGHT_PROCESSING_PROPERTY_KEYS.filter((key) => !returnedKeys.includes(key));
    if (missingPropertyKeys.length !== expectedMissing.length || missingPropertyKeys.some((key, index) => key !== expectedMissing[index])) {
      throw new Error('Fairlight clip-processing inspection returned inconsistent missing property evidence');
    }
    if (propertiesReadback === 'observed' && missingPropertyKeys.length !== 0) {
      throw new Error('Fairlight clip-processing inspection marked incomplete properties observed');
    }
    if (propertiesReadback === 'incomplete' && missingPropertyKeys.length === 0) {
      throw new Error('Fairlight clip-processing inspection marked complete properties incomplete');
    }
    if (propertiesReadback === 'missing') {
      if (!missingMethods.includes('GetProperties') || returnedKeys.length !== 0 || missingPropertyKeys.length !== FAIRLIGHT_PROCESSING_PROPERTY_KEYS.length) {
        throw new Error('Fairlight clip-processing inspection returned inconsistent missing properties');
      }
    } else if (propertiesReadback === 'failed') {
      if (!failedMethods.includes('GetProperties') || returnedKeys.length !== 0 || missingPropertyKeys.length !== FAIRLIGHT_PROCESSING_PROPERTY_KEYS.length) {
        throw new Error('Fairlight clip-processing inspection returned inconsistent failed properties');
      }
    } else if (missingMethods.includes('GetProperties') || failedMethods.includes('GetProperties')) {
      throw new Error('Fairlight clip-processing inspection returned properties despite getter failure');
    }

    const boolProp = (key: string): boolean | null => {
      if (!Object.hasOwn(properties, key)) return null;
      const entry = properties[key];
      if (typeof entry !== 'boolean') throw new Error(`Fairlight clip-processing inspection returned invalid ${key}`);
      return entry;
    };
    const numberProp = (key: string, min: number, max: number, integer = false): number | null => {
      if (!Object.hasOwn(properties, key)) return null;
      return fairlightProcessingNumber(properties[key], key, min, max, integer);
    };
    const volumeEnabled = boolProp('AudioVolumeEnabled');
    const volumeDb = numberProp('AudioVolume', -100, 30);
    const panEnabled = boolProp('AudioPanEnabled');
    const pan = numberProp('AudioPan', -100, 100);
    const pitchEnabled = boolProp('AudioPitchEnabled');
    const pitchSemitones = numberProp('AudioPitchSemiTones', -24, 24);
    const pitchCents = numberProp('AudioPitchCents', -100, 100);
    const voiceIsolationEnabled = boolProp('AudioVoiceIsolationEnabled');
    const voiceIsolationAmount = numberProp('AudioVoiceIsolationAmount', 0, 100, true);
    const dialogueLevelerEnabled = boolProp('AudioDialogueLevelerEnabled');
    const dialogueLevelerModeRaw = numberProp('AudioDialogueLevelerMode', 0, 3, true);
    const dialogueReduceLoud = boolProp('AudioDialogueLevelerReduceLoudDialogue');
    const dialogueLiftSoft = boolProp('AudioDialogueLevelerLiftSoftDialogue');
    const dialogueBackgroundReduction = boolProp('AudioDialogueLevelerBackgroundReduction');
    const dialogueOutputGainDb = numberProp('AudioDialogueLevelerOutputGain', 0, 6);

    const rawVoiceReadback = row['voiceReadback'];
    const voiceReadback = rawVoiceReadback as FairlightClipProcessingInspect['items'][number]['voiceReadback'];
    if (voiceReadback !== 'observed' && voiceReadback !== 'missing' && voiceReadback !== 'failed') {
      throw new Error('Fairlight clip-processing inspection returned invalid Voice Isolation readback');
    }
    const rawVoice = objectValue(row['voiceState']);
    let voiceState: { isEnabled: boolean; amount: number } | null = null;
    if (voiceReadback === 'observed') {
      if (!rawVoice || typeof rawVoice['isEnabled'] !== 'boolean') {
        throw new Error('Fairlight clip-processing inspection returned invalid Voice Isolation state');
      }
      voiceState = {
        isEnabled: rawVoice['isEnabled'],
        amount: fairlightProcessingNumber(rawVoice['amount'], 'Voice Isolation amount', 0, 100, true)
      };
      if (missingMethods.includes('GetVoiceIsolationState') || failedMethods.includes('GetVoiceIsolationState')) {
        throw new Error('Fairlight clip-processing inspection returned Voice Isolation state despite getter failure');
      }
    } else {
      if (row['voiceState'] !== null
        || (voiceReadback === 'missing' ? !missingMethods.includes('GetVoiceIsolationState') : !failedMethods.includes('GetVoiceIsolationState'))) {
        throw new Error('Fairlight clip-processing inspection returned inconsistent Voice Isolation failure evidence');
      }
    }

    const expectedVoiceConsistency: FairlightClipProcessingInspect['items'][number]['voiceConsistency'] = voiceState && voiceIsolationEnabled !== null && voiceIsolationAmount !== null
      ? voiceState.isEnabled === voiceIsolationEnabled && voiceState.amount === voiceIsolationAmount ? 'matched' : 'contradiction'
      : 'unavailable';
    if (row['voiceConsistency'] !== expectedVoiceConsistency) {
      throw new Error('Fairlight clip-processing inspection returned inconsistent Voice Isolation cross-check');
    }

    return {
      trackIndex,
      itemIndex,
      timelineItemId: itemId,
      timelineItemName: itemName,
      propertiesReadback,
      missingPropertyKeys,
      volumeEnabled,
      volumeDb,
      panEnabled,
      pan,
      pitchEnabled,
      pitchSemitones,
      pitchCents,
      voiceIsolationEnabled,
      voiceIsolationAmount,
      dialogueLevelerEnabled,
      dialogueLevelerMode: dialogueLevelerModeRaw as 0 | 1 | 2 | 3 | null,
      dialogueReduceLoud,
      dialogueLiftSoft,
      dialogueBackgroundReduction,
      dialogueOutputGainDb,
      voiceReadback,
      voiceState,
      voiceConsistency: expectedVoiceConsistency,
      missingMethods,
      failedMethods
    };
  });

  const evidence = objectValue(summary['methodEvidence']);
  if (!evidence) throw new Error('Fairlight clip-processing inspection returned invalid method evidence');
  const checkedMethods = fairlightProcessingStringArray(evidence['checkedMethods'], 'checked-method evidence');
  if (checkedMethods.length !== FAIRLIGHT_PROCESSING_METHODS.length || checkedMethods.some((name, index) => name !== FAIRLIGHT_PROCESSING_METHODS[index])) {
    throw new Error('Fairlight clip-processing inspection returned unexpected checked-method evidence');
  }
  const missingMethods = fairlightProcessingStringArray(evidence['missingMethods'], 'missing-method evidence');
  const failedMethods = fairlightProcessingStringArray(evidence['failedMethods'], 'failed-method evidence');
  const expectedMissingMethods = FAIRLIGHT_PROCESSING_METHODS.filter((name) => items.some((item) => item.missingMethods.includes(name)));
  const expectedFailedMethods = FAIRLIGHT_PROCESSING_METHODS.filter((name) => items.some((item) => item.failedMethods.includes(name)));
  if (missingMethods.length !== expectedMissingMethods.length || missingMethods.some((name, index) => name !== expectedMissingMethods[index])
    || failedMethods.length !== expectedFailedMethods.length || failedMethods.some((name, index) => name !== expectedFailedMethods[index])) {
    throw new Error('Fairlight clip-processing inspection returned inconsistent aggregate method evidence');
  }
  const expectedFullyObservedMethods = FAIRLIGHT_PROCESSING_METHODS.filter((name) => {
    if (items.length === 0) return false;
    if (name === 'GetProperties') return items.every((item) => item.propertiesReadback === 'observed');
    if (name === 'GetVoiceIsolationState') return items.every((item) => item.voiceReadback === 'observed');
    return !expectedMissingMethods.includes(name) && !expectedFailedMethods.includes(name);
  });
  const fullyObservedMethods = fairlightProcessingStringArray(evidence['fullyObservedMethods'], 'fully-observed method evidence');
  if (fullyObservedMethods.length !== expectedFullyObservedMethods.length || fullyObservedMethods.some((name, index) => name !== expectedFullyObservedMethods[index])) {
    throw new Error('Fairlight clip-processing inspection returned inconsistent fully-observed method evidence');
  }
  const itemsProbed = fairlightRequiredCount(evidence['itemsProbed'], 'processing item probe count');
  if (itemsProbed !== items.length) throw new Error('Fairlight clip-processing inspection returned inconsistent item probe count');

  const expectedComplete = !tracksTruncated && !itemsTruncated && missingMethods.length === 0 && failedMethods.length === 0
    && items.every((item) => item.propertiesReadback === 'observed' && item.voiceReadback === 'observed' && item.voiceConsistency !== 'contradiction');
  if ((summary['complete'] === true) !== expectedComplete) {
    throw new Error('Fairlight clip-processing inspection returned inconsistent completeness evidence');
  }
  return {
    readerId: 'fairlight.clip_processing_inspect.v1',
    timeline: { id: timeline['id'], name: timeline['name'] },
    audioTrackCount,
    tracksScanned,
    audioItemsObserved,
    itemsScanned,
    tracksTruncated,
    itemsTruncated,
    items,
    complete: expectedComplete,
    methodEvidence: {
      checkedMethods: checkedMethods as FairlightClipProcessingInspect['methodEvidence']['checkedMethods'],
      fullyObservedMethods,
      missingMethods,
      failedMethods,
      itemsProbed
    },
    unverified: ['automationState', 'clipEffects', 'renderedAudio', 'processingWrites']
  };
}

function deliverRequiredCount(value: unknown, field: string): number {
  const count = finiteNumber(value);
  if (count === null || count < 0 || !Number.isInteger(count)) throw new Error(`Deliver inspection returned invalid ${field}`);
  return count;
}

function deliverFormatRows(value: unknown): DeliverCapabilityMatrix['videoFormats'] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const row = objectValue(entry);
    if (!row || typeof row['name'] !== 'string' || typeof row['extension'] !== 'string') return [];
    const codecs = Array.isArray(row['codecs']) ? row['codecs'] : [];
    return [{
      name: row['name'],
      extension: row['extension'],
      codecCount: deliverRequiredCount(row['codecCount'], 'codec count'),
      codecs: codecs.flatMap((codec) => {
        const codecRow = objectValue(codec);
        return codecRow && typeof codecRow['name'] === 'string' && typeof codecRow['id'] === 'string'
          ? [{ name: codecRow['name'], id: codecRow['id'] }]
          : [];
      }),
      codecSampleTruncated: row['codecSampleTruncated'] === true
    }];
  });
}

function deliverCapabilityMatrix(value: unknown): DeliverCapabilityMatrix | null {
  const summary = objectValue(value);
  if (!summary || summary['readerId'] !== 'deliver.capability_matrix.v1') return null;
  const resolutions = Array.isArray(summary['generalResolutions']) ? summary['generalResolutions'] : [];
  const currentSelectionRaw = objectValue(summary['currentSelection']);
  let currentSelection: DeliverCapabilityMatrix['currentSelection'] = null;
  if (currentSelectionRaw) {
    if (typeof currentSelectionRaw['format'] !== 'string' || currentSelectionRaw['format'].length === 0
      || typeof currentSelectionRaw['codec'] !== 'string' || currentSelectionRaw['codec'].length === 0
      || !Array.isArray(currentSelectionRaw['resolutions'])) {
      throw new Error('Deliver inspection returned invalid current format/codec resolution evidence');
    }
    const resolutionCount = deliverRequiredCount(currentSelectionRaw['resolutionCount'], 'current format/codec resolution count');
    const resolutionsTruncated = currentSelectionRaw['resolutionsTruncated'] === true;
    if (resolutionsTruncated !== (resolutionCount > 64)
      || currentSelectionRaw['resolutions'].length !== Math.min(resolutionCount, 64)) {
      throw new Error('Deliver inspection returned inconsistent current format/codec resolution bounds');
    }
    const currentSelectionResolutions = currentSelectionRaw['resolutions'].map((entry) => {
      const row = objectValue(entry);
      const width = finiteNumber(row?.['width']);
      const height = finiteNumber(row?.['height']);
      if (width === null || height === null || !Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
        throw new Error('Deliver inspection returned invalid current format/codec resolution row');
      }
      return { width, height };
    });
    currentSelection = {
      format: currentSelectionRaw['format'],
      codec: currentSelectionRaw['codec'],
      resolutionCount,
      resolutions: currentSelectionResolutions,
      resolutionsTruncated
    };
  }
  const complete = summary['complete'] === true;
  if (complete && !currentSelection) {
    throw new Error('Deliver inspection returned complete capability evidence without current format/codec resolutions');
  }
  const renderPresetCount = deliverRequiredCount(summary['renderPresetCount'], 'render preset count');
  const quickExportPresetCount = deliverRequiredCount(summary['quickExportPresetCount'], 'quick export preset count');
  const presetNames = (value: unknown, count: number, truncated: unknown, label: string): { names: string[]; truncated: boolean } => {
    if (!Array.isArray(value) || typeof truncated !== 'boolean') {
      throw new Error(`Deliver inspection returned invalid ${label} evidence`);
    }
    if (truncated !== (count > 64) || value.length !== Math.min(count, 64)) {
      throw new Error(`Deliver inspection returned inconsistent ${label} bounds`);
    }
    const names = value.map((name) => {
      if (typeof name !== 'string' || name.length === 0 || name.length > 256) {
        throw new Error(`Deliver inspection returned invalid ${label} name`);
      }
      return name;
    });
    return { names, truncated };
  };
  const renderPresets = presetNames(summary['renderPresets'], renderPresetCount, summary['renderPresetsTruncated'], 'render preset');
  const quickExportPresets = presetNames(summary['quickExportPresets'], quickExportPresetCount, summary['quickExportPresetsTruncated'], 'Quick Export preset');
  if (complete && (renderPresets.truncated || quickExportPresets.truncated)) {
    throw new Error('Deliver inspection returned complete capability evidence with truncated preset names');
  }
  return {
    readerId: 'deliver.capability_matrix.v1',
    videoFormatCount: deliverRequiredCount(summary['videoFormatCount'], 'video format count'),
    videoCodecCountObserved: deliverRequiredCount(summary['videoCodecCountObserved'], 'video codec count'),
    videoFormats: deliverFormatRows(summary['videoFormats']),
    audioFormatCount: deliverRequiredCount(summary['audioFormatCount'], 'audio format count'),
    audioCodecCountObserved: deliverRequiredCount(summary['audioCodecCountObserved'], 'audio codec count'),
    audioFormats: deliverFormatRows(summary['audioFormats']),
    generalResolutions: resolutions.flatMap((entry) => {
      const row = objectValue(entry);
      const width = finiteNumber(row?.['width']);
      const height = finiteNumber(row?.['height']);
      return width !== null && height !== null && Number.isInteger(width) && Number.isInteger(height) && width > 0 && height > 0
        ? [{ width, height }]
        : [];
    }),
    currentSelection,
    renderPresetCount,
    renderPresets: renderPresets.names,
    renderPresetsTruncated: renderPresets.truncated,
    quickExportPresetCount,
    quickExportPresets: quickExportPresets.names,
    quickExportPresetsTruncated: quickExportPresets.truncated,
    complete,
    formatsTruncated: summary['formatsTruncated'] === true,
    codecSamplesTruncated: summary['codecSamplesTruncated'] === true,
    resolutionsTruncated: summary['resolutionsTruncated'] === true
  };
}

function renderSelection(value: unknown): string | null {
  const selection = nonEmptyString(value);
  return selection && selection.toLowerCase() !== 'unknown' ? selection : null;
}

function deliverSettingsInspect(value: unknown): DeliverSettingsInspect | null {
  const summary = objectValue(value);
  if (!summary || summary['readerId'] !== 'deliver.settings_inspect.v1') return null;
  const mode = finiteNumber(summary['renderMode']);
  const jobs = Array.isArray(summary['renderJobs']) ? summary['renderJobs'] : [];
  return {
    readerId: 'deliver.settings_inspect.v1',
    currentFormat: renderSelection(summary['currentFormat']),
    currentCodec: renderSelection(summary['currentCodec']),
    renderMode: mode === 0 ? 'individualClips' : mode === 1 ? 'singleClip' : null,
    renderingInProgress: nullableBoolean(summary['renderingInProgress']),
    renderJobCountObserved: deliverRequiredCount(summary['renderJobCountObserved'], 'render job count'),
    renderJobs: jobs.flatMap((entry) => {
      const row = objectValue(entry);
      if (!row || typeof row['id'] !== 'string' || row['id'].length === 0) return [];
      const width = finiteNumber(row['outputWidth']);
      const height = finiteNumber(row['outputHeight']);
      return [{
        id: row['id'],
        name: nonEmptyString(row['name']),
        timelineName: nonEmptyString(row['timelineName']),
        status: nonEmptyString(row['status']),
        completionPercentage: finiteNumber(row['completionPercentage']),
        outputResolution: width !== null && height !== null && width > 0 && height > 0 ? { width, height } : null,
        frameRate: finiteNumber(row['frameRate']),
        exportVideo: nullableBoolean(row['exportVideo']),
        exportAudio: nullableBoolean(row['exportAudio']),
        videoFormat: nonEmptyString(row['videoFormat']),
        videoCodec: nonEmptyString(row['videoCodec']),
        audioCodec: nonEmptyString(row['audioCodec']),
        renderMode: nonEmptyString(row['renderMode']),
        targetDirectoryConfigured: nullableBoolean(row['targetDirectoryConfigured']),
        outputFilenameConfigured: nullableBoolean(row['outputFilenameConfigured'])
      }];
    }),
    jobsTruncated: summary['jobsTruncated'] === true,
    unverified: [
      'currentTargetDirectory',
      'currentOutputFilename',
      'currentExportVideo',
      'currentExportAudio',
      'currentMarkInOut',
      'currentSubtitleExport'
    ]
  };
}

function checkStatus(issueCodes: string[], blockers: readonly string[], warnings: readonly string[]): ProjectPreflightStatus {
  if (issueCodes.some((code) => blockers.includes(code))) return 'blocked';
  if (issueCodes.some((code) => warnings.includes(code))) return 'warning';
  return issueCodes.length > 0 ? 'unverified' : 'pass';
}

function projectPreflightSummary(options: {
  profile: ProjectPreflightProfile;
  project: Extract<WorkflowInspectResult, { target: 'project' }>;
  media: Extract<WorkflowInspectResult, { target: 'media' }>;
  edit: Extract<WorkflowInspectResult, { target: 'edit' }>;
  fusion: Extract<WorkflowInspectResult, { target: 'fusion' }>;
  fusionGraph: Extract<WorkflowInspectResult, { target: 'fusion' }>;
  color: Extract<WorkflowInspectResult, { target: 'color' }>;
  colorGraph: Extract<WorkflowInspectResult, { target: 'color' }>;
  colorVersions: Extract<WorkflowInspectResult, { target: 'color' }>;
  fairlight: Extract<WorkflowInspectResult, { target: 'fairlight' }>;
  fairlightProcessing: Extract<WorkflowInspectResult, { target: 'fairlight' }>;
  deliver: Extract<WorkflowInspectResult, { target: 'deliver' }>;
  capabilityEvidence: ResolveCapabilityEvidence[];
}): ProjectPreflightSummary {
  const blockers: string[] = [];
  const warnings: string[] = [];
  const capabilityGaps: string[] = [];
  const checks: ProjectPreflightCheck[] = [];

  const identityIssues: string[] = [];
  if (!options.project.project) {
    identityIssues.push('project_not_open');
    blockers.push('project_not_open');
  } else if (!options.project.timeline) {
    identityIssues.push('timeline_not_open');
    blockers.push('timeline_not_open');
  }
  checks.push({ id: 'project.identity.v1', status: checkStatus(identityIssues, blockers, warnings), issueCodes: identityIssues });

  const effectiveSettings = options.project.settings.timeline ?? options.project.settings.project;
  const settingsIssues: string[] = [];
  if (!effectiveSettings?.timelineResolution || effectiveSettings.timelineFrameRate === null || !effectiveSettings.colorScienceMode) {
    settingsIssues.push('project_core_settings_unverified');
    capabilityGaps.push('project_core_settings_unverified');
  }
  checks.push({ id: 'project.settings_summary.v1', status: checkStatus(settingsIssues, blockers, warnings), issueCodes: settingsIssues });

  const mediaIssues: string[] = [];
  const media = options.media.inventory;
  if (!media) {
    mediaIssues.push('media_inventory_unavailable');
    capabilityGaps.push('media_inventory_unavailable');
  } else {
    if (media.offlineCountObserved > 0) {
      mediaIssues.push('media_offline_sources');
      blockers.push('media_offline_sources');
    }
    if (!media.complete) {
      mediaIssues.push('media_reader_bounded');
      capabilityGaps.push('media_reader_bounded');
    }
    if (media.onlineUnverifiedCount > 0) {
      mediaIssues.push('media_online_state_unverified');
      capabilityGaps.push('media_online_state_unverified');
    }
    if ((media.motionFrameRateMismatchCount ?? 0) > 0) {
      mediaIssues.push('media_frame_rate_mismatch');
      warnings.push('media_frame_rate_mismatch');
    }
    if ((media.motionResolutionMismatchCount ?? 0) > 0) {
      mediaIssues.push('media_resolution_mismatch');
      warnings.push('media_resolution_mismatch');
    }
  }
  checks.push({ id: 'media.inventory_summary.v1', status: checkStatus(mediaIssues, blockers, warnings), issueCodes: mediaIssues });

  const editIssues: string[] = [];
  const edit = options.edit.summary;
  if (!edit) {
    editIssues.push('edit_timeline_unavailable');
    capabilityGaps.push('edit_timeline_unavailable');
  } else {
    if (edit.offlineSourceItemCountObserved > 0) {
      editIssues.push('edit_offline_sources');
      blockers.push('edit_offline_sources');
    }
    if (!edit.complete) {
      editIssues.push('edit_reader_bounded');
      capabilityGaps.push('edit_reader_bounded');
    }
    if (edit.onlineStateUnverifiedItemCountObserved > 0) {
      editIssues.push('edit_online_state_unverified');
      capabilityGaps.push('edit_online_state_unverified');
    }
  }
  checks.push({ id: 'edit.timeline_summary.v1', status: checkStatus(editIssues, blockers, warnings), issueCodes: editIssues });

  const fusionIssues: string[] = [];
  const fusion = options.fusion.summary;
  if (!fusion) {
    fusionIssues.push('fusion_composition_unavailable');
    capabilityGaps.push('fusion_composition_unavailable');
  } else if (!fusion.complete) {
    fusionIssues.push('fusion_composition_reader_bounded');
    capabilityGaps.push('fusion_composition_reader_bounded');
  }
  checks.push({ id: 'fusion.composition_inspect.v1', status: checkStatus(fusionIssues, blockers, warnings), issueCodes: fusionIssues });

  const fusionGraphIssues: string[] = [];
  const fusionGraph = options.fusionGraph.graph;
  if (!fusionGraph) {
    fusionGraphIssues.push('fusion_graph_unavailable');
    capabilityGaps.push('fusion_graph_unavailable');
  } else if (!fusionGraph.complete) {
    fusionGraphIssues.push('fusion_graph_reader_bounded');
    capabilityGaps.push('fusion_graph_reader_bounded');
  }
  checks.push({ id: 'fusion.graph_inspect.v1', status: checkStatus(fusionGraphIssues, blockers, warnings), issueCodes: fusionGraphIssues });

  const colorIssues: string[] = [];
  const color = options.color.summary;
  if (!color?.settings?.colorScienceMode || !color.settings.outputColorSpace) {
    colorIssues.push('color_pipeline_unverified');
    capabilityGaps.push('color_pipeline_unverified');
  }
  if (color && !color.complete) {
    colorIssues.push('color_reader_bounded');
    capabilityGaps.push('color_reader_bounded');
  }
  capabilityGaps.push('color_dctl_reference_readback_unavailable');
  checks.push({ id: 'color.pipeline_inspect.v1', status: checkStatus(colorIssues, blockers, warnings), issueCodes: colorIssues });

  const colorGraphIssues: string[] = [];
  const colorGraph = options.colorGraph.graph;
  if (!colorGraph) {
    colorGraphIssues.push('color_graph_unavailable');
    capabilityGaps.push('color_graph_unavailable');
  } else if (!colorGraph.complete) {
    colorGraphIssues.push('color_graph_reader_bounded');
    capabilityGaps.push('color_graph_reader_bounded');
  }
  checks.push({ id: 'color.graph_inventory.v1', status: checkStatus(colorGraphIssues, blockers, warnings), issueCodes: colorGraphIssues });

  const colorVersionIssues: string[] = [];
  const colorVersions = options.colorVersions.versions;
  if (!colorVersions) {
    colorVersionIssues.push('color_grade_versions_unavailable');
    capabilityGaps.push('color_grade_versions_unavailable');
  } else if (!colorVersions.complete) {
    colorVersionIssues.push('color_grade_versions_reader_bounded');
    capabilityGaps.push('color_grade_versions_reader_bounded');
  }
  checks.push({ id: 'color.grade_version_inspect.v1', status: checkStatus(colorVersionIssues, blockers, warnings), issueCodes: colorVersionIssues });

  const fairlightIssues: string[] = [];
  const fairlight = options.fairlight.summary;
  if (!fairlight) {
    fairlightIssues.push('fairlight_mapping_unavailable');
    capabilityGaps.push('fairlight_mapping_unavailable');
  } else {
    if (!fairlight.complete) {
      fairlightIssues.push('fairlight_reader_bounded');
      capabilityGaps.push('fairlight_reader_bounded');
    }
    if (fairlight.sourceMappingUnverifiedItemCount > 0) {
      fairlightIssues.push('fairlight_mapping_unverified');
      capabilityGaps.push('fairlight_mapping_unverified');
    }
  }
  capabilityGaps.push('fairlight_sync_evidence_unavailable');
  checks.push({ id: 'fairlight.mapping_inspect.v1', status: checkStatus(fairlightIssues, blockers, warnings), issueCodes: fairlightIssues });

  const fairlightProcessingIssues: string[] = [];
  const fairlightProcessing = options.fairlightProcessing.clipProcessing;
  if (!fairlightProcessing) {
    fairlightProcessingIssues.push('fairlight_clip_processing_unavailable');
    capabilityGaps.push('fairlight_clip_processing_unavailable');
  } else {
    if (!fairlightProcessing.complete) {
      fairlightProcessingIssues.push('fairlight_clip_processing_reader_bounded');
      capabilityGaps.push('fairlight_clip_processing_reader_bounded');
    }
    if (fairlightProcessing.items.some((item) => item.voiceConsistency === 'contradiction')) {
      fairlightProcessingIssues.push('fairlight_voice_isolation_contradiction');
      warnings.push('fairlight_voice_isolation_contradiction');
    }
  }
  checks.push({ id: 'fairlight.clip_processing_inspect.v1', status: checkStatus(fairlightProcessingIssues, blockers, warnings), issueCodes: fairlightProcessingIssues });

  const deliverIssues: string[] = [];
  if (!options.deliver.capabilities) {
    deliverIssues.push('deliver_capabilities_unavailable');
    capabilityGaps.push('deliver_capabilities_unavailable');
  }
  const deliverSettings = options.deliver.settings;
  if (!deliverSettings?.currentFormat) {
    deliverIssues.push('deliver_current_format_unverified');
    capabilityGaps.push('deliver_current_format_unverified');
  }
  if (!deliverSettings?.currentCodec) {
    deliverIssues.push('deliver_current_codec_unverified');
    capabilityGaps.push('deliver_current_codec_unverified');
  }
  capabilityGaps.push('deliver_current_settings_readback_unavailable');
  checks.push({ id: 'deliver.settings_inspect.v1', status: checkStatus(deliverIssues, blockers, warnings), issueCodes: deliverIssues });

  const relevantIds = new Set<ProjectPreflightCheck['id']>(
    options.profile === 'media'
      ? ['project.identity.v1', 'project.settings_summary.v1', 'media.inventory_summary.v1']
      : options.profile === 'edit'
        ? ['project.identity.v1', 'project.settings_summary.v1', 'media.inventory_summary.v1', 'edit.timeline_summary.v1']
      : options.profile === 'color'
          ? ['project.identity.v1', 'project.settings_summary.v1', 'media.inventory_summary.v1', 'edit.timeline_summary.v1', 'color.pipeline_inspect.v1', 'color.graph_inventory.v1', 'color.grade_version_inspect.v1']
          : options.profile === 'fairlight'
            ? ['project.identity.v1', 'project.settings_summary.v1', 'media.inventory_summary.v1', 'edit.timeline_summary.v1', 'fairlight.mapping_inspect.v1', 'fairlight.clip_processing_inspect.v1']
            : options.profile === 'delivery'
              ? checks.map((check) => check.id)
              : options.profile === 'fusion'
                ? ['project.identity.v1', 'project.settings_summary.v1', 'media.inventory_summary.v1', 'edit.timeline_summary.v1', 'fusion.composition_inspect.v1', 'fusion.graph_inspect.v1']
                : checks.map((check) => check.id)
  );
  const relevant = checks.filter((check) => relevantIds.has(check.id));
  let status: ProjectPreflightStatus = relevant.some((check) => check.status === 'blocked')
    ? 'blocked'
    : relevant.some((check) => check.status === 'warning')
      ? 'warning'
      : relevant.some((check) => check.status === 'unverified')
        ? 'unverified'
        : 'pass';
  if (status === 'pass' && options.profile === 'delivery' && deliverSettings?.unverified.length) status = 'unverified';

  return {
    readerId: 'project.preflight.v1',
    profile: options.profile,
    status,
    project: options.project.project ? { id: options.project.project.id, name: options.project.project.name } : null,
    timeline: options.project.timeline ? { id: options.project.timeline.id, name: options.project.timeline.name } : null,
    checks,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    capabilityGaps: [...new Set(capabilityGaps)],
    capabilityEvidence: options.capabilityEvidence
  };
}

const PROJECT_PREFLIGHT_CAPABILITY_IDS = new Set<ResolveCapabilityEvidence['capabilityId']>([
  'resolve.status.read',
  'resolve.sandboxed_script.read',
  'project.identity.read',
  'project.settings.read',
  'media.inventory.read',
  'edit.timeline_structure.read',
  'fusion.composition.read',
  'fusion.graph.read',
  'color.pipeline.read',
  'color.graph.read',
  'color.grade_version.read',
  'fairlight.mapping.read',
  'fairlight.clip_processing.read',
  'deliver.capability_matrix.read',
  'deliver.settings.partial_read'
]);

export function assessWorkflowOperation(tool: string): WorkflowRiskAssessment {
  return assessRegisteredWorkflow(tool);
}

export async function inspectWorkflow(
  broker: ResolveClient,
  snapshot: ResolveBrokerSnapshot,
  target: WorkflowInspectTarget,
  profile: ProjectPreflightProfile = 'general',
  itemId?: string,
  mediaView: 'default' | 'link_status' = 'default',
  editView: 'default' | 'structure' | 'gaps_overlaps' | 'source_ranges' | 'transitions' | 'annotations' = 'default',
  fusionView: 'composition' | 'graph' = 'composition',
  colorView: 'pipeline' | 'graph' | 'versions' = 'pipeline',
  fairlightView: 'mapping' | 'clip_processing' = 'mapping'
): Promise<WorkflowInspectResult> {
  if (target === 'connection') {
    const status = await broker.getResolveStatus();
    return {
      target,
      observedAt: Date.now(),
      running: typeof status['running'] === 'boolean' ? status['running'] : null,
      resolveVersion: typeof status['version'] === 'string' ? status['version'] : null,
      serverName: snapshot.serverName,
      serverVersion: snapshot.serverVersion,
      protocolVersion: snapshot.protocolVersion,
      schemaHash: snapshot.schemaHash
    };
  }

  if (target === 'project') {
    if (!snapshot.tools.some((tool) => tool.name === 'run_script')) {
      throw new Error('The official ResolveMCP run_script tool is unavailable');
    }
    const raw = await callReadOnlyResolveScript(broker, READ_ONLY_PROJECT_SNAPSHOT_SCRIPT);
    const text = firstTextContent(raw);
    if (!text) throw new Error('Project inspection returned no text result');
    let parsed: Record<string, unknown>;
    try { parsed = objectValue(JSON.parse(text)) ?? {}; }
    catch { throw new Error('Project inspection returned invalid JSON'); }
    const payload = objectValue(parsed['result']);
    if (!payload) throw new Error('Project inspection returned no structured result');
    const project = objectValue(payload['project']);
    const timeline = objectValue(payload['timeline']);
    const rawTimelineSettings = objectValue(payload['timelineSettings']);
    return {
      target,
      observedAt: Date.now(),
      page: typeof payload['page'] === 'string' ? payload['page'] : null,
      project: project && typeof project['name'] === 'string' && typeof project['id'] === 'string'
        ? {
            name: project['name'],
            id: project['id'],
            timelineCount: finiteNumber(project['timelineCount'])
          }
        : null,
      timeline: timeline && typeof timeline['name'] === 'string' && typeof timeline['id'] === 'string'
        ? {
            name: timeline['name'],
            id: timeline['id'],
            videoTracks: finiteNumber(timeline['videoTracks']),
            audioTracks: finiteNumber(timeline['audioTracks']),
            subtitleTracks: finiteNumber(timeline['subtitleTracks'])
          }
        : null,
      settings: {
        readerId: 'project.settings_summary.v1',
        project: settingsFacts(payload['projectSettings']),
        timeline: settingsFacts(payload['timelineSettings']),
        timelineUsesCustomSettings: rawTimelineSettings
          ? customTimelineSettings(rawTimelineSettings['useCustomSettings'])
          : null
      },
      schemaHash: snapshot.schemaHash
    };
  }

  if (target === 'media') {
    if (!snapshot.tools.some((tool) => tool.name === 'run_script')) {
      throw new Error('The official ResolveMCP run_script tool is unavailable');
    }
    if (mediaView === 'link_status') {
      const raw = await callReadOnlyResolveScript(broker, mediaLinkStatusScript(itemId));
      const text = firstTextContent(raw);
      if (!text) throw new Error('Media link status returned no text result');
      let parsed: Record<string, unknown>;
      try { parsed = objectValue(JSON.parse(text)) ?? {}; }
      catch { throw new Error('Media link status returned invalid JSON'); }
      if (!Object.hasOwn(parsed, 'result')) throw new Error('Media link status returned no structured result');
      return {
        target,
        observedAt: Date.now(),
        inventory: null,
        clip: null,
        linkStatus: mediaLinkStatus(parsed['result']),
        requestedItemId: itemId ?? null,
        schemaHash: snapshot.schemaHash
      };
    }
    if (itemId !== undefined) {
      const raw = await callReadOnlyResolveScript(broker, mediaClipInspectScript(itemId));
      const text = firstTextContent(raw);
      if (!text) throw new Error('Media clip inspection returned no text result');
      let parsed: Record<string, unknown>;
      try { parsed = objectValue(JSON.parse(text)) ?? {}; }
      catch { throw new Error('Media clip inspection returned invalid JSON'); }
      if (!Object.hasOwn(parsed, 'result')) throw new Error('Media clip inspection returned no structured result');
      return {
        target,
        observedAt: Date.now(),
        inventory: null,
        clip: mediaClipInspect(parsed['result']),
        linkStatus: null,
        requestedItemId: itemId,
        schemaHash: snapshot.schemaHash
      };
    }
    const raw = await callReadOnlyResolveScript(broker, READ_ONLY_MEDIA_INVENTORY_SCRIPT);
    const text = firstTextContent(raw);
    if (!text) throw new Error('Media inventory returned no text result');
    let parsed: Record<string, unknown>;
    try { parsed = objectValue(JSON.parse(text)) ?? {}; }
    catch { throw new Error('Media inventory returned invalid JSON'); }
    if (!Object.hasOwn(parsed, 'result')) throw new Error('Media inventory returned no structured result');
    return {
      target,
      observedAt: Date.now(),
      inventory: mediaInventorySummary(parsed['result']),
      clip: null,
      linkStatus: null,
      requestedItemId: null,
      schemaHash: snapshot.schemaHash
    };
  }

  if (target === 'edit') {
    if (!snapshot.tools.some((tool) => tool.name === 'run_script')) {
      throw new Error('The official ResolveMCP run_script tool is unavailable');
    }
    if (editView === 'structure') {
      const raw = await callReadOnlyResolveScript(broker, READ_ONLY_EDIT_STRUCTURE_SCRIPT);
      const text = firstTextContent(raw);
      if (!text) throw new Error('Edit structure inspection returned no text result');
      let parsed: Record<string, unknown>;
      try { parsed = objectValue(JSON.parse(text)) ?? {}; }
      catch { throw new Error('Edit structure inspection returned invalid JSON'); }
      if (!Object.hasOwn(parsed, 'result')) throw new Error('Edit structure inspection returned no structured result');
      return {
        target,
        observedAt: Date.now(),
        view: 'structure',
        summary: null,
        structure: editStructureInspect(parsed['result']),
        gapsOverlaps: null,
        sourceRanges: null,
        transitions: null,
        annotations: null,
        schemaHash: snapshot.schemaHash
      };
    }
    if (editView === 'gaps_overlaps') {
      const raw = await callReadOnlyResolveScript(broker, READ_ONLY_EDIT_STRUCTURE_SCRIPT);
      const text = firstTextContent(raw);
      if (!text) throw new Error('Edit gaps/overlaps inspection returned no text result');
      let parsed: Record<string, unknown>;
      try { parsed = objectValue(JSON.parse(text)) ?? {}; }
      catch { throw new Error('Edit gaps/overlaps inspection returned invalid JSON'); }
      if (!Object.hasOwn(parsed, 'result')) throw new Error('Edit gaps/overlaps inspection returned no structured result');
      const structure = editStructureInspect(parsed['result']);
      return {
        target,
        observedAt: Date.now(),
        view: 'gaps_overlaps',
        summary: null,
        structure: null,
        gapsOverlaps: structure ? deriveEditGapsOverlaps(structure) : null,
        sourceRanges: null,
        transitions: null,
        annotations: null,
        schemaHash: snapshot.schemaHash
      };
    }
    if (editView === 'source_ranges') {
      const raw = await callReadOnlyResolveScript(broker, READ_ONLY_EDIT_STRUCTURE_SCRIPT);
      const text = firstTextContent(raw);
      if (!text) throw new Error('Edit source range report returned no text result');
      let parsed: Record<string, unknown>;
      try { parsed = objectValue(JSON.parse(text)) ?? {}; }
      catch { throw new Error('Edit source range report returned invalid JSON'); }
      if (!Object.hasOwn(parsed, 'result')) throw new Error('Edit source range report returned no structured result');
      const structure = editStructureInspect(parsed['result']);
      return {
        target,
        observedAt: Date.now(),
        view: 'source_ranges',
        summary: null,
        structure: null,
        gapsOverlaps: null,
        sourceRanges: structure ? deriveEditSourceRangeReport(structure) : null,
        transitions: null,
        annotations: null,
        schemaHash: snapshot.schemaHash
      };
    }
    if (editView === 'transitions') {
      const raw = await callReadOnlyResolveScript(broker, READ_ONLY_EDIT_TRANSITION_SCRIPT);
      const text = firstTextContent(raw);
      if (!text) throw new Error('Edit transition inspection returned no text result');
      let parsed: Record<string, unknown>;
      try { parsed = objectValue(JSON.parse(text)) ?? {}; }
      catch { throw new Error('Edit transition inspection returned invalid JSON'); }
      if (!Object.hasOwn(parsed, 'result')) throw new Error('Edit transition inspection returned no structured result');
      return {
        target,
        observedAt: Date.now(),
        view: 'transitions',
        summary: null,
        structure: null,
        gapsOverlaps: null,
        sourceRanges: null,
        transitions: editTransitionInspect(parsed['result']),
        annotations: null,
        schemaHash: snapshot.schemaHash
      };
    }
    if (editView === 'annotations') {
      const raw = await callReadOnlyResolveScript(broker, READ_ONLY_EDIT_REVIEW_ANNOTATIONS_SCRIPT);
      const text = firstTextContent(raw);
      if (!text) throw new Error('Edit review annotations inspection returned no text result');
      let parsed: Record<string, unknown>;
      try { parsed = objectValue(JSON.parse(text)) ?? {}; }
      catch { throw new Error('Edit review annotations inspection returned invalid JSON'); }
      if (!Object.hasOwn(parsed, 'result')) throw new Error('Edit review annotations inspection returned no structured result');
      return {
        target,
        observedAt: Date.now(),
        view: 'annotations',
        summary: null,
        structure: null,
        gapsOverlaps: null,
        sourceRanges: null,
        transitions: null,
        annotations: editReviewAnnotationsInspect(parsed['result']),
        schemaHash: snapshot.schemaHash
      };
    }
    const raw = await callReadOnlyResolveScript(broker, READ_ONLY_EDIT_TIMELINE_SUMMARY_SCRIPT);
    const text = firstTextContent(raw);
    if (!text) throw new Error('Edit timeline summary returned no text result');
    let parsed: Record<string, unknown>;
    try { parsed = objectValue(JSON.parse(text)) ?? {}; }
    catch { throw new Error('Edit timeline summary returned invalid JSON'); }
    if (!Object.hasOwn(parsed, 'result')) throw new Error('Edit timeline summary returned no structured result');
    return {
      target,
      observedAt: Date.now(),
      view: 'default',
      summary: editTimelineSummary(parsed['result']),
      structure: null,
      gapsOverlaps: null,
      sourceRanges: null,
      transitions: null,
      annotations: null,
      schemaHash: snapshot.schemaHash
    };
  }

  if (target === 'fusion') {
    if (!snapshot.tools.some((tool) => tool.name === 'run_script')) {
      throw new Error('The official ResolveMCP run_script tool is unavailable');
    }
    if (fusionView === 'graph') {
      const raw = await callReadOnlyResolveScript(broker, READ_ONLY_FUSION_GRAPH_SCRIPT);
      const text = firstTextContent(raw);
      if (!text) throw new Error('Fusion graph inspection returned no text result');
      let parsed: Record<string, unknown>;
      try { parsed = objectValue(JSON.parse(text)) ?? {}; }
      catch { throw new Error('Fusion graph inspection returned invalid JSON'); }
      if (!Object.hasOwn(parsed, 'result')) throw new Error('Fusion graph inspection returned no structured result');
      return {
        target,
        observedAt: Date.now(),
        view: 'graph',
        summary: null,
        graph: fusionGraphInspect(parsed['result']),
        schemaHash: snapshot.schemaHash
      };
    }
    const raw = await callReadOnlyResolveScript(broker, READ_ONLY_FUSION_COMPOSITION_SCRIPT);
    const text = firstTextContent(raw);
    if (!text) throw new Error('Fusion composition inspection returned no text result');
    let parsed: Record<string, unknown>;
    try { parsed = objectValue(JSON.parse(text)) ?? {}; }
    catch { throw new Error('Fusion composition inspection returned invalid JSON'); }
    if (!Object.hasOwn(parsed, 'result')) throw new Error('Fusion composition inspection returned no structured result');
    return {
      target,
      observedAt: Date.now(),
      view: 'composition',
      summary: fusionCompositionInspect(parsed['result']),
      graph: null,
      schemaHash: snapshot.schemaHash
    };
  }

  if (target === 'color') {
    if (!snapshot.tools.some((tool) => tool.name === 'run_script')) {
      throw new Error('The official ResolveMCP run_script tool is unavailable');
    }
    if (colorView === 'graph') {
      const raw = await callReadOnlyResolveScript(broker, READ_ONLY_COLOR_GRAPH_SCRIPT);
      const text = firstTextContent(raw);
      if (!text) throw new Error('Color graph inspection returned no text result');
      let parsed: Record<string, unknown>;
      try { parsed = objectValue(JSON.parse(text)) ?? {}; }
      catch { throw new Error('Color graph inspection returned invalid JSON'); }
      if (!Object.hasOwn(parsed, 'result')) throw new Error('Color graph inspection returned no structured result');
      return {
        target,
        observedAt: Date.now(),
        view: 'graph',
        summary: null,
        graph: colorGraphInventory(parsed['result']),
        versions: null,
        schemaHash: snapshot.schemaHash
      };
    }
    if (colorView === 'versions') {
      const raw = await callReadOnlyResolveScript(broker, READ_ONLY_COLOR_GRADE_VERSION_SCRIPT);
      const text = firstTextContent(raw);
      if (!text) throw new Error('Color grade-version inspection returned no text result');
      let parsed: Record<string, unknown>;
      try { parsed = objectValue(JSON.parse(text)) ?? {}; }
      catch { throw new Error('Color grade-version inspection returned invalid JSON'); }
      if (!Object.hasOwn(parsed, 'result')) throw new Error('Color grade-version inspection returned no structured result');
      return {
        target,
        observedAt: Date.now(),
        view: 'versions',
        summary: null,
        graph: null,
        versions: colorGradeVersionInspect(parsed['result']),
        schemaHash: snapshot.schemaHash
      };
    }
    const raw = await callReadOnlyResolveScript(broker, READ_ONLY_COLOR_PIPELINE_SCRIPT);
    const text = firstTextContent(raw);
    if (!text) throw new Error('Color pipeline inspection returned no text result');
    let parsed: Record<string, unknown>;
    try { parsed = objectValue(JSON.parse(text)) ?? {}; }
    catch { throw new Error('Color pipeline inspection returned invalid JSON'); }
    if (!Object.hasOwn(parsed, 'result')) throw new Error('Color pipeline inspection returned no structured result');
    return {
      target,
      observedAt: Date.now(),
      view: 'pipeline',
      summary: colorPipelineSummary(parsed['result']),
      graph: null,
      versions: null,
      schemaHash: snapshot.schemaHash
    };
  }

  if (target === 'fairlight') {
    if (!snapshot.tools.some((tool) => tool.name === 'run_script')) {
      throw new Error('The official ResolveMCP run_script tool is unavailable');
    }
    if (fairlightView === 'clip_processing') {
      const raw = await callReadOnlyResolveScript(broker, READ_ONLY_FAIRLIGHT_CLIP_PROCESSING_SCRIPT);
      const text = firstTextContent(raw);
      if (!text) throw new Error('Fairlight clip-processing inspection returned no text result');
      let parsed: Record<string, unknown>;
      try { parsed = objectValue(JSON.parse(text)) ?? {}; }
      catch { throw new Error('Fairlight clip-processing inspection returned invalid JSON'); }
      if (!Object.hasOwn(parsed, 'result')) throw new Error('Fairlight clip-processing inspection returned no structured result');
      return {
        target,
        observedAt: Date.now(),
        view: 'clip_processing',
        summary: null,
        clipProcessing: fairlightClipProcessingInspect(parsed['result']),
        schemaHash: snapshot.schemaHash
      };
    }
    const raw = await callReadOnlyResolveScript(broker, READ_ONLY_FAIRLIGHT_MAPPING_SCRIPT);
    const text = firstTextContent(raw);
    if (!text) throw new Error('Fairlight mapping inspection returned no text result');
    let parsed: Record<string, unknown>;
    try { parsed = objectValue(JSON.parse(text)) ?? {}; }
    catch { throw new Error('Fairlight mapping inspection returned invalid JSON'); }
    if (!Object.hasOwn(parsed, 'result')) throw new Error('Fairlight mapping inspection returned no structured result');
    return {
      target,
      observedAt: Date.now(),
      view: 'mapping',
      summary: fairlightMappingSummary(parsed['result']),
      clipProcessing: null,
      schemaHash: snapshot.schemaHash
    };
  }

  if (target === 'deliver') {
    if (!snapshot.tools.some((tool) => tool.name === 'run_script')) {
      throw new Error('The official ResolveMCP run_script tool is unavailable');
    }
    const raw = await callReadOnlyResolveScript(broker, READ_ONLY_DELIVER_SUMMARY_SCRIPT);
    const text = firstTextContent(raw);
    if (!text) throw new Error('Deliver inspection returned no text result');
    let parsed: Record<string, unknown>;
    try { parsed = objectValue(JSON.parse(text)) ?? {}; }
    catch { throw new Error('Deliver inspection returned invalid JSON'); }
    if (!Object.hasOwn(parsed, 'result')) throw new Error('Deliver inspection returned no structured result');
    const payload = objectValue(parsed['result']);
    return {
      target,
      observedAt: Date.now(),
      capabilities: deliverCapabilityMatrix(payload?.['capabilities']),
      settings: deliverSettingsInspect(payload?.['settings']),
      schemaHash: snapshot.schemaHash
    };
  }

  if (target === 'preflight') {
    const project = await inspectWorkflow(broker, snapshot, 'project') as Extract<WorkflowInspectResult, { target: 'project' }>;
    const media = await inspectWorkflow(broker, snapshot, 'media') as Extract<WorkflowInspectResult, { target: 'media' }>;
    const edit = await inspectWorkflow(broker, snapshot, 'edit') as Extract<WorkflowInspectResult, { target: 'edit' }>;
    const fusion = await inspectWorkflow(broker, snapshot, 'fusion') as Extract<WorkflowInspectResult, { target: 'fusion' }>;
    const fusionGraph = await inspectWorkflow(broker, snapshot, 'fusion', 'general', undefined, 'default', 'default', 'graph') as Extract<WorkflowInspectResult, { target: 'fusion' }>;
    const color = await inspectWorkflow(broker, snapshot, 'color') as Extract<WorkflowInspectResult, { target: 'color' }>;
    const colorGraph = await inspectWorkflow(broker, snapshot, 'color', 'general', undefined, 'default', 'default', 'composition', 'graph') as Extract<WorkflowInspectResult, { target: 'color' }>;
    const colorVersions = await inspectWorkflow(broker, snapshot, 'color', 'general', undefined, 'default', 'default', 'composition', 'versions') as Extract<WorkflowInspectResult, { target: 'color' }>;
    const fairlight = await inspectWorkflow(broker, snapshot, 'fairlight') as Extract<WorkflowInspectResult, { target: 'fairlight' }>;
    const fairlightProcessing = await inspectWorkflow(broker, snapshot, 'fairlight', 'general', undefined, 'default', 'default', 'composition', 'pipeline', 'clip_processing') as Extract<WorkflowInspectResult, { target: 'fairlight' }>;
    const deliver = await inspectWorkflow(broker, snapshot, 'deliver') as Extract<WorkflowInspectResult, { target: 'deliver' }>;
    const resolveStatus = await broker.getResolveStatus();
    const resolveVersion = typeof resolveStatus['version'] === 'string' ? resolveStatus['version'] : null;
    return {
      target,
      observedAt: Date.now(),
      preflight: projectPreflightSummary({
        profile,
        project,
        media,
        edit,
        fusion,
        fusionGraph,
        color,
        colorGraph,
        colorVersions,
        fairlight,
        fairlightProcessing,
        deliver,
        capabilityEvidence: resolveCapabilityRegistry(snapshot, resolveVersion)
          .filter((evidence) => PROJECT_PREFLIGHT_CAPABILITY_IDS.has(evidence.capabilityId))
      }),
      schemaHash: snapshot.schemaHash
    };
  }

  const resolveStatus = await broker.getResolveStatus();
  const resolveVersion = typeof resolveStatus['version'] === 'string' ? resolveStatus['version'] : null;
  return {
    target,
    observedAt: Date.now(),
    resolveVersion,
    officialToolCount: snapshot.tools.length,
    officialTools: snapshot.tools.map((tool) => tool.name),
    protectedTools: WORKFLOW_TOOLS.map((tool) => tool.name),
    capabilities: resolveCapabilityRegistry(snapshot, resolveVersion),
    schemaHash: snapshot.schemaHash
  };
}

function protectedInspectResult(result: WorkflowInspectResult): ProtectedWorkflowResult<WorkflowInspectResult> {
  if (result.target === 'connection') {
    const verified = result.running !== null;
    return {
      result,
      operation: readOnlyOperation({
        workflowId: 'system.connection_status.v1',
        status: verified ? 'success' : 'partial',
        verificationStatus: verified ? 'passed' : 'unverified',
        verificationLevel: verified ? 'API_READBACK' : undefined,
        checks: [verified ? 'Resolve running state observed' : 'Resolve running state unavailable']
      })
    };
  }

  if (result.target === 'capabilities') {
    const warnings = result.capabilities
      .filter((item) => item.status !== 'available')
      .map((item) => `${item.capabilityId}:${item.status}`);
    return {
      result,
      operation: readOnlyOperation({
        workflowId: 'system.capability_snapshot.v1',
        status: 'success',
        verificationStatus: 'passed',
        verificationLevel: 'API_READBACK',
        checks: [`${result.capabilities.length} narrow capabilities qualified`],
        warnings
      })
    };
  }

  if (result.target === 'project') {
    const effective = result.settings.timeline ?? result.settings.project;
    const warnings = [
      ...(!result.timeline ? ['timeline_not_open'] : []),
      ...(effective?.unverified ?? []).map((key) => `unverified:${key}`),
      ...(result.settings.timelineUsesCustomSettings === null ? ['unverified:timelineUsesCustomSettings'] : [])
    ];
    const blocked = result.project === null;
    return {
      result,
      operation: readOnlyOperation({
        workflowId: 'project.settings_summary.v1',
        status: blocked ? 'blocked' : warnings.length ? 'partial' : 'success',
        verificationStatus: blocked ? 'unverified' : warnings.length ? 'partial' : 'passed',
        verificationLevel: blocked ? undefined : 'API_READBACK',
        checks: [
          result.project ? 'Project identity observed' : 'Project not open',
          effective ? 'Effective project/timeline settings read back' : 'Project settings unavailable'
        ],
        warnings
      })
    };
  }

  if (result.target === 'media') {
    if (result.linkStatus) {
      const status = result.linkStatus;
      const poolObserved = status.methodEvidence.mediaPool.probed;
      const itemObserved = status.requestedItemId === null || status.itemLookup === 'found';
      const warnings = [
        ...status.capabilities.filter((capability) => capability.surface === 'missing').map((capability) => `surface_missing:${capability.id}`),
        ...status.unverified.map((key) => `unverified:${key}`),
        ...(status.itemLookup === 'not_found' ? ['target_not_found'] : []),
        ...(status.itemLookup === 'unverified' ? ['target_lookup_bounded'] : [])
      ];
      const blocked = !poolObserved;
      return {
        result,
        operation: readOnlyOperation({
          workflowId: 'media.link_status.v1',
          status: blocked ? 'blocked' : warnings.length ? 'partial' : 'success',
          verificationStatus: blocked ? 'unverified' : warnings.length ? 'partial' : 'passed',
          verificationLevel: blocked ? undefined : 'API_READBACK',
          checks: [
            poolObserved ? 'MediaPool relink/unlink method surface observed with dir()' : 'MediaPool link method surface unavailable',
            status.requestedItemId === null
              ? 'No MediaPoolItem target requested; item-level link methods were not probed'
              : itemObserved
                ? `Exact MediaPoolItem ${status.requestedItemId} link method surface observed with dir()`
                : `MediaPoolItem ${status.requestedItemId} link method surface was not established`
          ],
          warnings
        })
      };
    }
    if (result.requestedItemId !== null) {
      const detail = result.clip;
      if (!detail) throw new Error('Media clip inspection is missing its exact-target projection');
      const found = detail.lookup === 'found' && detail.item !== null;
      const knownAbsent = detail.lookup === 'not_found';
      const warnings = [
        ...(detail.lookup === 'unverified' ? ['target_lookup_bounded'] : []),
        ...(knownAbsent ? ['target_not_found'] : []),
        ...(detail.metadataTruncated ? ['metadata_bounded'] : []),
        ...(detail.thirdPartyMetadataTruncated ? ['third_party_metadata_bounded'] : []),
        ...(detail.markersTruncated ? ['markers_bounded'] : []),
        ...detail.unverified.map((key) => `unverified:${key}`)
      ];
      return {
        result,
        operation: readOnlyOperation({
          workflowId: 'media.clip_inspect.v1',
          status: found ? (warnings.length ? 'partial' : 'success') : 'blocked',
          verificationStatus: found ? (warnings.length ? 'partial' : 'passed') : knownAbsent ? 'passed' : 'unverified',
          verificationLevel: found || knownAbsent ? 'API_READBACK' : undefined,
          checks: [
            found
              ? `Exact Media Pool item ${detail.requestedItemId} observed by unique ID`
              : knownAbsent
                ? `Media Pool item ${detail.requestedItemId} was not present in the complete bounded lookup`
                : `Media Pool item ${detail.requestedItemId} could not be established before the lookup bound`
          ],
          warnings
        })
      };
    }
    const summary = result.inventory;
    const warnings = summary
      ? [
          ...(!summary.complete ? ['reader_bounded'] : []),
          ...summary.unverified.map((key) => `unverified:${key}`)
        ]
      : [];
    return {
      result,
      operation: readOnlyOperation({
        workflowId: 'media.inventory_summary.v1',
        status: !summary ? 'blocked' : warnings.length ? 'partial' : 'success',
        verificationStatus: !summary ? 'unverified' : warnings.length ? 'partial' : 'passed',
        verificationLevel: summary ? 'STRUCTURAL_READBACK' : undefined,
        checks: [summary ? `${summary.itemsObserved} Media Pool items observed` : 'Media Pool unavailable'],
        warnings
      })
    };
  }

  if (result.target === 'edit') {
    if (result.view === 'annotations') {
      const annotations = result.annotations;
      if (!annotations) {
        return {
          result,
          operation: readOnlyOperation({
            workflowId: 'edit.review_annotations_inspect.v1',
            status: 'blocked',
            verificationStatus: 'unverified',
            checks: ['Current timeline unavailable']
          })
        };
      }
      const warnings = [
        ...(!annotations.complete ? ['reader_bounded_or_incomplete'] : []),
        ...annotations.methodEvidence.timeline.missingMethods.map((name) => `timeline_surface_missing:${name}`),
        ...annotations.methodEvidence.timeline.failedMethods.map((name) => `timeline_getter_failed:${name}`),
        ...annotations.methodEvidence.timelineItem.missingMethods.map((name) => `timeline_item_surface_missing:${name}`),
        ...annotations.methodEvidence.timelineItem.failedMethods.map((name) => `timeline_item_getter_failed:${name}`),
        ...annotations.methodEvidence.mediaPoolItem.missingMethods.map((name) => `media_pool_surface_missing:${name}`),
        ...annotations.methodEvidence.mediaPoolItem.failedMethods.map((name) => `media_pool_getter_failed:${name}`),
        ...annotations.unverified.map((key) => `unverified:${key}`)
      ];
      return {
        result,
        operation: readOnlyOperation({
          workflowId: 'edit.review_annotations_inspect.v1',
          status: warnings.length ? 'partial' : 'success',
          verificationStatus: warnings.length ? 'partial' : 'passed',
          verificationLevel: 'API_READBACK',
          checks: [
            `Timeline ${annotations.timeline.id} observed by unique ID`,
            `${annotations.timelineMarkerCountObserved + annotations.timelineItemMarkerCountObserved + annotations.mediaPoolMarkerCountObserved} review marker records observed across timeline, TimelineItem and MediaPoolItem scopes`,
            `${annotations.mediaPoolItemsObserved} unique MediaPoolItem annotation targets observed`,
            'The protected reader called only fixed annotation getters; no annotation writer was dispatched'
          ],
          warnings
        })
      };
    }
    if (result.view === 'transitions') {
      const transitions = result.transitions;
      if (!transitions) {
        return {
          result,
          operation: readOnlyOperation({
            workflowId: 'edit.transition_inspect.v1',
            status: 'blocked',
            verificationStatus: 'unverified',
            checks: ['Current timeline unavailable']
          })
        };
      }
      const warnings = [
        ...(!transitions.complete ? ['reader_bounded_or_incomplete'] : []),
        ...transitions.methodEvidence.missingMethods.map((name) => `surface_missing:${name}`),
        ...transitions.methodEvidence.failedReadMethods.map((name) => `getter_failed:${name}`),
        ...transitions.unverified.map((key) => `unverified:${key}`)
      ];
      return {
        result,
        operation: readOnlyOperation({
          workflowId: 'edit.transition_inspect.v1',
          status: warnings.length ? 'partial' : 'success',
          verificationStatus: warnings.length ? 'partial' : 'passed',
          verificationLevel: 'API_READBACK',
          checks: [
            `Timeline ${transitions.timeline.id} observed by unique ID`,
            `${transitions.getFadesReadbackObservedCount}/${transitions.methodEvidence.itemsProbed} TimelineItem GetFades readbacks observed`,
            `${transitions.methodEvidence.fullyObservedMethods.length}/${transitions.methodEvidence.checkedMethods.length} fixed transition/fade method surfaces observed across all probed items`,
            'AddTransition and SetFades were not called by the protected reader'
          ],
          warnings
        })
      };
    }
    if (result.view === 'source_ranges') {
      const report = result.sourceRanges;
      if (!report) {
        return {
          result,
          operation: readOnlyOperation({
            workflowId: 'edit.source_range_report.v1',
            status: 'blocked',
            verificationStatus: 'unverified',
            checks: ['Current timeline unavailable']
          })
        };
      }
      const warnings = [
        ...(!report.complete ? ['reader_bounded_or_incomplete'] : []),
        ...report.methodEvidence.missingMethods.map((name) => `getter_missing:${name}`),
        ...report.methodEvidence.failedMethods.map((name) => `getter_failed:${name}`),
        ...report.unverified.map((key) => `unverified:${key}`)
      ];
      return {
        result,
        operation: readOnlyOperation({
          workflowId: 'edit.source_range_report.v1',
          status: warnings.length ? 'partial' : 'success',
          verificationStatus: warnings.length ? 'partial' : 'passed',
          verificationLevel: 'STRUCTURAL_READBACK',
          checks: [
            `Timeline ${report.timeline.id} observed by unique ID`,
            `${report.itemsReported}/${report.itemsObserved} timeline item source/record getter rows reported`,
            `${report.itemsWithCompleteSourceGetterValues} items returned both raw source frame getter values`,
            `${report.itemsWithMediaPoolReference} items have exact MediaPoolItem identities`
          ],
          warnings
        })
      };
    }
    if (result.view === 'gaps_overlaps') {
      const gaps = result.gapsOverlaps;
      if (!gaps) {
        return {
          result,
          operation: readOnlyOperation({
            workflowId: 'edit.gaps_overlaps.v1',
            status: 'blocked',
            verificationStatus: 'unverified',
            checks: ['Current timeline unavailable']
          })
        };
      }
      const warnings = [
        ...(!gaps.complete ? ['reader_bounded_or_incomplete'] : []),
        ...gaps.methodEvidence.missingMethods.map((name) => `getter_missing:${name}`),
        ...gaps.methodEvidence.failedMethods.map((name) => `getter_failed:${name}`),
        ...gaps.unverified.map((key) => `unverified:${key}`)
      ];
      return {
        result,
        operation: readOnlyOperation({
          workflowId: 'edit.gaps_overlaps.v1',
          status: warnings.length ? 'partial' : 'success',
          verificationStatus: warnings.length ? 'partial' : 'passed',
          verificationLevel: 'STRUCTURAL_READBACK',
          checks: [
            `Timeline ${gaps.timeline.id} observed by unique ID`,
            `${gaps.comparablePairsObserved}/${gaps.adjacentPairsObserved} same-track adjacent record-boundary pairs compared`,
            `${gaps.gapCountObserved} definite gaps, ${gaps.overlapCountObserved} definite overlaps, ${gaps.boundaryAmbiguousCountObserved} boundary-ambiguous relationships observed`
          ],
          warnings
        })
      };
    }
    if (result.view === 'structure') {
      const structure = result.structure;
      if (!structure) {
        return {
          result,
          operation: readOnlyOperation({
            workflowId: 'edit.structure_inspect.v1',
            status: 'blocked',
            verificationStatus: 'unverified',
            checks: ['Current timeline unavailable']
          })
        };
      }
      const warnings = [
        ...(structure.tracksTruncated ? ['tracks_bounded'] : []),
        ...(structure.itemsTruncated ? ['items_bounded'] : []),
        ...structure.methodEvidence.missingMethods.map((name) => `getter_missing:${name}`),
        ...structure.methodEvidence.failedMethods.map((name) => `getter_failed:${name}`),
        ...structure.unverified.map((key) => `unverified:${key}`)
      ];
      return {
        result,
        operation: readOnlyOperation({
          workflowId: 'edit.structure_inspect.v1',
          status: warnings.length ? 'partial' : 'success',
          verificationStatus: warnings.length ? 'partial' : 'passed',
          verificationLevel: 'STRUCTURAL_READBACK',
          checks: [
            `Timeline ${structure.timeline.id} observed by unique ID`,
            `${structure.itemsObserved} timeline item identities/ranges observed`,
            `${structure.methodEvidence.fullyObservedMethods.length}/${structure.methodEvidence.checkedMethods.length} fixed item getters observed across all probed items`
          ],
          warnings
        })
      };
    }
    const summary = result.summary;
    const warnings = summary
      ? [
          ...(!summary.complete ? ['reader_bounded'] : []),
          ...summary.unverified.map((key) => `unverified:${key}`)
        ]
      : [];
    return {
      result,
      operation: readOnlyOperation({
        workflowId: 'edit.timeline_summary.v1',
        status: !summary ? 'blocked' : warnings.length ? 'partial' : 'success',
        verificationStatus: !summary ? 'unverified' : warnings.length ? 'partial' : 'passed',
        verificationLevel: summary ? 'STRUCTURAL_READBACK' : undefined,
        checks: [summary ? `${summary.timelineItemCountObserved} timeline items observed` : 'Current timeline unavailable'],
        warnings
      })
    };
  }

  if (result.target === 'fusion') {
    if (result.view === 'graph') {
      const graph = result.graph;
      if (!graph) {
        return {
          result,
          operation: readOnlyOperation({
            workflowId: 'fusion.graph_inspect.v1',
            status: 'blocked',
            verificationStatus: 'unverified',
            checks: ['Current timeline unavailable']
          })
        };
      }
      const warnings = [
        ...(!graph.complete ? ['reader_bounded_or_incomplete'] : []),
        ...graph.methodEvidence.failedMethods.map((name) => `getter_failed:${name}`),
        ...graph.unverified.map((key) => `unverified:${key}`)
      ];
      return {
        result,
        operation: readOnlyOperation({
          workflowId: 'fusion.graph_inspect.v1',
          status: warnings.length ? 'partial' : 'success',
          verificationStatus: warnings.length ? 'partial' : 'passed',
          verificationLevel: 'API_READBACK',
          checks: [
            `Timeline ${graph.timeline.id} scanned across ${graph.tracksScanned}/${graph.videoTrackCount} VIDEO tracks`,
            `${graph.compositionsReported}/${graph.compositionsObserved} bounded Fusion compositions reported`,
            `${graph.toolsReported}/${graph.toolsObserved} bounded Fusion tools reported`,
            `${graph.edgesReported}/${graph.edgesObserved} bounded graph edges reported`,
            'Control values, rendered pixels and graph writes were not claimed by this reader'
          ],
          warnings
        })
      };
    }
    const summary = result.summary;
    if (!summary) {
      return {
        result,
        operation: readOnlyOperation({
          workflowId: 'fusion.composition_inspect.v1',
          status: 'blocked',
          verificationStatus: 'unverified',
          checks: ['Current timeline unavailable']
        })
      };
    }
    const warnings = [
      ...(!summary.complete ? ['reader_bounded_or_incomplete'] : []),
      ...summary.methodEvidence.missingMethods.map((name) => `surface_missing:${name}`),
      ...summary.methodEvidence.failedMethods.map((name) => `getter_failed:${name}`),
      ...summary.unverified.map((key) => `unverified:${key}`)
    ];
    return {
      result,
      operation: readOnlyOperation({
        workflowId: 'fusion.composition_inspect.v1',
        status: warnings.length ? 'partial' : 'success',
        verificationStatus: warnings.length ? 'partial' : 'passed',
        verificationLevel: 'API_READBACK',
        checks: [
          `Timeline ${summary.timeline.id} scanned across ${summary.tracksScanned}/${summary.videoTrackCount} VIDEO tracks`,
          `${summary.itemsReported}/${summary.videoItemsObserved} bounded VIDEO TimelineItem rows reported`,
          `${summary.items.reduce((sum, item) => sum + (item.compositionCountObserved ?? 0), 0)} Fusion compositions observed across reported items`,
          'Fusion graph, tool, input/output and rendered pixel claims were not made by this reader'
        ],
        warnings
      })
    };
  }

  if (result.target === 'color') {
    if (result.view === 'graph') {
      const graph = result.graph;
      if (!graph) {
        return {
          result,
          operation: readOnlyOperation({
            workflowId: 'color.graph_inventory.v1',
            status: 'blocked',
            verificationStatus: 'unverified',
            checks: ['Current timeline unavailable']
          })
        };
      }
      const warnings = [
        ...(!graph.complete ? ['reader_bounded_or_incomplete'] : []),
        ...graph.methodEvidence.missingMethods.map((name) => `getter_missing:${name}`),
        ...graph.methodEvidence.failedMethods.map((name) => `getter_failed:${name}`),
        ...graph.unverified.map((key) => `unverified:${key}`)
      ];
      return {
        result,
        operation: readOnlyOperation({
          workflowId: 'color.graph_inventory.v1',
          status: warnings.length ? 'partial' : 'success',
          verificationStatus: warnings.length ? 'partial' : 'passed',
          verificationLevel: 'API_READBACK',
          checks: [
            `Timeline ${graph.timeline.id} color graph inventory observed`,
            `${graph.graphsObserved} timeline/default clip Graph objects observed`,
            `${graph.nodesReported}/${graph.nodesObserved} bounded color node rows reported`,
            `${graph.methodEvidence.fullyObservedMethods.length}/${graph.methodEvidence.checkedMethods.length} fixed graph getters behaviorally observed`
          ],
          warnings
        })
      };
    }
    if (result.view === 'versions') {
      const versions = result.versions;
      if (!versions) {
        return {
          result,
          operation: readOnlyOperation({
            workflowId: 'color.grade_version_inspect.v1',
            status: 'blocked',
            verificationStatus: 'unverified',
            checks: ['Current timeline unavailable']
          })
        };
      }
      const warnings = [
        ...(!versions.complete ? ['reader_bounded_or_incomplete'] : []),
        ...versions.methodEvidence.missingMethods.map((name) => `getter_missing:${name}`),
        ...versions.methodEvidence.failedMethods.map((name) => `getter_failed:${name}`),
        ...versions.unverified.map((key) => `unverified:${key}`)
      ];
      return {
        result,
        operation: readOnlyOperation({
          workflowId: 'color.grade_version_inspect.v1',
          status: warnings.length ? 'partial' : 'success',
          verificationStatus: warnings.length ? 'partial' : 'passed',
          verificationLevel: 'API_READBACK',
          checks: [
            `Timeline ${versions.timeline.id} grade versions observed across ${versions.tracksScanned}/${versions.videoTrackCount} VIDEO tracks`,
            `${versions.itemsScanned}/${versions.videoItemsObserved} VIDEO TimelineItems inspected`,
            `${versions.methodEvidence.fullyObservedMethods.length}/${versions.methodEvidence.checkedMethods.length} fixed version getters observed across probed items`,
            'Version ordering, cross-type name identity, Color Group versions, rendered pixels and version writes were not claimed'
          ],
          warnings
        })
      };
    }
    const summary = result.summary;
    const warnings = summary
      ? [
          ...(!summary.complete ? ['reader_bounded'] : []),
          ...summary.unverified.map((key) => `unverified:${key}`)
        ]
      : [];
    return {
      result,
      operation: readOnlyOperation({
        workflowId: 'color.pipeline_inspect.v1',
        status: !summary ? 'blocked' : warnings.length ? 'partial' : 'success',
        verificationStatus: !summary ? 'unverified' : warnings.length ? 'partial' : 'passed',
        verificationLevel: summary ? 'API_READBACK' : undefined,
        checks: [summary ? `${summary.videoItemsScanned} color items inspected` : 'Color pipeline unavailable'],
        warnings
      })
    };
  }

  if (result.target === 'fairlight') {
    if (result.view === 'clip_processing') {
      const processing = result.clipProcessing;
      if (!processing) {
        return {
          result,
          operation: readOnlyOperation({
            workflowId: 'fairlight.clip_processing_inspect.v1',
            status: 'blocked',
            verificationStatus: 'unverified',
            checks: ['Current timeline unavailable']
          })
        };
      }
      const contradictions = processing.items.filter((item) => item.voiceConsistency === 'contradiction').length;
      const warnings = [
        ...(!processing.complete ? ['reader_bounded_or_incomplete'] : []),
        ...processing.methodEvidence.missingMethods.map((name) => `getter_missing:${name}`),
        ...processing.methodEvidence.failedMethods.map((name) => `getter_failed:${name}`),
        ...(contradictions > 0 ? [`voice_isolation_contradictions:${contradictions}`] : []),
        ...processing.unverified.map((key) => `unverified:${key}`)
      ];
      return {
        result,
        operation: readOnlyOperation({
          workflowId: 'fairlight.clip_processing_inspect.v1',
          status: warnings.length ? 'partial' : 'success',
          verificationStatus: warnings.length ? 'partial' : 'passed',
          verificationLevel: 'API_READBACK',
          checks: [
            `Timeline ${processing.timeline.id} audio processing inspected`,
            `${processing.itemsScanned}/${processing.audioItemsObserved} AUDIO TimelineItems inspected`,
            `${processing.methodEvidence.fullyObservedMethods.length}/${processing.methodEvidence.checkedMethods.length} fixed item getters observed`,
            'Automation, clip effects, rendered audio and processing writes were not claimed'
          ],
          warnings
        })
      };
    }
    const summary = result.summary;
    const warnings = summary
      ? [
          ...(!summary.complete ? ['reader_bounded'] : []),
          ...summary.unverified.map((key) => `unverified:${key}`)
        ]
      : [];
    return {
      result,
      operation: readOnlyOperation({
        workflowId: 'fairlight.mapping_inspect.v1',
        status: !summary ? 'blocked' : warnings.length ? 'partial' : 'success',
        verificationStatus: !summary ? 'unverified' : warnings.length ? 'partial' : 'passed',
        verificationLevel: summary ? 'STRUCTURAL_READBACK' : undefined,
        checks: [summary ? `${summary.audioTrackCount} audio tracks inspected` : 'Fairlight mapping unavailable'],
        warnings
      })
    };
  }

  if (result.target === 'deliver') {
    const settings = result.settings;
    const capabilities = result.capabilities;
    const warnings = [
      ...(!capabilities?.complete ? ['capability_matrix_bounded_or_unavailable'] : []),
      ...(settings?.unverified ?? []).map((key) => `unverified:${key}`)
    ];
    const blocked = !settings || !capabilities;
    return {
      result,
      operation: readOnlyOperation({
        workflowId: 'deliver.settings_inspect.v1',
        status: blocked ? 'blocked' : warnings.length ? 'partial' : 'success',
        verificationStatus: blocked ? 'unverified' : warnings.length ? 'partial' : 'passed',
        verificationLevel: blocked ? undefined : 'API_READBACK',
        checks: [
          capabilities ? `${capabilities.videoFormatCount} video formats observed` : 'Render capability matrix unavailable',
          settings ? `${settings.renderJobCountObserved} render queue jobs observed` : 'Render settings evidence unavailable'
        ],
        warnings
      })
    };
  }

  const preflight = result.preflight;
  const operationStatus: ProtectedOperation['status'] = preflight.status === 'pass'
    ? 'success'
    : preflight.status === 'blocked'
      ? 'blocked'
      : 'partial';
  const verificationStatus: ProtectedOperation['verification']['status'] = preflight.status === 'pass'
    ? 'passed'
    : preflight.status === 'blocked' || preflight.status === 'unverified'
      ? 'unverified'
      : 'partial';
  return {
    result,
    operation: readOnlyOperation({
      workflowId: 'project.preflight.v1',
      status: operationStatus,
      verificationStatus,
      verificationLevel: verificationStatus === 'unverified' ? undefined : 'STRUCTURAL_READBACK',
      checks: preflight.checks.map((check) => `${check.id}:${check.status}`),
      warnings: [...preflight.warnings, ...preflight.capabilityGaps]
    })
  };
}

export async function callWorkflowTool(
  broker: ResolveClient,
  snapshot: ResolveBrokerSnapshot,
  name: string,
  args: Record<string, unknown>,
  audit: readonly WorkflowAuditEntry[] = []
): Promise<CallToolResult> {
  if (name === 'status') {
    if (Object.keys(args).length > 0) throw new Error('status does not accept arguments');
    const status = await broker.getResolveStatus();
    const runningObserved = typeof status['running'] === 'boolean';
    return protectedTextResult({
      result: status,
      operation: readOnlyOperation({
        workflowId: 'system.connection_status.v1',
        status: runningObserved ? 'success' : 'partial',
        verificationStatus: runningObserved ? 'passed' : 'unverified',
        verificationLevel: runningObserved ? 'API_READBACK' : undefined,
        checks: [runningObserved ? 'Resolve running state observed' : 'Resolve running state unavailable']
      })
    });
  }

  if (name === 'inspect') {
    if (Object.keys(args).some((key) => key !== 'target' && key !== 'profile' && key !== 'itemId' && key !== 'view')) throw new Error('inspect received an unsupported argument');
    const target = args['target'];
    if (target !== 'connection' && target !== 'capabilities' && target !== 'project' && target !== 'media' && target !== 'edit' && target !== 'fusion'
      && target !== 'color' && target !== 'fairlight' && target !== 'deliver' && target !== 'preflight') {
      throw new Error('inspect target is not supported');
    }
    const requestedProfile = args['profile'];
    const requestedItemId = args['itemId'];
    const requestedView = args['view'];
    if (target !== 'preflight' && requestedProfile !== undefined) throw new Error('inspect profile is only supported for preflight');
    if (target !== 'media' && requestedItemId !== undefined) throw new Error('inspect itemId is only supported for media');
    if (requestedView !== undefined && requestedView !== 'link_status' && requestedView !== 'structure' && requestedView !== 'gaps_overlaps' && requestedView !== 'source_ranges' && requestedView !== 'transitions' && requestedView !== 'annotations' && requestedView !== 'graph' && requestedView !== 'versions' && requestedView !== 'audio_processing') {
      throw new Error('inspect view is not supported');
    }
    if (requestedView === 'link_status' && target !== 'media') throw new Error('inspect link_status view is only supported for media');
    if (requestedView === 'structure' && target !== 'edit') throw new Error('inspect structure view is only supported for edit');
    if (requestedView === 'gaps_overlaps' && target !== 'edit') throw new Error('inspect gaps_overlaps view is only supported for edit');
    if (requestedView === 'source_ranges' && target !== 'edit') throw new Error('inspect source_ranges view is only supported for edit');
    if (requestedView === 'transitions' && target !== 'edit') throw new Error('inspect transitions view is only supported for edit');
    if (requestedView === 'annotations' && target !== 'edit') throw new Error('inspect annotations view is only supported for edit');
    if (requestedView === 'graph' && target !== 'fusion' && target !== 'color') throw new Error('inspect graph view is only supported for fusion or color');
    if (requestedView === 'versions' && target !== 'color') throw new Error('inspect versions view is only supported for color');
    if (requestedView === 'audio_processing' && target !== 'fairlight') throw new Error('inspect audio_processing view is only supported for fairlight');
    const mediaView: 'default' | 'link_status' = requestedView === 'link_status' ? 'link_status' : 'default';
    const editView: 'default' | 'structure' | 'gaps_overlaps' | 'source_ranges' | 'transitions' | 'annotations' = requestedView === 'structure'
      ? 'structure'
      : requestedView === 'gaps_overlaps'
        ? 'gaps_overlaps'
        : requestedView === 'source_ranges'
          ? 'source_ranges'
          : requestedView === 'transitions'
            ? 'transitions'
            : requestedView === 'annotations'
              ? 'annotations'
              : 'default';
    const fusionView: 'composition' | 'graph' = requestedView === 'graph' ? 'graph' : 'composition';
    const colorView: 'pipeline' | 'graph' | 'versions' = requestedView === 'graph' ? 'graph' : requestedView === 'versions' ? 'versions' : 'pipeline';
    const fairlightView: 'mapping' | 'clip_processing' = requestedView === 'audio_processing' ? 'clip_processing' : 'mapping';
    const itemId = requestedItemId === undefined
      ? undefined
      : typeof requestedItemId === 'string' && requestedItemId.trim().length >= 1 && requestedItemId.trim().length <= 128
        ? requestedItemId.trim()
        : (() => { throw new Error('inspect media itemId is invalid'); })();
    const profile: ProjectPreflightProfile = requestedProfile === undefined
      ? 'general'
      : requestedProfile === 'general' || requestedProfile === 'media' || requestedProfile === 'edit'
        || requestedProfile === 'fusion' || requestedProfile === 'color' || requestedProfile === 'fairlight' || requestedProfile === 'delivery'
        ? requestedProfile
        : (() => { throw new Error('inspect preflight profile is not supported'); })();
    return protectedTextResult(protectedInspectResult(await inspectWorkflow(broker, snapshot, target, profile, itemId, mediaView, editView, fusionView, colorView, fairlightView)));
  }

  if (name === 'inspect_operation') {
    if (Object.keys(args).some((key) => key !== 'tool' && key !== 'workflowId')) throw new Error('inspect_operation received an unsupported argument');
    const value = args['workflowId'] ?? args['tool'];
    if (typeof value !== 'string' || value.trim().length === 0) throw new Error('inspect_operation requires a workflowId');
    const assessment = assessWorkflowOperation(value.trim());
    return protectedTextResult({
      result: assessment,
      operation: readOnlyOperation({
        workflowId: 'system.capability_snapshot.v1',
        status: assessment.riskEstablished ? 'success' : 'partial',
        verificationStatus: assessment.riskEstablished ? 'passed' : 'unverified',
        verificationLevel: assessment.riskEstablished ? 'API_READBACK' : undefined,
        checks: [assessment.riskEstablished ? 'Protected tool risk classification established' : 'Protected tool risk classification not established'],
        warnings: assessment.riskEstablished ? [] : assessment.reasons
      })
    });
  }

  if (name === 'audit') {
    if (Object.keys(args).some((key) => key !== 'limit')) throw new Error('audit received an unsupported argument');
    const requested = args['limit'];
    const limit = requested === undefined ? 10 : Number(requested);
    if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error('audit limit must be an integer from 1 to 20');
    const result = {
      entries: audit.slice(-limit).reverse(),
      count: Math.min(audit.length, limit)
    };
    return protectedTextResult({
      result,
      operation: readOnlyOperation({
        workflowId: 'activity.audit_recent.v1',
        status: 'success',
        verificationStatus: 'passed',
        verificationLevel: 'API_READBACK',
        checks: [`${result.count} audit entries returned`]
      })
    });
  }

  if (name === 'plan') {
    const workflowId = args['workflowId'];
    if (workflowId === 'edit.review_marker_add.v1') {
      if (Object.keys(args).some((key) => !['workflowId', 'target', 'targetItemId', 'frameOffset', 'color', 'name', 'note', 'duration'].includes(key))) {
        throw new Error('plan received an unsupported marker argument');
      }
      if (args['target'] !== 'timeline_item') throw new Error('plan marker target is not supported');
      const targetItemId = args['targetItemId'];
      if (typeof targetItemId !== 'string' || targetItemId.length === 0) {
        throw new Error('plan marker semantic target was not resolved to an exact TimelineItem');
      }
      const frameOffset = args['frameOffset'];
      const color = args['color'];
      const markerName = args['name'];
      const note = args['note'] ?? '';
      const duration = args['duration'] ?? 1;
      if (typeof frameOffset !== 'number' || typeof color !== 'string' || typeof markerName !== 'string' || typeof note !== 'string' || typeof duration !== 'number') {
        throw new Error('plan marker parameters are invalid');
      }
      const requested = {
        target: 'timeline_item',
        frameOffset,
        color,
        name: markerName,
        note,
        duration
      } as ReviewMarkerAddRequestedParameters;
      const result = await createReviewMarkerPlan(requested, targetItemId);
      return protectedTextResult({
        result,
        operation: readOnlyOperation({
          workflowId: 'edit.review_marker_add.v1',
          status: 'success',
          verificationStatus: 'passed',
          verificationLevel: 'API_READBACK',
          changeSetId: result.change_set.changeset_id,
          checks: ['The current semantic TimelineItem was resolved to its exact ID, then current project/timeline identity, exact target item, lock state and marker collision state were read back before plan creation'],
          warnings: ['Execution requires a separate execute(planId) call after durable local approval. Approval itself never dispatches the writer.']
        })
      });
    }
    if (workflowId === 'edit.track_add.v1') {
      if (Object.keys(args).some((key) => !['workflowId', 'target', 'trackType', 'placement'].includes(key))) {
        throw new Error('plan received an unsupported track-add argument');
      }
      if (args['target'] !== 'current_timeline') throw new Error('plan track-add target is not supported');
      if (args['trackType'] !== 'video') throw new Error('plan track-add trackType is not supported');
      if (args['placement'] !== 'append') throw new Error('plan track-add placement is not supported');
      const result = await createEditTrackAddPlan();
      return protectedTextResult({
        result,
        operation: readOnlyOperation({
          workflowId: 'edit.track_add.v1',
          status: 'success',
          verificationStatus: 'passed',
          verificationLevel: 'STRUCTURAL_READBACK',
          changeSetId: result.change_set.changeset_id,
          checks: ['Current project/timeline identity and the complete bounded timeline structure were read back and sealed into the immutable Plan fingerprint.'],
          warnings: ['Execution requires separate local exact-plan approval and a verified Class C timeline backup before AddTrack can dispatch.']
        })
      });
    }
    if (workflowId === 'color.grade_version_create.v1') {
      if (Object.keys(args).some((key) => !['workflowId', 'target', 'targetItemId', 'name'].includes(key))) {
        throw new Error('plan received an unsupported grade-version argument');
      }
      if (args['target'] !== 'timeline_item') throw new Error('plan grade-version target is not supported');
      const targetItemId = args['targetItemId'];
      const versionName = args['name'];
      if (typeof targetItemId !== 'string' || targetItemId.length === 0) {
        throw new Error('plan grade-version semantic target was not resolved to an exact TimelineItem');
      }
      if (typeof versionName !== 'string') throw new Error('plan grade-version name is invalid');
      const result = await createColorGradeVersionCreatePlan(versionName, targetItemId);
      return protectedTextResult({
        result,
        operation: readOnlyOperation({
          workflowId: 'color.grade_version_create.v1',
          status: 'success',
          verificationStatus: 'passed',
          verificationLevel: 'API_READBACK',
          changeSetId: result.change_set.changeset_id,
          checks: ['Exact current TimelineItem identity plus complete bounded LOCAL/REMOTE grade-version state and current LOCAL version were sealed into the immutable Plan fingerprint.'],
          warnings: ['Execution requires separate local exact-plan approval. The writer creates one LOCAL grade version only; switch/delete remain internal recovery operations.']
        })
      });
    }
    throw new Error('plan workflowId is not supported');
  }

  if (name === 'execute') {
    if (Object.keys(args).some((key) => key !== 'planId')) throw new Error('execute received an unsupported argument');
    const planId = args['planId'];
    if (typeof planId !== 'string' || planId.trim().length === 0) throw new Error('execute requires a planId');
    const normalizedPlanId = planId.trim();
    const projection = getWorkflowPlan(normalizedPlanId);
    if (!projection) throw new Error('Workflow plan was not found');
    const result = projection.plan.plan_kind === 'review_marker_add'
      ? await executeWorkflowPlan(normalizedPlanId)
      : projection.plan.plan_kind === 'edit_track_add'
        ? (await createTimelineDuplicateBackupForPlan(normalizedPlanId), await executeEditTrackAddPlan(normalizedPlanId))
        : projection.plan.plan_kind === 'color_grade_version_create'
          ? await executeColorGradeVersionCreatePlan(normalizedPlanId)
        : (() => { throw new Error('Protected execute is not registered for this plan kind'); })();
    return protectedTextResult({ result, operation: executionOperation(result) });
  }

  throw new Error(`Tool is not available on this connector: ${name}`);
}
