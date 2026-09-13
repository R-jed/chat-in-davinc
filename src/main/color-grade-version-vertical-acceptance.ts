import { randomUUID } from 'node:crypto';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { recordCosBrowserEventsNow } from '../cos-host/session-runtime.js';
import { observeCosRequestCorrelationNow } from '../cos-host/identity.js';
import { readDurable, writeDurableNow } from './durable.js';
import {
  getAgentToolKernel,
  mentionAgentEntityByExactId,
  runResolveQualificationScript,
  setAgentSharedFocus,
  workflowGatewayUrlForQualification
} from './connection.js';
import { logInfo } from './log.js';
import { getWorkflowPlan, rejectWorkflowPlan } from './workflow-engine.js';
import { workflowLedgerEvents } from './workflow-ledger.js';
import { projectWorkflowPlanForRenderer } from './workflow-plan-view.js';

const TARGET_PROJECT_ID = '1c1ec3b1-c087-4e9f-864b-ee6f51e24f85';
const TARGET_TIMELINE_ID = 'de561b0e-3a89-47dc-ae7d-1aaec29dc72e';
const TARGET_ITEM_ID = '3ae6bdfb-6b71-41df-a18c-3e75f73a3b52';
const TARGET_ITEM_NAME = 'BMX 4_S-Log3 (S-Gamut3.Cine).mov';
const ACCEPTANCE_NAME = 'CID Color Vertical Acceptance 20260913 B';
const PRIOR_TIMED_OUT_PLAN_ID = 'plan_b170b092-82e4-4a61-8f41-520668b94665';
const REQUEST_PREFIX = 'wfr_color_version_vertical_';
const ACCEPTANCE_INPUT = `Create a new local grade version named ${ACCEPTANCE_NAME}.`;

interface RpcResponse extends Record<string, unknown> {}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function textFromRpc(response: RpcResponse): string {
  const result = response['result'];
  if (!result || typeof result !== 'object' || Array.isArray(result)) return '';
  const content = (result as Record<string, unknown>)['content'];
  if (!Array.isArray(content)) return '';
  return content
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item)))
    .filter((item) => item['type'] === 'text' && typeof item['text'] === 'string')
    .map((item) => item['text'] as string)
    .join('\n\n');
}

function errorFromRpc(response: RpcResponse): string | null {
  const error = response['error'];
  if (!error || typeof error !== 'object' || Array.isArray(error)) return null;
  const message = (error as Record<string, unknown>)['message'];
  return typeof message === 'string' ? message : JSON.stringify(error);
}

function decisionToken(response: RpcResponse): string {
  const match = textFromRpc(response).match(/"decisionContextToken":"([^"]+)"/);
  if (!match?.[1]) throw new Error('Product response did not provide a DecisionContext receipt');
  return match[1];
}

function planIdFromResponse(response: RpcResponse): string {
  const match = textFromRpc(response).match(/"(?:plan_id|planId)":"([^"]+)"/);
  if (!match?.[1]) throw new Error('Product plan response did not contain a plan id');
  return match[1];
}

async function rpc(productUrl: string, requestId: string, tool: string, args: Record<string, unknown>): Promise<RpcResponse> {
  const response = await fetch(productUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      'x-request-id': requestId
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: requestId,
      method: 'tools/call',
      params: { name: tool, arguments: args }
    })
  });
  if (!response.ok) throw new Error(`Product gateway HTTP ${response.status}`);
  const raw = await response.text();
  if (response.headers.get('content-type')?.includes('application/json')) return JSON.parse(raw) as RpcResponse;
  const data = raw.split('\n').find((line) => line.startsWith('data: '))?.slice(6);
  if (!data) throw new Error('Product gateway returned no MCP payload');
  return JSON.parse(data) as RpcResponse;
}

async function productCall(options: {
  productUrl: string;
  requestId: string;
  tool: string;
  args: Record<string, unknown>;
  conversationId: string;
  sessionId: string;
  turnId: string;
  messageId: string;
}): Promise<RpcResponse> {
  const correlation = await observeCosRequestCorrelationNow({
    requestId: options.requestId,
    conversationId: options.conversationId,
    sessionId: options.sessionId,
    turnId: options.turnId,
    messageId: options.messageId,
    tool: options.tool,
    observedAt: Date.now()
  });
  if (correlation === 'refused') throw new Error(`Request correlation refused for ${options.requestId}`);
  return await rpc(options.productUrl, options.requestId, options.tool, options.args);
}

async function refreshWorld(sessionId: string, turnId: string): Promise<{ handle: string; generation: number }> {
  const kernel = await getAgentToolKernel();
  const call = async (callId: string, name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
    await kernel.call({ caller: 'agent', sessionId, turnId, callId }, name, args);
  await call(`${REQUEST_PREFIX}bootstrap_status`, 'status', {});
  await call(`${REQUEST_PREFIX}bootstrap_project`, 'inspect', { target: 'project' });
  await call(`${REQUEST_PREFIX}bootstrap_versions`, 'inspect', { target: 'color', view: 'versions' });
  const focus = setAgentSharedFocus({ kind: 'timeline_item', exactId: TARGET_ITEM_ID }, 'user');
  if (focus.entity.kind !== 'timeline_item') throw new Error('Qualification focus is not a TimelineItem');
  return { handle: focus.entity.handle, generation: focus.entity.generation };
}

function setupScript(): string {
  return `pm = resolve.GetProjectManager() if resolve else None
p = pm.GetCurrentProject() if pm else None
original_timeline = p.GetCurrentTimeline() if p else None
result = {
    "projectId": p.GetUniqueId() if p else None,
    "projectName": p.GetName() if p else None,
    "originalTimelineId": original_timeline.GetUniqueId() if original_timeline else None,
    "originalTimelineName": original_timeline.GetName() if original_timeline else None,
    "targetTimelineSelected": False,
    "targetItemResolved": False,
    "targetItemName": None,
    "trackIndex": None,
    "localVersions": None,
    "remoteVersions": None,
    "currentVersion": None,
    "error": None
}
if not pm or not p or p.GetUniqueId() != ${JSON.stringify(TARGET_PROJECT_ID)}:
    result["error"] = "current_project_is_not_disposable_target"
else:
    target_timeline = None
    for index in range(1, int(p.GetTimelineCount() or 0) + 1):
        candidate = p.GetTimelineByIndex(index)
        if candidate and candidate.GetUniqueId() == ${JSON.stringify(TARGET_TIMELINE_ID)}:
            target_timeline = candidate
            break
    if not target_timeline:
        result["error"] = "target_timeline_not_found"
    elif not p.SetCurrentTimeline(target_timeline):
        result["error"] = "target_timeline_select_failed"
    else:
        result["targetTimelineSelected"] = True
        item = None
        track_index = None
        for ti in range(1, int(target_timeline.GetTrackCount("video") or 0) + 1):
            for candidate in (target_timeline.GetItemListInTrack("video", ti) or []):
                if candidate.GetUniqueId() == ${JSON.stringify(TARGET_ITEM_ID)}:
                    item = candidate
                    track_index = ti
                    break
            if item:
                break
        if not item:
            result["error"] = "target_item_not_found"
        else:
            result["targetItemResolved"] = True
            result["targetItemName"] = item.GetName()
            result["trackIndex"] = track_index
            result["localVersions"] = item.GetVersionNameList(0)
            result["remoteVersions"] = item.GetVersionNameList(1)
            result["currentVersion"] = item.GetCurrentVersion()`;
}

function readStateScript(): string {
  return `p = project
t = p.GetCurrentTimeline() if p else None
item = None
track_index = None
if p and t and p.GetUniqueId() == ${JSON.stringify(TARGET_PROJECT_ID)} and t.GetUniqueId() == ${JSON.stringify(TARGET_TIMELINE_ID)}:
    for ti in range(1, int(t.GetTrackCount("video") or 0) + 1):
        for candidate in (t.GetItemListInTrack("video", ti) or []):
            if candidate.GetUniqueId() == ${JSON.stringify(TARGET_ITEM_ID)}:
                item = candidate
                track_index = ti
                break
        if item:
            break
result = {
    "projectId": p.GetUniqueId() if p else None,
    "timelineId": t.GetUniqueId() if t else None,
    "itemId": item.GetUniqueId() if item else None,
    "trackIndex": track_index,
    "localVersions": item.GetVersionNameList(0) if item else None,
    "remoteVersions": item.GetVersionNameList(1) if item else None,
    "currentVersion": item.GetCurrentVersion() if item else None
}`;
}

function cleanupScript(originalName: string, baselineLocal: string[], baselineRemote: string[]): string {
  return `p = project
t = p.GetCurrentTimeline() if p else None
item = None
if p and t and p.GetUniqueId() == ${JSON.stringify(TARGET_PROJECT_ID)} and t.GetUniqueId() == ${JSON.stringify(TARGET_TIMELINE_ID)}:
    for ti in range(1, int(t.GetTrackCount("video") or 0) + 1):
        for candidate in (t.GetItemListInTrack("video", ti) or []):
            if candidate.GetUniqueId() == ${JSON.stringify(TARGET_ITEM_ID)}:
                item = candidate
                break
        if item:
            break
expected_post_local = sorted(${JSON.stringify([...baselineLocal, ACCEPTANCE_NAME])})
expected_remote = sorted(${JSON.stringify(baselineRemote)})
expected_baseline_local = sorted(${JSON.stringify(baselineLocal)})
result = {
    "safe": False,
    "loadOk": False,
    "deleteOk": False,
    "restored": False,
    "localBefore": None,
    "remoteBefore": None,
    "currentBefore": None,
    "localAfter": None,
    "remoteAfter": None,
    "currentAfter": None
}
if item:
    local_before = item.GetVersionNameList(0)
    remote_before = item.GetVersionNameList(1)
    current_before = item.GetCurrentVersion()
    result["localBefore"] = local_before
    result["remoteBefore"] = remote_before
    result["currentBefore"] = current_before
    safe = (
        isinstance(local_before, list)
        and isinstance(remote_before, list)
        and sorted(local_before) == expected_post_local
        and sorted(remote_before) == expected_remote
        and local_before.count(${JSON.stringify(ACCEPTANCE_NAME)}) == 1
        and local_before.count(${JSON.stringify(originalName)}) == 1
        and isinstance(current_before, dict)
        and current_before.get("versionName") == ${JSON.stringify(ACCEPTANCE_NAME)}
        and current_before.get("versionType") == 0
    )
    result["safe"] = safe
    if safe:
        result["loadOk"] = bool(item.LoadVersionByName(${JSON.stringify(originalName)}, 0))
        current_after_load = item.GetCurrentVersion()
        if result["loadOk"] and isinstance(current_after_load, dict) and current_after_load.get("versionName") == ${JSON.stringify(originalName)} and current_after_load.get("versionType") == 0:
            result["deleteOk"] = bool(item.DeleteVersionByName(${JSON.stringify(ACCEPTANCE_NAME)}, 0))
        local_after = item.GetVersionNameList(0)
        remote_after = item.GetVersionNameList(1)
        current_after = item.GetCurrentVersion()
        result["localAfter"] = local_after
        result["remoteAfter"] = remote_after
        result["currentAfter"] = current_after
        result["restored"] = (
            result["deleteOk"]
            and isinstance(local_after, list)
            and isinstance(remote_after, list)
            and sorted(local_after) == expected_baseline_local
            and sorted(remote_after) == expected_remote
            and isinstance(current_after, dict)
            and current_after.get("versionName") == ${JSON.stringify(originalName)}
            and current_after.get("versionType") == 0
        )`;
}

function restoreTimelineScript(timelineId: string): string {
  return `p = project
result = {"restored": False, "currentTimelineId": None}
if p and p.GetUniqueId() == ${JSON.stringify(TARGET_PROJECT_ID)}:
    candidate = None
    for index in range(1, int(p.GetTimelineCount() or 0) + 1):
        current = p.GetTimelineByIndex(index)
        if current and current.GetUniqueId() == ${JSON.stringify(timelineId)}:
            candidate = current
            break
    if candidate and p.SetCurrentTimeline(candidate):
        current = p.GetCurrentTimeline()
        result["currentTimelineId"] = current.GetUniqueId() if current else None
        result["restored"] = bool(current and current.GetUniqueId() == ${JSON.stringify(timelineId)})`;
}

async function cleanupQualificationDurable(options: {
  sessionId: string;
  conversationId: string;
  priorWorkspace: Record<string, unknown> | null;
}): Promise<void> {
  const sessions = await readDurable<Record<string, unknown>>('cos-sessions');
  if (sessions?.['version'] === 1 && Array.isArray(sessions['sessions'])) {
    sessions['sessions'] = (sessions['sessions'] as unknown[]).filter((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) return true;
      const session = row as Record<string, unknown>;
      const ids = Array.isArray(session['conversationIds']) ? session['conversationIds'] : [];
      return session['sessionId'] !== options.sessionId
        && session['conversationId'] !== options.conversationId
        && !ids.includes(options.conversationId);
    });
    sessions['savedAt'] = Date.now();
    await writeDurableNow('cos-sessions', sessions);
  }
  const correlations = await readDurable<Record<string, unknown>>('cos-request-correlations');
  if (correlations && Array.isArray(correlations['entries'])) {
    correlations['entries'] = (correlations['entries'] as unknown[]).filter((row) =>
      !row || typeof row !== 'object' || Array.isArray(row)
        || !String((row as Record<string, unknown>)['requestId'] ?? '').startsWith(REQUEST_PREFIX)
    );
    await writeDurableNow('cos-request-correlations', correlations);
  }
  const workspaces = await readDurable<Record<string, unknown>>('cid-workspaces');
  if (workspaces?.['version'] === 1 && Array.isArray(workspaces['sessionBindings'])) {
    workspaces['sessionBindings'] = (workspaces['sessionBindings'] as unknown[]).filter((row) =>
      !row || typeof row !== 'object' || Array.isArray(row)
        || (row as Record<string, unknown>)['sessionId'] !== options.sessionId
    );
    const priorActive = options.priorWorkspace?.['activeWorkspaceId'];
    const rows = Array.isArray(workspaces['workspaces']) ? workspaces['workspaces'] as unknown[] : [];
    if (typeof priorActive === 'string' && rows.some((row) => row && typeof row === 'object' && !Array.isArray(row)
      && (row as Record<string, unknown>)['workspaceId'] === priorActive)) {
      workspaces['activeWorkspaceId'] = priorActive;
    }
    workspaces['savedAt'] = Date.now();
    await writeDurableNow('cid-workspaces', workspaces);
  }
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error(`${label} is unavailable`);
  return value as string[];
}

function currentVersion(value: unknown): { versionName: string; versionType: number } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Current version is unavailable');
  const row = value as Record<string, unknown>;
  if (typeof row['versionName'] !== 'string' || typeof row['versionType'] !== 'number') throw new Error('Current version is invalid');
  return { versionName: row['versionName'], versionType: row['versionType'] };
}

export async function runColorGradeVersionVerticalAcceptance(): Promise<Record<string, unknown>> {
  if (process.env['CID_COLOR_GRADE_VERSION_VERTICAL_ACCEPTANCE'] !== '1') {
    throw new Error('Color grade-version vertical acceptance is disabled');
  }
  const productUrl = workflowGatewayUrlForQualification();
  const priorTimedOut = getWorkflowPlan(PRIOR_TIMED_OUT_PLAN_ID);
  if (priorTimedOut?.state === 'ready') await rejectWorkflowPlan(PRIOR_TIMED_OUT_PLAN_ID);
  const ledgerCountBefore = workflowLedgerEvents().length;
  const priorWorkspace = await readDurable<Record<string, unknown>>('cid-workspaces');
  const conversationId = `cid-color-version-acceptance-${randomUUID()}`;
  const turnId = 'turn-color-version-acceptance';
  const messageId = `msg-color-version-${randomUUID()}`;
  let sessionId = '';
  let planId: string | null = null;
  let originalTimelineId: string | null = null;
  let baselineLocal: string[] = [];
  let baselineRemote: string[] = [];
  let baselineCurrent = '';
  let cleanupRestored = false;
  try {
    const setup = await runResolveQualificationScript(setupScript());
    if (setup['error'] || setup['projectId'] !== TARGET_PROJECT_ID || setup['targetTimelineSelected'] !== true
      || setup['targetItemResolved'] !== true || setup['targetItemName'] !== TARGET_ITEM_NAME) {
      throw new Error(`Disposable preflight failed: ${String(setup['error'] ?? 'identity mismatch')}`);
    }
    if (typeof setup['originalTimelineId'] !== 'string') throw new Error('Original disposable timeline identity is unavailable');
    originalTimelineId = setup['originalTimelineId'];
    baselineLocal = stringArray(setup['localVersions'], 'LOCAL version baseline');
    baselineRemote = stringArray(setup['remoteVersions'], 'REMOTE version baseline');
    const baselineVersion = currentVersion(setup['currentVersion']);
    if (baselineVersion.versionType !== 0) throw new Error('Disposable baseline current version is not LOCAL');
    baselineCurrent = baselineVersion.versionName;
    if (baselineLocal.filter((name) => name === baselineCurrent).length !== 1) throw new Error('Disposable baseline current LOCAL version is ambiguous');
    if (baselineLocal.includes(ACCEPTANCE_NAME) || baselineRemote.includes(ACCEPTANCE_NAME)) throw new Error('Acceptance version name already exists');

    const session = await recordCosBrowserEventsNow(conversationId, [
      { kind: 'turn_start', turnId, time: Date.now() - 10 },
      { kind: 'user_message', turnId, messageId, text: ACCEPTANCE_INPUT, time: Date.now() - 5 }
    ]);
    sessionId = session.sessionId;
    const focus = await refreshWorld(sessionId, turnId);
    const base = { productUrl, conversationId, sessionId, turnId, messageId };
    const planArgs = {
      workflowId: 'color.grade_version_create.v1',
      target: 'timeline_item',
      itemRef: focus.handle,
      generation: focus.generation,
      name: ACCEPTANCE_NAME
    };
    const planContext = await productCall({ ...base, requestId: `${REQUEST_PREFIX}plan_context`, tool: 'plan', args: planArgs });
    const contextText = textFromRpc(planContext);
    if (!contextText.includes('NO_RESOLVE_DISPATCH') || !contextText.includes('color.grade_version_create.v1')
      || !contextText.includes('color.grade_version.create')) {
      throw new Error('Current-turn DecisionFrame did not expose the exact applicable Color writer offer');
    }
    const plannedResponse = await productCall({
      ...base,
      requestId: `${REQUEST_PREFIX}plan_dispatch`,
      tool: 'plan',
      args: { ...planArgs, decisionContextToken: decisionToken(planContext) }
    });
    const planError = errorFromRpc(plannedResponse);
    if (planError) throw new Error(`Public plan failed: ${planError}`);
    const plannedText = textFromRpc(plannedResponse);
    if (plannedText.includes('versionType') || plannedText.includes('version_type')
      || plannedText.includes(TARGET_ITEM_ID) || plannedText.includes(TARGET_PROJECT_ID) || plannedText.includes(TARGET_TIMELINE_ID)) {
      throw new Error('Public plan result leaked private Color writer state');
    }
    planId = planIdFromResponse(plannedResponse);
    const canonical = getWorkflowPlan(planId);
    if (!canonical || canonical.state !== 'ready' || canonical.plan.plan_kind !== 'color_grade_version_create') {
      throw new Error('Public product plan did not create one ready Color grade-version Plan');
    }
    if (canonical.plan.project_unique_id !== TARGET_PROJECT_ID || canonical.plan.timeline_unique_id !== TARGET_TIMELINE_ID
      || canonical.plan.target_ids[0] !== TARGET_ITEM_ID || canonical.plan.requested_parameters.name !== ACCEPTANCE_NAME) {
      throw new Error('Canonical Color Plan bound to the wrong disposable target');
    }
    const rendererView = projectWorkflowPlanForRenderer(canonical, mentionAgentEntityByExactId);
    const rendererJson = JSON.stringify(rendererView);
    for (const forbidden of [
      TARGET_PROJECT_ID, TARGET_TIMELINE_ID, TARGET_ITEM_ID,
      canonical.plan.input_fingerprint, canonical.plan.plan_hash, 'versionType', 'version_type'
    ]) {
      if (rendererJson.includes(forbidden)) throw new Error('Renderer Color Plan projection leaked private state');
    }

    const preApproval = await productCall({
      ...base,
      requestId: `${REQUEST_PREFIX}execute_before_approval`,
      tool: 'execute',
      args: { planId, decisionContextToken: decisionToken(plannedResponse) }
    });
    const preApprovalError = errorFromRpc(preApproval);
    if (!preApprovalError || !preApprovalError.includes('cannot execute because it is ready')) {
      throw new Error(`Pre-approval execute did not fail closed: ${preApprovalError ?? textFromRpc(preApproval)}`);
    }
    const beforeApprovalState = await runResolveQualificationScript(readStateScript());
    if (JSON.stringify(beforeApprovalState['localVersions']) !== JSON.stringify(baselineLocal)
      || JSON.stringify(beforeApprovalState['remoteVersions']) !== JSON.stringify(baselineRemote)
      || JSON.stringify(beforeApprovalState['currentVersion']) !== JSON.stringify(setup['currentVersion'])) {
      throw new Error('Pre-approval execute or planning changed the disposable grade-version state');
    }

    logInfo(`COLOR_GRADE_VERSION_VERTICAL_WAITING_APPROVAL ${JSON.stringify({
      planId,
      workflowId: rendererView.workflowId,
      planKind: rendererView.planKind,
      target: rendererView.target,
      proposedChange: rendererView.proposedChange,
      ledgerEventsAdded: workflowLedgerEvents().length - ledgerCountBefore
    })}`);

    const approvalDeadline = Date.now() + 600_000;
    for (;;) {
      const current = getWorkflowPlan(planId);
      if (!current) throw new Error('Acceptance Plan disappeared while waiting for renderer approval');
      if (current.state === 'approved') {
        if (current.approval?.provenance !== 'local_renderer') throw new Error('Acceptance Plan was not approved by the local renderer');
        break;
      }
      if (current.state !== 'ready') throw new Error(`Acceptance Plan left ready state before approval: ${current.state}`);
      if (Date.now() >= approvalDeadline) throw new Error('Timed out waiting for local renderer approval');
      await sleep(200);
    }
    const afterApprovalState = await runResolveQualificationScript(readStateScript());
    if (JSON.stringify(afterApprovalState['localVersions']) !== JSON.stringify(baselineLocal)
      || JSON.stringify(afterApprovalState['remoteVersions']) !== JSON.stringify(baselineRemote)
      || JSON.stringify(afterApprovalState['currentVersion']) !== JSON.stringify(setup['currentVersion'])) {
      throw new Error('Local approval itself changed the disposable grade-version state');
    }

    const executeContext = await productCall({
      ...base,
      requestId: `${REQUEST_PREFIX}execute_context`,
      tool: 'execute',
      args: { planId }
    });
    if (!textFromRpc(executeContext).includes('NO_RESOLVE_DISPATCH')) throw new Error('Approved execute did not re-gate through DecisionContext');
    const executedResponse = await productCall({
      ...base,
      requestId: `${REQUEST_PREFIX}execute_dispatch`,
      tool: 'execute',
      args: { planId, decisionContextToken: decisionToken(executeContext) }
    });
    const executeError = errorFromRpc(executedResponse);
    if (executeError) throw new Error(`Public execute failed: ${executeError}`);
    const executeText = textFromRpc(executedResponse);
    if (executeText.includes('versionType') || executeText.includes('version_type')
      || executeText.includes(TARGET_ITEM_ID) || executeText.includes(TARGET_PROJECT_ID) || executeText.includes(TARGET_TIMELINE_ID)) {
      throw new Error('Public execute result leaked private Color writer state');
    }
    const consumed = getWorkflowPlan(planId);
    if (!consumed || consumed.state !== 'consumed' || consumed.execution?.state !== 'verified'
      || consumed.plan.plan_kind !== 'color_grade_version_create') {
      throw new Error('Public execute did not finish as one consumed/verified Color Plan');
    }
    const readback = consumed.execution.grade_version_readback;
    if (!readback || readback.name !== ACCEPTANCE_NAME || readback.present !== true || readback.current !== true) {
      throw new Error('API readback did not prove the new LOCAL grade version is present and current');
    }
    const eventTypes = workflowLedgerEvents()
      .slice(ledgerCountBefore)
      .filter((event) => event.plan_id === planId)
      .map((event) => event.event_type);
    const expectedEvents = [
      'plan_created', 'approval_granted', 'execution_prepared', 'dispatch_started',
      'dispatch_returned', 'verification_started', 'verification_completed'
    ];
    if (JSON.stringify(eventTypes) !== JSON.stringify(expectedEvents)) {
      throw new Error(`Unexpected Color acceptance ledger sequence: ${eventTypes.join(' -> ')}`);
    }

    const cleanup = await runResolveQualificationScript(cleanupScript(baselineCurrent, baselineLocal, baselineRemote));
    cleanupRestored = cleanup['safe'] === true && cleanup['loadOk'] === true
      && cleanup['deleteOk'] === true && cleanup['restored'] === true;
    if (!cleanupRestored) throw new Error('Disposable Color version cleanup did not restore the exact baseline');

    return {
      ok: true,
      planId,
      workflowId: consumed.plan.workflow_id,
      targetHandle: rendererView.target.kind === 'timeline_item' ? rendererView.target.handle : null,
      versionName: ACCEPTANCE_NAME,
      approvalSource: consumed.approval?.provenance ?? null,
      executionState: consumed.execution.state,
      writerReturned: consumed.execution.writer_returned,
      writerPreconditionOk: consumed.execution.writer_precondition_ok,
      readback: consumed.execution.grade_version_readback,
      cleanupRestored,
      ledgerEvents: eventTypes,
      ledgerEventsAdded: workflowLedgerEvents().length - ledgerCountBefore
    };
  } finally {
    if (!cleanupRestored && baselineCurrent && baselineLocal.length > 0) {
      await runResolveQualificationScript(cleanupScript(baselineCurrent, baselineLocal, baselineRemote)).catch(() => undefined);
    }
    if (originalTimelineId) {
      await runResolveQualificationScript(restoreTimelineScript(originalTimelineId)).catch(() => undefined);
    }
    if (sessionId) {
      await cleanupQualificationDurable({ sessionId, conversationId, priorWorkspace }).catch(() => undefined);
    }
    logInfo(`COLOR_GRADE_VERSION_VERTICAL_RESTORE ${JSON.stringify({ planId, cleanupRestored, originalTimelineId })}`);
  }
}
