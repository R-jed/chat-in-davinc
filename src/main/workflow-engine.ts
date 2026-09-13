import { randomUUID } from 'node:crypto';
import type {
  ColorGradeVersionCreateWorkflowPlan,
  EditStructuralWorkflowPlan,
  EditTrackAddWorkflowPlan,
  LegacyReviewMarkerAddRequestedParameters,
  ReviewMarkerAddRequestedParameters,
  ReviewMarkerColor,
  ReviewMarkerWorkflowPlan,
  WorkflowApprovalRecord,
  WorkflowBackupProjection,
  WorkflowChangeSetProjection,
  WorkflowExecutionProjection,
  WorkflowLedgerEvent,
  WorkflowPlan,
  WorkflowPlanProjection,
  WorkflowPlanState
} from '../shared/types.js';
import { ResolveBrokerError } from './resolve-broker.js';
import type { ResolveClient } from './resolve-scheduler.js';
import { appendWorkflowLedgerEvent, workflowLedgerError, workflowLedgerEvents } from './workflow-ledger.js';
import { createPlanId, hashCanonicalValue, sealWorkflowPlan, verifyWorkflowPlanHash } from './workflow-plan.js';
import { getWorkflowDefinition } from './workflow-registry.js';
import { logError } from './log.js';

type WorkflowBroker = ResolveClient;
type StructuralWorkflowPlan = EditStructuralWorkflowPlan | EditTrackAddWorkflowPlan;

const PLAN_TTL_MS = 10 * 60 * 1000;
const MARKER_COLORS = new Set<ReviewMarkerColor>([
  'Blue', 'Cyan', 'Green', 'Yellow', 'Red', 'Pink', 'Purple', 'Fuchsia',
  'Rose', 'Lavender', 'Sky', 'Mint', 'Lemon', 'Sand', 'Cocoa', 'Cream'
]);

interface MarkerTargetEvidence {
  projectId: string;
  timelineId: string;
  itemId: string;
  trackType: string;
  trackIndex: number;
  trackLocked: boolean;
  itemStart: number;
  itemEnd: number;
  itemDuration: number;
  markerAtFrame: Record<string, unknown> | null;
}

interface GradeVersionTargetEvidence {
  projectId: string;
  timelineId: string;
  itemId: string;
  trackIndex: number;
  localVersions: string[];
  remoteVersions: string[];
  currentVersion: { name: string; type: 0 | 1 };
}

interface TimelineBackupPreflight {
  projectId: string;
  timelineId: string;
  timelineName: string;
  timelineNames: string[];
}

interface StructuralTimelineTrackEvidence {
  type: 'video' | 'audio' | 'subtitle';
  index: number;
  locked: boolean;
  items: Array<{
    itemId: string;
    recordStart: number | null;
    recordEnd: number | null;
    duration: number | null;
    sourceStart: number | null;
    sourceEnd: number | null;
    leftOffset: number | null;
    rightOffset: number | null;
    mediaPoolItemId: string | null;
  }>;
}

interface StructuralTimelineEvidence {
  projectId: string;
  timelineId: string;
  timelineName: string;
  startFrame: number | null;
  endFrame: number | null;
  complete: true;
  tracks: StructuralTimelineTrackEvidence[];
}

interface ProjectionRecord {
  plan: WorkflowPlan;
  state: WorkflowPlanState;
  approval: WorkflowApprovalRecord | null;
  reason: string | null;
  execution: WorkflowExecutionProjection | null;
  backup: WorkflowBackupProjection | null;
}

let broker: WorkflowBroker | null = null;
let engineError: string | null = null;
let authorityEpoch = 0;
let authorityAvailable = true;
const projections = new Map<string, ProjectionRecord>();
let executionQueue: Promise<void> = Promise.resolve();
const planMutationQueues = new Map<string, Promise<void>>();
let beforeMutationDispatchHookForTests: (() => Promise<void> | void) | null = null;

function currentAuthorityEpoch(): number {
  if (!authorityAvailable) throw new Error('Resolve authority is unavailable; fresh connection and approval are required');
  return authorityEpoch;
}

function authorityMatches(epoch: number): boolean {
  return authorityAvailable && authorityEpoch === epoch;
}

export function invalidateWorkflowAuthority(): void {
  if (!authorityAvailable) return;
  authorityEpoch += 1;
  authorityAvailable = false;
}

export function establishWorkflowAuthority(): void {
  authorityEpoch += 1;
  authorityAvailable = true;
}

export function setBeforeMutationDispatchHookForTests(hook: (() => Promise<void> | void) | null): void {
  beforeMutationDispatchHookForTests = hook;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
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

function parseStructuredScriptResult(value: unknown, label: string): Record<string, unknown> {
  const text = firstTextContent(value);
  if (!text) throw new Error(`${label} returned no text result`);
  let parsed: Record<string, unknown> | null = null;
  try { parsed = objectValue(JSON.parse(text)); } catch { /* handled below */ }
  const payload = parsed ? objectValue(parsed['result']) : null;
  if (!payload) throw new Error(`${label} returned no structured result`);
  return payload;
}

function parseScriptResult(value: unknown): Record<string, unknown> {
  return parseStructuredScriptResult(value, 'Review marker inspection');
}

function timelineBackupPreflightScript(projectId: string, timelineId: string): string {
  return `p = project
t = p.GetCurrentTimeline() if p else None
timelines = []
if p:
    count = p.GetTimelineCount() or 0
    for index in range(1, int(count) + 1):
        candidate = p.GetTimelineByIndex(index)
        if candidate is not None:
            name = candidate.GetName()
            if isinstance(name, str):
                timelines.append(name)
result = {
    "projectId": p.GetUniqueId() if p else None,
    "timelineId": t.GetUniqueId() if t else None,
    "timelineName": t.GetName() if t else None,
    "timelineNames": timelines,
    "expectedProjectId": ${JSON.stringify(projectId)},
    "expectedTimelineId": ${JSON.stringify(timelineId)}
}`;
}

function timelineBackupMutationScript(projectId: string, timelineId: string, backupName: string): string {
  return `p = project
t = p.GetCurrentTimeline() if p else None
expected_project = ${JSON.stringify(projectId)}
expected_timeline = ${JSON.stringify(timelineId)}
backup_name = ${JSON.stringify(backupName)}
result = {
    "duplicateCreated": False,
    "backupTimelineId": None,
    "backupTimelineName": None,
    "currentAfterDuplicateId": None,
    "restoreOk": False,
    "currentTimelineId": t.GetUniqueId() if t else None,
    "error": "source_identity_mismatch"
}
if p and t and p.GetUniqueId() == expected_project and t.GetUniqueId() == expected_timeline:
    names = []
    count = p.GetTimelineCount() or 0
    for index in range(1, int(count) + 1):
        candidate = p.GetTimelineByIndex(index)
        if candidate is not None:
            name = candidate.GetName()
            if isinstance(name, str):
                names.append(name)
    if backup_name in names:
        result["error"] = "backup_name_collision"
    else:
        dup = t.DuplicateTimeline(backup_name)
        if dup is None:
            result["error"] = "duplicate_failed"
        else:
            backup_id = dup.GetUniqueId()
            backup_readback_name = dup.GetName()
            current_after_duplicate = p.GetCurrentTimeline()
            current_after_duplicate_id = current_after_duplicate.GetUniqueId() if current_after_duplicate else None
            restore_ok = bool(p.SetCurrentTimeline(t))
            current_after_restore = p.GetCurrentTimeline()
            current_after_restore_id = current_after_restore.GetUniqueId() if current_after_restore else None
            result = {
                "duplicateCreated": True,
                "backupTimelineId": backup_id,
                "backupTimelineName": backup_readback_name,
                "currentAfterDuplicateId": current_after_duplicate_id,
                "restoreOk": restore_ok,
                "currentTimelineId": current_after_restore_id,
                "error": None
            }`;
}

function timelineBackupPreflight(payload: Record<string, unknown>): TimelineBackupPreflight {
  const projectId = payload['projectId'];
  const timelineId = payload['timelineId'];
  const timelineName = payload['timelineName'];
  const timelineNames = payload['timelineNames'];
  if (typeof projectId !== 'string' || projectId.length === 0) throw new Error('Timeline backup project identity is unavailable');
  if (typeof timelineId !== 'string' || timelineId.length === 0) throw new Error('Timeline backup source identity is unavailable');
  if (typeof timelineName !== 'string' || timelineName.length === 0) throw new Error('Timeline backup source name is unavailable');
  if (!Array.isArray(timelineNames) || timelineNames.some((name) => typeof name !== 'string')) {
    throw new Error('Timeline backup project timeline names are unavailable');
  }
  return { projectId, timelineId, timelineName, timelineNames: timelineNames as string[] };
}

function chooseTimelineBackupName(sourceName: string, existingNames: string[]): string {
  const names = new Set(existingNames);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `${sourceName} [CID backup ${randomUUID().slice(0, 8)}]`;
    if (!names.has(candidate)) return candidate;
  }
  throw new Error('Could not allocate a collision-free timeline backup name');
}

function finite(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Review marker target ${field} is unavailable`);
  return value;
}

function targetEvidence(payload: Record<string, unknown>): MarkerTargetEvidence {
  const requiredString = (field: string): string => {
    const value = payload[field];
    if (typeof value !== 'string' || value.length === 0) throw new Error(`Review marker target ${field} is unavailable`);
    return value;
  };
  const trackLocked = payload['trackLocked'];
  if (typeof trackLocked !== 'boolean') throw new Error('Review marker target lock state is unavailable');
  const marker = payload['markerAtFrame'];
  return {
    projectId: requiredString('projectId'),
    timelineId: requiredString('timelineId'),
    itemId: requiredString('itemId'),
    trackType: requiredString('trackType'),
    trackIndex: finite(payload['trackIndex'], 'track index'),
    trackLocked,
    itemStart: finite(payload['itemStart'], 'start'),
    itemEnd: finite(payload['itemEnd'], 'end'),
    itemDuration: finite(payload['itemDuration'], 'duration'),
    markerAtFrame: marker === null || marker === undefined ? null : objectValue(marker)
  };
}

function markerFingerprint(evidence: MarkerTargetEvidence): string {
  return hashCanonicalValue({
    projectId: evidence.projectId,
    timelineId: evidence.timelineId,
    itemId: evidence.itemId,
    trackType: evidence.trackType,
    trackIndex: evidence.trackIndex,
    trackLocked: evidence.trackLocked,
    itemStart: evidence.itemStart,
    itemEnd: evidence.itemEnd,
    itemDuration: evidence.itemDuration,
    markerAtFrame: evidence.markerAtFrame
  });
}

function gradeVersionTargetEvidence(payload: Record<string, unknown>): GradeVersionTargetEvidence {
  const requiredString = (field: string): string => {
    const value = payload[field];
    if (typeof value !== 'string' || value.length === 0) throw new Error(`Grade-version target ${field} is unavailable`);
    return value;
  };
  if (payload['complete'] !== true) throw new Error('Grade-version target exceeds bounded inspection limits');
  const trackIndex = payload['trackIndex'];
  if (typeof trackIndex !== 'number' || !Number.isInteger(trackIndex) || trackIndex < 1) {
    throw new Error('Grade-version target track index is invalid');
  }
  const local = payload['localVersions'];
  const remote = payload['remoteVersions'];
  if (!Array.isArray(local) || !Array.isArray(remote) || local.length > 64 || remote.length > 64
    || local.some((name) => typeof name !== 'string' || name.length > 128)
    || remote.some((name) => typeof name !== 'string' || name.length > 128)) {
    throw new Error('Grade-version target version lists are invalid or incomplete');
  }
  const current = objectValue(payload['currentVersion']);
  if (!current || typeof current['versionName'] !== 'string' || (current['versionType'] !== 0 && current['versionType'] !== 1)) {
    throw new Error('Grade-version target current version is unavailable');
  }
  return {
    projectId: requiredString('projectId'),
    timelineId: requiredString('timelineId'),
    itemId: requiredString('itemId'),
    trackIndex,
    localVersions: local as string[],
    remoteVersions: remote as string[],
    currentVersion: { name: current['versionName'], type: current['versionType'] }
  };
}

function gradeVersionFingerprint(evidence: GradeVersionTargetEvidence): string {
  return hashCanonicalValue({
    projectId: evidence.projectId,
    timelineId: evidence.timelineId,
    itemId: evidence.itemId,
    trackIndex: evidence.trackIndex,
    localVersions: [...evidence.localVersions].sort(),
    remoteVersions: [...evidence.remoteVersions].sort(),
    currentVersion: evidence.currentVersion
  });
}

function gradeVersionTargetScript(
  itemId: string,
  expected?: { projectId: string; timelineId: string; trackIndex: number }
): string {
  return `p = project
t = p.GetCurrentTimeline() if p else None
target_id = ${JSON.stringify(itemId)}
expected_project = ${expected ? JSON.stringify(expected.projectId) : 'None'}
expected_timeline = ${expected ? JSON.stringify(expected.timelineId) : 'None'}
expected_track = ${expected ? expected.trackIndex : 'None'}
item = None
track_index = None
items_seen = 0
complete = True
identity_ok = bool(p and t) and (expected_project is None or p.GetUniqueId() == expected_project) and (expected_timeline is None or t.GetUniqueId() == expected_timeline)
if identity_ok:
    track_count = int(t.GetTrackCount("video") or 0)
    if track_count > 64:
        complete = False
    else:
        indices = [expected_track] if expected_track is not None else range(1, track_count + 1)
        for index in indices:
            if index is None or index < 1 or index > track_count:
                complete = False
                break
            rows = t.GetItemListInTrack("video", int(index)) or []
            items_seen += len(rows)
            if items_seen > 2000:
                complete = False
                item = None
                break
            for candidate in rows:
                if candidate.GetUniqueId() == target_id:
                    item = candidate
                    track_index = int(index)
                    break
            if item:
                break
local_versions = item.GetVersionNameList(0) if item else None
remote_versions = item.GetVersionNameList(1) if item else None
current_version = item.GetCurrentVersion() if item else None
if not isinstance(local_versions, list) or not isinstance(remote_versions, list) or len(local_versions) > 64 or len(remote_versions) > 64:
    complete = False
result = None if not (identity_ok and item and track_index) else {
    "projectId": p.GetUniqueId(),
    "timelineId": t.GetUniqueId(),
    "itemId": item.GetUniqueId(),
    "trackIndex": track_index,
    "localVersions": local_versions,
    "remoteVersions": remote_versions,
    "currentVersion": current_version,
    "complete": complete
}`;
}

async function inspectGradeVersionTarget(
  itemId: string,
  expected?: { projectId: string; timelineId: string; trackIndex: number }
): Promise<GradeVersionTargetEvidence> {
  if (!broker) throw new Error('Workflow engine is not initialized');
  return gradeVersionTargetEvidence(parseStructuredScriptResult(await broker.callTool('run_script', {
    script: gradeVersionTargetScript(itemId, expected),
    timeout: 10
  }, 12_000), 'Grade-version target inspection'));
}

function nullableFinite(value: unknown, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Structural timeline ${field} is unavailable`);
  return value;
}

function structuralTimelineEvidence(payload: Record<string, unknown>): StructuralTimelineEvidence {
  const requiredString = (field: string): string => {
    const value = payload[field];
    if (typeof value !== 'string' || value.length === 0) throw new Error(`Structural timeline ${field} is unavailable`);
    return value;
  };
  const rawTracks = payload['tracks'];
  if (!Array.isArray(rawTracks)) throw new Error('Structural timeline tracks are unavailable');
  if (payload['complete'] !== true) throw new Error('Structural timeline exceeds bounded Plan fingerprint limits');
  const tracks = rawTracks.map((value, trackOffset): StructuralTimelineTrackEvidence => {
    const track = objectValue(value);
    if (!track) throw new Error(`Structural timeline track ${trackOffset + 1} is invalid`);
    const type = track['type'];
    const index = track['index'];
    const locked = track['locked'];
    const rawItems = track['items'];
    if (type !== 'video' && type !== 'audio' && type !== 'subtitle') throw new Error('Structural timeline track type is invalid');
    if (typeof index !== 'number' || !Number.isInteger(index) || index < 1) throw new Error('Structural timeline track index is invalid');
    if (typeof locked !== 'boolean') throw new Error('Structural timeline track lock state is unavailable');
    if (!Array.isArray(rawItems)) throw new Error('Structural timeline track items are unavailable');
    const items = rawItems.map((itemValue, itemOffset) => {
      const item = objectValue(itemValue);
      if (!item) throw new Error(`Structural timeline item ${itemOffset + 1} is invalid`);
      const itemId = item['itemId'];
      const mediaPoolItemId = item['mediaPoolItemId'];
      if (typeof itemId !== 'string' || itemId.length === 0) throw new Error('Structural timeline item identity is unavailable');
      if (mediaPoolItemId !== null && mediaPoolItemId !== undefined && (typeof mediaPoolItemId !== 'string' || mediaPoolItemId.length === 0)) {
        throw new Error('Structural timeline media pool identity is invalid');
      }
      return {
        itemId,
        recordStart: nullableFinite(item['recordStart'], 'record start'),
        recordEnd: nullableFinite(item['recordEnd'], 'record end'),
        duration: nullableFinite(item['duration'], 'duration'),
        sourceStart: nullableFinite(item['sourceStart'], 'source start'),
        sourceEnd: nullableFinite(item['sourceEnd'], 'source end'),
        leftOffset: nullableFinite(item['leftOffset'], 'left offset'),
        rightOffset: nullableFinite(item['rightOffset'], 'right offset'),
        mediaPoolItemId: typeof mediaPoolItemId === 'string' ? mediaPoolItemId : null
      };
    });
    return { type, index, locked, items };
  });
  return {
    projectId: requiredString('projectId'),
    timelineId: requiredString('timelineId'),
    timelineName: requiredString('timelineName'),
    startFrame: nullableFinite(payload['startFrame'], 'start frame'),
    endFrame: nullableFinite(payload['endFrame'], 'end frame'),
    complete: true,
    tracks
  };
}

function structuralTimelineFingerprint(evidence: StructuralTimelineEvidence): string {
  return hashCanonicalValue({
    projectId: evidence.projectId,
    timelineId: evidence.timelineId,
    startFrame: evidence.startFrame,
    endFrame: evidence.endFrame,
    tracks: evidence.tracks
  });
}

function structuralTimelineScript(plan: Pick<StructuralWorkflowPlan, 'project_unique_id' | 'timeline_unique_id'> | null): string {
  return `p = project
t = p.GetCurrentTimeline() if p else None
expected_project = ${plan ? JSON.stringify(plan.project_unique_id) : 'None'}
expected_timeline = ${plan ? JSON.stringify(plan.timeline_unique_id) : 'None'}
tracks = []
complete = True
items_seen = 0
identity_ok = bool(p and t) and (expected_project is None or p.GetUniqueId() == expected_project) and (expected_timeline is None or t.GetUniqueId() == expected_timeline)
if identity_ok:
    for track_type in ("video", "audio", "subtitle"):
        if not complete:
            break
        track_count = t.GetTrackCount(track_type) or 0
        for track_index in range(1, int(track_count) + 1):
            if len(tracks) >= 64:
                complete = False
                break
            item_rows = []
            raw_items = t.GetItemListInTrack(track_type, track_index) or []
            if items_seen + len(raw_items) > 2000:
                complete = False
                break
            for item in raw_items:
                media_item = item.GetMediaPoolItem()
                item_rows.append({
                    "itemId": item.GetUniqueId(),
                    "recordStart": item.GetStart(),
                    "recordEnd": item.GetEnd(),
                    "duration": item.GetDuration(),
                    "sourceStart": item.GetSourceStartFrame(),
                    "sourceEnd": item.GetSourceEndFrame(),
                    "leftOffset": item.GetLeftOffset(),
                    "rightOffset": item.GetRightOffset(),
                    "mediaPoolItemId": media_item.GetUniqueId() if media_item else None
                })
            items_seen += len(item_rows)
            tracks.append({
                "type": track_type,
                "index": track_index,
                "locked": bool(t.GetIsTrackLocked(track_type, track_index)),
                "items": item_rows
            })
result = None if not identity_ok else {
    "projectId": p.GetUniqueId(),
    "timelineId": t.GetUniqueId(),
    "timelineName": t.GetName(),
    "startFrame": t.GetStartFrame(),
    "endFrame": t.GetEndFrame(),
    "complete": complete,
    "tracks": tracks
}`;
}

function editTrackAddWriterScript(plan: EditTrackAddWorkflowPlan): string {
  const expectedFingerprint = JSON.stringify(plan.input_fingerprint);
  const expectedVideoTrackCount = plan.preconditions.video_track_count_before;
  const expectedNewTrackIndex = plan.preconditions.expected_new_track_index;
  return `import hashlib
import json
p = project
t = p.GetCurrentTimeline() if p else None
expected_project = ${JSON.stringify(plan.project_unique_id)}
expected_timeline = ${JSON.stringify(plan.timeline_unique_id)}
expected_fingerprint = ${expectedFingerprint}
expected_video_count = ${expectedVideoTrackCount}
expected_new_index = ${expectedNewTrackIndex}

def norm_number(value):
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return value

def snapshot(timeline):
    tracks = []
    items_seen = 0
    for track_type in ("video", "audio", "subtitle"):
        track_count = timeline.GetTrackCount(track_type) or 0
        for track_index in range(1, int(track_count) + 1):
            if len(tracks) >= 64:
                return None
            item_rows = []
            raw_items = timeline.GetItemListInTrack(track_type, track_index) or []
            if items_seen + len(raw_items) > 2000:
                return None
            for item in raw_items:
                media_item = item.GetMediaPoolItem()
                item_rows.append({
                    "itemId": item.GetUniqueId(),
                    "recordStart": norm_number(item.GetStart()),
                    "recordEnd": norm_number(item.GetEnd()),
                    "duration": norm_number(item.GetDuration()),
                    "sourceStart": norm_number(item.GetSourceStartFrame()),
                    "sourceEnd": norm_number(item.GetSourceEndFrame()),
                    "leftOffset": norm_number(item.GetLeftOffset()),
                    "rightOffset": norm_number(item.GetRightOffset()),
                    "mediaPoolItemId": media_item.GetUniqueId() if media_item else None
                })
            items_seen += len(item_rows)
            tracks.append({
                "type": track_type,
                "index": track_index,
                "locked": bool(timeline.GetIsTrackLocked(track_type, track_index)),
                "items": item_rows
            })
    return {
        "projectId": p.GetUniqueId(),
        "timelineId": timeline.GetUniqueId(),
        "startFrame": norm_number(timeline.GetStartFrame()),
        "endFrame": norm_number(timeline.GetEndFrame()),
        "tracks": tracks
    }

identity_ok = bool(p and t) and p.GetUniqueId() == expected_project and t.GetUniqueId() == expected_timeline
before_count = int(t.GetTrackCount("video") or 0) if identity_ok else -1
before_snapshot = snapshot(t) if identity_ok else None
before_json = json.dumps(before_snapshot, sort_keys=True, separators=(",", ":"), ensure_ascii=False) if before_snapshot is not None else ""
before_fingerprint = hashlib.sha256(before_json.encode("utf-8")).hexdigest() if before_json else None
precondition_ok = identity_ok and before_count == expected_video_count and before_fingerprint == expected_fingerprint
add_ok = bool(t.AddTrack("video")) if precondition_ok else False
after_count = int(t.GetTrackCount("video") or 0) if identity_ok else -1
new_items = (t.GetItemListInTrack("video", expected_new_index) or []) if identity_ok and after_count >= expected_new_index else []
result = {
    "preconditionOk": precondition_ok,
    "addOk": add_ok,
    "beforeVideoTrackCount": before_count,
    "afterVideoTrackCount": after_count,
    "newTrackIndex": expected_new_index,
    "newTrackItemCount": len(new_items),
    "beforeFingerprint": before_fingerprint
}`;
}

function currentTargetScript(frameOffset: number): string {
  return `p = project
t = p.GetCurrentTimeline() if p else None
item = t.GetCurrentVideoItem() if t else None
track = item.GetTrackTypeAndIndex() if item else None
markers = item.GetMarkers() if item else None
frame = ${frameOffset}
result = None if not (p and t and item and track and len(track) >= 2) else {
    "projectId": p.GetUniqueId(),
    "timelineId": t.GetUniqueId(),
    "itemId": item.GetUniqueId(),
    "trackType": str(track[0]),
    "trackIndex": int(track[1]),
    "trackLocked": bool(t.GetIsTrackLocked(str(track[0]), int(track[1]))),
    "itemStart": item.GetStart(),
    "itemEnd": item.GetEnd(),
    "itemDuration": item.GetDuration(),
    "markerAtFrame": (markers or {}).get(frame)
}`;
}

function requestedTargetScript(itemId: string, frameOffset: number): string {
  return `p = project
t = p.GetCurrentTimeline() if p else None
target_id = ${JSON.stringify(itemId)}
frame = ${frameOffset}
item = None
track_index = None
items_seen = 0
if p and t:
    track_count = int(t.GetTrackCount("video") or 0)
    if track_count <= 64:
        for index in range(1, track_count + 1):
            rows = t.GetItemListInTrack("video", index) or []
            items_seen += len(rows)
            if items_seen > 2000:
                item = None
                track_index = None
                break
            for candidate in rows:
                if candidate.GetUniqueId() == target_id:
                    item = candidate
                    track_index = index
                    break
            if item:
                break
markers = item.GetMarkers() if item else None
result = None if not (p and t and item and track_index) else {
    "projectId": p.GetUniqueId(),
    "timelineId": t.GetUniqueId(),
    "itemId": item.GetUniqueId(),
    "trackType": "video",
    "trackIndex": int(track_index),
    "trackLocked": bool(t.GetIsTrackLocked("video", int(track_index))),
    "itemStart": item.GetStart(),
    "itemEnd": item.GetEnd(),
    "itemDuration": item.GetDuration(),
    "markerAtFrame": (markers or {}).get(frame)
}`;
}

function exactTargetScript(plan: ReviewMarkerWorkflowPlan): string {
  const itemId = JSON.stringify(plan.target_ids[0]);
  const projectId = JSON.stringify(plan.project_unique_id);
  const timelineId = JSON.stringify(plan.timeline_unique_id);
  const trackType = JSON.stringify(plan.preconditions.track_type);
  const trackIndex = plan.preconditions.track_index;
  const frameOffset = plan.requested_parameters.frameOffset;
  return `p = project
t = p.GetCurrentTimeline() if p else None
expected_project = ${projectId}
expected_timeline = ${timelineId}
target_id = ${itemId}
track_type = ${trackType}
track_index = ${trackIndex}
frame = ${frameOffset}
item = None
if p and t and p.GetUniqueId() == expected_project and t.GetUniqueId() == expected_timeline:
    for candidate in (t.GetItemListInTrack(track_type, track_index) or []):
        if candidate.GetUniqueId() == target_id:
            item = candidate
            break
markers = item.GetMarkers() if item else None
result = None if not (p and t and item) else {
    "projectId": p.GetUniqueId(),
    "timelineId": t.GetUniqueId(),
    "itemId": item.GetUniqueId(),
    "trackType": track_type,
    "trackIndex": track_index,
    "trackLocked": bool(t.GetIsTrackLocked(track_type, track_index)),
    "itemStart": item.GetStart(),
    "itemEnd": item.GetEnd(),
    "itemDuration": item.GetDuration(),
    "markerAtFrame": (markers or {}).get(frame)
}`;
}

function plannedMarker(plan: ReviewMarkerWorkflowPlan) {
  const change = plan.proposed_changes[0];
  if (!change) throw new Error('Workflow plan has no proposed marker change');
  return change;
}

function writerScript(plan: ReviewMarkerWorkflowPlan): string {
  const change = plannedMarker(plan);
  const itemId = JSON.stringify(plan.target_ids[0]);
  const projectId = JSON.stringify(plan.project_unique_id);
  const timelineId = JSON.stringify(plan.timeline_unique_id);
  const trackType = JSON.stringify(plan.preconditions.track_type);
  const trackIndex = plan.preconditions.track_index;
  const frameOffset = change.frame_offset;
  const color = JSON.stringify(change.color);
  const name = JSON.stringify(change.name);
  const note = JSON.stringify(change.note);
  const duration = change.duration;
  const customData = JSON.stringify(change.custom_data);
  return `p = project
t = p.GetCurrentTimeline() if p else None
expected_project = ${projectId}
expected_timeline = ${timelineId}
target_id = ${itemId}
track_type = ${trackType}
track_index = ${trackIndex}
frame = ${frameOffset}
item = None
if p and t and p.GetUniqueId() == expected_project and t.GetUniqueId() == expected_timeline:
    for candidate in (t.GetItemListInTrack(track_type, track_index) or []):
        if candidate.GetUniqueId() == target_id:
            item = candidate
            break
markers = item.GetMarkers() if item else {}
locked = bool(t.GetIsTrackLocked(track_type, track_index)) if t and item else True
existing_custom = item.GetMarkerByCustomData(${customData}) if item else {}
precondition_ok = bool(item) and not locked and (markers or {}).get(frame) is None and not existing_custom
add_ok = item.AddMarker(frame, ${color}, ${name}, ${note}, ${duration}, ${customData}) if precondition_ok else False
result = {
    "preconditionOk": precondition_ok,
    "addOk": bool(add_ok)
}`;
}

function verificationScript(plan: ReviewMarkerWorkflowPlan): string {
  const change = plannedMarker(plan);
  const itemId = JSON.stringify(plan.target_ids[0]);
  const projectId = JSON.stringify(plan.project_unique_id);
  const timelineId = JSON.stringify(plan.timeline_unique_id);
  const trackType = JSON.stringify(plan.preconditions.track_type);
  const trackIndex = plan.preconditions.track_index;
  const frameOffset = change.frame_offset;
  const customData = JSON.stringify(change.custom_data);
  return `p = project
t = p.GetCurrentTimeline() if p else None
expected_project = ${projectId}
expected_timeline = ${timelineId}
target_id = ${itemId}
track_type = ${trackType}
track_index = ${trackIndex}
frame = ${frameOffset}
item = None
if p and t and p.GetUniqueId() == expected_project and t.GetUniqueId() == expected_timeline:
    for candidate in (t.GetItemListInTrack(track_type, track_index) or []):
        if candidate.GetUniqueId() == target_id:
            item = candidate
            break
markers = item.GetMarkers() if item else {}
by_custom = item.GetMarkerByCustomData(${customData}) if item else {}
result = None if not item else {
    "markerAtFrame": (markers or {}).get(frame),
    "markerByCustomData": by_custom or None
}`;
}

function recoveryScript(plan: ReviewMarkerWorkflowPlan): string {
  const change = plannedMarker(plan);
  const itemId = JSON.stringify(plan.target_ids[0]);
  const projectId = JSON.stringify(plan.project_unique_id);
  const timelineId = JSON.stringify(plan.timeline_unique_id);
  const trackType = JSON.stringify(plan.preconditions.track_type);
  const trackIndex = plan.preconditions.track_index;
  const customData = JSON.stringify(change.custom_data);
  return `p = project
t = p.GetCurrentTimeline() if p else None
expected_project = ${projectId}
expected_timeline = ${timelineId}
target_id = ${itemId}
track_type = ${trackType}
track_index = ${trackIndex}
item = None
if p and t and p.GetUniqueId() == expected_project and t.GetUniqueId() == expected_timeline:
    for candidate in (t.GetItemListInTrack(track_type, track_index) or []):
        if candidate.GetUniqueId() == target_id:
            item = candidate
            break
before = item.GetMarkerByCustomData(${customData}) if item else {}
delete_ok = item.DeleteMarkerByCustomData(${customData}) if item and before else False
after = item.GetMarkerByCustomData(${customData}) if item else {}
result = {
    "hadMarker": bool(before),
    "deleteOk": bool(delete_ok),
    "markerAbsent": not bool(after)
}`;
}

async function inspectCurrentTarget(frameOffset: number): Promise<MarkerTargetEvidence> {
  if (!broker) throw new Error('Workflow engine is not initialized');
  return targetEvidence(parseScriptResult(await broker.callTool('run_script', { script: currentTargetScript(frameOffset), timeout: 10 }, 12_000)));
}

async function inspectRequestedTarget(itemId: string, frameOffset: number): Promise<MarkerTargetEvidence> {
  if (!broker) throw new Error('Workflow engine is not initialized');
  return targetEvidence(parseScriptResult(await broker.callTool('run_script', {
    script: requestedTargetScript(itemId, frameOffset),
    timeout: 10
  }, 12_000)));
}

async function inspectExactTarget(plan: ReviewMarkerWorkflowPlan): Promise<MarkerTargetEvidence> {
  if (!broker) throw new Error('Workflow engine is not initialized');
  return targetEvidence(parseScriptResult(await broker.callTool('run_script', { script: exactTargetScript(plan), timeout: 10 }, 12_000)));
}

async function inspectCurrentStructuralTimeline(): Promise<StructuralTimelineEvidence> {
  if (!broker) throw new Error('Workflow engine is not initialized');
  return structuralTimelineEvidence(parseStructuredScriptResult(
    await broker.callTool('run_script', { script: structuralTimelineScript(null), timeout: 20 }, 22_000),
    'Structural timeline inspection'
  ));
}

async function inspectStructuralTimeline(plan: StructuralWorkflowPlan): Promise<StructuralTimelineEvidence> {
  if (!broker) throw new Error('Workflow engine is not initialized');
  return structuralTimelineEvidence(parseStructuredScriptResult(
    await broker.callTool('run_script', { script: structuralTimelineScript(plan), timeout: 20 }, 22_000),
    'Structural timeline inspection'
  ));
}

function markerReadback(value: unknown): WorkflowExecutionProjection['marker_readback'] {
  const marker = objectValue(value);
  if (!marker || Object.keys(marker).length === 0) return null;
  const color = marker['color'];
  const duration = marker['duration'];
  const note = marker['note'];
  const name = marker['name'];
  const customData = marker['customData'];
  if (typeof color !== 'string' || !MARKER_COLORS.has(color as ReviewMarkerColor)
    || typeof duration !== 'number' || !Number.isInteger(duration)
    || typeof note !== 'string' || typeof name !== 'string' || typeof customData !== 'string') return null;
  return { color: color as ReviewMarkerColor, duration, note, name, customData };
}

function markerMatchesPlan(marker: WorkflowExecutionProjection['marker_readback'], plan: ReviewMarkerWorkflowPlan): boolean {
  if (!marker) return false;
  const change = plannedMarker(plan);
  return marker.color === change.color
    && marker.duration === change.duration
    && marker.note === change.note
    && marker.name === change.name
    && marker.customData === change.custom_data;
}

async function readMarkerVerification(plan: ReviewMarkerWorkflowPlan): Promise<{
  markerAtFrame: WorkflowExecutionProjection['marker_readback'];
  markerByCustomData: WorkflowExecutionProjection['marker_readback'];
}> {
  if (!broker) throw new Error('Workflow engine is not initialized');
  const payload = parseScriptResult(await broker.callTool('run_script', { script: verificationScript(plan), timeout: 10 }, 12_000));
  return {
    markerAtFrame: markerReadback(payload['markerAtFrame']),
    markerByCustomData: markerReadback(payload['markerByCustomData'])
  };
}

async function planStaleReason(plan: WorkflowPlan): Promise<string | null> {
  if (plan.plan_kind === 'review_marker_add') {
    let evidence: MarkerTargetEvidence;
    try { evidence = await inspectExactTarget(plan); }
    catch { return 'Workflow plan target no longer resolves'; }
    if (evidence.trackLocked) return 'Workflow plan target track is now locked';
    if (evidence.markerAtFrame !== null) return 'Workflow plan marker frame is no longer empty';
    if (markerFingerprint(evidence) !== plan.input_fingerprint) return 'Workflow plan target state changed after planning';
    return null;
  }
  if (plan.plan_kind === 'color_grade_version_create') {
    let evidence: GradeVersionTargetEvidence;
    try {
      evidence = await inspectGradeVersionTarget(plan.target_ids[0], {
        projectId: plan.project_unique_id,
        timelineId: plan.timeline_unique_id,
        trackIndex: plan.preconditions.track_index
      });
    } catch {
      return 'Workflow plan grade-version target no longer resolves';
    }
    if (evidence.currentVersion.type !== 0) return 'Workflow plan current grade version is no longer LOCAL';
    if (evidence.localVersions.includes(plan.requested_parameters.name) || evidence.remoteVersions.includes(plan.requested_parameters.name)) {
      return 'Workflow plan grade-version name now collides with existing version state';
    }
    if (gradeVersionFingerprint(evidence) !== plan.input_fingerprint) {
      return 'Workflow plan grade-version state changed after planning; human edits win and require a new Plan';
    }
    return null;
  }

  let evidence: StructuralTimelineEvidence;
  try { evidence = await inspectStructuralTimeline(plan); }
  catch { return 'Workflow plan structural timeline no longer resolves'; }
  if (evidence.projectId !== plan.project_unique_id || evidence.timelineId !== plan.timeline_unique_id) {
    return 'Workflow plan source project or timeline changed after planning';
  }
  if (structuralTimelineFingerprint(evidence) !== plan.input_fingerprint) {
    return 'Workflow plan timeline structure changed after planning; human edits win and require a new Plan';
  }
  return null;
}

function enqueueExecution<T>(operation: () => Promise<T>): Promise<T> {
  const run = executionQueue.then(operation, operation);
  executionQueue = run.then(() => undefined, () => undefined);
  return run;
}

function enqueuePlanMutation<T>(planId: string, operation: () => Promise<T>): Promise<T> {
  const previous = planMutationQueues.get(planId) ?? Promise.resolve();
  const run = previous.then(operation, operation);
  const tail = run.then(() => undefined, () => undefined);
  planMutationQueues.set(planId, tail);
  void tail.then(() => {
    if (planMutationQueues.get(planId) === tail) planMutationQueues.delete(planId);
  });
  return run;
}

function validateRequestedParameters<T extends ReviewMarkerAddRequestedParameters | LegacyReviewMarkerAddRequestedParameters>(value: T): T {
  if (value.target !== 'timeline_item' && value.target !== 'current_video_item') throw new Error('Review marker target is invalid');
  if (!Number.isInteger(value.frameOffset) || value.frameOffset < 0) throw new Error('Review marker frameOffset must be a non-negative integer');
  if (!MARKER_COLORS.has(value.color)) throw new Error('Review marker color is invalid');
  const name = value.name.trim();
  if (name.length < 1 || name.length > 80) throw new Error('Review marker name must be 1–80 characters');
  if (value.note.length > 500) throw new Error('Review marker note must be at most 500 characters');
  if (!Number.isInteger(value.duration) || value.duration < 1 || value.duration > 10_000) throw new Error('Review marker duration must be an integer from 1 to 10000 frames');
  return { ...value, name } as T;
}

function projectionState(record: ProjectionRecord, now = Date.now()): WorkflowPlanState {
  if ((record.state === 'ready' || record.state === 'approved') && Date.parse(record.plan.expires_at) <= now) return 'expired';
  return record.state;
}

function changeSetId(planId: string): string {
  return `changeset_${planId.startsWith('plan_') ? planId.slice(5) : planId}`;
}

function changeSetProjection(record: ProjectionRecord): WorkflowChangeSetProjection {
  const planState = projectionState(record);
  const execution = record.execution;
  const change = record.plan.plan_kind === 'review_marker_add' ? plannedMarker(record.plan) : null;
  let state: WorkflowChangeSetProjection['state'];
  if (execution) {
    state = execution.state === 'dispatch_started' || execution.state === 'dispatch_returned'
      ? 'dispatched'
      : execution.state;
  } else if (planState === 'ready') state = 'proposed';
  else if (planState === 'approved') state = 'approved';
  else if (planState === 'consumed') state = 'ambiguous';
  else state = planState;

  const readback = execution?.marker_readback ?? null;
  const structuralObservation = record.plan.plan_kind === 'edit_track_add'
    ? execution?.structural_readback ?? null
    : null;
  const gradeVersionObservation = record.plan.plan_kind === 'color_grade_version_create'
    ? execution?.state === 'recovered'
      ? {
          kind: 'grade_version_state' as const,
          name: record.plan.requested_parameters.name,
          version_type: 0 as const,
          present: false,
          current: false
        }
      : execution?.grade_version_readback
      ? {
          kind: 'grade_version_state' as const,
          name: execution.grade_version_readback.name,
          version_type: execution.grade_version_readback.version_type,
          present: execution.grade_version_readback.present,
          current: execution.grade_version_readback.current
        }
      : null
    : null;
  const actualObservation = structuralObservation
    ?? gradeVersionObservation
    ?? (change && (execution?.state === 'failed' || execution?.state === 'recovered')
    ? {
      kind: 'review_marker_state' as const,
      target_item_id: change.target_item_id,
      frame_offset: change.frame_offset,
      present: false,
      color: null,
      duration: null,
      name: null,
      note: null
    }
    : change && (execution?.state === 'verified' || execution?.state === 'contradiction') && readback
      ? {
        kind: 'review_marker_state' as const,
        target_item_id: change.target_item_id,
        frame_offset: change.frame_offset,
        present: true,
        color: readback.color,
        duration: readback.duration,
        name: readback.name,
        note: readback.note
      }
      : null);
  const verificationStatus = execution?.state === 'verified'
    ? 'passed' as const
    : execution?.state === 'failed'
      ? 'failed' as const
      : execution && ['contradiction', 'recovering', 'recovered', 'recovery_failed'].includes(execution.state)
        ? 'contradiction' as const
        : 'unverified' as const;
  const verificationLevel = execution && ['verified', 'failed', 'contradiction', 'recovering', 'recovered', 'recovery_failed'].includes(execution.state)
    ? record.plan.verification_level
    : null;
  return {
    changeset_id: changeSetId(record.plan.plan_id),
    plan_id: record.plan.plan_id,
    workflow_id: record.plan.workflow_id,
    state,
    project_unique_id: record.plan.project_unique_id,
    timeline_unique_id: record.plan.timeline_unique_id,
    target_ids: [...record.plan.target_ids],
    expected_changes: structuredClone(record.plan.proposed_changes),
    actual_observation: actualObservation,
    execution_id: execution?.execution_id ?? null,
    verification_status: verificationStatus,
    verification_level: verificationLevel,
    recovery_status: execution?.recovery_status ?? null,
    backup: record.backup ? structuredClone(record.backup) : null,
    reason: execution?.reason ?? record.reason
  };
}

function cloneProjection(record: ProjectionRecord): WorkflowPlanProjection {
  return {
    plan: structuredClone(record.plan),
    state: projectionState(record),
    approval: record.approval ? structuredClone(record.approval) : null,
    reason: record.reason,
    execution: record.execution ? structuredClone(record.execution) : null,
    backup: record.backup ? structuredClone(record.backup) : null,
    change_set: changeSetProjection(record)
  };
}

function executionFromEvent(event: WorkflowLedgerEvent, planId: string): WorkflowExecutionProjection | null {
  if (!event.execution_id) return null;
  return {
    execution_id: event.execution_id,
    plan_id: planId,
    state: 'prepared',
    writer_returned: null,
    writer_precondition_ok: null,
    marker_readback: null,
    structural_readback: null,
    grade_version_readback: null,
    reason: null,
    recovery_status: 'not_needed'
  };
}

interface ParsedPlanEvent {
  plan: WorkflowPlan;
  legacyHashVerified: boolean;
}

function legacyReviewMarkerPlanIsValid(plan: Record<string, unknown>): boolean {
  const planId = plan['plan_id'];
  const projectId = plan['project_unique_id'];
  const timelineId = plan['timeline_unique_id'];
  const inputFingerprint = plan['input_fingerprint'];
  const targetIds = plan['target_ids'];
  const requested = objectValue(plan['requested_parameters']);
  const changes = plan['proposed_changes'];
  const change = Array.isArray(changes) && changes.length === 1 ? objectValue(changes[0]) : null;
  const preconditions = objectValue(plan['preconditions']);
  const verification = objectValue(plan['verification_contract']);
  const capabilityRefs = plan['capability_evidence_refs'];
  const createdAt = plan['created_at'];
  const expiresAt = plan['expires_at'];
  const resolveVersion = plan['resolve_version'];
  if (
    typeof planId !== 'string' || planId.length === 0
    || plan['hash_algorithm'] !== 'sha256'
    || plan['canonicalization_version'] !== '1'
    || plan['workflow_version'] !== '1'
    || typeof projectId !== 'string' || projectId.length === 0
    || typeof timelineId !== 'string' || timelineId.length === 0
    || typeof inputFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(inputFingerprint)
    || typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))
    || typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))
    || Date.parse(expiresAt) <= Date.parse(createdAt)
    || Date.parse(expiresAt) - Date.parse(createdAt) !== PLAN_TTL_MS
    || typeof resolveVersion !== 'string' || !/^21\.1(?:\.|$)/.test(resolveVersion)
    || !Array.isArray(targetIds) || targetIds.length !== 1
    || typeof targetIds[0] !== 'string' || targetIds[0].length === 0
    || !requested || !change || !preconditions || !verification
  ) return false;

  const frameOffset = requested['frameOffset'];
  const color = requested['color'];
  const name = requested['name'];
  const note = requested['note'];
  const duration = requested['duration'];
  const itemDuration = preconditions['item_duration'];
  if (
    requested['target'] !== 'current_video_item'
    || typeof frameOffset !== 'number' || !Number.isInteger(frameOffset) || frameOffset < 0
    || typeof color !== 'string' || !MARKER_COLORS.has(color as ReviewMarkerColor)
    || typeof name !== 'string' || name.length < 1 || name.length > 80 || name.trim() !== name
    || typeof note !== 'string' || note.length > 500
    || typeof duration !== 'number' || !Number.isInteger(duration) || duration < 1 || duration > 10_000
    || typeof itemDuration !== 'number' || !Number.isFinite(itemDuration) || itemDuration <= 0
    || frameOffset >= itemDuration || duration > itemDuration - frameOffset
  ) return false;

  if (
    change['kind'] !== 'add_review_marker'
    || change['target_item_id'] !== targetIds[0]
    || change['frame_offset'] !== frameOffset
    || change['color'] !== color
    || change['name'] !== name
    || change['note'] !== note
    || change['duration'] !== duration
    || change['custom_data'] !== `chat-in-davinci:review-marker:${planId}`
    || preconditions['target_item_id'] !== targetIds[0]
    || preconditions['track_type'] !== 'video'
    || typeof preconditions['track_index'] !== 'number'
    || !Number.isInteger(preconditions['track_index'])
    || (preconditions['track_index'] as number) < 1
    || preconditions['track_locked'] !== false
    || typeof preconditions['item_start'] !== 'number' || !Number.isFinite(preconditions['item_start'])
    || typeof preconditions['item_end'] !== 'number' || !Number.isFinite(preconditions['item_end'])
    || preconditions['marker_frame_empty'] !== true
    || typeof preconditions['marker_state_hash'] !== 'string'
    || !/^[0-9a-f]{64}$/.test(preconditions['marker_state_hash'] as string)
  ) return false;

  if (preconditions['marker_state_hash'] !== hashCanonicalValue(null)) return false;
  const legacyFingerprint = markerFingerprint({
    projectId,
    timelineId,
    itemId: targetIds[0] as string,
    trackType: 'video',
    trackIndex: preconditions['track_index'] as number,
    trackLocked: false,
    itemStart: preconditions['item_start'] as number,
    itemEnd: preconditions['item_end'] as number,
    itemDuration,
    markerAtFrame: null
  });
  if (legacyFingerprint !== inputFingerprint) return false;

  if (
    plan['risk_level'] !== 'low'
    || plan['blast_radius'] !== 'item'
    || plan['preview_mode'] !== 'derived_plan'
    || plan['recovery_class'] !== 'B'
    || plan['required_backup'] !== false
    || plan['verification_level'] !== 'API_READBACK'
    || verification['id'] !== 'edit.review_marker_add.verify.v1'
    || verification['version'] !== '1'
  ) return false;

  const expectedCapabilities = ['resolve.sandboxed_script.read', 'edit.review_marker.read', 'edit.review_marker.write'];
  return Array.isArray(capabilityRefs)
    && capabilityRefs.length === expectedCapabilities.length
    && expectedCapabilities.every((value, index) => capabilityRefs[index] === value);
}

function reviewMarkerPlanIsValid(plan: Record<string, unknown>): boolean {
  const requested = objectValue(plan['requested_parameters']);
  if (!requested) return false;
  if (requested['target'] === 'current_video_item') return legacyReviewMarkerPlanIsValid(plan);
  if (requested['target'] !== 'timeline_item') return false;
  return legacyReviewMarkerPlanIsValid({
    ...plan,
    requested_parameters: { ...requested, target: 'current_video_item' }
  });
}

function colorGradeVersionPlanIsValid(plan: Record<string, unknown>): boolean {
  const planId = plan['plan_id'];
  const projectId = plan['project_unique_id'];
  const timelineId = plan['timeline_unique_id'];
  const inputFingerprint = plan['input_fingerprint'];
  const targetIds = plan['target_ids'];
  const requested = objectValue(plan['requested_parameters']);
  const changes = plan['proposed_changes'];
  const change = Array.isArray(changes) && changes.length === 1 ? objectValue(changes[0]) : null;
  const preconditions = objectValue(plan['preconditions']);
  const current = objectValue(preconditions?.['current_version']);
  const localVersions = preconditions?.['local_versions'];
  const remoteVersions = preconditions?.['remote_versions'];
  const verification = objectValue(plan['verification_contract']);
  const capabilities = plan['capability_evidence_refs'];
  const createdAt = plan['created_at'];
  const expiresAt = plan['expires_at'];
  if (
    typeof planId !== 'string' || planId.length === 0
    || plan['hash_algorithm'] !== 'sha256'
    || plan['canonicalization_version'] !== '1'
    || plan['workflow_version'] !== '1'
    || typeof projectId !== 'string' || projectId.length === 0
    || typeof timelineId !== 'string' || timelineId.length === 0
    || typeof inputFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(inputFingerprint)
    || typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))
    || typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))
    || Date.parse(expiresAt) - Date.parse(createdAt) !== PLAN_TTL_MS
    || typeof plan['resolve_version'] !== 'string' || !/^21\.1(?:\.|$)/.test(plan['resolve_version'] as string)
    || !Array.isArray(targetIds) || targetIds.length !== 1 || typeof targetIds[0] !== 'string' || targetIds[0].length === 0
    || !requested || !change || !preconditions || !current || !verification
    || requested['target'] !== 'timeline_item'
    || requested['version_type'] !== 0
    || typeof requested['name'] !== 'string'
    || (requested['name'] as string).trim() !== requested['name']
    || (requested['name'] as string).length < 1
    || (requested['name'] as string).length > 80
    || change['kind'] !== 'create_grade_version'
    || change['target_item_id'] !== targetIds[0]
    || change['name'] !== requested['name']
    || change['version_type'] !== 0
    || preconditions['target_item_id'] !== targetIds[0]
    || typeof preconditions['track_index'] !== 'number'
    || !Number.isInteger(preconditions['track_index'])
    || (preconditions['track_index'] as number) < 1
    || typeof current['name'] !== 'string'
    || current['name'].length === 0
    || current['type'] !== 0
    || !Array.isArray(localVersions) || !Array.isArray(remoteVersions)
    || localVersions.length > 64 || remoteVersions.length > 64
    || localVersions.some((name) => typeof name !== 'string' || name.length > 128)
    || remoteVersions.some((name) => typeof name !== 'string' || name.length > 128)
    || localVersions.filter((name) => name === current['name']).length !== 1
    || localVersions.includes(requested['name'])
    || remoteVersions.includes(requested['name'])
    || preconditions['version_state_hash'] !== inputFingerprint
    || plan['risk_level'] !== 'low'
    || plan['blast_radius'] !== 'item'
    || plan['preview_mode'] !== 'derived_plan'
    || plan['recovery_class'] !== 'B'
    || plan['required_backup'] !== false
    || plan['verification_level'] !== 'API_READBACK'
    || verification['id'] !== 'color.grade_version_create.verify.v1'
    || verification['version'] !== '1'
  ) return false;
  const fingerprint = gradeVersionFingerprint({
    projectId,
    timelineId,
    itemId: targetIds[0] as string,
    trackIndex: preconditions['track_index'] as number,
    localVersions: localVersions as string[],
    remoteVersions: remoteVersions as string[],
    currentVersion: { name: current['name'] as string, type: 0 }
  });
  if (fingerprint !== inputFingerprint) return false;
  const expectedCapabilities = ['resolve.sandboxed_script.read', 'color.grade_version.read', 'color.grade_version.write'];
  return Array.isArray(capabilities)
    && capabilities.length === expectedCapabilities.length
    && expectedCapabilities.every((value, index) => capabilities[index] === value);
}

function planFromEvent(event: WorkflowLedgerEvent): ParsedPlanEvent | null {
  const rawPlan = objectValue(event.payload['plan']);
  if (!rawPlan) return null;
  let plan = rawPlan;
  const workflowId = plan['workflow_id'];
  if (plan['plan_kind'] === undefined && workflowId === 'edit.review_marker_add.v1') {
    const planHash = plan['plan_hash'];
    if (
      typeof planHash !== 'string'
      || !legacyReviewMarkerPlanIsValid(plan)
    ) return null;
    const { plan_hash: _legacyHash, ...legacyHashable } = plan;
    if (planHash !== hashCanonicalValue(legacyHashable)) return null;
    plan = { ...plan, plan_kind: 'review_marker_add' };
    return { plan: plan as unknown as ReviewMarkerWorkflowPlan, legacyHashVerified: true };
  }
  const planKind = plan['plan_kind'];
  if (planKind === 'review_marker_add' && workflowId !== 'edit.review_marker_add.v1') return null;
  if (planKind === 'edit_structural' && workflowId !== 'edit.timeline_structural_guard.v1') return null;
  if (planKind === 'edit_track_add' && workflowId !== 'edit.track_add.v1') return null;
  if (planKind === 'color_grade_version_create' && workflowId !== 'color.grade_version_create.v1') return null;
  if (planKind !== 'review_marker_add' && planKind !== 'edit_structural' && planKind !== 'edit_track_add' && planKind !== 'color_grade_version_create') return null;
  if (planKind === 'review_marker_add' && !reviewMarkerPlanIsValid(plan)) return null;
  if (planKind === 'color_grade_version_create' && !colorGradeVersionPlanIsValid(plan)) return null;
  if (planKind === 'edit_structural' || planKind === 'edit_track_add') {
    const targetIds = plan['target_ids'];
    const preconditions = objectValue(plan['preconditions']);
    if (!Array.isArray(targetIds) || targetIds.length !== 1 || targetIds[0] !== plan['timeline_unique_id']) return null;
    if (plan['required_backup'] !== true || plan['recovery_class'] !== 'C' || plan['verification_level'] !== 'STRUCTURAL_READBACK') return null;
    if (!preconditions || preconditions['structure_fingerprint'] !== plan['input_fingerprint']) return null;
  }
  if (planKind === 'edit_track_add') {
    const requested = objectValue(plan['requested_parameters']);
    const changes = plan['proposed_changes'];
    const change = Array.isArray(changes) && changes.length === 1 ? objectValue(changes[0]) : null;
    const preconditions = objectValue(plan['preconditions']);
    const verification = objectValue(plan['verification_contract']);
    const capabilities = plan['capability_evidence_refs'];
    const createdAt = plan['created_at'];
    const expiresAt = plan['expires_at'];
    const planId = plan['plan_id'];
    const projectId = plan['project_unique_id'];
    const timelineId = plan['timeline_unique_id'];
    const inputFingerprint = plan['input_fingerprint'];
    if (
      !requested || !change || !preconditions || !verification
      || typeof planId !== 'string' || planId.length === 0
      || plan['hash_algorithm'] !== 'sha256'
      || plan['canonicalization_version'] !== '1'
      || plan['workflow_version'] !== '1'
      || typeof projectId !== 'string' || projectId.length === 0
      || typeof timelineId !== 'string' || timelineId.length === 0
      || typeof inputFingerprint !== 'string' || !/^[0-9a-f]{64}$/.test(inputFingerprint)
      || typeof createdAt !== 'string' || !Number.isFinite(Date.parse(createdAt))
      || typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))
      || Date.parse(expiresAt) <= Date.parse(createdAt)
      || Date.parse(expiresAt) - Date.parse(createdAt) !== PLAN_TTL_MS
      || typeof plan['resolve_version'] !== 'string' || !/^21\.1(?:\.|$)/.test(plan['resolve_version'] as string)
      || requested['target'] !== 'current_timeline'
      || requested['track_type'] !== 'video'
      || requested['placement'] !== 'append'
      || change['kind'] !== 'add_track'
      || change['track_type'] !== 'video'
      || change['placement'] !== 'append'
      || typeof preconditions['video_track_count_before'] !== 'number'
      || !Number.isInteger(preconditions['video_track_count_before'])
      || (preconditions['video_track_count_before'] as number) < 0
      || typeof preconditions['total_track_count_before'] !== 'number'
      || !Number.isInteger(preconditions['total_track_count_before'])
      || (preconditions['total_track_count_before'] as number) < (preconditions['video_track_count_before'] as number)
      || typeof preconditions['item_count_before'] !== 'number'
      || !Number.isInteger(preconditions['item_count_before'])
      || (preconditions['item_count_before'] as number) < 0
      || typeof preconditions['timeline_name'] !== 'string'
      || (preconditions['timeline_name'] as string).length === 0
      || typeof preconditions['expected_new_track_index'] !== 'number'
      || preconditions['expected_new_track_index'] !== (preconditions['video_track_count_before'] as number) + 1
      || change['expected_track_index'] !== preconditions['expected_new_track_index']
      || plan['risk_level'] !== 'low'
      || plan['blast_radius'] !== 'timeline'
      || plan['preview_mode'] !== 'derived_plan'
      || verification['id'] !== 'edit.track_add.verify.v1'
      || verification['version'] !== '1'
    ) return null;
    const expectedCapabilities = ['resolve.sandboxed_script.read', 'edit.timeline_structure.read', 'edit.track.write'];
    if (!Array.isArray(capabilities)
      || capabilities.length !== expectedCapabilities.length
      || !expectedCapabilities.every((value, index) => capabilities[index] === value)) return null;
  }
  return { plan: plan as unknown as WorkflowPlan, legacyHashVerified: false };
}

function isClassCStructuralPlan(plan: WorkflowPlan): plan is StructuralWorkflowPlan {
  return (plan.plan_kind === 'edit_structural' || plan.plan_kind === 'edit_track_add')
    && plan.required_backup === true
    && plan.recovery_class === 'C'
    && plan.verification_level === 'STRUCTURAL_READBACK';
}

function approvalFromEvent(event: WorkflowLedgerEvent, plan: WorkflowPlan): WorkflowApprovalRecord | null {
  const approval = objectValue(event.payload['approval']);
  if (!approval) return null;
  const approvalId = approval['approval_id'];
  const approvedAt = approval['approved_at'];
  const expiresAt = approval['expires_at'];
  if (
    typeof approvalId !== 'string'
    || approvalId.length === 0
    || event.approval_id !== approvalId
    || approval['plan_id'] !== plan.plan_id
    || approval['plan_hash'] !== plan.plan_hash
    || approval['approved_scope'] !== 'exact_plan'
    || approval['provenance'] !== 'local_renderer'
    || typeof approvedAt !== 'string'
    || !Number.isFinite(Date.parse(approvedAt))
    || typeof expiresAt !== 'string'
    || !Number.isFinite(Date.parse(expiresAt))
    || expiresAt !== plan.expires_at
    || Date.parse(approvedAt) < Date.parse(plan.created_at)
    || Date.parse(approvedAt) >= Date.parse(expiresAt)
    || event.workflow_id !== plan.workflow_id
    || event.workflow_version !== plan.workflow_version
  ) return null;
  return approval as unknown as WorkflowApprovalRecord;
}

function replay(events: WorkflowLedgerEvent[]): void {
  projections.clear();
  engineError = null;
  const pendingBackups = new Map<string, { operationId: string; sourceTimelineId: string; backupTimelineName: string }>();
  for (const event of events) {
    if (event.event_type === 'plan_created') {
      const parsedPlan = planFromEvent(event);
      const plan = parsedPlan?.plan ?? null;
      if (!plan || (!parsedPlan!.legacyHashVerified && !verifyWorkflowPlanHash(plan)) || event.plan_id !== plan.plan_id) {
        engineError = `Workflow plan ledger event is invalid: ${event.event_id}`;
        logError(engineError);
        return;
      }
      projections.set(plan.plan_id, { plan, state: 'ready', approval: null, reason: null, execution: null, backup: null });
      continue;
    }
    if (!event.plan_id) continue;
    const record = projections.get(event.plan_id);
    if (!record) continue;
    if (event.event_type === 'approval_granted') {
      const approval = approvalFromEvent(event, record.plan);
      if (!approval || approval.plan_id !== record.plan.plan_id || approval.plan_hash !== record.plan.plan_hash) {
        engineError = `Workflow approval ledger event is invalid: ${event.event_id}`;
        logError(engineError);
        return;
      }
      record.approval = approval;
      record.state = 'approved';
      record.reason = null;
    } else if (event.event_type === 'plan_rejected') {
      record.state = 'rejected';
      record.reason = typeof event.payload['reason'] === 'string' ? event.payload['reason'] : 'Plan rejected locally';
    } else if (event.event_type === 'plan_stale') {
      record.state = 'stale';
      record.reason = typeof event.payload['reason'] === 'string' ? event.payload['reason'] : 'Plan became stale';
    } else if (event.event_type === 'approval_revoked') {
      record.approval = null;
      record.state = 'ready';
      record.reason = null;
    } else if (event.event_type === 'backup_started') {
      const operationId = event.payload['backup_operation_id'];
      const sourceTimelineId = event.payload['source_timeline_id'];
      const backupTimelineName = event.payload['backup_timeline_name'];
      const approval = record.approval;
      if (
        typeof operationId !== 'string'
        || operationId.length === 0
        || typeof sourceTimelineId !== 'string'
        || sourceTimelineId !== record.plan.timeline_unique_id
        || typeof backupTimelineName !== 'string'
        || backupTimelineName.length === 0
        || !approval
        || event.approval_id !== approval.approval_id
        || !Number.isFinite(Date.parse(event.recorded_at))
        || Date.parse(event.recorded_at) < Date.parse(approval.approved_at)
        || Date.parse(event.recorded_at) >= Date.parse(approval.expires_at)
        || !isClassCStructuralPlan(record.plan)
        || record.backup
      ) {
        engineError = `Workflow backup start ledger event is invalid: ${event.event_id}`;
        logError(engineError);
        return;
      }
      const existing = pendingBackups.get(record.plan.plan_id);
      if (existing && (existing.operationId !== operationId || existing.backupTimelineName !== backupTimelineName)) {
        engineError = `Workflow backup start ledger event conflicts with existing attempt: ${event.event_id}`;
        logError(engineError);
        return;
      }
      pendingBackups.set(record.plan.plan_id, { operationId, sourceTimelineId, backupTimelineName });
    } else if (event.event_type === 'backup_cancelled') {
      const pending = pendingBackups.get(record.plan.plan_id);
      const operationId = event.payload['backup_operation_id'];
      const writerDispatched = event.payload['writer_dispatched'];
      const approval = record.approval;
      if (
        !pending
        || typeof operationId !== 'string'
        || operationId !== pending.operationId
        || writerDispatched !== false
        || !approval
        || event.approval_id !== approval.approval_id
      ) {
        engineError = `Workflow backup cancellation ledger event is invalid: ${event.event_id}`;
        logError(engineError);
        return;
      }
      pendingBackups.delete(record.plan.plan_id);
      record.approval = null;
      record.state = 'ready';
      record.reason = typeof event.payload['reason'] === 'string'
        ? event.payload['reason']
        : 'Timeline backup was cancelled before mutation dispatch.';
    } else if (event.event_type === 'backup_created') {
      const strategy = event.payload['strategy'];
      const operationId = event.payload['backup_operation_id'];
      const sourceTimelineId = event.payload['source_timeline_id'];
      const backupTimelineId = event.payload['backup_timeline_id'];
      const backupTimelineName = event.payload['backup_timeline_name'];
      const currentTimelineRestored = event.payload['current_timeline_restored'];
      const approval = record.approval;
      if (
        strategy !== 'timeline_duplicate'
        || typeof sourceTimelineId !== 'string'
        || sourceTimelineId !== record.plan.timeline_unique_id
        || typeof backupTimelineId !== 'string'
        || backupTimelineId.length === 0
        || backupTimelineId === sourceTimelineId
        || typeof backupTimelineName !== 'string'
        || backupTimelineName.length === 0
        || currentTimelineRestored !== true
        || !approval
        || event.approval_id !== approval.approval_id
        || !Number.isFinite(Date.parse(event.recorded_at))
        || Date.parse(event.recorded_at) < Date.parse(approval.approved_at)
        || Date.parse(event.recorded_at) >= Date.parse(approval.expires_at)
      ) {
        engineError = `Workflow backup ledger event is invalid: ${event.event_id}`;
        logError(engineError);
        return;
      }
      const pending = pendingBackups.get(record.plan.plan_id);
      if (!pending) {
        engineError = `Workflow backup ledger event has no durable backup start: ${event.event_id}`;
        logError(engineError);
        return;
      }
      if (
        typeof operationId !== 'string'
        || operationId !== pending.operationId
        || sourceTimelineId !== pending.sourceTimelineId
        || backupTimelineName !== pending.backupTimelineName
        || !isClassCStructuralPlan(record.plan)
      ) {
        engineError = `Workflow backup ledger event does not close the durable backup attempt: ${event.event_id}`;
        logError(engineError);
        return;
      }
      const backup: WorkflowBackupProjection = {
        strategy: 'timeline_duplicate',
        source_timeline_id: sourceTimelineId,
        backup_timeline_id: backupTimelineId,
        backup_timeline_name: backupTimelineName,
        current_timeline_restored: true,
        created_at: event.recorded_at
      };
      if (record.backup && JSON.stringify(record.backup) !== JSON.stringify(backup)) {
        engineError = `Workflow backup ledger event conflicts with existing backup: ${event.event_id}`;
        logError(engineError);
        return;
      }
      record.backup = backup;
      pendingBackups.delete(record.plan.plan_id);
    } else if (event.event_type === 'execution_prepared') {
      const execution = executionFromEvent(event, record.plan.plan_id);
      if (!execution) {
        engineError = `Workflow execution ledger event is invalid: ${event.event_id}`;
        logError(engineError);
        return;
      }
      record.execution = execution;
    } else if (event.event_type === 'dispatch_started') {
      if (record.execution && event.execution_id === record.execution.execution_id) record.execution.state = 'dispatch_started';
      record.state = 'consumed';
    } else if (event.event_type === 'dispatch_returned') {
      if (record.execution && event.execution_id === record.execution.execution_id) {
        record.execution.state = 'dispatch_returned';
        record.execution.writer_returned = typeof event.payload['writer_returned'] === 'boolean' ? event.payload['writer_returned'] : null;
        record.execution.writer_precondition_ok = typeof event.payload['writer_precondition_ok'] === 'boolean'
          ? event.payload['writer_precondition_ok']
          : null;
      }
    } else if (event.event_type === 'execution_cancelled') {
      if (
        !record.execution
        || event.execution_id !== record.execution.execution_id
        || event.payload['writer_dispatched'] !== false
        || !record.approval
        || event.approval_id !== record.approval.approval_id
      ) {
        engineError = `Workflow execution cancellation ledger event is invalid: ${event.event_id}`;
        logError(engineError);
        return;
      }
      if (record.execution && event.execution_id === record.execution.execution_id) {
        record.execution.state = 'failed';
        record.execution.reason = typeof event.payload['reason'] === 'string'
          ? event.payload['reason']
          : 'Execution was cancelled before writer dispatch.';
        record.execution.recovery_status = 'unavailable';
      }
      record.approval = null;
      record.state = 'consumed';
    } else if (event.event_type === 'verification_started') {
      if (record.execution && event.execution_id === record.execution.execution_id) record.execution.state = 'verifying';
    } else if (event.event_type === 'verification_completed') {
      if (record.execution && event.execution_id === record.execution.execution_id) {
        const status = event.payload['status'];
        if (status === 'verified' || status === 'failed' || status === 'contradiction') record.execution.state = status;
        record.execution.reason = typeof event.payload['reason'] === 'string' ? event.payload['reason'] : null;
        const marker = objectValue(event.payload['marker_readback']);
        record.execution.marker_readback = marker as WorkflowExecutionProjection['marker_readback'];
        const structural = objectValue(event.payload['structural_readback']);
        if (record.plan.plan_kind === 'edit_track_add' && status === 'verified') {
          if (
            record.execution.writer_returned !== true
            || record.execution.writer_precondition_ok !== true
            || !structural
            || structural['kind'] !== 'track_add_state'
            || structural['track_type'] !== 'video'
            || structural['track_index'] !== record.plan.preconditions.expected_new_track_index
            || structural['present'] !== true
            || structural['item_count'] !== 0
          ) {
            engineError = `Workflow structural verification ledger event is invalid: ${event.event_id}`;
            logError(engineError);
            return;
          }
        }
        record.execution.structural_readback = structural as WorkflowExecutionProjection['structural_readback'];
        const gradeVersion = objectValue(event.payload['grade_version_readback']);
        if (record.plan.plan_kind === 'color_grade_version_create' && status === 'verified') {
          if (
            !gradeVersion
            || gradeVersion['name'] !== record.plan.requested_parameters.name
            || gradeVersion['version_type'] !== 0
            || gradeVersion['present'] !== true
            || gradeVersion['current'] !== true
          ) {
            engineError = 'Workflow grade-version verification ledger event is invalid: ' + event.event_id;
            logError(engineError);
            return;
          }
        }
        record.execution.grade_version_readback = gradeVersion as WorkflowExecutionProjection['grade_version_readback'];
        if (status === 'contradiction' && !marker && !gradeVersion) record.execution.recovery_status = 'unavailable';
      }
    } else if (event.event_type === 'execution_ambiguous') {
      if (record.execution && event.execution_id === record.execution.execution_id) {
        record.execution.state = 'ambiguous';
        record.execution.reason = typeof event.payload['reason'] === 'string' ? event.payload['reason'] : 'Execution outcome is ambiguous';
        record.execution.recovery_status = 'unavailable';
      }
    } else if (event.event_type === 'recovery_started') {
      if (record.execution && event.execution_id === record.execution.execution_id) record.execution.state = 'recovering';
    } else if (event.event_type === 'recovery_completed') {
      if (record.execution && event.execution_id === record.execution.execution_id) {
        const recovered = event.payload['recovered'] === true;
        const unavailable = event.payload['unavailable'] === true;
        record.execution.state = recovered ? 'recovered' : 'recovery_failed';
        record.execution.recovery_status = recovered ? 'recovered' : unavailable ? 'unavailable' : 'failed';
        if (recovered && record.plan.plan_kind === 'color_grade_version_create') {
          record.execution.grade_version_readback = {
            name: record.plan.requested_parameters.name,
            version_type: 0,
            present: false,
            current: false
          };
        }
        const recoveryReason = typeof event.payload['reason'] === 'string' ? event.payload['reason'] : null;
        if (recoveryReason) record.execution.reason = `${record.execution.reason ?? ''} ${recoveryReason}`.trim();
      }
    }
  }
  const unresolvedBackup = pendingBackups.entries().next().value as [string, { operationId: string }] | undefined;
  if (unresolvedBackup) {
    engineError = `Workflow timeline backup outcome is ambiguous after restart for plan ${unresolvedBackup[0]} (${unresolvedBackup[1].operationId})`;
    logError(engineError);
    return;
  }
  for (const record of projections.values()) {
    if (record.execution && ['dispatch_started', 'dispatch_returned', 'verifying', 'recovering'].includes(record.execution.state)) {
      record.execution.state = 'ambiguous';
      record.execution.reason = 'App restarted after dispatch without durable terminal evidence; execution was not replayed.';
      record.state = 'consumed';
    }
  }
}

export function initWorkflowEngine(nextBroker: WorkflowBroker): void {
  broker = nextBroker;
  const ledgerFailure = workflowLedgerError();
  if (ledgerFailure) {
    engineError = ledgerFailure;
    projections.clear();
    return;
  }
  replay(workflowLedgerEvents());
}

export function workflowEngineError(): string | null { return engineError; }

function assertEngineReady(): void {
  if (engineError) throw new Error(engineError);
  if (!broker) throw new Error('Workflow engine is not initialized');
  const ledgerFailure = workflowLedgerError();
  if (ledgerFailure) throw new Error(ledgerFailure);
}

export async function createReviewMarkerPlan(
  raw: ReviewMarkerAddRequestedParameters | LegacyReviewMarkerAddRequestedParameters,
  exactTargetItemId?: string
): Promise<WorkflowPlanProjection> {
  assertEngineReady();
  const requested = validateRequestedParameters(raw);
  const definition = getWorkflowDefinition('edit.review_marker_add.v1');
  if (!definition || definition.readOnly) throw new Error('Review marker workflow is not registered for planning');
  if (definition.recoveryClass !== 'B' || definition.verificationLevel !== 'API_READBACK') {
    throw new Error('Review marker workflow runtime metadata no longer matches its Plan contract');
  }

  const planId = createPlanId();
  const evidence = requested.target === 'timeline_item'
    ? await inspectRequestedTarget(
        typeof exactTargetItemId === 'string' && exactTargetItemId.length > 0
          ? exactTargetItemId
          : (() => { throw new Error('Review marker semantic target exact ID is required'); })(),
        requested.frameOffset
      )
    : await inspectCurrentTarget(requested.frameOffset);
  if (requested.target === 'timeline_item' && evidence.itemId !== exactTargetItemId) {
    throw new Error('Review marker semantic target did not resolve to the exact requested TimelineItem');
  }
  if (evidence.trackType !== 'video') throw new Error('Current target is not a video timeline item');
  if (!Number.isInteger(evidence.trackIndex) || evidence.trackIndex < 1) throw new Error('Current target track index is invalid');
  if (evidence.trackLocked) throw new Error('Current target track is locked');
  if (requested.frameOffset >= evidence.itemDuration) throw new Error('Review marker frameOffset is outside the current item duration');
  if (requested.duration > evidence.itemDuration - requested.frameOffset) throw new Error('Review marker duration extends beyond the current item');
  if (evidence.markerAtFrame !== null) throw new Error('A marker already exists at the requested frame offset');

  const status = await broker!.getResolveStatus();
  const resolveVersion = typeof status['version'] === 'string' && /^21\.1(?:\.|$)/.test(status['version'])
    ? status['version']
    : null;
  if (!resolveVersion) throw new Error('Resolve version is unavailable or not qualified for review-marker planning');
  const created = Date.now();
  const customData = `chat-in-davinci:review-marker:${planId}`;
  const markerStateHash = hashCanonicalValue(evidence.markerAtFrame);
  const inputFingerprint = markerFingerprint(evidence);
  const plan = sealWorkflowPlan({
    plan_id: planId,
    hash_algorithm: 'sha256',
    canonicalization_version: '1',
    plan_kind: 'review_marker_add',
    workflow_id: 'edit.review_marker_add.v1',
    workflow_version: '1',
    created_at: new Date(created).toISOString(),
    expires_at: new Date(created + PLAN_TTL_MS).toISOString(),
    resolve_version: resolveVersion,
    project_unique_id: evidence.projectId,
    timeline_unique_id: evidence.timelineId,
    target_ids: [evidence.itemId],
    input_fingerprint: inputFingerprint,
    requested_parameters: requested,
    proposed_changes: [{
      kind: 'add_review_marker',
      target_item_id: evidence.itemId,
      frame_offset: requested.frameOffset,
      color: requested.color,
      name: requested.name,
      note: requested.note,
      duration: requested.duration,
      custom_data: customData
    }],
    preconditions: {
      target_item_id: evidence.itemId,
      track_type: evidence.trackType,
      track_index: evidence.trackIndex,
      track_locked: false,
      item_start: evidence.itemStart,
      item_end: evidence.itemEnd,
      item_duration: evidence.itemDuration,
      marker_frame_empty: true,
      marker_state_hash: markerStateHash
    },
    risk_level: definition.risk,
    blast_radius: definition.blastRadius,
    preview_mode: definition.previewMode,
    recovery_class: 'B',
    required_backup: false,
    verification_level: 'API_READBACK',
    verification_contract: { id: 'edit.review_marker_add.verify.v1', version: '1' },
    capability_evidence_refs: [...definition.requiredCapabilities]
  });
  await appendWorkflowLedgerEvent({
    eventType: 'plan_created',
    planId: plan.plan_id,
    workflowId: plan.workflow_id,
    workflowVersion: plan.workflow_version,
    payload: { plan },
    flush: true
  });
  const record: ProjectionRecord = { plan, state: 'ready', approval: null, reason: null, execution: null, backup: null };
  projections.set(plan.plan_id, record);
  return cloneProjection(record);
}

export async function createEditTrackAddPlan(): Promise<WorkflowPlanProjection> {
  assertEngineReady();
  const definition = getWorkflowDefinition('edit.track_add.v1');
  if (!definition || definition.readOnly) throw new Error('Track-add workflow is not registered for planning');
  if (
    definition.risk !== 'low'
    || definition.blastRadius !== 'timeline'
    || definition.approvalPolicy !== 'local_required'
    || definition.recoveryClass !== 'C'
    || definition.previewMode !== 'derived_plan'
    || definition.verificationLevel !== 'STRUCTURAL_READBACK'
  ) throw new Error('Track-add workflow runtime metadata no longer matches its Plan contract');
  const evidence = await inspectCurrentStructuralTimeline();
  const status = await broker!.getResolveStatus();
  const resolveVersion = typeof status['version'] === 'string' && /^21\.1(?:\.|$)/.test(status['version'])
    ? status['version']
    : null;
  if (!resolveVersion) throw new Error('Resolve version is unavailable or not qualified for structural track add planning');

  const videoTracks = evidence.tracks.filter((track) => track.type === 'video');
  const totalTrackCount = evidence.tracks.length;
  const itemCount = evidence.tracks.reduce((sum, track) => sum + track.items.length, 0);
  const expectedNewTrackIndex = videoTracks.length + 1;
  const inputFingerprint = structuralTimelineFingerprint(evidence);
  const created = Date.now();
  const plan = sealWorkflowPlan({
    plan_id: createPlanId(),
    hash_algorithm: 'sha256',
    canonicalization_version: '1',
    plan_kind: 'edit_track_add',
    workflow_id: 'edit.track_add.v1',
    workflow_version: '1',
    created_at: new Date(created).toISOString(),
    expires_at: new Date(created + PLAN_TTL_MS).toISOString(),
    resolve_version: resolveVersion,
    project_unique_id: evidence.projectId,
    timeline_unique_id: evidence.timelineId,
    target_ids: [evidence.timelineId],
    input_fingerprint: inputFingerprint,
    requested_parameters: {
      target: 'current_timeline',
      track_type: 'video',
      placement: 'append'
    },
    proposed_changes: [{
      kind: 'add_track',
      track_type: 'video',
      placement: 'append',
      expected_track_index: expectedNewTrackIndex
    }],
    preconditions: {
      timeline_name: evidence.timelineName,
      timeline_start_frame: evidence.startFrame,
      timeline_end_frame: evidence.endFrame,
      total_track_count_before: totalTrackCount,
      item_count_before: itemCount,
      video_track_count_before: videoTracks.length,
      expected_new_track_index: expectedNewTrackIndex,
      structure_fingerprint: inputFingerprint
    },
    risk_level: definition.risk,
    blast_radius: definition.blastRadius,
    preview_mode: definition.previewMode,
    recovery_class: 'C',
    required_backup: true,
    verification_level: 'STRUCTURAL_READBACK',
    verification_contract: { id: 'edit.track_add.verify.v1', version: '1' },
    capability_evidence_refs: [...definition.requiredCapabilities]
  });
  await appendWorkflowLedgerEvent({
    eventType: 'plan_created',
    planId: plan.plan_id,
    workflowId: plan.workflow_id,
    workflowVersion: plan.workflow_version,
    payload: { plan },
    flush: true
  });
  const record: ProjectionRecord = { plan, state: 'ready', approval: null, reason: null, execution: null, backup: null };
  projections.set(plan.plan_id, record);
  return cloneProjection(record);
}

export async function createColorGradeVersionCreatePlan(
  rawName: string,
  exactTargetItemId: string
): Promise<WorkflowPlanProjection> {
  assertEngineReady();
  const definition = getWorkflowDefinition('color.grade_version_create.v1');
  if (!definition || definition.readOnly) throw new Error('Grade-version create workflow is not registered for planning');
  if (
    definition.risk !== 'low'
    || definition.blastRadius !== 'item'
    || definition.approvalPolicy !== 'local_required'
    || definition.recoveryClass !== 'B'
    || definition.previewMode !== 'derived_plan'
    || definition.verificationLevel !== 'API_READBACK'
  ) throw new Error('Grade-version create workflow runtime metadata no longer matches its Plan contract');
  const name = rawName.trim();
  if (name.length < 1 || name.length > 80) throw new Error('Grade-version name must be 1–80 characters');
  if (typeof exactTargetItemId !== 'string' || exactTargetItemId.length === 0) {
    throw new Error('Grade-version semantic target exact ID is required');
  }
  const evidence = await inspectGradeVersionTarget(exactTargetItemId);
  if (evidence.itemId !== exactTargetItemId) throw new Error('Grade-version target did not resolve to the exact requested TimelineItem');
  if (evidence.currentVersion.type !== 0) throw new Error('Grade-version create V1 requires the current grade version to be LOCAL');
  if (evidence.localVersions.filter((value) => value === evidence.currentVersion.name).length !== 1) {
    throw new Error('Current LOCAL grade version identity is ambiguous');
  }
  if (evidence.localVersions.includes(name) || evidence.remoteVersions.includes(name)) {
    throw new Error('Grade-version name already exists in observed local or remote version state');
  }
  const status = await broker!.getResolveStatus();
  const resolveVersion = typeof status['version'] === 'string' && /^21\.1(?:\.|$)/.test(status['version'])
    ? status['version']
    : null;
  if (!resolveVersion) throw new Error('Resolve version is unavailable or not qualified for grade-version creation');
  const inputFingerprint = gradeVersionFingerprint(evidence);
  const created = Date.now();
  const plan = sealWorkflowPlan({
    plan_id: createPlanId(),
    hash_algorithm: 'sha256',
    canonicalization_version: '1',
    plan_kind: 'color_grade_version_create',
    workflow_id: 'color.grade_version_create.v1',
    workflow_version: '1',
    created_at: new Date(created).toISOString(),
    expires_at: new Date(created + PLAN_TTL_MS).toISOString(),
    resolve_version: resolveVersion,
    project_unique_id: evidence.projectId,
    timeline_unique_id: evidence.timelineId,
    target_ids: [evidence.itemId],
    input_fingerprint: inputFingerprint,
    requested_parameters: { target: 'timeline_item', name, version_type: 0 },
    proposed_changes: [{
      kind: 'create_grade_version',
      target_item_id: evidence.itemId,
      name,
      version_type: 0
    }],
    preconditions: {
      target_item_id: evidence.itemId,
      track_index: evidence.trackIndex,
      current_version: { name: evidence.currentVersion.name, type: 0 },
      local_versions: [...evidence.localVersions],
      remote_versions: [...evidence.remoteVersions],
      version_state_hash: inputFingerprint
    },
    risk_level: 'low',
    blast_radius: 'item',
    preview_mode: 'derived_plan',
    recovery_class: 'B',
    required_backup: false,
    verification_level: 'API_READBACK',
    verification_contract: { id: 'color.grade_version_create.verify.v1', version: '1' },
    capability_evidence_refs: [...definition.requiredCapabilities]
  });
  await appendWorkflowLedgerEvent({
    eventType: 'plan_created',
    planId: plan.plan_id,
    workflowId: plan.workflow_id,
    workflowVersion: plan.workflow_version,
    payload: { plan },
    flush: true
  });
  const record: ProjectionRecord = { plan, state: 'ready', approval: null, reason: null, execution: null, backup: null };
  projections.set(plan.plan_id, record);
  return cloneProjection(record);
}

export function getWorkflowPlan(planId: string): WorkflowPlanProjection | null {
  const record = projections.get(planId);
  return record ? cloneProjection(record) : null;
}

export function getRecentWorkflowPlans(limit = 10): WorkflowPlanProjection[] {
  return [...projections.values()].slice(-Math.max(1, Math.min(20, limit))).reverse().map(cloneProjection);
}

export function getRecentWorkflowPlansForScope(options: {
  projectUniqueId: string;
  timelineUniqueId: string;
  limit?: number;
}): WorkflowPlanProjection[] {
  const limit = Math.max(1, Math.min(20, options.limit ?? 10));
  return [...projections.values()]
    .filter((record) => record.plan.project_unique_id === options.projectUniqueId)
    .filter((record) => record.plan.timeline_unique_id === options.timelineUniqueId)
    .slice(-limit)
    .reverse()
    .map(cloneProjection);
}

export function getLatestWorkflowTimelineForProject(projectUniqueId: string): string | null {
  const latest = [...projections.values()]
    .reverse()
    .find((record) => record.plan.project_unique_id === projectUniqueId);
  return latest?.plan.timeline_unique_id ?? null;
}

/**
 * A local approval is authority for one continuous Resolve authority epoch only. Losing that
 * authority never deletes the Plan/history, but it durably revokes any unconsumed approval so a
 * reconnect cannot silently make an old approval executable again.
 */
export async function revokeWorkflowApprovalsForAuthorityLoss(
  reason = 'Resolve authority disconnected; fresh exact revalidation and approval are required'
): Promise<number> {
  invalidateWorkflowAuthority();
  const approvedPlanIds = [...projections.entries()]
    .filter(([, record]) => projectionState(record) === 'approved' && record.approval !== null)
    .map(([planId]) => planId);
  let revoked = 0;
  for (const planId of approvedPlanIds) {
    await enqueuePlanMutation(planId, async () => {
      const record = projections.get(planId);
      if (!record || projectionState(record) !== 'approved' || !record.approval) return null;
      const approvalId = record.approval.approval_id;
      await appendWorkflowLedgerEvent({
        eventType: 'approval_revoked',
        planId: record.plan.plan_id,
        approvalId,
        workflowId: record.plan.workflow_id,
        workflowVersion: record.plan.workflow_version,
        payload: { reason },
        flush: true
      });
      record.approval = null;
      record.state = 'ready';
      record.reason = null;
      revoked += 1;
      return null;
    });
  }
  return revoked;
}

async function cancelPreparedExecutionForAuthorityLoss(
  record: ProjectionRecord,
  approvalId: string,
  execution: WorkflowExecutionProjection
): Promise<WorkflowPlanProjection> {
  const reason = 'Resolve authority changed after the durable dispatch boundary but before the writer call; dispatch was cancelled and will not be retried.';
  await appendWorkflowLedgerEvent({
    eventType: 'execution_cancelled',
    planId: record.plan.plan_id,
    approvalId,
    executionId: execution.execution_id,
    workflowId: record.plan.workflow_id,
    workflowVersion: record.plan.workflow_version,
    payload: { reason, writer_dispatched: false },
    flush: true
  });
  execution.state = 'failed';
  execution.reason = reason;
  execution.recovery_status = 'unavailable';
  record.approval = null;
  record.state = 'consumed';
  return cloneProjection(record);
}

async function markStale(record: ProjectionRecord, reason: string): Promise<never> {
  await appendWorkflowLedgerEvent({
    eventType: 'plan_stale',
    planId: record.plan.plan_id,
    workflowId: record.plan.workflow_id,
    workflowVersion: record.plan.workflow_version,
    payload: { reason },
    flush: true
  });
  record.state = 'stale';
  record.reason = reason;
  throw new Error(reason);
}

export function revalidateWorkflowPlan(planId: string): Promise<WorkflowPlanProjection> {
  return enqueuePlanMutation(planId, async () => {
    assertEngineReady();
    const record = projections.get(planId);
    if (!record) throw new Error('Workflow plan was not found');
    const state = projectionState(record);
    if (!['ready', 'approved'].includes(state)) throw new Error(`Workflow plan cannot be revalidated because it is ${state}`);
    if (!verifyWorkflowPlanHash(record.plan)) throw new Error('Workflow plan hash verification failed');
    const staleReason = await planStaleReason(record.plan);
    if (staleReason) return await markStale(record, staleReason);
    return cloneProjection(record);
  });
}

export function grantWorkflowPlanApproval(planId: string): Promise<WorkflowPlanProjection> {
  return enqueuePlanMutation(planId, async () => {
    assertEngineReady();
    currentAuthorityEpoch();
    const record = projections.get(planId);
    if (!record) throw new Error('Workflow plan was not found');
    const state = projectionState(record);
    if (state === 'approved' && record.approval) return cloneProjection(record);
    if (state !== 'ready') throw new Error(`Workflow plan cannot be approved because it is ${state}`);
    if (!verifyWorkflowPlanHash(record.plan)) throw new Error('Workflow plan hash verification failed');
    const definition = getWorkflowDefinition(record.plan.workflow_id);
    if (!definition || definition.approvalPolicy !== 'local_required') {
      throw new Error('Workflow plan approval policy is not established');
    }
    const staleReason = await planStaleReason(record.plan);
    if (staleReason) return await markStale(record, staleReason);

    const approvedAt = new Date().toISOString();
    const approval: WorkflowApprovalRecord = {
      approval_id: `approval_${randomUUID()}`,
      plan_id: record.plan.plan_id,
      plan_hash: record.plan.plan_hash,
      approved_at: approvedAt,
      expires_at: record.plan.expires_at,
      approved_scope: 'exact_plan',
      provenance: 'local_renderer'
    };
    await appendWorkflowLedgerEvent({
      eventType: 'approval_granted',
      planId: record.plan.plan_id,
      approvalId: approval.approval_id,
      workflowId: record.plan.workflow_id,
      workflowVersion: record.plan.workflow_version,
      payload: { approval },
      flush: true
    });
    record.approval = approval;
    record.state = 'approved';
    record.reason = null;
    return cloneProjection(record);
  });
}

function approvedPlanRecordForBackup(planId: string): ProjectionRecord {
  assertEngineReady();
  const record = projections.get(planId);
  if (!record) throw new Error('Workflow plan was not found');
  const state = projectionState(record);
  if (state !== 'approved' || !record.approval) throw new Error(`Workflow plan cannot create backup because it is ${state}`);
  if (!verifyWorkflowPlanHash(record.plan)) throw new Error('Workflow plan hash verification failed');
  if (record.approval.plan_hash !== record.plan.plan_hash || record.approval.plan_id !== record.plan.plan_id) {
    throw new Error('Workflow approval does not match the exact plan hash');
  }
  if (Date.parse(record.approval.expires_at) <= Date.now()) throw new Error('Workflow approval has expired');
  if (!isClassCStructuralPlan(record.plan)) {
    throw new Error('Workflow plan does not require Class C structural timeline backup protection');
  }
  return record;
}

function executablePlanRecord(planId: string): ProjectionRecord {
  assertEngineReady();
  const record = projections.get(planId);
  if (!record) throw new Error('Workflow plan was not found');
  const state = projectionState(record);
  if (state !== 'approved' || !record.approval) throw new Error(`Workflow plan cannot execute because it is ${state}`);
  if (!verifyWorkflowPlanHash(record.plan)) throw new Error('Workflow plan hash verification failed');
  if (record.approval.plan_hash !== record.plan.plan_hash || record.approval.plan_id !== record.plan.plan_id) {
    throw new Error('Workflow approval does not match the exact plan hash');
  }
  if (Date.parse(record.approval.expires_at) <= Date.now()) throw new Error('Workflow approval has expired');
  const definition = getWorkflowDefinition(record.plan.workflow_id);
  if (!definition || definition.readOnly || definition.approvalPolicy !== 'local_required') {
    throw new Error('Workflow writer execution policy is not established');
  }
  return record;
}

async function cancelBackupForAuthorityLoss(
  record: ProjectionRecord,
  backupOperationId: string
): Promise<WorkflowPlanProjection> {
  const approvalId = record.approval?.approval_id;
  if (!approvalId) throw new Error('Workflow backup cancellation lost its exact approval authority');
  const reason = 'Resolve authority changed after the durable backup boundary but before DuplicateTimeline dispatch; backup mutation was cancelled.';
  await appendWorkflowLedgerEvent({
    eventType: 'backup_cancelled',
    planId: record.plan.plan_id,
    approvalId,
    workflowId: record.plan.workflow_id,
    workflowVersion: record.plan.workflow_version,
    payload: {
      backup_operation_id: backupOperationId,
      writer_dispatched: false,
      reason
    },
    flush: true
  });
  record.approval = null;
  record.state = 'ready';
  record.reason = reason;
  return cloneProjection(record);
}

export function createTimelineDuplicateBackupForPlan(planId: string): Promise<WorkflowPlanProjection> {
  return enqueueExecution(async () => enqueuePlanMutation(planId, async () => {
    const record = approvedPlanRecordForBackup(planId);
    const backupAuthorityEpoch = currentAuthorityEpoch();
    const staleReason = await planStaleReason(record.plan);
    if (staleReason) return await markStale(record, staleReason);
    if (record.backup) return cloneProjection(record);

    const preflight = timelineBackupPreflight(parseStructuredScriptResult(
      await broker!.callTool('run_script', {
        script: timelineBackupPreflightScript(record.plan.project_unique_id, record.plan.timeline_unique_id),
        timeout: 10
      }, 12_000),
      'Timeline backup preflight'
    ));
    if (preflight.projectId !== record.plan.project_unique_id || preflight.timelineId !== record.plan.timeline_unique_id) {
      return await markStale(record, 'Workflow plan source project or timeline changed before backup creation');
    }

    const backupTimelineName = chooseTimelineBackupName(preflight.timelineName, preflight.timelineNames);
    const backupOperationId = `backup_${randomUUID()}`;
    await appendWorkflowLedgerEvent({
      eventType: 'backup_started',
      planId: record.plan.plan_id,
      approvalId: record.approval!.approval_id,
      workflowId: record.plan.workflow_id,
      workflowVersion: record.plan.workflow_version,
      payload: {
        backup_operation_id: backupOperationId,
        strategy: 'timeline_duplicate',
        source_timeline_id: record.plan.timeline_unique_id,
        backup_timeline_name: backupTimelineName
      },
      flush: true
    });

    if (beforeMutationDispatchHookForTests) await beforeMutationDispatchHookForTests();
    if (!authorityMatches(backupAuthorityEpoch)) {
      return await cancelBackupForAuthorityLoss(record, backupOperationId);
    }

    try {
      const payload = parseStructuredScriptResult(await broker!.callTool('run_script', {
        script: timelineBackupMutationScript(record.plan.project_unique_id, record.plan.timeline_unique_id, backupTimelineName),
        timeout: 20
      }, 22_000), 'Timeline backup mutation');
      const backupTimelineId = payload['backupTimelineId'];
      const backupNameReadback = payload['backupTimelineName'];
      const currentAfterDuplicateId = payload['currentAfterDuplicateId'];
      const restoreOk = payload['restoreOk'];
      const currentTimelineId = payload['currentTimelineId'];
      if (payload['duplicateCreated'] !== true
        || typeof backupTimelineId !== 'string'
        || backupTimelineId.length === 0
        || backupTimelineId === record.plan.timeline_unique_id
        || backupNameReadback !== backupTimelineName
        || currentAfterDuplicateId !== backupTimelineId
        || restoreOk !== true
        || currentTimelineId !== record.plan.timeline_unique_id) {
        throw new Error(`Timeline backup verification failed: ${String(payload['error'] ?? 'identity_or_restore_mismatch')}`);
      }

      const event = await appendWorkflowLedgerEvent({
        eventType: 'backup_created',
        planId: record.plan.plan_id,
        approvalId: record.approval!.approval_id,
        workflowId: record.plan.workflow_id,
        workflowVersion: record.plan.workflow_version,
        payload: {
          backup_operation_id: backupOperationId,
          strategy: 'timeline_duplicate',
          source_timeline_id: record.plan.timeline_unique_id,
          backup_timeline_id: backupTimelineId,
          backup_timeline_name: backupTimelineName,
          current_timeline_restored: true
        },
        flush: true
      });
      record.backup = {
        strategy: 'timeline_duplicate',
        source_timeline_id: record.plan.timeline_unique_id,
        backup_timeline_id: backupTimelineId,
        backup_timeline_name: backupTimelineName,
        current_timeline_restored: true,
        created_at: event.recorded_at
      };
      return cloneProjection(record);
    } catch (error) {
      const detail = error instanceof ResolveBrokerError && error.ambiguous
        ? `transport outcome is ambiguous: ${error.message}`
        : error instanceof Error ? error.message : String(error);
      engineError = `Workflow timeline backup outcome is unresolved for plan ${record.plan.plan_id}: ${detail}`;
      logError(engineError);
      throw new Error(engineError);
    }
  }));
}

function verifyEditTrackAddReadback(
  plan: EditTrackAddWorkflowPlan,
  evidence: StructuralTimelineEvidence
): { verified: boolean; observation: NonNullable<WorkflowExecutionProjection['structural_readback']>; reason: string | null } {
  const expectedIndex = plan.preconditions.expected_new_track_index;
  const videoTracks = evidence.tracks.filter((track) => track.type === 'video');
  const newTrack = videoTracks.find((track) => track.index === expectedIndex) ?? null;
  const observation: NonNullable<WorkflowExecutionProjection['structural_readback']> = {
    kind: 'track_add_state',
    track_type: 'video',
    track_index: expectedIndex,
    present: newTrack !== null,
    item_count: newTrack ? newTrack.items.length : null
  };
  if (evidence.projectId !== plan.project_unique_id || evidence.timelineId !== plan.timeline_unique_id) {
    return { verified: false, observation, reason: 'Structural readback moved to a different project or timeline.' };
  }
  if (videoTracks.length !== plan.preconditions.video_track_count_before + 1) {
    return { verified: false, observation, reason: 'Video track count did not increase by exactly one.' };
  }
  if (evidence.tracks.length !== plan.preconditions.total_track_count_before + 1) {
    return { verified: false, observation, reason: 'Total track count changed by more than the approved add-track effect.' };
  }
  const itemCount = evidence.tracks.reduce((sum, track) => sum + track.items.length, 0);
  if (itemCount !== plan.preconditions.item_count_before) {
    return { verified: false, observation, reason: 'Timeline item count changed during the add-track execution.' };
  }
  if (!newTrack || newTrack.items.length !== 0) {
    return { verified: false, observation, reason: 'The expected appended video track is missing or is not empty.' };
  }
  const withoutNewTrack: StructuralTimelineEvidence = {
    ...evidence,
    tracks: evidence.tracks.filter((track) => !(track.type === 'video' && track.index === expectedIndex))
  };
  if (structuralTimelineFingerprint(withoutNewTrack) !== plan.input_fingerprint) {
    return { verified: false, observation, reason: 'Existing timeline structure changed beyond the approved empty-track addition.' };
  }
  return { verified: true, observation, reason: null };
}

function sameNames(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  const a = [...left].sort();
  const b = [...right].sort();
  return a.every((value, index) => value === b[index]);
}

function expectedGradeVersionPostState(plan: ColorGradeVersionCreateWorkflowPlan): {
  localVersions: string[];
  remoteVersions: string[];
} {
  return {
    localVersions: [...plan.preconditions.local_versions, plan.requested_parameters.name],
    remoteVersions: [...plan.preconditions.remote_versions]
  };
}

function gradeVersionWriterScript(plan: ColorGradeVersionCreateWorkflowPlan): string {
  return `p = project
t = p.GetCurrentTimeline() if p else None
expected_project = ${JSON.stringify(plan.project_unique_id)}
expected_timeline = ${JSON.stringify(plan.timeline_unique_id)}
target_id = ${JSON.stringify(plan.target_ids[0])}
track_index = ${plan.preconditions.track_index}
expected_local = ${JSON.stringify([...plan.preconditions.local_versions].sort())}
expected_remote = ${JSON.stringify([...plan.preconditions.remote_versions].sort())}
expected_current_name = ${JSON.stringify(plan.preconditions.current_version.name)}
new_name = ${JSON.stringify(plan.requested_parameters.name)}
item = None
if p and t and p.GetUniqueId() == expected_project and t.GetUniqueId() == expected_timeline:
    for candidate in (t.GetItemListInTrack("video", track_index) or []):
        if candidate.GetUniqueId() == target_id:
            item = candidate
            break
local_before = item.GetVersionNameList(0) if item else None
remote_before = item.GetVersionNameList(1) if item else None
current_before = item.GetCurrentVersion() if item else None
precondition_ok = (
    bool(item)
    and isinstance(local_before, list)
    and isinstance(remote_before, list)
    and sorted(local_before) == expected_local
    and sorted(remote_before) == expected_remote
    and isinstance(current_before, dict)
    and current_before.get("versionName") == expected_current_name
    and current_before.get("versionType") == 0
    and new_name not in local_before
    and new_name not in remote_before
)
add_ok = bool(item.AddVersion(new_name, 0)) if precondition_ok else False
result = {
    "preconditionOk": precondition_ok,
    "addOk": add_ok
}`;
}

function gradeVersionRecoveryScript(plan: ColorGradeVersionCreateWorkflowPlan): string {
  const expectedPost = expectedGradeVersionPostState(plan);
  return `p = project
t = p.GetCurrentTimeline() if p else None
expected_project = ${JSON.stringify(plan.project_unique_id)}
expected_timeline = ${JSON.stringify(plan.timeline_unique_id)}
target_id = ${JSON.stringify(plan.target_ids[0])}
track_index = ${plan.preconditions.track_index}
original_name = ${JSON.stringify(plan.preconditions.current_version.name)}
new_name = ${JSON.stringify(plan.requested_parameters.name)}
expected_post_local = ${JSON.stringify([...expectedPost.localVersions].sort())}
expected_remote = ${JSON.stringify([...expectedPost.remoteVersions].sort())}
expected_baseline_local = ${JSON.stringify([...plan.preconditions.local_versions].sort())}
item = None
if p and t and p.GetUniqueId() == expected_project and t.GetUniqueId() == expected_timeline:
    for candidate in (t.GetItemListInTrack("video", track_index) or []):
        if candidate.GetUniqueId() == target_id:
            item = candidate
            break
local_before = item.GetVersionNameList(0) if item else None
remote_before = item.GetVersionNameList(1) if item else None
current_before = item.GetCurrentVersion() if item else None
safe = (
    bool(item)
    and isinstance(local_before, list)
    and isinstance(remote_before, list)
    and sorted(local_before) == expected_post_local
    and sorted(remote_before) == expected_remote
    and local_before.count(new_name) == 1
    and local_before.count(original_name) == 1
    and isinstance(current_before, dict)
    and current_before.get("versionType") == 0
    and current_before.get("versionName") in (original_name, new_name)
)
load_ok = bool(item.LoadVersionByName(original_name, 0)) if safe else False
current_after_load = item.GetCurrentVersion() if item and load_ok else None
original_current = isinstance(current_after_load, dict) and current_after_load.get("versionName") == original_name and current_after_load.get("versionType") == 0
delete_ok = bool(item.DeleteVersionByName(new_name, 0)) if original_current else False
local_after = item.GetVersionNameList(0) if item else None
remote_after = item.GetVersionNameList(1) if item else None
current_after = item.GetCurrentVersion() if item else None
recovered = (
    delete_ok
    and isinstance(local_after, list)
    and isinstance(remote_after, list)
    and sorted(local_after) == expected_baseline_local
    and sorted(remote_after) == expected_remote
    and isinstance(current_after, dict)
    and current_after.get("versionName") == original_name
    and current_after.get("versionType") == 0
)
result = {
    "safe": safe,
    "loadOk": load_ok,
    "deleteOk": delete_ok,
    "recovered": recovered
}`;
}

function verifyGradeVersionReadback(
  plan: ColorGradeVersionCreateWorkflowPlan,
  evidence: GradeVersionTargetEvidence
): {
  verified: boolean;
  failedWithoutEffect: boolean;
  recoverable: boolean;
  observation: NonNullable<WorkflowExecutionProjection['grade_version_readback']>;
  reason: string | null;
} {
  const expectedPost = expectedGradeVersionPostState(plan);
  const candidateCount = evidence.localVersions.filter((name) => name === plan.requested_parameters.name).length;
  const present = candidateCount === 1;
  const current = evidence.currentVersion.type === 0 && evidence.currentVersion.name === plan.requested_parameters.name;
  const observation = {
    name: plan.requested_parameters.name,
    version_type: 0 as const,
    present,
    current
  };
  if (evidence.projectId !== plan.project_unique_id || evidence.timelineId !== plan.timeline_unique_id || evidence.itemId !== plan.target_ids[0]) {
    return { verified: false, failedWithoutEffect: false, recoverable: false, observation, reason: 'Grade-version readback moved to a different exact target.' };
  }
  const verified = sameNames(evidence.localVersions, expectedPost.localVersions)
    && sameNames(evidence.remoteVersions, expectedPost.remoteVersions)
    && present
    && current;
  if (verified) return { verified: true, failedWithoutEffect: false, recoverable: false, observation, reason: null };
  const failedWithoutEffect = sameNames(evidence.localVersions, plan.preconditions.local_versions)
    && sameNames(evidence.remoteVersions, plan.preconditions.remote_versions)
    && evidence.currentVersion.type === 0
    && evidence.currentVersion.name === plan.preconditions.current_version.name
    && !present;
  const recoverable = sameNames(evidence.localVersions, expectedPost.localVersions)
    && sameNames(evidence.remoteVersions, expectedPost.remoteVersions)
    && present
    && evidence.localVersions.filter((name) => name === plan.preconditions.current_version.name).length === 1
    && evidence.currentVersion.type === 0
    && (evidence.currentVersion.name === plan.preconditions.current_version.name || current);
  return {
    verified: false,
    failedWithoutEffect,
    recoverable,
    observation,
    reason: failedWithoutEffect
      ? 'The approved grade version was not created.'
      : 'Grade-version state after dispatch contradicted the approved Plan.'
  };
}

export function executeEditTrackAddPlan(planId: string): Promise<WorkflowPlanProjection> {
  return enqueueExecution(async () => {
    let record = executablePlanRecord(planId);
    const executionAuthorityEpoch = currentAuthorityEpoch();
    if (record.plan.plan_kind !== 'edit_track_add') throw new Error('Workflow plan is not an edit track-add Plan');
    if (!record.backup) throw new Error('Workflow plan requires a verified durable timeline backup before dispatch');
    const trackPlan = record.plan;
    const status = await broker!.getResolveStatus();
    const resolveVersion = typeof status['version'] === 'string' ? status['version'] : null;
    let staleReason: string | null = null;
    if (resolveVersion !== trackPlan.resolve_version || !/^21\.1(?:\.|$)/.test(resolveVersion ?? '')) {
      staleReason = 'Resolve version changed after planning or is not qualified for the track-add writer';
    } else {
      staleReason = await planStaleReason(trackPlan);
    }

    const prepared = await enqueuePlanMutation(planId, async () => {
      record = executablePlanRecord(planId);
      if (record.plan.plan_kind !== 'edit_track_add') throw new Error('Workflow plan is not an edit track-add Plan');
      if (!record.backup) throw new Error('Workflow plan requires a verified durable timeline backup before dispatch');
      if (staleReason) return await markStale(record, staleReason);

      const approvalId = record.approval!.approval_id;
      const executionId = `execution_${randomUUID()}`;
      const execution: WorkflowExecutionProjection = {
        execution_id: executionId,
        plan_id: record.plan.plan_id,
        state: 'prepared',
        writer_returned: null,
        writer_precondition_ok: null,
        marker_readback: null,
        structural_readback: null,
        grade_version_readback: null,
        reason: null,
        recovery_status: 'not_needed'
      };
      await appendWorkflowLedgerEvent({
        eventType: 'execution_prepared',
        planId: record.plan.plan_id,
        approvalId,
        executionId,
        workflowId: record.plan.workflow_id,
        workflowVersion: record.plan.workflow_version,
        payload: {
          input_fingerprint: record.plan.input_fingerprint,
          expected_track_index: record.plan.preconditions.expected_new_track_index
        }
      });
      await appendWorkflowLedgerEvent({
        eventType: 'dispatch_started',
        planId: record.plan.plan_id,
        approvalId,
        executionId,
        workflowId: record.plan.workflow_id,
        workflowVersion: record.plan.workflow_version,
        payload: { expected_track_index: record.plan.preconditions.expected_new_track_index },
        flush: true
      });
      record.execution = execution;
      record.state = 'consumed';
      execution.state = 'dispatch_started';
      return { approvalId, execution };
    });
    const { approvalId, execution } = prepared;
    const executionId = execution.execution_id;

    if (beforeMutationDispatchHookForTests) await beforeMutationDispatchHookForTests();
    if (!authorityMatches(executionAuthorityEpoch)) {
      return await cancelPreparedExecutionForAuthorityLoss(record, approvalId, execution);
    }

    let writerPayload: Record<string, unknown> | null = null;
    try {
      writerPayload = parseStructuredScriptResult(await broker!.callTool('run_script', {
        script: editTrackAddWriterScript(trackPlan), timeout: 20
      }, 22_000), 'Edit track add writer');
    } catch (error) {
      const reason = error instanceof ResolveBrokerError && error.ambiguous
        ? `Track-add dispatch outcome is ambiguous: ${error.message}`
        : `Track-add dispatch failed without a trustworthy return: ${(error as Error).message}`;
      await appendWorkflowLedgerEvent({
        eventType: 'execution_ambiguous',
        planId: trackPlan.plan_id,
        approvalId,
        executionId,
        workflowId: trackPlan.workflow_id,
        workflowVersion: trackPlan.workflow_version,
        payload: { reason },
        flush: true
      });
      execution.state = 'ambiguous';
      execution.reason = reason;
      execution.recovery_status = 'unavailable';
      return cloneProjection(record);
    }

    const writerReturned = writerPayload['addOk'] === true;
    const writerPreconditionOk = writerPayload['preconditionOk'] === true;
    await appendWorkflowLedgerEvent({
      eventType: 'dispatch_returned',
      planId: trackPlan.plan_id,
      approvalId,
      executionId,
      workflowId: trackPlan.workflow_id,
      workflowVersion: trackPlan.workflow_version,
      payload: { writer_returned: writerReturned, writer_precondition_ok: writerPreconditionOk },
      flush: true
    });
    execution.writer_returned = writerReturned;
    execution.writer_precondition_ok = writerPreconditionOk;
    execution.state = 'dispatch_returned';

    await appendWorkflowLedgerEvent({
      eventType: 'verification_started',
      planId: trackPlan.plan_id,
      approvalId,
      executionId,
      workflowId: trackPlan.workflow_id,
      workflowVersion: trackPlan.workflow_version,
      payload: { contract: trackPlan.verification_contract },
      flush: true
    });
    execution.state = 'verifying';

    let verification: ReturnType<typeof verifyEditTrackAddReadback> | null = null;
    try {
      verification = verifyEditTrackAddReadback(trackPlan, await inspectStructuralTimeline(trackPlan));
    } catch (error) {
      const reason = `Structural readback could not be established: ${(error as Error).message}`;
      await appendWorkflowLedgerEvent({
        eventType: 'verification_completed',
        planId: trackPlan.plan_id,
        approvalId,
        executionId,
        workflowId: trackPlan.workflow_id,
        workflowVersion: trackPlan.workflow_version,
        payload: { status: 'contradiction', reason, structural_readback: null },
        flush: true
      });
      execution.state = 'contradiction';
      execution.reason = reason;
      execution.recovery_status = 'unavailable';
      return cloneProjection(record);
    }

    execution.structural_readback = verification.observation;
    const verified = writerReturned && writerPreconditionOk && verification.verified;
    const failedWithoutEffect = !writerReturned && !verification.observation.present;
    const terminalState: 'verified' | 'failed' | 'contradiction' = verified
      ? 'verified'
      : failedWithoutEffect
        ? 'failed'
        : 'contradiction';
    const reason = verified
      ? null
      : !writerPreconditionOk
        ? 'Writer-side structural fingerprint precondition rejected the dispatch; no automatic retry was attempted.'
        : verification.reason ?? (writerReturned ? 'Structural readback contradicted the approved add-track Plan.' : 'Timeline.AddTrack returned false.');
    await appendWorkflowLedgerEvent({
      eventType: 'verification_completed',
      planId: trackPlan.plan_id,
      approvalId,
      executionId,
      workflowId: trackPlan.workflow_id,
      workflowVersion: trackPlan.workflow_version,
      payload: {
        status: terminalState,
        reason,
        structural_readback: verification.observation
      },
      flush: true
    });
    execution.state = terminalState;
    execution.reason = reason;
    if (terminalState === 'contradiction') execution.recovery_status = 'unavailable';
    return cloneProjection(record);
  });
}

export function executeColorGradeVersionCreatePlan(planId: string): Promise<WorkflowPlanProjection> {
  return enqueueExecution(async () => {
    let record = executablePlanRecord(planId);
    const executionAuthorityEpoch = currentAuthorityEpoch();
    if (record.plan.plan_kind !== 'color_grade_version_create') {
      throw new Error('Workflow plan is not a Color grade-version create Plan');
    }
    const colorPlan = record.plan;
    const status = await broker!.getResolveStatus();
    const resolveVersion = typeof status['version'] === 'string' ? status['version'] : null;
    let staleReason: string | null = null;
    if (resolveVersion !== colorPlan.resolve_version || !/^21\.1(?:\.|$)/.test(resolveVersion ?? '')) {
      staleReason = 'Resolve version changed after planning or is not qualified for the grade-version writer';
    } else {
      staleReason = await planStaleReason(colorPlan);
    }

    const prepared = await enqueuePlanMutation(planId, async () => {
      record = executablePlanRecord(planId);
      if (record.plan.plan_kind !== 'color_grade_version_create') {
        throw new Error('Workflow plan is not a Color grade-version create Plan');
      }
      if (staleReason) return await markStale(record, staleReason);
      const approvalId = record.approval!.approval_id;
      const executionId = 'execution_' + randomUUID();
      const execution: WorkflowExecutionProjection = {
        execution_id: executionId,
        plan_id: record.plan.plan_id,
        state: 'prepared',
        writer_returned: null,
        writer_precondition_ok: null,
        marker_readback: null,
        structural_readback: null,
        grade_version_readback: null,
        reason: null,
        recovery_status: 'not_needed'
      };
      await appendWorkflowLedgerEvent({
        eventType: 'execution_prepared',
        planId: record.plan.plan_id,
        approvalId,
        executionId,
        workflowId: record.plan.workflow_id,
        workflowVersion: record.plan.workflow_version,
        payload: {
          input_fingerprint: record.plan.input_fingerprint,
          target_item_id: record.plan.target_ids[0],
          grade_version_name: record.plan.requested_parameters.name
        }
      });
      await appendWorkflowLedgerEvent({
        eventType: 'dispatch_started',
        planId: record.plan.plan_id,
        approvalId,
        executionId,
        workflowId: record.plan.workflow_id,
        workflowVersion: record.plan.workflow_version,
        payload: { target_item_id: record.plan.target_ids[0] },
        flush: true
      });
      record.execution = execution;
      record.state = 'consumed';
      execution.state = 'dispatch_started';
      return { approvalId, execution };
    });
    const { approvalId, execution } = prepared;
    const executionId = execution.execution_id;

    if (beforeMutationDispatchHookForTests) await beforeMutationDispatchHookForTests();
    if (!authorityMatches(executionAuthorityEpoch)) {
      return await cancelPreparedExecutionForAuthorityLoss(record, approvalId, execution);
    }

    let writerPayload: Record<string, unknown> | null = null;
    let writerError: unknown = null;
    try {
      writerPayload = parseStructuredScriptResult(await broker!.callTool('run_script', {
        script: gradeVersionWriterScript(colorPlan),
        timeout: 10
      }, 12_000), 'Grade-version create writer');
    } catch (error) {
      writerError = error;
    }
    if (writerPayload) {
      execution.writer_returned = writerPayload['addOk'] === true;
      execution.writer_precondition_ok = writerPayload['preconditionOk'] === true;
      execution.state = 'dispatch_returned';
      await appendWorkflowLedgerEvent({
        eventType: 'dispatch_returned',
        planId: colorPlan.plan_id,
        approvalId,
        executionId,
        workflowId: colorPlan.workflow_id,
        workflowVersion: colorPlan.workflow_version,
        payload: {
          writer_returned: execution.writer_returned,
          writer_precondition_ok: execution.writer_precondition_ok
        },
        flush: true
      });
    }

    await appendWorkflowLedgerEvent({
      eventType: 'verification_started',
      planId: colorPlan.plan_id,
      approvalId,
      executionId,
      workflowId: colorPlan.workflow_id,
      workflowVersion: colorPlan.workflow_version,
      payload: { contract: colorPlan.verification_contract },
      flush: true
    });
    execution.state = 'verifying';

    let verification: ReturnType<typeof verifyGradeVersionReadback>;
    try {
      const evidence = await inspectGradeVersionTarget(colorPlan.target_ids[0], {
        projectId: colorPlan.project_unique_id,
        timelineId: colorPlan.timeline_unique_id,
        trackIndex: colorPlan.preconditions.track_index
      });
      verification = verifyGradeVersionReadback(colorPlan, evidence);
    } catch (error) {
      const dispatchAmbiguous = writerError instanceof ResolveBrokerError ? writerError.ambiguous : writerError !== null;
      const reason = 'Grade-version execution outcome could not be read back'
        + (dispatchAmbiguous ? ' after a possibly dispatched writer call' : '')
        + ': ' + (error as Error).message;
      await appendWorkflowLedgerEvent({
        eventType: 'execution_ambiguous',
        planId: colorPlan.plan_id,
        approvalId,
        executionId,
        workflowId: colorPlan.workflow_id,
        workflowVersion: colorPlan.workflow_version,
        payload: { reason },
        flush: true
      });
      execution.state = 'ambiguous';
      execution.reason = reason;
      execution.recovery_status = 'unavailable';
      return cloneProjection(record);
    }

    execution.grade_version_readback = verification.observation;
    if (verification.verified) {
      const reason = writerError
        ? 'Writer transport reported an error, but exact API readback established the approved LOCAL grade version: ' + (writerError as Error).message
        : null;
      await appendWorkflowLedgerEvent({
        eventType: 'verification_completed',
        planId: colorPlan.plan_id,
        approvalId,
        executionId,
        workflowId: colorPlan.workflow_id,
        workflowVersion: colorPlan.workflow_version,
        payload: { status: 'verified', reason, grade_version_readback: verification.observation },
        flush: true
      });
      execution.state = 'verified';
      execution.reason = reason;
      return cloneProjection(record);
    }

    if (verification.failedWithoutEffect && writerPayload?.['addOk'] !== true) {
      const reason = writerError
        ? 'Writer did not establish the grade version and exact API readback confirms the baseline remains: ' + (writerError as Error).message
        : writerPayload?.['preconditionOk'] === false
          ? 'Writer-side grade-version precondition changed after dispatch was prepared; no grade version was added.'
          : verification.reason;
      await appendWorkflowLedgerEvent({
        eventType: 'verification_completed',
        planId: colorPlan.plan_id,
        approvalId,
        executionId,
        workflowId: colorPlan.workflow_id,
        workflowVersion: colorPlan.workflow_version,
        payload: { status: 'failed', reason, grade_version_readback: verification.observation },
        flush: true
      });
      execution.state = 'failed';
      execution.reason = reason;
      return cloneProjection(record);
    }

    await appendWorkflowLedgerEvent({
      eventType: 'verification_completed',
      planId: colorPlan.plan_id,
      approvalId,
      executionId,
      workflowId: colorPlan.workflow_id,
      workflowVersion: colorPlan.workflow_version,
      payload: { status: 'contradiction', reason: verification.reason, grade_version_readback: verification.observation },
      flush: true
    });
    execution.state = 'contradiction';
    execution.reason = verification.reason;
    if (!verification.recoverable) {
      execution.recovery_status = 'unavailable';
      return cloneProjection(record);
    }

    await appendWorkflowLedgerEvent({
      eventType: 'recovery_started',
      planId: colorPlan.plan_id,
      approvalId,
      executionId,
      workflowId: colorPlan.workflow_id,
      workflowVersion: colorPlan.workflow_version,
      payload: { strategy: 'LoadOriginalThenDeletePlanVersion' },
      flush: true
    });
    execution.state = 'recovering';
    if (!authorityMatches(executionAuthorityEpoch)) {
      const authorityReason = 'Resolve authority changed before Class B compensation; no recovery mutation was dispatched.';
      await appendWorkflowLedgerEvent({
        eventType: 'recovery_completed',
        planId: colorPlan.plan_id,
        approvalId,
        executionId,
        workflowId: colorPlan.workflow_id,
        workflowVersion: colorPlan.workflow_version,
        payload: { recovered: false, unavailable: true, reason: authorityReason },
        flush: true
      });
      execution.state = 'recovery_failed';
      execution.recovery_status = 'unavailable';
      execution.reason = ((execution.reason ?? '') + ' ' + authorityReason).trim();
      return cloneProjection(record);
    }
    let recovered = false;
    let recoveryReason: string | null = null;
    try {
      const recovery = parseStructuredScriptResult(await broker!.callTool('run_script', {
        script: gradeVersionRecoveryScript(colorPlan),
        timeout: 10
      }, 12_000), 'Grade-version create recovery');
      recovered = recovery['recovered'] === true;
      if (!recovered) recoveryReason = 'Class B compensation did not restore the exact approved baseline version state.';
    } catch (error) {
      recoveryReason = 'Class B compensation could not be verified: ' + (error as Error).message;
    }
    await appendWorkflowLedgerEvent({
      eventType: 'recovery_completed',
      planId: colorPlan.plan_id,
      approvalId,
      executionId,
      workflowId: colorPlan.workflow_id,
      workflowVersion: colorPlan.workflow_version,
      payload: { recovered, reason: recoveryReason },
      flush: true
    });
    execution.state = recovered ? 'recovered' : 'recovery_failed';
    execution.recovery_status = recovered ? 'recovered' : 'failed';
    if (recovered) {
      execution.grade_version_readback = {
        name: colorPlan.requested_parameters.name,
        version_type: 0,
        present: false,
        current: false
      };
    }
    if (recoveryReason) execution.reason = ((execution.reason ?? '') + ' ' + recoveryReason).trim();
    return cloneProjection(record);
  });
}

export function executeWorkflowPlan(planId: string): Promise<WorkflowPlanProjection> {
  return enqueueExecution(async () => {
    let record = executablePlanRecord(planId);
    const executionAuthorityEpoch = currentAuthorityEpoch();
    if (record.plan.required_backup === true && !record.backup) {
      throw new Error('Workflow plan requires a verified durable timeline backup before dispatch');
    }
    if (record.plan.plan_kind !== 'review_marker_add') {
      throw new Error('Workflow writer implementation is not registered for this plan kind');
    }
    const markerPlan = record.plan;
    const status = await broker!.getResolveStatus();
    const resolveVersion = typeof status['version'] === 'string' ? status['version'] : null;
    let staleReason: string | null = null;
    if (resolveVersion !== record.plan.resolve_version || !/^21\.1(?:\.|$)/.test(resolveVersion ?? '')) {
      staleReason = 'Resolve version changed after planning or is not qualified for this writer';
    }

    if (!staleReason) {
      staleReason = await planStaleReason(markerPlan);
    }

    const prepared = await enqueuePlanMutation(planId, async () => {
      record = executablePlanRecord(planId);
      if (record.plan.required_backup === true && !record.backup) {
        throw new Error('Workflow plan requires a verified durable timeline backup before dispatch');
      }
      if (record.plan.plan_kind !== 'review_marker_add') {
        throw new Error('Workflow writer implementation is not registered for this plan kind');
      }
      if (staleReason) return await markStale(record, staleReason);

      const approvalId = record.approval!.approval_id;
      const executionId = `execution_${randomUUID()}`;
      const execution: WorkflowExecutionProjection = {
        execution_id: executionId,
        plan_id: record.plan.plan_id,
        state: 'prepared',
        writer_returned: null,
        writer_precondition_ok: null,
        marker_readback: null,
        structural_readback: null,
        grade_version_readback: null,
        reason: null,
        recovery_status: 'not_needed'
      };
      await appendWorkflowLedgerEvent({
        eventType: 'execution_prepared',
        planId: record.plan.plan_id,
        approvalId,
        executionId,
        workflowId: record.plan.workflow_id,
        workflowVersion: record.plan.workflow_version,
        payload: {
          previous_marker: null,
          input_fingerprint: record.plan.input_fingerprint,
          target_item_id: record.plan.target_ids[0]
        }
      });
      await appendWorkflowLedgerEvent({
        eventType: 'dispatch_started',
        planId: record.plan.plan_id,
        approvalId,
        executionId,
        workflowId: record.plan.workflow_id,
        workflowVersion: record.plan.workflow_version,
        payload: { target_item_id: record.plan.target_ids[0] },
        flush: true
      });
      record.execution = execution;
      record.state = 'consumed';
      execution.state = 'dispatch_started';
      return { approvalId, execution };
    });
    const { approvalId, execution } = prepared;
    const executionId = execution.execution_id;

    if (beforeMutationDispatchHookForTests) await beforeMutationDispatchHookForTests();
    if (!authorityMatches(executionAuthorityEpoch)) {
      return await cancelPreparedExecutionForAuthorityLoss(record, approvalId, execution);
    }

    let writerPayload: Record<string, unknown> | null = null;
    let writerError: unknown = null;
    try {
      writerPayload = parseScriptResult(await broker!.callTool('run_script', { script: writerScript(markerPlan), timeout: 10 }, 12_000));
    } catch (error) {
      writerError = error;
    }
    if (writerPayload) {
      const writerReturned = writerPayload['addOk'] === true;
      await appendWorkflowLedgerEvent({
        eventType: 'dispatch_returned',
        planId: record.plan.plan_id,
        approvalId,
        executionId,
        workflowId: record.plan.workflow_id,
        workflowVersion: record.plan.workflow_version,
        payload: {
          writer_returned: writerReturned,
          writer_precondition_ok: writerPayload['preconditionOk'] === true
        },
        flush: true
      });
      execution.writer_returned = writerReturned;
      execution.writer_precondition_ok = writerPayload['preconditionOk'] === true;
      execution.state = 'dispatch_returned';
    }

    await appendWorkflowLedgerEvent({
      eventType: 'verification_started',
      planId: record.plan.plan_id,
      approvalId,
      executionId,
      workflowId: record.plan.workflow_id,
      workflowVersion: record.plan.workflow_version,
      payload: { contract: record.plan.verification_contract },
      flush: true
    });
    execution.state = 'verifying';

    let verification: Awaited<ReturnType<typeof readMarkerVerification>>;
    try {
      verification = await readMarkerVerification(markerPlan);
    } catch (error) {
      const dispatchAmbiguous = writerError instanceof ResolveBrokerError ? writerError.ambiguous : writerError !== null;
      const reason = `Execution outcome could not be read back${dispatchAmbiguous ? ' after a possibly dispatched writer call' : ''}: ${(error as Error).message}`;
      await appendWorkflowLedgerEvent({
        eventType: 'execution_ambiguous',
        planId: record.plan.plan_id,
        approvalId,
        executionId,
        workflowId: record.plan.workflow_id,
        workflowVersion: record.plan.workflow_version,
        payload: { reason },
        flush: true
      });
      execution.state = 'ambiguous';
      execution.reason = reason;
      execution.recovery_status = 'unavailable';
      return cloneProjection(record);
    }

    const verified = markerMatchesPlan(verification.markerByCustomData, markerPlan)
      && markerMatchesPlan(verification.markerAtFrame, markerPlan);
    if (verified) {
      const reason = writerError ? `Writer transport reported an error, but direct API readback established the requested marker: ${(writerError as Error).message}` : null;
      await appendWorkflowLedgerEvent({
        eventType: 'verification_completed',
        planId: record.plan.plan_id,
        approvalId,
        executionId,
        workflowId: record.plan.workflow_id,
        workflowVersion: record.plan.workflow_version,
        payload: {
          status: 'verified',
          reason,
          marker_readback: verification.markerByCustomData
        },
        flush: true
      });
      execution.state = 'verified';
      execution.reason = reason;
      execution.marker_readback = verification.markerByCustomData;
      return cloneProjection(record);
    }

    const markerAbsent = verification.markerAtFrame === null && verification.markerByCustomData === null;
    const writerReportedSuccess = writerPayload?.['addOk'] === true;
    if (markerAbsent && !writerReportedSuccess) {
      const reason = writerError
        ? `Writer did not establish the marker and direct API readback confirms no marker exists: ${(writerError as Error).message}`
        : writerPayload?.['preconditionOk'] === false
          ? 'Writer-side precondition changed after dispatch was prepared; no marker was added.'
          : 'Writer returned without establishing the requested marker.';
      await appendWorkflowLedgerEvent({
        eventType: 'verification_completed',
        planId: record.plan.plan_id,
        approvalId,
        executionId,
        workflowId: record.plan.workflow_id,
        workflowVersion: record.plan.workflow_version,
        payload: { status: 'failed', reason, marker_readback: null },
        flush: true
      });
      execution.state = 'failed';
      execution.reason = reason;
      execution.marker_readback = null;
      return cloneProjection(record);
    }

    const contradictionReason = writerReportedSuccess
      ? 'Resolve reported marker creation success but required API readback did not match the approved plan.'
      : 'Marker state after dispatch contradicted the approved plan.';
    await appendWorkflowLedgerEvent({
      eventType: 'verification_completed',
      planId: record.plan.plan_id,
      approvalId,
      executionId,
      workflowId: record.plan.workflow_id,
      workflowVersion: record.plan.workflow_version,
      payload: {
        status: 'contradiction',
        reason: contradictionReason,
        marker_readback: verification.markerByCustomData
      },
      flush: true
    });
    execution.state = 'contradiction';
    execution.reason = contradictionReason;
    execution.marker_readback = verification.markerByCustomData;

    if (!verification.markerByCustomData) {
      execution.recovery_status = 'unavailable';
      return cloneProjection(record);
    }

    await appendWorkflowLedgerEvent({
      eventType: 'recovery_started',
      planId: record.plan.plan_id,
      approvalId,
      executionId,
      workflowId: record.plan.workflow_id,
      workflowVersion: record.plan.workflow_version,
      payload: { strategy: 'DeleteMarkerByCustomData', custom_data: plannedMarker(markerPlan).custom_data },
      flush: true
    });
    execution.state = 'recovering';
    let recovered = false;
    let recoveryReason: string | null = null;
    try {
      const recovery = parseScriptResult(await broker!.callTool('run_script', { script: recoveryScript(markerPlan), timeout: 10 }, 12_000));
      recovered = recovery['markerAbsent'] === true;
      if (!recovered) recoveryReason = 'Compensation did not establish marker absence.';
    } catch (error) {
      recoveryReason = `Compensation could not be verified: ${(error as Error).message}`;
    }
    await appendWorkflowLedgerEvent({
      eventType: 'recovery_completed',
      planId: record.plan.plan_id,
      approvalId,
      executionId,
      workflowId: record.plan.workflow_id,
      workflowVersion: record.plan.workflow_version,
      payload: { recovered, reason: recoveryReason },
      flush: true
    });
    execution.state = recovered ? 'recovered' : 'recovery_failed';
    execution.recovery_status = recovered ? 'recovered' : 'failed';
    if (recoveryReason) execution.reason = `${execution.reason} ${recoveryReason}`;
    return cloneProjection(record);
  });
}

export function rejectWorkflowPlan(planId: string): Promise<WorkflowPlanProjection> {
  return enqueuePlanMutation(planId, async () => {
    assertEngineReady();
    const record = projections.get(planId);
    if (!record) throw new Error('Workflow plan was not found');
    const state = projectionState(record);
    if (!['ready', 'approved'].includes(state)) throw new Error(`Workflow plan cannot be rejected because it is ${state}`);
    if (!verifyWorkflowPlanHash(record.plan)) throw new Error('Workflow plan hash verification failed');
    const reason = 'Plan rejected by local user';
    await appendWorkflowLedgerEvent({
      eventType: 'plan_rejected',
      planId: record.plan.plan_id,
      workflowId: record.plan.workflow_id,
      workflowVersion: record.plan.workflow_version,
      payload: { reason },
      flush: true
    });
    record.state = 'rejected';
    record.reason = reason;
    return cloneProjection(record);
  });
}

export function resetWorkflowEngineForTests(): void {
  broker = null;
  engineError = null;
  authorityEpoch = 0;
  authorityAvailable = true;
  beforeMutationDispatchHookForTests = null;
  projections.clear();
  executionQueue = Promise.resolve();
  planMutationQueues.clear();
}
