import type { AppApi } from '../preload/index.js';
import type {
  AppConfig,
  AppState,
  DiagnosticCheckId,
  DiagnosticStatus,
  LogEntry,
  ProtectedWorkflowId,
  RendererWorkflowPlanProjection,
  Reply,
  UiLanguagePreference,
  WorkflowAuditEntry,
  WorkflowInspectResult,
  WorkflowRiskAssessment
} from '../shared/types.js';
import type { AgentSessionSummary, AgentSessionView } from '../shared/agent-session.js';
import type {
  AgentArtifactLensId,
  AgentArtifactWorkspaceProjection,
  AgentEditStructureInspectorDetail,
  AgentEntityMention,
  AgentEvidenceRef,
  AgentMediaInventoryItemDetail,
  AgentSituationFrame,
  AgentSystemSpineProjection
} from '../shared/agent-system.js';
import {
  createElement as createLucideIcon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  type IconNode
} from 'lucide';
import { localizeRuntimeText, setUiLanguage, t, uiLanguage } from './i18n.js';
import { createAsyncActionGate, createLatestAsyncIntentGate, nextMenuIndex, nextSidebarPeek, type MenuNavigationKey } from './interaction-policy.js';
import {
  artifactById,
  artifactWorkspaceSemanticScope,
  createArtifactWorkspacePresentationState,
  reconcileArtifactWorkspacePresentation,
  selectArtifactForInspection,
  selectArtifactLens as selectArtifactLensState,
  setArtifactPin,
  type ArtifactWorkspacePresentationState
} from './artifact-workspace-policy.js';

declare global { interface Window { api: AppApi; } }

const api = window.api;
const TUNNEL_ID_PATTERN = /^tunnel_[0-9a-f]{32}$/;
const CONNECTOR_NAME = 'Chat in DaVinci';
const WORKFLOW_CONNECTOR_NAME = 'Chat in DaVinci Workflow';
const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const step = (name: string): HTMLElement => document.querySelector<HTMLElement>(`.step[data-step="${name}"]`)!;
const appRoot = $<HTMLElement>('app');
const workspaceTabs = $<HTMLElement>('tabs');
const sidebarCollapseButton = $<HTMLButtonElement>('sidebarCollapseButton');
const sidebarShell = workspaceTabs.closest<HTMLElement>('.topbar-shell')!;
const sidebarPeekZone = $<HTMLElement>('sidebarPeekZone');
const sidebarResizeHandle = $<HTMLElement>('sidebarResizeHandle');
const cockpitShell = $<HTMLElement>('cockpitShell');
const davinciWorkspace = $<HTMLElement>('davinciWorkspace');
const davinciCollapseButton = $<HTMLButtonElement>('davinciCollapseButton');
const cockpitResizeHandle = $<HTMLElement>('cockpitResizeHandle');
const actionGate = createAsyncActionGate();
const mediaClipIntentGate = createLatestAsyncIntentGate();
const fusionIntentGate = createLatestAsyncIntentGate();
const colorIntentGate = createLatestAsyncIntentGate();
const artifactWorkspaceIntentGate = createLatestAsyncIntentGate();

const UI_LANGUAGE_BOOTSTRAP_KEY = 'chat-in-davinci:ui-language';
let bootstrapLanguage: UiLanguagePreference = 'system';
try {
  const stored = window.localStorage.getItem(UI_LANGUAGE_BOOTSTRAP_KEY);
  if (stored === 'system' || stored === 'en' || stored === 'zh-CN') bootstrapLanguage = stored;
} catch { /* language persistence is a paint optimization only */ }
setUiLanguage(bootstrapLanguage, navigator.languages);

let state: AppState | null = null;
let log: LogEntry[] = [];
let showAllSteps = false;
type AppView = 'cockpit' | 'activity' | 'setup' | 'settings';
type ArtifactDomainLens = Exclude<AgentArtifactLensId, 'summary'>;
let activeView: AppView = 'cockpit';
let agentSessions: AgentSessionSummary[] = [];
let agentSession: AgentSessionView | null = null;
let agentLoaded = false;
let agentBusy = false;
let agentUiError: string | null = null;
let agentSituation: AgentSituationFrame | null = null;
let agentSpine: AgentSystemSpineProjection | null = null;
let artifactWorkspace: AgentArtifactWorkspaceProjection | null = null;
let artifactPresentation: ArtifactWorkspacePresentationState = createArtifactWorkspacePresentationState();
let artifactWorkspaceRefreshSeq = 0;
let focusedAgentEntity: AgentEntityMention | null = null;
let workflowConnection: Extract<WorkflowInspectResult, { target: 'connection' }> | null = null;
let workflowCapabilities: Extract<WorkflowInspectResult, { target: 'capabilities' }> | null = null;
let fusionError: string | null = null;
let fusionGraphError: string | null = null;
let colorGraphError: string | null = null;
let colorVersionsError: string | null = null;
let fairlightProcessingError: string | null = null;
let workflowRisk: WorkflowRiskAssessment | null = null;
let workflowAudit: WorkflowAuditEntry[] = [];
let workflowPlans: RendererWorkflowPlanProjection[] = [];
let zoomNoticeTimer: ReturnType<typeof setTimeout> | null = null;
let currentZoomPercent = 100;
let sidebarPeek = false;
let sidebarResizing = false;
const SIDEBAR_PEEK_EDGE_PX = 8;
const SIDEBAR_DEFAULT_WIDTH_PX = 200;
const SIDEBAR_MIN_WIDTH_PX = 200;
const SIDEBAR_MAX_WIDTH_PX = 400;
let sidebarWidthPx = SIDEBAR_DEFAULT_WIDTH_PX;
const TITLEBAR_CONTROL_SIZE_PX = 30;
const TITLEBAR_PANEL_ICON_SIZE_PX = 20;
const TITLEBAR_CONTROL_TOP_PX = 2;
const TITLEBAR_SIDEBAR_CONTROL_LEFT_PX = 76;
const TITLEBAR_DIVIDER_CONTROL_GAP_PX = 8;
const DAVINCI_MIN_WIDTH_PX = 200;
const CONVERSATION_MIN_WIDTH_PX = 300;
let davinciWidthPx: number | null = null;
let davinciRestoreWidthPx: number | null = null;
let davinciCollapsed = false;
let davinciResizing = false;

function resetLegacyDomainSnapshots(): void {
  fusionError = null;
  fusionGraphError = null;
  colorGraphError = null;
  colorVersionsError = null;
  fairlightProcessingError = null;
}

function legacyDomainRequestScope(): string | null {
  return artifactWorkspace ? artifactWorkspaceSemanticScope(artifactWorkspace) : null;
}

function legacyDomainRequestStillCurrent(scope: string | null): boolean {
  return scope !== null
    && artifactWorkspace !== null
    && scope === artifactWorkspaceSemanticScope(artifactWorkspace);
}

async function reconcileLegacyDomainObservation(scope: string): Promise<boolean> {
  if (!await refreshAgentSituation()) return false;
  return legacyDomainRequestStillCurrent(scope);
}

function renderPanelControlIcon(button: HTMLButtonElement, icon: IconNode): void {
  button.replaceChildren(createLucideIcon(icon, {
    class: 'panel-control-icon',
    'aria-hidden': 'true',
    focusable: 'false',
    'stroke-width': '1.8'
  }));
}

function syncTitlebarControlMetrics(percent: number): void {
  const scale = Math.max(0.5, Math.min(2, percent / 100));
  const physicalToCss = (value: number): string => `${value / scale}px`;
  appRoot.style.setProperty('--titlebar-control-size', physicalToCss(TITLEBAR_CONTROL_SIZE_PX));
  appRoot.style.setProperty('--titlebar-panel-icon-size', physicalToCss(TITLEBAR_PANEL_ICON_SIZE_PX));
  appRoot.style.setProperty('--titlebar-control-top', physicalToCss(TITLEBAR_CONTROL_TOP_PX));
  appRoot.style.setProperty('--titlebar-sidebar-control-left', physicalToCss(TITLEBAR_SIDEBAR_CONTROL_LEFT_PX));
  appRoot.style.setProperty('--titlebar-divider-control-gap', physicalToCss(TITLEBAR_DIVIDER_CONTROL_GAP_PX));
}

function isSetupComplete(next: AppState): boolean {
  const rawReady = TUNNEL_ID_PATTERN.test(next.config.tunnelId) && next.config.chatgptVerified;
  const workflowReady = TUNNEL_ID_PATTERN.test(next.config.workflowTunnelId) && next.config.workflowChatgptVerified;
  return next.hasApiKey && (rawReady || workflowReady);
}

function setSidebarWidth(next: number): void {
  sidebarWidthPx = Math.min(SIDEBAR_MAX_WIDTH_PX, Math.max(SIDEBAR_MIN_WIDTH_PX, Math.round(next)));
  appRoot.style.setProperty('--sidebar-width', `${sidebarWidthPx}px`);
}

function davinciMaxWidth(): number {
  return Math.max(DAVINCI_MIN_WIDTH_PX, cockpitShell.clientWidth - CONVERSATION_MIN_WIDTH_PX);
}

function setDavinciWidth(next: number): void {
  const clamped = Math.min(davinciMaxWidth(), Math.max(DAVINCI_MIN_WIDTH_PX, Math.round(next)));
  if (davinciWidthPx === clamped) return;
  davinciWidthPx = clamped;
  cockpitShell.style.setProperty('--davinci-width', `${clamped}px`);
}

function setDavinciCollapsed(next: boolean): void {
  if (next && !davinciCollapsed && davinciRestoreWidthPx === null) {
    davinciRestoreWidthPx = davinciWorkspace.getBoundingClientRect().width;
  }
  davinciCollapsed = next;
  cockpitShell.dataset.davinciCollapsed = String(next);
  davinciWorkspace.inert = next;
  davinciCollapseButton.setAttribute('aria-expanded', String(!next));
  renderPanelControlIcon(davinciCollapseButton, next ? PanelRightOpen : PanelRightClose);
  const labelKey = next ? 'davinci.expandWorkspace' : 'davinci.collapseWorkspace';
  const label = t(labelKey);
  davinciCollapseButton.dataset.i18nAriaLabel = labelKey;
  davinciCollapseButton.setAttribute('aria-label', label);
  davinciCollapseButton.title = label;
  if (!next && davinciRestoreWidthPx !== null) {
    const restoreWidth = davinciRestoreWidthPx;
    davinciRestoreWidthPx = null;
    setDavinciWidth(restoreWidth);
  }
}

function setSidebarPeek(next: boolean): void {
  sidebarPeek = next;
  if (next) appRoot.dataset.sidebarPeek = 'true';
  else delete appRoot.dataset.sidebarPeek;
  const collapsed = state?.config.sidebarCollapsed ?? false;
  const hiddenSidebar = state?.config.navigationLayout === 'sidebar' && collapsed && !next;
  sidebarShell.inert = hiddenSidebar;
  if (hiddenSidebar) sidebarShell.setAttribute('aria-hidden', 'true');
  else sidebarShell.removeAttribute('aria-hidden');
  sidebarCollapseButton.setAttribute('aria-expanded', String(!collapsed || next));
}

function paintSidebarCollapse(next: AppState): void {
  const sidebar = next.config.navigationLayout === 'sidebar';
  const collapsed = next.config.sidebarCollapsed;
  if (sidebar) appRoot.dataset.sidebarCollapsed = String(collapsed);
  else delete appRoot.dataset.sidebarCollapsed;
  if (!sidebar || !collapsed) setSidebarPeek(false);
  else setSidebarPeek(sidebarPeek);
  sidebarCollapseButton.hidden = !sidebar;
  sidebarCollapseButton.setAttribute('aria-expanded', String(!collapsed || sidebarPeek));
  renderPanelControlIcon(sidebarCollapseButton, collapsed ? PanelLeftOpen : PanelLeftClose);
  const label = t(collapsed ? 'nav.expandSidebar' : 'nav.collapseSidebar');
  sidebarCollapseButton.setAttribute('aria-label', label);
}

function armZoomNoticeTimer(notice: HTMLElement): void {
  if (zoomNoticeTimer) clearTimeout(zoomNoticeTimer);
  zoomNoticeTimer = setTimeout(() => {
    notice.classList.remove('is-visible');
    zoomNoticeTimer = null;
  }, 2000);
}

async function setZoomFromControl(percent: number): Promise<void> {
  const reply = await api.setZoom(percent);
  if (reply.ok) showZoomNotice(reply.data);
}

function showZoomNotice(percent: number): void {
  currentZoomPercent = percent;
  syncTitlebarControlMetrics(percent);
  let notice = document.getElementById('zoomNotice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'zoomNotice';
    notice.className = 'zoom-notice';
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.innerHTML = `
      <strong class="zoom-value" id="zoomValue">100%</strong>
      <button class="zoom-control-button" id="zoomOut" type="button" aria-label="Zoom out">−</button>
      <button class="zoom-control-button" id="zoomIn" type="button" aria-label="Zoom in">+</button>
      <span class="zoom-divider" aria-hidden="true"></span>
      <button class="zoom-reset-button" id="zoomReset" type="button">Reset</button>
    `;
    document.body.append(notice);
    $<HTMLButtonElement>('zoomOut').addEventListener('click', () => { void setZoomFromControl(currentZoomPercent - 10); });
    $<HTMLButtonElement>('zoomIn').addEventListener('click', () => { void setZoomFromControl(currentZoomPercent + 10); });
    $<HTMLButtonElement>('zoomReset').addEventListener('click', () => { void setZoomFromControl(100); });
    notice.addEventListener('mouseenter', () => {
      if (zoomNoticeTimer) clearTimeout(zoomNoticeTimer);
      zoomNoticeTimer = null;
    });
    notice.addEventListener('mouseleave', () => armZoomNoticeTimer(notice!));
  }
  $<HTMLElement>('zoomValue').textContent = `${percent}%`;
  const zoomOut = $<HTMLButtonElement>('zoomOut');
  const zoomIn = $<HTMLButtonElement>('zoomIn');
  const zoomReset = $<HTMLButtonElement>('zoomReset');
  const chinese = uiLanguage() === 'zh-CN';
  zoomOut.setAttribute('aria-label', chinese ? '缩小界面' : 'Zoom out');
  zoomIn.setAttribute('aria-label', chinese ? '放大界面' : 'Zoom in');
  zoomReset.textContent = chinese ? '重置' : 'Reset';
  zoomReset.setAttribute('aria-label', chinese ? '重置为 100%' : 'Reset to 100%');
  zoomOut.disabled = percent <= 50;
  zoomIn.disabled = percent >= 200;
  zoomReset.disabled = percent === 100;
  notice.classList.add('is-visible');
  armZoomNoticeTimer(notice);
}

function ago(at: number | null): string {
  if (!at) return t('time.never');
  const seconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (seconds < 3) return t('time.justNow');
  if (seconds < 90) return t('time.secondsAgo', { value: seconds });
  return t('time.minutesAgo', { value: Math.round(seconds / 60) });
}

function fact(label: string, value: string): HTMLElement {
  const row = document.createElement('div');
  row.className = 'fact';
  const left = document.createElement('span');
  const right = document.createElement('span');
  left.textContent = label;
  right.textContent = value;
  row.append(left, right);
  return row;
}

function healthLabel(id: DiagnosticCheckId): string {
  switch (id) {
    case 'resolve': return t('health.resolve');
    case 'resolveMcp': return t('health.resolveMcp');
    case 'broker': return t('health.broker');
    case 'tunnel': return t('health.tunnel');
    case 'openai': return t('health.openai');
    case 'chatgptRequest': return t('health.chatgptRequest');
    case 'toolCall': return t('health.toolCall');
  }
}

function healthStatus(id: DiagnosticCheckId, status: DiagnosticStatus): string {
  if (status === 'pass') return t('health.pass');
  if (status === 'fail') return t('health.fail');
  if (id === 'broker') return t('health.inactive');
  if (id === 'chatgptRequest' || id === 'toolCall') return t('health.notObservable');
  return t('health.notVerified');
}

function protectedTunnel(next: AppState) {
  return TUNNEL_ID_PATTERN.test(next.config.workflowTunnelId) ? next.workflowTunnel : next.tunnel;
}

function protectedGatewayRequestAt(next: AppState): number | null {
  return TUNNEL_ID_PATTERN.test(next.config.workflowTunnelId) ? next.gateway.workflowRequestAt : next.gateway.rawRequestAt;
}

function protectedVerified(next: AppState): boolean {
  return TUNNEL_ID_PATTERN.test(next.config.workflowTunnelId) ? next.config.workflowChatgptVerified : next.config.chatgptVerified;
}

function healthDetail(next: AppState, id: DiagnosticCheckId): string {
  const tunnel = protectedTunnel(next);
  const gatewayRequestAt = protectedGatewayRequestAt(next);
  switch (id) {
    case 'resolve': return localizeRuntimeText(next.resolve.detail);
    case 'resolveMcp': return next.resolve.reachable
      ? `ResolveMCP ${next.resolve.serverVersion ?? ''}`.trim()
      : localizeRuntimeText(next.resolve.detail);
    case 'broker': return next.gateway.active && next.gateway.schemaHash
      ? t('health.brokerReady')
      : t('health.brokerInactive');
    case 'tunnel': return tunnel.detail ? localizeRuntimeText(tunnel.detail) : t('health.disconnected');
    case 'openai': return gatewayRequestAt
      ? t('health.openaiRequest', { ago: ago(gatewayRequestAt) })
      : tunnel.lastPollSuccessMs
        ? t('health.openaiPoll', { ago: ago(tunnel.lastPollSuccessMs) })
        : t('health.disconnected');
    case 'chatgptRequest': return gatewayRequestAt
      ? t('health.lastChatgptRequest', { ago: ago(gatewayRequestAt) })
      : tunnel.lastToolCallMs && tunnel.lastToolName
        ? t('health.lastToolCall', { name: tunnel.lastToolName, ago: ago(tunnel.lastToolCallMs) })
        : tunnel.toolCallCount > 0 && tunnel.lastToolCallMs
          ? t('health.toolCallsObserved', { count: tunnel.toolCallCount, ago: ago(tunnel.lastToolCallMs) })
          : protectedVerified(next) ? t('health.manuallyConfirmed') : t('health.rawNotObservable');
    case 'toolCall': return next.gateway.lastToolCallAt && next.gateway.lastToolName
      ? t('health.lastToolCall', { name: next.gateway.lastToolName, ago: ago(next.gateway.lastToolCallAt) })
      : tunnel.lastToolCallMs && tunnel.lastToolName
      ? t('health.lastToolCall', { name: tunnel.lastToolName, ago: ago(tunnel.lastToolCallMs) })
      : tunnel.toolCallCount > 0 && tunnel.lastToolCallMs
        ? t('health.toolCallsObserved', { count: tunnel.toolCallCount, ago: ago(tunnel.lastToolCallMs) })
      : protectedVerified(next) ? t('health.manuallyConfirmed') : t('health.rawNotObservable');
  }
}

function paintHealth(next: AppState): void {
  const visibleChecks = next.diagnostics.checks.filter((check) => check.id !== 'broker' || next.config.developerMode);
  $('healthChecks').replaceChildren(...visibleChecks.map((check) => {
    const row = document.createElement('div');
    row.className = 'health-check';
    const main = document.createElement('div');
    main.className = 'health-check-main';
    const label = document.createElement('b');
    label.textContent = healthLabel(check.id);
    const detail = document.createElement('span');
    detail.textContent = healthDetail(next, check.id);
    main.append(label, detail);
    const status = document.createElement('span');
    status.className = `health-state ${check.status}`;
    status.textContent = healthStatus(check.id, check.status);
    row.append(main, status);
    return row;
  }));
}

function paintLocations(next: AppState): void {
  const locations = next.config.projectLocations;
  $('locationSummary').textContent = locations.length === 0 ? t('common.noneYet') : locations.map((location) => `/${location.name}`).join('  ');
  const list = $('locationList');
  list.replaceChildren(...locations.map((location) => {
    const row = document.createElement('div');
    row.className = 'location';
    const text = document.createElement('div');
    const name = document.createElement('b');
    const path = document.createElement('span');
    name.textContent = `/${location.name}`;
    path.textContent = location.path;
    text.append(name, path);
    const remove = document.createElement('button');
    remove.className = 'btn btn-danger btn-icon';
    remove.type = 'button';
    remove.title = t('remove.location');
    remove.setAttribute('aria-label', `${t('remove.location')}: /${location.name}`);
    remove.innerHTML = '<svg class="ico" viewBox="0 0 24 24"><use href="#i-trash" /></svg>';
    remove.addEventListener('click', async () => {
      await actionGate.run(`location:remove:${location.name}`, async () => {
        const updated = await unwrap(api.removeProjectLocation(location.name));
        if (updated) paint(updated);
      });
    });
    row.append(text, remove);
    return row;
  }));
}

function shortHash(value: string | null): string {
  return value ? value.slice(0, 12) : t('common.unknown');
}

function workflowRiskLabel(risk: WorkflowRiskAssessment | null): string {
  if (!risk?.riskEstablished) return t('workflow.riskUnknown');
  switch (risk.riskLevel) {
    case 'low': return t('workflow.risk.low');
    case 'medium': return t('workflow.risk.medium');
    case 'high': return t('workflow.risk.high');
    case 'critical': return t('workflow.risk.critical');
  }
}

function workflowBlastLabel(risk: WorkflowRiskAssessment | null): string {
  switch (risk?.blastRadius) {
    case 'item': return t('workflow.blast.item');
    case 'track': return t('workflow.blast.track');
    case 'timeline': return t('workflow.blast.timeline');
    case 'project': return t('workflow.blast.project');
    case 'system': return t('workflow.blast.system');
    default: return t('workflow.blast.unknown');
  }
}

function workflowApprovalLabel(risk: WorkflowRiskAssessment | null): string {
  if (risk?.approvalPolicy === 'none') return t('workflow.approval.none');
  if (risk?.approvalPolicy === 'local_required') return t('workflow.approval.local');
  return t('common.unknown');
}

function workflowPreviewLabel(risk: WorkflowRiskAssessment | null): string {
  if (risk?.previewMode === 'native') return t('workflow.preview.native');
  if (risk?.previewMode === 'derived_plan') return t('workflow.preview.derivedPlan');
  if (risk?.previewMode === 'unavailable') return t('workflow.preview.unavailable');
  return t('common.unknown');
}

function workflowVerificationLabel(risk: WorkflowRiskAssessment | null): string {
  if (risk?.verificationLevel === 'API_READBACK') return t('workflow.verification.api');
  if (risk?.verificationLevel === 'STRUCTURAL_READBACK') return t('workflow.verification.structural');
  if (risk?.verificationLevel === 'RENDER_VERIFIED') return t('workflow.verification.render');
  return t('common.unknown');
}

function knownCount(value: number | null): string {
  return value === null ? t('common.unknown') : String(value);
}

function resolutionLabel(value: { width: number; height: number } | null): string {
  return value ? `${value.width} × ${value.height}` : t('common.unknown');
}

function frameRateLabel(value: number | null): string {
  return value === null ? t('common.unknown') : `${value} fps`;
}

function focusedEntityDomain(entity: AgentEntityMention | null): ArtifactDomainLens | null {
  if (entity?.kind === 'media_pool_item') return 'media';
  if (entity?.kind === 'timeline_item') return 'edit';
  return null;
}

function workflowDomain(workflowId: ProtectedWorkflowId | null): ArtifactDomainLens | null {
  if (!workflowId) return null;
  if (workflowId.startsWith('project.')) return 'project';
  if (workflowId.startsWith('media.')) return 'media';
  if (workflowId.startsWith('edit.')) return 'edit';
  if (workflowId.startsWith('fusion.')) return 'fusion';
  if (workflowId.startsWith('color.')) return 'color';
  if (workflowId.startsWith('fairlight.')) return 'fairlight';
  if (workflowId.startsWith('deliver.')) return 'deliver';
  return null;
}

function evidenceAnchorId(workflowId: ProtectedWorkflowId): string | null {
  switch (workflowId) {
    case 'project.identity.v1':
    case 'project.preflight.v1': return 'workflowPreflightState';
    case 'project.settings_summary.v1': return 'projectSettingsFacts';
    case 'media.inventory_summary.v1': return 'mediaInventoryState';
    case 'media.clip_inspect.v1': return 'mediaClipState';
    case 'media.link_status.v1': return 'mediaLinkState';
    case 'edit.timeline_summary.v1': return 'editTimelineState';
    case 'edit.structure_inspect.v1': return 'editStructureState';
    case 'edit.gaps_overlaps.v1': return 'editGapsState';
    case 'edit.source_range_report.v1': return 'editSourceRangesState';
    case 'edit.transition_inspect.v1': return 'editTransitionsState';
    case 'edit.review_annotations_inspect.v1': return 'editAnnotationsState';
    case 'fusion.composition_inspect.v1': return 'fusionCompositionState';
    case 'fusion.graph_inspect.v1': return 'fusionGraphState';
    case 'color.pipeline_inspect.v1': return 'colorPipelineState';
    case 'color.graph_inventory.v1': return 'colorGraphState';
    case 'color.grade_version_inspect.v1': return 'colorVersionsState';
    case 'fairlight.mapping_inspect.v1': return 'fairlightMappingState';
    case 'fairlight.clip_processing_inspect.v1': return 'fairlightProcessingState';
    case 'deliver.capability_matrix.v1': return 'deliverCapabilityState';
    case 'deliver.settings_inspect.v1': return 'deliverSettingsState';
    default: return null;
  }
}

function evidenceLabel(workflowId: ProtectedWorkflowId): string {
  switch (workflowId) {
    case 'media.clip_inspect.v1': return t('media.clipTitle');
    case 'media.link_status.v1': return t('media.linkTitle');
    case 'edit.structure_inspect.v1': return t('edit.itemsTitle');
    case 'edit.gaps_overlaps.v1': return t('edit.gapsTitle');
    case 'fusion.graph_inspect.v1': return t('fusion.graphTitle');
    case 'color.graph_inventory.v1': return t('color.graphTitle');
    case 'color.grade_version_inspect.v1': return t('color.versionsTitle');
    case 'fairlight.clip_processing_inspect.v1': return t('fairlight.processingTitle');
    case 'deliver.settings_inspect.v1': return t('deliver.settingsTitle');
    default: {
      const domain = workflowDomain(workflowId);
      return domain ? t(`nav.${domain}` as Parameters<typeof t>[0]) : t('agent.evidence');
    }
  }
}

function openEvidence(evidence: AgentEvidenceRef): void {
  const domain = workflowDomain(evidence.workflowId);
  const anchorId = evidence.workflowId ? evidenceAnchorId(evidence.workflowId) : null;
  if (!domain || !anchorId) return;
  selectAppView('cockpit');
  if (artifactWorkspace && evidence.targetHandle) {
    const target = artifactWorkspace.artifacts.find((artifact) => artifact.semanticHandle === evidence.targetHandle);
    if (target) artifactPresentation = selectArtifactForInspection(artifactPresentation, artifactWorkspace, target.artifactId);
  }
  selectArtifactLens(domain);
  paintArtifactWorkspace();
  requestAnimationFrame(() => document.getElementById(anchorId)?.closest<HTMLElement>('.workflow-card')?.scrollIntoView({ block: 'start' }));
}

function paintEvidenceLinks(): void {
  const bar = $('agentEvidenceBar');
  const list = $('agentEvidenceLinks');
  const evidence = (agentSituation?.evidence ?? [])
    .filter((item): item is AgentEvidenceRef & { workflowId: ProtectedWorkflowId } => Boolean(item.workflowId && workflowDomain(item.workflowId) && evidenceAnchorId(item.workflowId)))
    .slice(-3)
    .reverse();
  bar.hidden = evidence.length === 0;
  list.replaceChildren(...evidence.map((item) => {
    const evidenceButton = document.createElement('button');
    evidenceButton.type = 'button';
    const label = evidenceLabel(item.workflowId);
    evidenceButton.textContent = `${item.id} · ${label}`;
    evidenceButton.setAttribute('aria-label', t('agent.openEvidence', { id: item.id, label }));
    evidenceButton.addEventListener('click', () => openEvidence(item));
    return evidenceButton;
  }));
}

function paintSystemSpine(): void {
  const bar = $('agentSpineBar');
  bar.hidden = agentSpine === null;
  if (!agentSpine) return;
  const workspace = agentSpine.workspace;
  $('agentSpineWorkspace').textContent = t('agent.spineWorkspace', {
    workspace: workspace?.projectLabel ?? workspace?.workspaceId ?? '—',
    state: workspace
      ? [workspace.bindingStatus, workspace.freshness].join('/')
      : 'unbound'
  });
  $('agentSpineDecision').textContent = t('agent.spineDecision', {
    kind: agentSpine.decision.decisionKind,
    criterion: agentSpine.decision.goalCriterion ?? '—'
  });
  $('agentSpineActions').textContent = t('agent.spineActions', {
    count: String(agentSpine.actionOffers.length)
  });
  $('agentSpineCompletion').textContent = t('agent.spineCompletion', {
    state: agentSpine.completion.complete ? 'complete' : 'open'
  });
}

function shortSemanticId(value: string | null): string {
  if (!value) return '—';
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

function artifactValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
  const encoded = JSON.stringify(value);
  return encoded.length > 160 ? `${encoded.slice(0, 157)}…` : encoded;
}

function artifactKindLabel(kind: NonNullable<ReturnType<typeof activeArtifact>>['kind']): string {
  return t(`artifact.kind.${kind}` as Parameters<typeof t>[0]);
}

function activeArtifact() {
  return artifactWorkspace ? artifactById(artifactWorkspace, artifactPresentation.activeArtifactId) : null;
}

function projectInspectorDetail() {
  return artifactWorkspace?.artifacts.find((artifact) => artifact.kind === 'project')?.projectInspector ?? null;
}

function mediaPoolInspectorDetail() {
  return artifactWorkspace?.artifacts.find((artifact) => artifact.kind === 'media_pool')?.mediaInspector ?? null;
}

function activeMediaItemInspectorDetail() {
  const artifact = activeArtifact();
  return artifact?.kind === 'media_item' ? artifact.mediaInspector ?? null : null;
}

function editInspectorDetail() {
  return artifactWorkspace?.artifacts.find((artifact) => artifact.kind === 'timeline')?.editInspector ?? null;
}

function fusionInspectorDetail() {
  return artifactWorkspace?.artifacts.find((artifact) => artifact.kind === 'timeline')?.fusionInspector ?? null;
}

function colorInspectorDetail() {
  return artifactWorkspace?.artifacts.find((artifact) => artifact.kind === 'color_graph')?.colorInspector ?? null;
}

function fairlightInspectorDetail() {
  return artifactWorkspace?.artifacts.find((artifact) => artifact.kind === 'fairlight')?.fairlightInspector ?? null;
}

function deliverInspectorDetail() {
  return artifactWorkspace?.artifacts.find((artifact) => artifact.kind === 'deliver')?.deliverInspector ?? null;
}

function artifactLensLabel(lens: AgentArtifactLensId): string {
  if (lens === 'summary') return t('artifact.lens.summary');
  return t(`nav.${lens}` as Parameters<typeof t>[0]);
}

function artifactDisplayLabel(artifact: NonNullable<ReturnType<typeof activeArtifact>>): string {
  return artifact.source === 'semantic_projection' && artifact.kind !== 'project'
    ? artifactKindLabel(artifact.kind)
    : artifact.label;
}

function paintArtifactWorkspace(): void {
  const projection = artifactWorkspace;
  if (!projection) {
    $('artifactWorkspaceFreshness').textContent = t('artifact.unavailable');
    $('artifactContextWorkspace').textContent = '—';
    $('artifactContextProject').textContent = '—';
    $('artifactContextResolve').textContent = t('artifact.offline');
    $('artifactContextSession').textContent = '—';
    $('artifactContextTurn').textContent = '—';
    $('artifactContextGoal').textContent = '—';
    $('artifactContextObligation').textContent = '—';
    $('artifactContextFocus').textContent = '—';
    $('artifactContextDecision').textContent = '—';
    $('artifactContextGap').textContent = '';
    $('artifactContextBlockers').textContent = '';
    $<HTMLSelectElement>('artifactSelect').replaceChildren();
    $('artifactSummaryStrip').replaceChildren();
    $('artifactSummaryFacts').replaceChildren();
    $('artifactActionOffers').replaceChildren();
    $('artifactPlanList').replaceChildren();
    $('artifactPlanEmpty').hidden = false;
    $('artifactEvidenceList').replaceChildren();
    $('artifactDeltaList').replaceChildren();
    $('artifactUnknowns').textContent = '';
    $('artifactLimitations').textContent = '';
    paintProjectInspector();
    paintMediaInventory();
    paintMediaClip();
    paintMediaLinkStatus();
    paintEditTimeline();
    paintEditStructure();
    paintEditGapsOverlaps();
    paintEditSourceRanges();
    paintEditTransitions();
    paintEditAnnotations();
    return;
  }

  artifactPresentation = reconcileArtifactWorkspacePresentation(artifactPresentation, projection);
  const artifact = activeArtifact();
  const workspace = projection.workspace;
  const freshness = workspace?.freshness ?? 'offline';
  const freshnessPill = $('artifactWorkspaceFreshness');
  freshnessPill.textContent = t(`artifact.freshness.${freshness}` as Parameters<typeof t>[0]);
  freshnessPill.className = `pill ${freshness === 'fresh' ? 'good' : freshness === 'offline' ? 'bad' : ''}`;
  $('artifactContextWorkspace').textContent = workspace?.projectLabel ?? shortSemanticId(workspace?.workspaceId ?? null);
  $('artifactContextProject').textContent = workspace?.projectLabel
    ? [workspace.projectLabel, workspace.projectHandle].filter(Boolean).join(' · ')
    : workspace?.projectHandle ?? '—';
  $('artifactContextResolve').textContent = workspace?.online ? t('artifact.online') : t('artifact.offline');
  $('artifactContextSession').textContent = shortSemanticId(projection.sessionId);
  $('artifactContextTurn').textContent = shortSemanticId(projection.turnId);
  $('artifactContextGoal').textContent = projection.context.goalCriterion ?? '—';
  $('artifactContextObligation').textContent = projection.context.openObligation ?? '—';
  $('artifactContextFocus').textContent = projection.context.sharedFocus
    ? `${projection.context.sharedFocus.entity.label} · ${projection.context.sharedFocus.entity.handle}`
    : '—';
  $('artifactContextDecision').textContent = projection.context.decisionKind;
  $('artifactContextGap').textContent = projection.context.completionGap
    ? t('artifact.completionGap', { value: projection.context.completionGap })
    : '';
  const blockers = [...projection.context.blockers];
  if (projection.context.materialUncertainty) blockers.push(projection.context.materialUncertainty);
  $('artifactContextBlockers').textContent = blockers.length > 0
    ? t('artifact.blockers', { value: blockers.join(' · ') })
    : '';

  const select = $<HTMLSelectElement>('artifactSelect');
  select.replaceChildren(...projection.artifacts.map((item) => {
    const option = document.createElement('option');
    option.value = item.artifactId;
    option.textContent = [
      artifactDisplayLabel(item),
      artifactKindLabel(item.kind),
      item.source === 'cached_projection' ? t('artifact.cachedReadOnly') : null
    ].filter(Boolean).join(' · ');
    option.selected = item.artifactId === artifact?.artifactId;
    return option;
  }));
  const pin = $<HTMLButtonElement>('artifactPin');
  pin.disabled = !artifact;
  pin.setAttribute('aria-pressed', String(artifactPresentation.pinned));
  pin.textContent = t(artifactPresentation.pinned ? 'artifact.unpin' : 'artifact.pin');
  const useContext = $<HTMLButtonElement>('artifactUseContext');
  useContext.disabled = !artifact?.semanticHandle
    || artifact.source === 'cached_projection'
    || (artifact.kind !== 'media_item' && artifact.kind !== 'timeline_item');
  $<HTMLButtonElement>('artifactReveal').disabled = true;

  const suggested = projection.suggestedArtifactId
    ? artifactById(projection, projection.suggestedArtifactId)
    : null;
  const working = $('artifactAgentWorking');
  working.hidden = !suggested || suggested.artifactId === artifact?.artifactId;
  working.textContent = suggested && suggested.artifactId !== artifact?.artifactId
    ? t('artifact.agentWorking', { label: artifactDisplayLabel(suggested) })
    : '';

  $('artifactSummaryStrip').replaceChildren(...([
    artifact ? `${artifactKindLabel(artifact.kind)} · ${artifactDisplayLabel(artifact)}` : t('artifact.noArtifact'),
    artifact?.semanticHandle ? artifact.semanticHandle : null,
    artifact?.source === 'cached_projection' ? t('artifact.cachedReadOnly') : null,
    artifactPresentation.pinned ? t('artifact.pinned') : null,
    projection.protectedResolveActionsBlocked ? t('artifact.protectedBlocked') : null
  ].filter((value): value is string => Boolean(value)).map((value) => {
    const chip = document.createElement('span');
    chip.className = 'artifact-summary-chip';
    chip.textContent = value;
    return chip;
  })));

  $('artifactSummaryFacts').replaceChildren(...(artifact?.summaryFacts ?? []).map((item) =>
    fact(item.key, artifactValue(item.value))
  ));
  const offers = artifact?.actionOffers ?? [];
  $('artifactActionOffers').replaceChildren(...(offers.length > 0 ? offers.map((offer) => {
    const row = document.createElement('div');
    row.className = `artifact-offer-row ${offer.applicability}`;
    const title = document.createElement('b');
    title.textContent = offer.whyRelevant;
    const meta = document.createElement('span');
    meta.textContent = [
      offer.capabilityId,
      t('artifact.offerApplicability', { value: offer.applicability }),
      t('artifact.offerRisk', { value: offer.risk }),
      offer.targetHandle ? t('artifact.offerTarget', { value: offer.targetHandle }) : null,
      offer.implementation ? t('artifact.offerQualification', { value: offer.implementation.qualification }) : null,
      offer.implementation?.evidenceBuild ? t('artifact.offerBuild', { value: offer.implementation.evidenceBuild }) : null
    ].filter(Boolean).join(' · ');
    const effect = document.createElement('p');
    effect.textContent = `${offer.expectedSemanticEffect} · ${offer.verificationRequirement}`;
    if (offer.blockingReason) effect.textContent += ` · ${offer.blockingReason}`;
    row.append(title, meta, effect);
    return row;
  }) : [(() => {
    const empty = document.createElement('p');
    empty.className = 'artifact-empty-note';
    empty.textContent = t('artifact.noOffers');
    return empty;
  })()]));

  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-artifact-lens]')) {
    const lensId = button.dataset.artifactLens as AgentArtifactLensId;
    const lens = artifact?.lenses.find((item) => item.id === lensId);
    const available = lens?.availability === 'available';
    button.disabled = !available;
    button.title = available ? artifactLensLabel(lensId) : t('artifact.lensUnavailable');
    const selected = available && artifactPresentation.selectedLens === lensId;
    button.classList.toggle('is-sel', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  for (const section of document.querySelectorAll<HTMLElement>('[data-artifact-lens-panel]')) {
    section.classList.toggle('is-active', section.dataset.artifactLensPanel === artifactPresentation.selectedLens);
  }

  const relevantPlans = projection.plans.filter((plan) =>
    artifact?.kind === 'project' || artifact?.kind === 'timeline'
      ? true
      : plan.targetHandle === artifact?.semanticHandle
  );
  $('artifactPlanEmpty').hidden = relevantPlans.length > 0;
  $('artifactPlanList').replaceChildren(...relevantPlans.map((plan) => {
    const row = document.createElement('div');
    row.className = 'artifact-plan-row';
    const title = document.createElement('b');
    title.textContent = plan.proposedChanges.map((change) => change.kind === 'add_review_marker'
      ? t('artifact.change.addReviewMarker', {
        name: change.name,
        frame: String(change.frameOffset),
        color: change.color,
        duration: String(change.duration)
      })
      : change.kind
    ).join(' · ');
    const meta = document.createElement('span');
    meta.textContent = [
      t(plan.authority === 'cached_read_only' ? 'artifact.planAuthority.cached' : 'artifact.planAuthority.current'),
      plan.state,
      plan.approvalState,
      t('artifact.offerRisk', { value: plan.risk }),
      plan.targetHandle ?? plan.targetLabel ?? t('common.unknown'),
      plan.executionState,
      plan.verificationRequirement,
      plan.recoveryType,
      plan.blockingReason
    ].filter(Boolean).join(' · ');
    row.append(title, meta);
    return row;
  }));

  const evidence = artifact?.evidenceRefs ?? [];
  $('artifactEvidenceList').replaceChildren(...(evidence.length > 0 ? evidence.map((item) => {
    const artifactEvidenceButton = document.createElement('button');
    artifactEvidenceButton.type = 'button';
    artifactEvidenceButton.className = 'artifact-evidence-row';
    const label = item.workflowId ? evidenceLabel(item.workflowId) : t('agent.evidence');
    artifactEvidenceButton.textContent = [
      item.id,
      label,
      item.verificationStatus ?? t('artifact.unverified'),
      item.verificationLevel ?? '—',
      t(artifact?.source === 'cached_projection' ? 'artifact.evidenceCached' : 'artifact.evidenceCurrent'),
      item.provenanceRevision === undefined ? null : t('artifact.provenanceRevision', { value: String(item.provenanceRevision) })
    ].filter(Boolean).join(' · ');
    if (item.workflowId && workflowDomain(item.workflowId) && evidenceAnchorId(item.workflowId)) {
      artifactEvidenceButton.addEventListener('click', () => openEvidence(item));
    } else {
      artifactEvidenceButton.disabled = true;
    }
    return artifactEvidenceButton;
  }) : [(() => {
    const empty = document.createElement('p');
    empty.className = 'artifact-empty-note';
    empty.textContent = t('artifact.noEvidence');
    return empty;
  })()]));
  const evidenceIds = new Set(evidence.map((item) => item.id));
  const deltas = projection.recentDeltas.filter((delta) => delta.evidenceIds.some((id) => evidenceIds.has(id))).slice(-3).reverse();
  $('artifactDeltaList').replaceChildren(...deltas.map((delta) => {
    const row = document.createElement('div');
    row.className = 'artifact-delta-row';
    row.textContent = [delta.reason, ...delta.changedFactKeys, ...delta.invalidatedFactKeys.map((key) => `− ${key}`)].join(' · ');
    return row;
  }));
  const limitations = [...new Set(evidence.flatMap((item) => item.limitations))];
  $('artifactUnknowns').textContent = projection.context.unknowns.length > 0
    ? t('artifact.unknowns', { value: projection.context.unknowns.join(' · ') })
    : '';
  $('artifactLimitations').textContent = limitations.length > 0
    ? t('artifact.limitations', { value: limitations.join(' · ') })
    : '';
  paintProjectInspector();
  paintMediaInventory();
  paintMediaClip();
  paintMediaLinkStatus();
  paintEditTimeline();
  paintEditStructure();
  paintEditGapsOverlaps();
  paintEditSourceRanges();
  paintEditTransitions();
  paintEditAnnotations();
}

function paintFocusedEntityRows(): void {
  const entity = focusedAgentEntity;
  for (const row of document.querySelectorAll<HTMLElement>('[data-entity-id], [data-entity-handle]')) {
    row.classList.toggle(
      'is-shared-focus',
      Boolean(entity && entity.handle === row.dataset.entityHandle)
    );
  }
}

function paintSharedContext(): void {
  const focusBar = $('agentFocusBar');
  const focusLink = $<HTMLButtonElement>('agentFocusLink');
  const focus = agentSituation?.sharedFocus ?? null;
  const domain = focusedEntityDomain(focusedAgentEntity);
  focusBar.hidden = !focus || !focusedAgentEntity || !domain;
  if (focus && focusedAgentEntity && domain) {
    focusLink.textContent = [focus.entity.label, focus.entity.handle, focus.entity.locator].filter(Boolean).join(' · ');
    const domainLabel = t(`nav.${domain}` as Parameters<typeof t>[0]);
    const openLabel = t('agent.openFocus', { label: focus.entity.label, domain: domainLabel });
    focusLink.title = openLabel;
    focusLink.setAttribute('aria-label', openLabel);
  }
  paintEvidenceLinks();
  paintSystemSpine();
}

async function refreshAgentSituation(): Promise<boolean> {
  const artifactIntent = artifactWorkspaceIntentGate.run(`artifact:${++artifactWorkspaceRefreshSeq}`, () => api.getArtifactWorkspace());
  const [reply, spineReply, artifactReply] = await Promise.all([
    api.getAgentSituation(),
    api.getAgentSpine(),
    artifactIntent
  ]);
  if (!reply.ok) return false;
  agentSituation = reply.data;
  agentSpine = spineReply.ok ? spineReply.data : null;
  let canonicalArtifactRefreshed = false;
  if (artifactReply.current && artifactReply.value.ok && artifactReply.value.data) {
    const nextArtifactWorkspace = artifactReply.value.data;
    const previousArtifactWorkspace = artifactWorkspace;
    if (previousArtifactWorkspace === null
      || artifactWorkspaceSemanticScope(previousArtifactWorkspace) !== artifactWorkspaceSemanticScope(nextArtifactWorkspace)) {
      resetLegacyDomainSnapshots();
    }
    artifactWorkspace = nextArtifactWorkspace;
    canonicalArtifactRefreshed = true;
  } else if (artifactReply.current && artifactReply.value.ok && artifactReply.value.data === null) {
    resetLegacyDomainSnapshots();
    artifactWorkspace = null;
  }
  focusedAgentEntity = null;
  const focus = agentSituation.sharedFocus;
  if (focus) focusedAgentEntity = focus.entity;
  paintSharedContext();
  paintArtifactWorkspace();
  paintFocusedEntityRows();
  return canonicalArtifactRefreshed;
}

async function setWorkspaceFocus(handle: string, generation: number): Promise<void> {
  const reply = await api.setTimelineArtifactFocus(handle, generation);
  if (reply.ok) await refreshAgentSituation();
}

function bindEditArtifactInspectionRow(
  row: HTMLElement,
  item: AgentEditStructureInspectorDetail['tracks'][number]['items'][number]
): void {
  const activate = (): void => {
    if (!artifactWorkspace) return;
    const artifact = artifactWorkspace.artifacts.find((candidate) =>
      candidate.kind === 'timeline_item'
      && candidate.semanticHandle === item.semanticHandle
      && candidate.generation === item.generation
    );
    if (!artifact) return;
    artifactPresentation = selectArtifactForInspection(artifactPresentation, artifactWorkspace, artifact.artifactId);
    paintArtifactWorkspace();
  };
  row.classList.add('is-selectable');
  row.dataset.artifactId = item.semanticHandle;
  row.dataset.entityHandle = item.semanticHandle;
  row.classList.toggle('is-selected', activeArtifact()?.semanticHandle === item.semanticHandle);
  row.classList.toggle('is-shared-focus', focusedAgentEntity?.handle === item.semanticHandle);
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-label', t('artifact.inspectItem', { label: item.name }));
  row.addEventListener('click', activate);
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activate();
  });
}

function scrollFocusedEntityIntoView(): void {
  const entity = focusedAgentEntity;
  if (!entity) return;
  const target = [...document.querySelectorAll<HTMLElement>('[data-entity-id], [data-entity-handle]')].find((row) =>
    row.dataset.entityHandle === entity.handle
  );
  if (!target) return;
  target.scrollIntoView({ block: 'nearest' });
  target.focus({ preventScroll: true });
}

async function openSharedFocus(): Promise<void> {
  const entity = focusedAgentEntity;
  const domain = focusedEntityDomain(entity);
  if (!entity || !domain) return;
  selectAppView('cockpit');
  if (artifactWorkspace) {
    const artifact = artifactWorkspace.artifacts.find((item) => item.semanticHandle === entity.handle);
    if (artifact) artifactPresentation = selectArtifactForInspection(artifactPresentation, artifactWorkspace, artifact.artifactId);
  }
  selectArtifactLens(domain);
  if (entity.kind === 'timeline_item' && !editInspectorDetail()?.structure && state?.gateway.active) {
    await refreshEditPanel();
  }
  paintFocusedEntityRows();
  requestAnimationFrame(scrollFocusedEntityIntoView);
}

function mediaItemTechnical(item: AgentMediaInventoryItemDetail): string {
  const values = [
    item.resolution ? resolutionLabel(item.resolution) : null,
    item.fps === null ? null : `${item.fps} fps`,
    item.duration
  ].filter((value): value is string => Boolean(value));
  return values.length > 0 ? values.join(' · ') : t('common.unknown');
}

function mediaItemCodec(item: AgentMediaInventoryItemDetail): string {
  const values = [item.videoCodec, item.audioCodec].filter((value): value is string => Boolean(value));
  return values.length > 0 ? values.join(' · ') : t('common.unknown');
}

function mediaItemState(item: AgentMediaInventoryItemDetail): string {
  if (item.isTimeline) return t('media.timeline');
  const values = [
    item.online === true ? t('media.online') : item.online === false ? t('media.offline') : t('common.unknown'),
    item.hasProxyMedia === true ? t('media.proxy') : item.hasProxyMedia === false ? t('media.noProxy') : t('common.unknown')
  ];
  return values.join(' · ');
}

function mediaInventoryRow(values: string[], header = false): HTMLElement {
  const row = document.createElement('div');
  row.className = `media-inventory-row${header ? ' is-header' : ''}`;
  for (const value of values) {
    const cell = document.createElement('span');
    cell.textContent = value;
    row.append(cell);
  }
  return row;
}

function bindMediaArtifactInspectionRow(row: HTMLElement, item: AgentMediaInventoryItemDetail): void {
  const activate = (): void => {
    if (!artifactWorkspace) return;
    const artifact = artifactWorkspace.artifacts.find((candidate) =>
      candidate.kind === 'media_item' && candidate.semanticHandle === item.semanticHandle
    );
    if (!artifact) return;
    artifactPresentation = selectArtifactForInspection(artifactPresentation, artifactWorkspace, artifact.artifactId);
    paintArtifactWorkspace();
    void refreshMediaClip(item.semanticHandle, item.generation);
  };
  row.classList.add('is-selectable');
  row.dataset.artifactId = item.semanticHandle;
  row.dataset.entityHandle = item.semanticHandle;
  row.classList.toggle('is-selected', activeArtifact()?.semanticHandle === item.semanticHandle);
  row.classList.toggle('is-shared-focus', focusedAgentEntity?.handle === item.semanticHandle);
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.setAttribute('aria-label', t('media.inspectHint'));
  row.addEventListener('click', activate);
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    activate();
  });
}

function paintMediaInventory(): void {
  const statePill = $('mediaInventoryState');
  const inspector = mediaPoolInspectorDetail();
  const inventory = inspector?.inventory ?? null;
  statePill.textContent = inventory ? t('workflow.ready') : inspector ? t('media.noProject') : t('workflow.pending');
  statePill.className = `pill ${inventory ? 'good' : ''}`;

  if (!inventory) {
    $('mediaInventoryFacts').replaceChildren(
      fact(t('media.rootBin'), t('common.unknown')),
      fact(t('media.currentBin'), t('common.unknown')),
      fact(t('media.sourceClipsObserved'), t('common.unknown'))
    );
    $('mediaInventoryList').replaceChildren();
    $('mediaInventoryNote').textContent = inspector ? t('media.noProject') : '';
    return;
  }

  const typeSummary = inventory.resolveTypeCounts.length > 0
    ? inventory.resolveTypeCounts.map((entry) => `${entry.type || t('common.unknown')} × ${entry.count}`).join(' · ')
    : t('common.unknown');
  $('mediaInventoryFacts').replaceChildren(
    fact(t('media.rootBin'), inventory.rootFolderLabel ?? t('common.unknown')),
    fact(t('media.currentBin'), inventory.currentFolderLabel ?? t('common.unknown')),
    fact(t('media.binsObserved'), knownCount(inventory.folderCountObserved)),
    fact(t('media.sourceClipsObserved'), knownCount(inventory.sourceClipCountObserved)),
    fact(t('media.timelinesObserved'), knownCount(inventory.timelineItemCountObserved)),
    fact(t('media.onlineState'), t('media.onlineStateValue', {
      online: inventory.onlineCountObserved,
      offline: inventory.offlineCountObserved,
      unknown: inventory.onlineUnverifiedCount
    })),
    fact(t('media.proxyState'), t('media.proxyStateValue', {
      linked: inventory.proxyLinkedCountObserved,
      none: inventory.proxyAbsentCountObserved,
      unknown: inventory.proxyUnverifiedCount
    })),
    fact(t('media.resolveTypes'), typeSummary),
    fact(t('media.motionMismatch'), t('media.motionMismatchValue', {
      fps: inventory.motionFrameRateMismatchCount === null ? t('common.unknown') : inventory.motionFrameRateMismatchCount,
      resolution: inventory.motionResolutionMismatchCount === null ? t('common.unknown') : inventory.motionResolutionMismatchCount
    })),
    fact(t('media.coverage'), t(inventory.complete ? 'media.coverageComplete' : 'media.coverageBounded'))
  );

  const rows = [
    mediaInventoryRow([
      t('media.column.name'),
      t('media.column.type'),
      t('media.column.bin'),
      t('media.column.technical'),
      t('media.column.codec'),
      t('media.column.state')
    ], true),
    ...inventory.items.map((item) => {
      const row = mediaInventoryRow([
        item.name,
        item.resolveType ?? (item.isTimeline ? t('media.timeline') : t('common.unknown')),
        item.folderLabel,
        mediaItemTechnical(item),
        mediaItemCodec(item),
        mediaItemState(item)
      ]);
      if (!item.isTimeline) {
        row.title = t('media.inspectHint');
        bindMediaArtifactInspectionRow(row, item);
        row.addEventListener('keydown', (event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
          event.preventDefault();
          const selectable = [...$('mediaInventoryList').querySelectorAll<HTMLElement>('.media-inventory-row.is-selectable')];
          const next = nextMenuIndex(selectable.indexOf(row), event.key as MenuNavigationKey, selectable.length);
          selectable[next]?.focus();
        });
      }
      return row;
    })
  ];
  $('mediaInventoryList').replaceChildren(...rows);
  $('mediaInventoryNote').textContent = t('media.itemsShowing', {
    shown: inventory.items.length,
    observed: inventory.itemsObserved
  });
}

function paintMediaClip(): void {
  const detail = activeMediaItemInspectorDetail()?.clip ?? null;
  const artifact = activeArtifact();
  const statePill = $('mediaClipState');
  if (!detail) {
    statePill.textContent = t('media.clipSelect');
    statePill.className = 'pill';
    $('mediaClipFacts').replaceChildren(
      fact(t('media.clipName'), t('common.unknown')),
      fact(t('media.clipSourceState'), t('common.unknown')),
      fact(t('media.clipFullResolution'), t('media.fullResolutionUnverified'))
    );
    $('mediaClipEvidence').replaceChildren();
    $('mediaClipNote').textContent = '';
    return;
  }

  const item = detail.item;
  const found = detail.lookup === 'found' && item !== null;
  statePill.textContent = found
    ? t('workflow.ready')
    : detail.lookup === 'not_found' ? t('media.clipNotFound') : t('media.clipLookupUnverified');
  statePill.className = `pill ${found ? 'good' : ''}`;

  if (!item) {
    $('mediaClipFacts').replaceChildren(
      fact(t('media.clipId'), shortSemanticId(artifact?.kind === 'media_item' ? artifact.semanticHandle : null)),
      fact(t('media.clipSourceState'), t('common.unknown')),
      fact(t('media.clipFullResolution'), t('media.fullResolutionUnverified'))
    );
    $('mediaClipEvidence').replaceChildren();
    $('mediaClipNote').textContent = t('media.clipLookupNote', {
      items: detail.search.itemsObserved,
      folders: detail.search.foldersObserved
    });
    return;
  }

  const technical = [
    item.resolution ? resolutionLabel(item.resolution) : null,
    item.fps === null ? null : `${item.fps} fps`,
    item.duration
  ].filter((value): value is string => Boolean(value)).join(' · ') || t('common.unknown');
  const codec = [item.videoCodec, item.audioCodec].filter((value): value is string => Boolean(value)).join(' · ') || t('common.unknown');
  const sourceState = [
    item.online === true ? t('media.online') : item.online === false ? t('media.offline') : t('common.unknown'),
    item.hasProxyMedia === true ? t('media.proxy') : item.hasProxyMedia === false ? t('media.noProxy') : t('common.unknown')
  ].join(' · ');
  const timecode = item.startTimecode || item.endTimecode
    ? `${item.startTimecode ?? t('common.unknown')} → ${item.endTimecode ?? t('common.unknown')}`
    : t('common.unknown');
  const audio = item.audioMapping
    ? t('media.clipAudioValue', {
        channels: item.audioChannels ?? t('common.unknown'),
        bitDepth: item.audioBitDepth ?? t('common.unknown'),
        tracks: item.audioMapping.trackCount,
        mapped: item.audioMapping.mappedChannelCount
      })
    : [
        item.audioChannels === null ? null : `${item.audioChannels} ch`,
        item.audioBitDepth === null ? null : `${item.audioBitDepth} bit`
      ].filter(Boolean).join(' · ') || t('common.unknown');

  $('mediaClipFacts').replaceChildren(
    fact(t('media.clipName'), item.name),
    fact(t('media.clipId'), shortSemanticId(item.semanticHandle)),
    fact(t('media.column.type'), item.resolveType ?? t('common.unknown')),
    fact(t('media.clipTechnical'), technical),
    fact(t('media.clipCodec'), codec),
    fact(t('media.clipSourceState'), sourceState),
    fact(t('media.clipTimecode'), timecode),
    fact(t('media.clipAudio'), audio),
    fact(t('media.clipMarkers'), `${detail.markers.length}${detail.markersTruncated ? '+' : ''}`),
    fact(t('media.clipFlags'), item.flags.length ? item.flags.join(' · ') : t('media.none')),
    fact(t('media.clipColor'), item.clipColor ?? t('media.none')),
    fact(t('media.clipGetterEvidence'), t('media.clipGetterEvidenceValue', {
      observed: detail.methodEvidence.observedMethods.length,
      checked: detail.methodEvidence.checkedMethods.length,
      failed: detail.methodEvidence.failedMethods.length
    })),
    fact(t('media.clipFullResolution'), t('media.fullResolutionUnverified'))
  );

  const evidenceRows: HTMLElement[] = [
    domainRow('media-clip-row', [t('media.clipColumn.kind'), t('media.clipColumn.key'), t('media.clipColumn.value')], true),
    ...detail.metadata.map((entry) => domainRow('media-clip-row', [t('media.clipMetadata'), entry.key, entry.value])),
    ...detail.thirdPartyMetadata.map((entry) => domainRow('media-clip-row', [t('media.clipThirdParty'), entry.key, entry.value])),
    ...detail.markers.map((marker) => domainRow('media-clip-row', [
      t('media.clipMarker'),
      String(marker.frame),
      [marker.color, marker.name, marker.note].filter((value): value is string => Boolean(value)).join(' · ') || t('common.unknown')
    ]))
  ];
  if (evidenceRows.length === 1) evidenceRows.push(domainRow('media-clip-row', [t('media.clipNoEvidence'), '', '']));
  $('mediaClipEvidence').replaceChildren(...evidenceRows);
  $('mediaClipNote').textContent = t('media.clipLookupNote', {
    items: detail.search.itemsObserved,
    folders: detail.search.foldersObserved
  });
}

function paintMediaLinkStatus(): void {
  const status = activeMediaItemInspectorDetail()?.linkStatus ?? mediaPoolInspectorDetail()?.linkStatus ?? null;
  const statePill = $('mediaLinkState');
  if (!status) {
    statePill.textContent = t('workflow.pending');
    statePill.className = 'pill';
    $('mediaLinkFacts').replaceChildren(
      fact(t('media.linkRelink'), t('common.unknown')),
      fact(t('media.linkUnlink'), t('common.unknown')),
      fact(t('media.linkProxyAttach'), t('common.unknown')),
      fact(t('media.linkProxyDetach'), t('common.unknown')),
      fact(t('media.linkFullResolutionAttach'), t('common.unknown'))
    );
    $('mediaLinkNote').textContent = '';
    return;
  }
  const labelFor = (id: typeof status.capabilities[number]['id']): string => {
    const capability = status.capabilities.find((entry) => entry.id === id);
    if (!capability || capability.surface === 'unverified') return t('media.linkSurfaceUnverified');
    if (capability.surface === 'missing') return t('media.linkSurfaceMissing');
    return t('media.linkSurfaceObserved');
  };
  const poolObserved = status.methodEvidence.mediaPoolProbed;
  const itemObserved = status.scope === 'item' && status.itemLookup === 'found' && status.methodEvidence.mediaPoolItemProbed;
  statePill.textContent = itemObserved
    ? t('media.linkItemObserved')
    : poolObserved ? t('media.linkPoolObserved') : t('workflow.pending');
  statePill.className = `pill ${poolObserved ? 'good' : ''}`;
  $('mediaLinkFacts').replaceChildren(
    fact(t('media.linkRelink'), labelFor('relink')),
    fact(t('media.linkUnlink'), labelFor('unlink')),
    fact(t('media.linkProxyAttach'), labelFor('linkProxy')),
    fact(t('media.linkProxyDetach'), labelFor('unlinkProxy')),
    fact(t('media.linkFullResolutionAttach'), labelFor('linkFullResolution'))
  );
  $('mediaLinkNote').textContent = status.scope === 'pool'
    ? `${t('media.linkItemSelect')} ${t('media.linkNote')}`
    : t('media.linkNote');
}

function editTrackRow(values: string[], header = false): HTMLElement {
  const row = document.createElement('div');
  row.className = `edit-track-row${header ? ' is-header' : ''}`;
  for (const value of values) {
    const cell = document.createElement('span');
    cell.textContent = value;
    row.append(cell);
  }
  return row;
}

function editTrackLabel(type: 'video' | 'audio' | 'subtitle', index: number): string {
  return `${type === 'video' ? 'V' : type === 'audio' ? 'A' : 'S'}${index}`;
}

function paintEditTimeline(): void {
  const statePill = $('editTimelineState');
  const summary = editInspectorDetail()?.timeline ?? null;
  statePill.textContent = summary ? t('workflow.ready') : t('workflow.pending');
  statePill.className = `pill ${summary ? 'good' : ''}`;

  if (!summary) {
    $('editTimelineFacts').replaceChildren(
      fact(t('edit.timelineName'), t('common.unknown')),
      fact(t('edit.range'), t('common.unknown')),
      fact(t('edit.trackCounts'), t('common.unknown'))
    );
    $('editTrackList').replaceChildren();
    $('editTrackNote').textContent = '';
    return;
  }

  const range = summary.timeline.startFrame !== null && summary.timeline.endFrame !== null
    ? `${summary.timeline.startFrame}–${summary.timeline.endFrame}`
    : t('common.unknown');
  $('editTimelineFacts').replaceChildren(
    fact(t('edit.timelineName'), summary.timeline.name),
    fact(t('edit.timelineId'), summary.timeline.semanticHandle),
    fact(t('edit.range'), range),
    fact(t('edit.duration'), summary.timeline.durationFrames === null
      ? t('common.unknown')
      : t('edit.framesValue', { value: summary.timeline.durationFrames })),
    fact(t('edit.startTimecode'), summary.timeline.startTimecode ?? t('common.unknown')),
    fact(t('edit.frameRate'), frameRateLabel(summary.timeline.frameRate)),
    fact(t('edit.trackCounts'), t('edit.trackCountsValue', summary.trackCounts)),
    fact(t('edit.timelineItems'), String(summary.timelineItemCountObserved)),
    fact(t('edit.markers'), String(summary.markerCount)),
    fact(t('edit.subtitleItems'), String(summary.subtitleItemCount)),
    fact(t('edit.sourceState'), t('edit.sourceStateValue', {
      offline: summary.offlineSourceItemCountObserved,
      unknown: summary.onlineStateUnverifiedItemCountObserved,
      withoutRef: summary.itemsWithoutMediaPoolReferenceCountObserved
    })),
    fact(t('edit.coverage'), t(summary.complete ? 'edit.coverageComplete' : 'edit.coverageBounded'))
  );

  const rows = [
    editTrackRow([
      t('edit.column.track'),
      t('edit.column.name'),
      t('edit.column.items'),
      t('edit.column.enabled'),
      t('edit.column.locked'),
      t('edit.column.source')
    ], true),
    ...summary.tracks.map((track) => editTrackRow([
      editTrackLabel(track.type, track.index),
      track.name ?? t('common.unknown'),
      String(track.itemCount),
      track.enabled === true ? t('edit.enabled') : track.enabled === false ? t('edit.disabled') : t('common.unknown'),
      track.locked === true ? t('edit.locked') : track.locked === false ? t('edit.unlocked') : t('common.unknown'),
      t('edit.sourceTrackValue', {
        offline: track.offlineSourceItemCountObserved,
        unknown: track.onlineStateUnverifiedItemCountObserved + track.itemsWithoutMediaPoolReferenceCountObserved
      })
    ]))
  ];
  $('editTrackList').replaceChildren(...rows);
  $('editTrackNote').textContent = t('edit.tracksShowing', {
    shown: summary.tracks.length,
    scanned: summary.itemsScannedForSourceState
  });
}

function paintEditStructure(): void {
  const structure = editInspectorDetail()?.structure ?? null;
  const statePill = $('editStructureState');
  if (!structure) {
    statePill.textContent = t('workflow.pending');
    statePill.className = 'pill';
    $('editItemList').replaceChildren();
    $('editItemNote').textContent = '';
    return;
  }
  statePill.textContent = t('edit.itemsReady');
  statePill.className = 'pill good';
  const value = (number: number | null): string => number === null ? t('common.unknown') : String(number);
  const range = (start: number | null, end: number | null): string =>
    t('edit.itemRangeValue', { start: value(start), end: value(end) });
  const rows: HTMLElement[] = [
    domainRow('edit-item-row', [
      t('edit.itemsColumn.track'),
      t('edit.itemsColumn.item'),
      t('edit.itemsColumn.record'),
      t('edit.itemsColumn.source'),
      t('edit.itemsColumn.duration'),
      t('edit.itemsColumn.identity')
    ], true)
  ];
  for (const track of structure.tracks) {
    for (const item of track.items) {
      const row = domainRow('edit-item-row', [
        editTrackLabel(track.type, track.index),
        item.name,
        range(item.recordStart, item.recordEnd),
        range(item.sourceStart, item.sourceEnd),
        item.duration === null ? t('common.unknown') : t('edit.framesValue', { value: item.duration }),
        t('edit.itemIdentityValue', {
          item: item.semanticHandle,
          media: item.mediaPoolHandle ?? t('common.unknown')
        })
      ]);
      bindEditArtifactInspectionRow(row, item);
      rows.push(row);
    }
  }
  if (rows.length === 1) rows.push(domainRow('edit-item-row', [t('edit.itemsNone'), '', '', '', '', '']));
  $('editItemList').replaceChildren(...rows);
  $('editItemNote').textContent = t('edit.itemsNote', {
    items: structure.itemsObserved,
    tracks: structure.tracksObserved,
    observed: structure.methodEvidence.fullyObservedMethodCount,
    checked: structure.methodEvidence.checkedMethodCount,
    failed: structure.methodEvidence.failedMethodCount
  });
}

function paintEditGapsOverlaps(): void {
  const gaps = editInspectorDetail()?.gaps ?? null;
  const statePill = $('editGapsState');
  if (!gaps) {
    statePill.textContent = t('workflow.pending');
    statePill.className = 'pill';
    $('editGapFacts').replaceChildren(
      fact(t('edit.gapsPairs'), t('common.unknown')),
      fact(t('edit.gapsCount'), t('common.unknown')),
      fact(t('edit.overlapsCount'), t('common.unknown'))
    );
    $('editGapList').replaceChildren();
    $('editGapNote').textContent = '';
    return;
  }

  statePill.textContent = t('edit.gapsReady');
  statePill.className = 'pill good';
  $('editGapFacts').replaceChildren(
    fact(t('edit.gapsPairs'), `${gaps.comparablePairsObserved} / ${gaps.adjacentPairsObserved}`),
    fact(t('edit.gapsCount'), String(gaps.gapCountObserved)),
    fact(t('edit.overlapsCount'), String(gaps.overlapCountObserved)),
    fact(t('edit.boundaryAmbiguousCount'), String(gaps.boundaryAmbiguousCountObserved)),
    fact(t('edit.gapsUnverifiedTracks'), String(gaps.unverifiedTrackCount))
  );
  const rows: HTMLElement[] = [
    domainRow('edit-gap-row', [
      t('edit.gapsColumn.track'),
      t('edit.gapsColumn.relation'),
      t('edit.gapsColumn.left'),
      t('edit.gapsColumn.right'),
      t('edit.gapsColumn.delta')
    ], true),
    ...gaps.relationships.map((relationship) => domainRow('edit-gap-row', [
      editTrackLabel(relationship.trackType, relationship.trackIndex),
      t(`edit.gapsRelation.${relationship.kind}` as Parameters<typeof t>[0]),
      t('edit.gapsItemValue', { name: relationship.leftItem.name, id: relationship.leftItem.semanticHandle ?? t('common.unknown') }),
      t('edit.gapsItemValue', { name: relationship.rightItem.name, id: relationship.rightItem.semanticHandle ?? t('common.unknown') }),
      t('edit.gapsDeltaValue', { value: relationship.boundaryDelta })
    ]))
  ];
  if (rows.length === 1) rows.push(domainRow('edit-gap-row', [t('edit.gapsNone'), '', '', '', '']));
  $('editGapList').replaceChildren(...rows);
  $('editGapNote').textContent = t('edit.gapsNote', {
    compared: gaps.comparablePairsObserved,
    observed: gaps.adjacentPairsObserved
  });
}

function paintEditSourceRanges(): void {
  const report = editInspectorDetail()?.sourceRanges ?? null;
  const statePill = $('editSourceRangesState');
  if (!report) {
    statePill.textContent = t('workflow.pending');
    statePill.className = 'pill';
    $('editSourceRangeFacts').replaceChildren(
      fact(t('edit.sourceRangesItems'), t('common.unknown')),
      fact(t('edit.sourceRangesSourceComplete'), t('common.unknown')),
      fact(t('edit.sourceRangesMediaRefs'), t('common.unknown'))
    );
    $('editSourceRangeList').replaceChildren();
    $('editSourceRangeNote').textContent = '';
    return;
  }

  statePill.textContent = t('edit.sourceRangesReady');
  statePill.className = 'pill good';
  $('editSourceRangeFacts').replaceChildren(
    fact(t('edit.sourceRangesItems'), `${report.itemsReported} / ${report.itemsObserved}`),
    fact(t('edit.sourceRangesRecordComplete'), String(report.itemsWithCompleteRecordGetterValues)),
    fact(t('edit.sourceRangesSourceComplete'), String(report.itemsWithCompleteSourceGetterValues)),
    fact(t('edit.sourceRangesMediaRefs'), `${report.itemsWithMediaPoolReference} / ${report.itemsReported}`)
  );
  const value = (number: number | null): string => number === null ? t('common.unknown') : String(number);
  const rows: HTMLElement[] = [
    domainRow('edit-source-range-row', [
      t('edit.sourceRangesColumn.track'),
      t('edit.sourceRangesColumn.item'),
      t('edit.sourceRangesColumn.record'),
      t('edit.sourceRangesColumn.source'),
      t('edit.sourceRangesColumn.media')
    ], true),
    ...report.items.map((item) => domainRow('edit-source-range-row', [
      editTrackLabel(item.trackType, item.trackIndex),
      t('edit.sourceRangesItemValue', { name: item.name, id: item.semanticHandle ?? t('common.unknown') }),
      `${value(item.recordStartGetterValue)} → ${value(item.recordEndGetterValue)} · ${value(item.durationGetterValue)}`,
      `${value(item.sourceStartFrameGetterValue)} → ${value(item.sourceEndFrameGetterValue)}`,
      item.mediaPoolHandle ? t('edit.sourceRangesMediaValue', { id: item.mediaPoolHandle }) : t('common.unknown')
    ]))
  ];
  if (rows.length === 1) rows.push(domainRow('edit-source-range-row', [t('edit.sourceRangesNone'), '', '', '', '']));
  $('editSourceRangeList').replaceChildren(...rows);
  $('editSourceRangeNote').textContent = t('edit.sourceRangesNote');
}

function paintEditTransitions(): void {
  const transitions = editInspectorDetail()?.transitions ?? null;
  const statePill = $('editTransitionsState');
  if (!transitions) {
    statePill.textContent = t('workflow.pending');
    statePill.className = 'pill';
    $('editTransitionFacts').replaceChildren(
      fact(t('edit.transitionsItems'), t('common.unknown')),
      fact(t('edit.transitionsReadback'), t('common.unknown')),
      fact(t('edit.transitionsAddSurface'), t('common.unknown')),
      fact(t('edit.transitionsSetSurface'), t('common.unknown'))
    );
    $('editTransitionList').replaceChildren();
    $('editTransitionNote').textContent = '';
    return;
  }

  statePill.textContent = t('edit.transitionsReady');
  statePill.className = 'pill good';
  $('editTransitionFacts').replaceChildren(
    fact(t('edit.transitionsItems'), `${transitions.itemsReported} / ${transitions.itemsObserved}`),
    fact(t('edit.transitionsReadback'), `${transitions.getFadesReadbackObservedCount} / ${transitions.itemsObserved}`),
    fact(t('edit.transitionsAddSurface'), transitions.addTransitionSurfaceObserved ? t('edit.transitionsSurfaceObserved') : t('edit.transitionsSurfaceNotComplete')),
    fact(t('edit.transitionsSetSurface'), transitions.setFadesSurfaceObserved ? t('edit.transitionsSurfaceObserved') : t('edit.transitionsSurfaceNotComplete'))
  );
  const value = (number: number | null): string => number === null ? t('common.unknown') : String(number);
  const rows: HTMLElement[] = [
    domainRow('edit-transition-row', [
      t('edit.transitionsColumn.track'),
      t('edit.transitionsColumn.item'),
      t('edit.transitionsColumn.fadeIn'),
      t('edit.transitionsColumn.fadeOut'),
      t('edit.transitionsColumn.readback')
    ], true),
    ...transitions.items.map((item) => domainRow('edit-transition-row', [
      editTrackLabel(item.trackType, item.trackIndex),
      t('edit.sourceRangesItemValue', { name: item.name, id: item.semanticHandle ?? t('common.unknown') }),
      value(item.fadeInGetterValue),
      value(item.fadeOutGetterValue),
      t(`edit.transitionsReadback.${item.getFadesReadback}` as Parameters<typeof t>[0])
    ]))
  ];
  if (rows.length === 1) rows.push(domainRow('edit-transition-row', [t('edit.transitionsNone'), '', '', '', '']));
  $('editTransitionList').replaceChildren(...rows);
  $('editTransitionNote').textContent = t('edit.transitionsNote');
}

function ensureEditAnnotationsCard(): boolean {
  if (document.getElementById('editAnnotationsState')) return true;
  const anchor = document.querySelector<HTMLElement>('.edit-transitions-card');
  if (!anchor) return false;
  const section = document.createElement('section');
  section.className = 'workflow-card domain-detail-card edit-annotations-card';
  section.innerHTML = `
    <div class="workflow-card-head">
      <div><h2 id="editAnnotationsTitle"></h2><p id="editAnnotationsBody"></p></div>
      <span class="pill" id="editAnnotationsState"></span>
    </div>
    <div class="facts compact workflow-preflight-facts" id="editAnnotationFacts"></div>
    <div class="domain-list" id="editAnnotationMarkerList"></div>
    <div class="domain-list" id="editAnnotationMediaList"></div>
    <p class="media-inventory-note" id="editAnnotationNote"></p>
  `;
  anchor.insertAdjacentElement('afterend', section);
  return true;
}

function editAnnotationUnverifiedLabel(value: string): string {
  switch (value) {
    case 'timelineMarkers': return t('edit.annotationsUnverifiedTimelineMarkers');
    case 'timelineItemMarkers': return t('edit.annotationsUnverifiedItemMarkers');
    case 'mediaPoolMarkers': return t('edit.annotationsUnverifiedMediaMarkers');
    case 'flags': return t('edit.annotationsUnverifiedFlags');
    case 'clipColor': return t('edit.annotationsUnverifiedClipColor');
    case 'timelineItemIdentity': return t('edit.annotationsUnverifiedTimelineItemIdentity');
    case 'mediaPoolAssociation': return t('edit.annotationsUnverifiedMediaPoolAssociation');
    case 'mediaPoolIdentity': return t('edit.annotationsUnverifiedMediaPoolIdentity');
    case 'markerRows': return t('edit.annotationsUnverifiedMarkerRows');
    default: return t('edit.annotationsUnverifiedUnknown', { value });
  }
}

function paintEditAnnotations(): void {
  if (!ensureEditAnnotationsCard()) return;
  $('editAnnotationsTitle').textContent = t('edit.annotationsTitle');
  $('editAnnotationsBody').textContent = t('edit.annotationsBody');
  const annotations = editInspectorDetail()?.annotations ?? null;
  const statePill = $('editAnnotationsState');
  if (!annotations) {
    statePill.textContent = t('workflow.pending');
    statePill.className = 'pill';
    $('editAnnotationFacts').replaceChildren(
      fact(t('edit.annotationsTimelineMarkers'), t('common.unknown')),
      fact(t('edit.annotationsItemMarkers'), t('common.unknown')),
      fact(t('edit.annotationsMediaMarkers'), t('common.unknown')),
      fact(t('edit.annotationsFlaggedItems'), t('common.unknown')),
      fact(t('edit.annotationsColoredItems'), t('common.unknown'))
    );
    $('editAnnotationMarkerList').replaceChildren();
    $('editAnnotationMediaList').replaceChildren();
    $('editAnnotationNote').textContent = '';
    return;
  }

  const flagsTruncated = annotations.mediaPoolAnnotations.some((item) => item.flagsTruncated);
  const bounded = [
    annotations.tracksTruncated ? t('edit.annotationsBoundedTracks') : null,
    annotations.itemsTruncated ? t('edit.annotationsBoundedItems') : null,
    annotations.markerRowsTruncated ? t('edit.annotationsBoundedMarkers') : null,
    flagsTruncated ? t('edit.annotationsBoundedFlags') : null
  ].filter((value): value is string => Boolean(value));
  const unverifiedStates = new Set<string>(annotations.unverified);
  const unverified = annotations.unverified.map(editAnnotationUnverifiedLabel);
  const methodEvidence = (observed: number, checked: number, missing: number, failed: number): string => t('edit.annotationsMethodEvidenceValue', {
    observed,
    checked,
    missing,
    failed
  });
  statePill.textContent = annotations.complete ? t('edit.annotationsReady') : t('edit.annotationsBounded');
  statePill.className = `pill ${annotations.complete ? 'good' : ''}`;
  $('editAnnotationFacts').replaceChildren(
    fact(t('edit.timelineName'), annotations.timelineLabel),
    fact(t('edit.annotationsTimelineMarkers'), String(annotations.timelineMarkerCountObserved)),
    fact(t('edit.annotationsItemMarkers'), String(annotations.timelineItemMarkerCountObserved)),
    fact(t('edit.annotationsMediaMarkers'), String(annotations.mediaPoolMarkerCountObserved)),
    fact(t('edit.annotationsFlaggedItems'), String(annotations.flaggedMediaPoolItemCountObserved)),
    fact(t('edit.annotationsColoredItems'), String(annotations.coloredMediaPoolItemCountObserved)),
    fact(t('edit.annotationsTimelineMethods'), methodEvidence(
      annotations.methodEvidence.timeline.observed,
      annotations.methodEvidence.timeline.checked,
      annotations.methodEvidence.timeline.missing,
      annotations.methodEvidence.timeline.failed
    )),
    fact(t('edit.annotationsItemMethods'), methodEvidence(
      annotations.methodEvidence.timelineItem.observed,
      annotations.methodEvidence.timelineItem.checked,
      annotations.methodEvidence.timelineItem.missing,
      annotations.methodEvidence.timelineItem.failed
    )),
    fact(t('edit.annotationsMediaMethods'), methodEvidence(
      annotations.methodEvidence.mediaPoolItem.observed,
      annotations.methodEvidence.mediaPoolItem.checked,
      annotations.methodEvidence.mediaPoolItem.missing,
      annotations.methodEvidence.mediaPoolItem.failed
    )),
    fact(t('edit.coverage'), annotations.complete ? t('edit.annotationsCoverageComplete') : t('edit.annotationsCoverageBounded'))
  );

  const markerRows: HTMLElement[] = [domainRow('edit-transition-row', [
    t('edit.annotationsColumn.scope'),
    t('edit.annotationsColumn.target'),
    t('edit.annotationsColumn.frame'),
    t('edit.annotationsColumn.marker'),
    t('edit.annotationsColumn.evidence')
  ], true)];
  for (const marker of annotations.markers) {
    const track = marker.trackType && marker.trackIndex !== null ? ` · ${editTrackLabel(marker.trackType, marker.trackIndex)}` : '';
    const markerCoverageUnverified = unverifiedStates.has('markerRows')
      || (marker.scope === 'timeline' && unverifiedStates.has('timelineMarkers'))
      || (marker.scope === 'timeline_item' && (unverifiedStates.has('timelineItemMarkers') || unverifiedStates.has('timelineItemIdentity')))
      || (marker.scope === 'media_pool_item' && (unverifiedStates.has('mediaPoolMarkers') || unverifiedStates.has('mediaPoolIdentity')));
    const markerValue = [
      marker.color,
      marker.name,
      marker.note,
      marker.duration === null ? null : t('edit.annotationsDurationValue', { value: marker.duration })
    ].filter((value): value is string => Boolean(value)).join(' · ') || t('common.unknown');
    markerRows.push(domainRow('edit-transition-row', [
      t(`edit.annotationsScope.${marker.scope}` as Parameters<typeof t>[0]),
      `${marker.targetName} · ${marker.targetHandle ?? t('common.unknown')}${track}`,
      String(marker.frame),
      markerValue,
      markerCoverageUnverified ? `GetMarkers · ${t('edit.annotationsPartiallyUnverified')}` : 'GetMarkers'
    ]));
  }
  if (markerRows.length === 1) markerRows.push(domainRow('edit-transition-row', [t('edit.annotationsNoMarkers'), '', '', '', '']));
  $('editAnnotationMarkerList').replaceChildren(...markerRows);

  const mediaRows: HTMLElement[] = [domainRow('edit-transition-row', [
    t('edit.annotationsColumn.mediaItem'),
    t('edit.annotationsColumn.markers'),
    t('edit.annotationsColumn.flags'),
    t('edit.annotationsColumn.clipColor'),
    t('edit.annotationsColumn.coverage')
  ], true)];
  const mediaMarkersUnverified = unverifiedStates.has('mediaPoolMarkers');
  const flagsUnverified = unverifiedStates.has('flags');
  const clipColorUnverified = unverifiedStates.has('clipColor');
  const mediaIdentityUnverified = unverifiedStates.has('mediaPoolIdentity') || unverifiedStates.has('mediaPoolAssociation');
  for (const item of annotations.mediaPoolAnnotations) {
    const flags = item.flags.length ? item.flags.join(' · ') : t('media.none');
    const markerCount = mediaMarkersUnverified
      ? t('edit.annotationsObservedUnverifiedValue', { value: item.markerCountObserved })
      : String(item.markerCountObserved);
    const flagValue = flagsUnverified
      ? item.flags.length ? t('edit.annotationsObservedUnverifiedValue', { value: flags }) : t('edit.annotationsValueUnverified')
      : item.flagsTruncated ? `${flags} · ${t('edit.annotationsTruncated')}` : flags;
    const clipColor = clipColorUnverified
      ? item.clipColor ? t('edit.annotationsObservedUnverifiedValue', { value: item.clipColor }) : t('edit.annotationsValueUnverified')
      : item.clipColor ?? t('media.none');
    const rowUnverified = mediaMarkersUnverified || flagsUnverified || clipColorUnverified || mediaIdentityUnverified;
    mediaRows.push(domainRow('edit-transition-row', [
      `${item.name} · ${item.semanticHandle}`,
      markerCount,
      flagValue,
      clipColor,
      item.flagsTruncated ? t('edit.annotationsBoundedFlags') : rowUnverified ? t('edit.annotationsPartiallyUnverified') : t('edit.annotationsObservedRow')
    ]));
  }
  if (mediaRows.length === 1) mediaRows.push(domainRow('edit-transition-row', [t('edit.annotationsNoMediaRows'), '', '', '', '']));
  $('editAnnotationMediaList').replaceChildren(...mediaRows);
  $('editAnnotationNote').textContent = t('edit.annotationsNote', {
    unverified: unverified.join(' · ') || t('media.none'),
    bounded: bounded.join(' · ') || t('media.none')
  });
}

function domainRow(className: string, values: string[], header = false): HTMLElement {
  const row = document.createElement('div');
  row.className = `domain-row ${className}${header ? ' is-header' : ''}`;
  for (const value of values) {
    const cell = document.createElement('span');
    cell.textContent = value;
    row.append(cell);
  }
  return row;
}

function preflightStatusLabel(status: 'pass' | 'warning' | 'blocked' | 'unverified'): string {
  return t(`preflight.status.${status}` as Parameters<typeof t>[0]);
}

function preflightCheckLabel(id: string): string {
  switch (id) {
    case 'project.identity.v1': return t('preflight.check.project');
    case 'project.settings_summary.v1': return t('preflight.check.settings');
    case 'media.inventory_summary.v1': return t('preflight.check.media');
    case 'edit.timeline_summary.v1': return t('preflight.check.edit');
    case 'fusion.composition_inspect.v1': return t('preflight.check.fusion');
    case 'fusion.graph_inspect.v1': return t('preflight.check.fusionGraph');
    case 'color.pipeline_inspect.v1': return t('preflight.check.color');
    case 'color.graph_inventory.v1': return t('preflight.check.colorGraph');
    case 'color.grade_version_inspect.v1': return t('preflight.check.colorVersions');
    case 'fairlight.mapping_inspect.v1': return t('preflight.check.fairlight');
    case 'fairlight.clip_processing_inspect.v1': return t('preflight.check.fairlightProcessing');
    case 'deliver.settings_inspect.v1': return t('preflight.check.deliver');
    default: return id;
  }
}

function preflightIssueLabel(code: string): string {
  const key = `preflight.issue.${code}` as Parameters<typeof t>[0];
  try { return t(key); } catch { return code; }
}

function capabilityStatusLabel(status: 'available' | 'unavailable' | 'conditional' | 'unreliable' | 'unknown'): string {
  return t(`capability.status.${status}` as Parameters<typeof t>[0]);
}

function capabilitySourceLabel(source: 'measured' | 'reported' | 'vendor' | 'code_floor'): string {
  return t(`capability.source.${source}` as Parameters<typeof t>[0]);
}

function paintProjectSettings(): void {
  const settings = projectInspectorDetail()?.settings ?? null;
  $('projectSettingsFacts').replaceChildren(
    fact(t('project.timelineResolution'), resolutionLabel(settings?.timelineResolution ?? null)),
    fact(t('project.timelineFrameRate'), frameRateLabel(settings?.timelineFrameRate ?? null)),
    fact(t('project.playbackFrameRate'), frameRateLabel(settings?.timelinePlaybackFrameRate ?? null)),
    fact(t('project.outputResolution'), resolutionLabel(settings?.outputResolution ?? null)),
    fact(t('project.frameRateMismatch'), settings?.frameRateMismatchBehavior ?? t('common.unknown')),
    fact(t('project.colorScience'), settings?.colorScienceMode ?? t('common.unknown')),
    fact(t('project.videoMonitorFormat'), settings?.videoMonitorFormat ?? t('common.unknown')),
    fact(t('project.timelineSettingsMode'), settings?.timelineUsesCustomSettings === true
      ? t('project.settingsCustom')
      : settings?.timelineUsesCustomSettings === false
        ? t('project.settingsProjectDefault')
        : t('common.unknown'))
  );
}

function paintProjectPreflight(): void {
  const preflight = projectInspectorDetail()?.preflight ?? null;
  const statePill = $('workflowPreflightState');
  statePill.textContent = preflight ? preflightStatusLabel(preflight.status) : t('workflow.pending');
  statePill.className = `pill ${preflight?.status === 'pass' ? 'good' : preflight?.status === 'blocked' ? 'bad' : ''}`;
  if (!preflight) {
    $('workflowPreflightFacts').replaceChildren(
      fact(t('workflow.currentProject'), t('common.unknown')),
      fact(t('workflow.currentTimeline'), t('common.unknown')),
      fact(t('preflight.overall'), t('common.unknown'))
    );
    $('projectPreflightChecks').replaceChildren();
    $('projectPreflightNote').textContent = '';
    return;
  }
  $('workflowPreflightFacts').replaceChildren(
    fact(t('preflight.overall'), preflightStatusLabel(preflight.status)),
    fact(t('workflow.currentProject'), preflight.projectLabel ?? t('workflow.noProject')),
    fact(t('workflow.currentTimeline'), preflight.timelineLabel ?? t('workflow.noTimeline')),
    fact(t('preflight.blockers'), String(preflight.blockers.length)),
    fact(t('preflight.warnings'), String(preflight.warnings.length)),
    fact(t('preflight.capabilityGaps'), String(preflight.capabilityGaps.length)),
    fact(t('preflight.capabilityEvidence'), t('preflight.capabilityEvidenceValue', {
      available: preflight.capabilityEvidence.filter((item) => item.status === 'available').length,
      conditional: preflight.capabilityEvidence.filter((item) => item.status === 'conditional').length,
      unknown: preflight.capabilityEvidence.filter((item) => item.status === 'unknown').length,
      unavailable: preflight.capabilityEvidence.filter((item) => item.status === 'unavailable').length
    }))
  );
  const rows = [
    domainRow('preflight-row', [t('preflight.column.check'), t('preflight.column.status'), t('preflight.column.issues')], true),
    ...preflight.checks.map((check) => domainRow('preflight-row', [
      preflightCheckLabel(check.id),
      preflightStatusLabel(check.status),
      check.issueCodes.length ? check.issueCodes.map(preflightIssueLabel).join(' · ') : t('preflight.noIssues')
    ]))
  ];
  $('projectPreflightChecks').replaceChildren(...rows);
  const extras = [...preflight.blockers, ...preflight.warnings, ...preflight.capabilityGaps];
  const capabilityNotes = preflight.capabilityEvidence
    .filter((item) => item.status !== 'available')
    .map((item) => t('preflight.capabilityEvidenceNote', {
      id: item.capabilityId,
      status: capabilityStatusLabel(item.status),
      source: capabilitySourceLabel(item.evidenceSource),
      limitation: item.limitations[0] ?? t('common.unknown')
    }));
  $('projectPreflightNote').textContent = [...new Set([
    ...extras.map(preflightIssueLabel),
    ...capabilityNotes
  ])].join(' · ') || t('preflight.noIssues');
}

function paintProjectInspector(): void {
  paintProjectSettings();
  paintProjectPreflight();
}

function paintColorPipeline(): void {
  const summary = colorInspectorDetail()?.pipeline ?? null;
  const statePill = $('colorPipelineState');
  statePill.textContent = summary
    ? t('workflow.ready')
    : artifactWorkspace?.context.project ? t('workflow.pending') : t('workflow.noProject');
  statePill.className = `pill ${summary ? 'good' : ''}`;
  if (!summary) {
    $('colorPipelineFacts').replaceChildren(fact(t('color.science'), t('common.unknown')), fact(t('color.output'), t('common.unknown')));
    $('colorItemList').replaceChildren();
    $('colorItemNote').textContent = '';
    return;
  }
  const settings = summary.settings;
  $('colorPipelineFacts').replaceChildren(
    fact(t('color.science'), settings?.colorScienceMode ?? t('common.unknown')),
    fact(t('color.input'), [settings?.inputColorSpace, settings?.inputGamma].filter(Boolean).join(' · ') || t('common.unknown')),
    fact(t('color.timelineSpace'), [settings?.timelineColorSpace, settings?.timelineGamma].filter(Boolean).join(' · ') || t('common.unknown')),
    fact(t('color.output'), [settings?.outputColorSpace, settings?.outputGamma].filter(Boolean).join(' · ') || t('common.unknown')),
    fact(t('color.mapping'), [settings?.outputToneMapping, settings?.outputGamutMapping].filter(Boolean).join(' · ') || t('common.unknown')),
    fact(t('color.groups'), String(summary.colorGroupCount)),
    fact(t('color.videoItems'), `${summary.videoItemsScanned} / ${summary.videoItemCountObserved}`),
    fact(t('color.nodes'), String(summary.nodeCountObserved)),
    fact(t('color.luts'), String(summary.lutReferenceCountObserved)),
    fact(t('color.coverage'), t(summary.complete ? 'color.coverageComplete' : 'color.coverageBounded'))
  );
  $('colorItemList').replaceChildren(
    domainRow('color-row', [t('color.column.name'), t('color.column.group'), t('color.column.version'), t('color.column.nodes'), t('color.column.luts'), t('color.column.versions')], true),
    ...summary.items.map((item) => domainRow('color-row', [
      item.name,
      item.groupName ?? t('common.unknown'),
      item.currentVersionName ?? t('common.unknown'),
      knownCount(item.nodeCount),
      String(item.lutReferenceCount),
      `${item.localVersionCount} / ${item.remoteVersionCount}`
    ]))
  );
  $('colorItemNote').textContent = t('color.itemsShowing', { shown: summary.items.length, scanned: summary.videoItemsScanned });
}

function paintColorGraph(): void {
  const graph = colorInspectorDetail()?.graph ?? null;
  const cacheEvidence = (node: NonNullable<typeof graph>['timelineGraph']['nodes'][number]): string => {
    if (node.cacheModeShape === 'integer' && node.cacheMode !== null) return String(node.cacheMode);
    if (node.cacheModeShape === 'null') return t('color.graphCacheNull');
    return t('common.unknown');
  };
  const statePill = $('colorGraphState');
  statePill.textContent = graph
    ? t(graph.complete ? 'color.graphReady' : 'color.graphBounded')
    : artifactWorkspace?.context.timeline ? t('workflow.pending') : t('edit.noTimeline');
  statePill.className = `pill ${graph?.complete ? 'good' : ''}`;
  if (!graph) {
    $('colorGraphFacts').replaceChildren(
      fact(t('edit.timelineName'), t('common.unknown')),
      fact(t('color.graphLayers'), t('common.unknown')),
      fact(t('color.groups'), t('common.unknown')),
      fact(t('color.graphGraphs'), t('common.unknown')),
      fact(t('color.graphNodes'), t('common.unknown')),
      fact(t('color.graphMethodEvidence'), t('common.unknown')),
      fact(t('fusion.pixels'), t('preflight.status.unverified'))
    );
    $('colorGraphList').replaceChildren();
    $('colorGraphNote').textContent = colorGraphError ?? '';
    return;
  }
  $('colorGraphFacts').replaceChildren(
    fact(t('edit.timelineName'), graph.timelineLabel),
    fact(t('color.graphLayers'), graph.nodeStackLayersReadback === 'observed' && graph.nodeStackLayersConfigured !== null
      ? `${graph.nodeStackLayersScanned} / ${graph.nodeStackLayersConfigured}`
      : t('common.unknown')),
    fact(t('color.groups'), graph.colorGroupsReadback === 'observed' && graph.colorGroupCountObserved !== null
      ? `${graph.colorGroupsScanned} / ${graph.colorGroupCountObserved}`
      : t('common.unknown')),
    fact(t('color.graphTracks'), `${graph.tracksScanned} / ${graph.videoTrackCount}`),
    fact(t('color.graphItems'), `${graph.itemsScanned} / ${graph.videoItemsObserved}`),
    fact(t('color.graphGraphs'), String(graph.graphsObserved)),
    fact(t('color.graphNodes'), `${graph.nodesReported} / ${graph.nodesObserved}`),
    fact(t('color.graphMethodEvidence'), t('color.graphMethodEvidenceValue', {
      observed: graph.methodEvidence.fullyObservedMethodCount,
      checked: graph.methodEvidence.checkedMethodCount,
      missing: graph.methodEvidence.missingMethodCount,
      failed: graph.methodEvidence.failedMethodCount
    })),
    fact(t('color.coverage'), t(graph.complete ? 'color.graphCoverageComplete' : 'color.coverageBounded')),
    fact(t('fusion.pixels'), t('preflight.status.unverified'))
  );

  const rows: HTMLElement[] = [];
  if (graph.timelineGraph.nodes.length === 0) {
    rows.push(domainRow('color-graph-row', [
      t('color.graphScopeTimeline'),
      graph.timelineLabel,
      graph.timelineGraph.nodeCountObserved === null ? t('common.unknown') : String(graph.timelineGraph.nodeCountObserved),
      t('color.graphNoNodeRows')
    ]));
  } else {
    for (const node of graph.timelineGraph.nodes) {
      rows.push(domainRow('color-graph-row', [
        t('color.graphScopeTimeline'),
        graph.timelineLabel,
        t('color.graphNodeIdentity', { index: node.ordinal, label: node.label || t('color.graphEmptyLabel') }),
        t('color.graphNodeEvidence', {
          lut: node.lutReferencePresent === true ? t('color.graphLutObserved') : node.lutReferencePresent === false ? t('color.graphLutNotObserved') : t('common.unknown'),
          cache: cacheEvidence(node),
          tools: node.toolListShape === 'null' ? t('color.graphToolsNull') : node.toolNames.join(' · ') || t('color.graphToolsEmptyList')
        })
      ]));
    }
  }
  for (const scope of graph.itemGraphs) {
    const scopeLabel = scope.trackIndex === null || scope.layerIndex === null
      ? t('common.unknown')
      : `V${scope.trackIndex} · L${scope.layerIndex}`;
    const itemLabel = `${scope.timelineItemName ?? t('common.unknown')} · ${scope.timelineItemHandle ?? t('common.unknown')}`;
    if (scope.nodes.length === 0) {
      rows.push(domainRow('color-graph-row', [
        scopeLabel,
        itemLabel,
        scope.nodeCountObserved === null ? t('common.unknown') : String(scope.nodeCountObserved),
        scope.graphAccess === 'observed' ? t('color.graphNoNodeRows') : t(`color.graphAccess.${scope.graphAccess}` as Parameters<typeof t>[0])
      ]));
      continue;
    }
    for (const node of scope.nodes) {
      rows.push(domainRow('color-graph-row', [
        scopeLabel,
        itemLabel,
        t('color.graphNodeIdentity', { index: node.ordinal, label: node.label || t('color.graphEmptyLabel') }),
        t('color.graphNodeEvidence', {
          lut: node.lutReferencePresent === true ? t('color.graphLutObserved') : node.lutReferencePresent === false ? t('color.graphLutNotObserved') : t('common.unknown'),
          cache: cacheEvidence(node),
          tools: node.toolListShape === 'null' ? t('color.graphToolsNull') : node.toolNames.join(' · ') || t('color.graphToolsEmptyList')
        })
      ]));
    }
  }
  for (const scope of graph.colorGroupGraphs) {
    const scopeLabel = scope.scope === 'group_pre' ? t('color.graphScopeGroupPre') : t('color.graphScopeGroupPost');
    const groupLabel = scope.colorGroupName ?? t('common.unknown');
    if (scope.nodes.length === 0) {
      rows.push(domainRow('color-graph-row', [
        scopeLabel,
        groupLabel,
        scope.nodeCountObserved === null ? t('common.unknown') : String(scope.nodeCountObserved),
        scope.graphAccess === 'observed' ? t('color.graphNoNodeRows') : t(`color.graphAccess.${scope.graphAccess}` as Parameters<typeof t>[0])
      ]));
      continue;
    }
    for (const node of scope.nodes) {
      rows.push(domainRow('color-graph-row', [
        scopeLabel,
        groupLabel,
        t('color.graphNodeIdentity', { index: node.ordinal, label: node.label || t('color.graphEmptyLabel') }),
        t('color.graphNodeEvidence', {
          lut: node.lutReferencePresent === true ? t('color.graphLutObserved') : node.lutReferencePresent === false ? t('color.graphLutNotObserved') : t('common.unknown'),
          cache: cacheEvidence(node),
          tools: node.toolListShape === 'null' ? t('color.graphToolsNull') : node.toolNames.join(' · ') || t('color.graphToolsEmptyList')
        })
      ]));
    }
  }
  $('colorGraphList').replaceChildren(
    domainRow('color-graph-row', [t('color.graphColumnScope'), t('color.graphColumnTarget'), t('color.graphColumnNode'), t('color.graphColumnEvidence')], true),
    ...rows
  );
  const unverified = graph.unverified.map((value) => t(`color.graphUnverified.${value}` as Parameters<typeof t>[0])).join(' · ') || t('media.none');
  const bounded = [
    graph.layersTruncated ? t('color.graphLayersTruncated') : null,
    graph.colorGroupsTruncated ? t('color.graphGroupsTruncated') : null,
    graph.tracksTruncated ? t('fusion.tracksTruncated') : null,
    graph.itemsTruncated ? t('fusion.itemsTruncated') : null,
    graph.nodesTruncated ? t('color.graphNodesTruncated') : null,
    graph.toolsTruncated ? t('color.graphToolsTruncated') : null
  ].filter((value): value is string => Boolean(value)).join(' · ') || t('media.none');
  $('colorGraphNote').textContent = t('color.graphNote', { unverified, bounded });
}

function paintColorVersions(): void {
  const versions = colorInspectorDetail()?.versions ?? null;
  const statePill = $('colorVersionsState');
  statePill.textContent = versions
    ? t(versions.complete ? 'color.versionsReady' : 'color.versionsBounded')
    : artifactWorkspace?.context.timeline ? t('workflow.pending') : t('edit.noTimeline');
  statePill.className = `pill ${versions?.complete ? 'good' : ''}`;
  if (!versions) {
    $('colorVersionsFacts').replaceChildren(
      fact(t('edit.timelineName'), t('common.unknown')),
      fact(t('color.versionsItems'), t('common.unknown')),
      fact(t('color.versionsMethodEvidence'), t('common.unknown')),
      fact(t('fusion.pixels'), t('preflight.status.unverified'))
    );
    $('colorVersionsList').replaceChildren();
    $('colorVersionsNote').textContent = colorVersionsError ?? '';
    return;
  }

  $('colorVersionsFacts').replaceChildren(
    fact(t('edit.timelineName'), versions.timelineLabel),
    fact(t('color.versionsTracks'), `${versions.tracksScanned} / ${versions.videoTrackCount}`),
    fact(t('color.versionsItems'), `${versions.itemsScanned} / ${versions.videoItemsObserved}`),
    fact(t('color.versionsMethodEvidence'), t('color.versionsMethodEvidenceValue', {
      observed: versions.methodEvidence.fullyObservedMethodCount,
      checked: versions.methodEvidence.checkedMethodCount,
      missing: versions.methodEvidence.missingMethodCount,
      failed: versions.methodEvidence.failedMethodCount
    })),
    fact(t('color.coverage'), t(versions.complete ? 'color.versionsCoverageComplete' : 'color.coverageBounded')),
    fact(t('fusion.pixels'), t('preflight.status.unverified'))
  );

  $('colorVersionsList').replaceChildren(
    domainRow('color-version-row', [t('color.versionsColumnItem'), t('color.versionsColumnCurrent'), t('color.versionsColumnLocal'), t('color.versionsColumnRemote')], true),
    ...versions.items.map((item) => domainRow('color-version-row', [
      `V${item.trackIndex} · ${item.timelineItemName} · ${item.timelineItemHandle}`,
      item.currentVersion
        ? `${item.currentVersion.name} · ${t(item.currentVersion.type === 0 ? 'color.versionTypeLocal' : 'color.versionTypeRemote')}`
        : t(`color.versionReadback.${item.currentReadback}` as Parameters<typeof t>[0]),
      item.localReadback === 'observed'
        ? item.localVersions.join(' · ') || t('color.versionsNoneObserved')
        : t(`color.versionReadback.${item.localReadback}` as Parameters<typeof t>[0]),
      item.remoteReadback === 'observed'
        ? item.remoteVersions.join(' · ') || t('color.versionsNoneObserved')
        : t(`color.versionReadback.${item.remoteReadback}` as Parameters<typeof t>[0])
    ]))
  );

  const unverified = versions.unverified.map((value) => t(`color.versionsUnverified.${value}` as Parameters<typeof t>[0])).join(' · ') || t('media.none');
  const bounded = [
    versions.tracksTruncated ? t('fusion.tracksTruncated') : null,
    versions.itemsTruncated ? t('fusion.itemsTruncated') : null,
    versions.versionNamesTruncated ? t('color.versionsNamesTruncated') : null
  ].filter((value): value is string => Boolean(value)).join(' · ') || t('media.none');
  $('colorVersionsNote').textContent = t('color.versionsNote', { unverified, bounded });
}

function paintFusionComposition(): void {
  const summary = fusionInspectorDetail()?.composition ?? null;
  const graph = fusionInspectorDetail()?.graph ?? null;
  const statePill = $('fusionCompositionState');
  statePill.textContent = summary
    ? t(summary.complete ? 'fusion.ready' : 'fusion.bounded')
    : artifactWorkspace && !artifactWorkspace.context.timeline ? t('edit.noTimeline') : t('workflow.pending');
  statePill.className = `pill ${summary?.complete ? 'good' : ''}`;
  if (!summary) {
    $('fusionCompositionFacts').replaceChildren(
      fact(t('edit.timelineName'), t('common.unknown')),
      fact(t('fusion.tracksScanned'), t('common.unknown')),
      fact(t('fusion.itemsReported'), t('common.unknown')),
      fact(t('fusion.compositionCount'), t('common.unknown')),
      fact(t('fusion.graphToolsIo'), graph ? t(graph.complete ? 'fusion.graphReady' : 'fusion.graphBounded') : t('preflight.status.unverified')),
      fact(t('fusion.pixels'), t('preflight.status.unverified'))
    );
    $('fusionCompositionList').replaceChildren();
    $('fusionCompositionNote').textContent = fusionError ?? '';
    return;
  }
  const methodEvidence = t('fusion.methodEvidenceValue', {
    observed: summary.methodEvidence.fullyObservedMethodCount,
    checked: summary.methodEvidence.checkedMethodCount,
    missing: summary.methodEvidence.missingMethodCount,
    failed: summary.methodEvidence.failedMethodCount
  });
  const knownCompositionTotal = summary.items.reduce((total, item) => total + (item.compositionCountObserved ?? 0), 0);
  const hasUnknownCompositionCount = summary.items.some((item) => item.compositionCountObserved === null);
  const compositionTotal = hasUnknownCompositionCount
    ? t('fusion.compositionCountPartial', { value: knownCompositionTotal })
    : String(knownCompositionTotal);
  $('fusionCompositionFacts').replaceChildren(
    fact(t('edit.timelineName'), `${summary.timeline.name} · ${summary.timeline.semanticHandle}`),
    fact(t('fusion.tracksScanned'), `${summary.tracksScanned} / ${summary.videoTrackCount}`),
    fact(t('fusion.itemsReported'), `${summary.itemsReported} / ${summary.videoItemsObserved}`),
    fact(t('fusion.compositionCount'), compositionTotal),
    fact(t('fusion.methodEvidence'), methodEvidence),
    fact(t('fusion.coverage'), t(summary.complete ? 'fusion.coverageComplete' : 'fusion.coverageBounded')),
    fact(t('fusion.graphToolsIo'), graph ? t(graph.complete ? 'fusion.graphReady' : 'fusion.graphBounded') : t('preflight.status.unverified')),
    fact(t('fusion.pixels'), t('preflight.status.unverified'))
  );
  const rows = summary.items.map((item) => domainRow('fusion-row', [
    `V${item.trackIndex}`,
    `${item.name ?? t('common.unknown')} · ${item.semanticHandle ?? t('common.unknown')}`,
    item.compositionCountObserved === null ? t('common.unknown') : String(item.compositionCountObserved),
    item.compositionNames.length ? item.compositionNames.join(' · ') : t('fusion.noCompositionNames')
  ]));
  $('fusionCompositionList').replaceChildren(
    domainRow('fusion-row', [t('fusion.column.track'), t('fusion.column.item'), t('fusion.column.count'), t('fusion.column.names')], true),
    ...(rows.length ? rows : [domainRow('fusion-row', [t('fusion.noItems'), '', '', ''])])
  );
  const unverified = summary.unverified.map((value) => t(`fusion.unverified.${value}` as Parameters<typeof t>[0])).join(' · ') || t('media.none');
  const bounded = [
    summary.tracksTruncated ? t('fusion.tracksTruncated') : null,
    summary.itemsTruncated ? t('fusion.itemsTruncated') : null,
    summary.namesTruncated ? t('fusion.namesTruncated') : null
  ].filter((value): value is string => Boolean(value)).join(' · ') || t('media.none');
  $('fusionCompositionNote').textContent = t('fusion.note', {
    unverified,
    bounded
  });
}

function paintFusionGraph(): void {
  const graph = fusionInspectorDetail()?.graph ?? null;
  const statePill = $('fusionGraphState');
  statePill.textContent = graph
    ? t(graph.complete ? 'fusion.graphReady' : 'fusion.graphBounded')
    : artifactWorkspace && !artifactWorkspace.context.timeline ? t('edit.noTimeline') : t('workflow.pending');
  statePill.className = `pill ${graph?.complete ? 'good' : ''}`;
  if (!graph) {
    $('fusionGraphFacts').replaceChildren(
      fact(t('edit.timelineName'), t('common.unknown')),
      fact(t('fusion.graphCompositions'), t('common.unknown')),
      fact(t('fusion.graphTools'), t('common.unknown')),
      fact(t('fusion.graphEdges'), t('common.unknown')),
      fact(t('fusion.pixels'), t('preflight.status.unverified'))
    );
    $('fusionGraphList').replaceChildren();
    $('fusionGraphNote').textContent = fusionGraphError ?? '';
    return;
  }
  $('fusionGraphFacts').replaceChildren(
    fact(t('edit.timelineName'), `${graph.timeline.name} · ${graph.timeline.semanticHandle}`),
    fact(t('fusion.graphCompositions'), `${graph.compositionsReported} / ${graph.compositionsObserved}`),
    fact(t('fusion.graphTools'), `${graph.toolsReported} / ${graph.toolsObserved}`),
    fact(t('fusion.graphEdges'), `${graph.edgesReported} / ${graph.edgesObserved}`),
    fact(t('fusion.graphMethodEvidence'), t('fusion.graphMethodEvidenceValue', {
      checked: graph.methodEvidence.checkedMethodCount,
      failed: graph.methodEvidence.failedMethodCount
    })),
    fact(t('fusion.coverage'), t(graph.complete ? 'fusion.graphCoverageComplete' : 'fusion.coverageBounded')),
    fact(t('fusion.pixels'), t('preflight.status.unverified'))
  );
  const rows = graph.compositions.flatMap((composition) => {
    if (!composition.tools.length) {
      return [domainRow('fusion-row', [composition.compositionName, t('fusion.graphNoTools'), '0 / 0', t('fusion.graphNoConnections')])];
    }
    return composition.tools.map((tool) => {
      const connections = tool.connections.length
        ? tool.connections.map((connection) => t(connection.bidirectionalReadback ? 'fusion.graphConnectionVerified' : 'fusion.graphConnectionUnverified', {
            value: `${tool.name} → ${connection.targetToolName}`
          })).join(' · ')
        : t('fusion.graphNoConnections');
      return domainRow('fusion-row', [
        composition.compositionName,
        tool.name,
        t('fusion.graphPortsValue', { inputs: tool.inputCountObserved, outputs: tool.outputCountObserved }),
        connections
      ]);
    });
  });
  $('fusionGraphList').replaceChildren(
    domainRow('fusion-row', [t('fusion.graphColumnComposition'), t('fusion.graphColumnTool'), t('fusion.graphColumnPorts'), t('fusion.graphColumnConnections')], true),
    ...(rows.length ? rows : [domainRow('fusion-row', [t('fusion.graphNoRows'), '', '', ''])])
  );
  const unverified = graph.unverified.map((value) => t(`fusion.graphUnverified.${value}` as Parameters<typeof t>[0])).join(' · ') || t('media.none');
  const bounded = [
    graph.tracksTruncated ? t('fusion.tracksTruncated') : null,
    graph.itemsTruncated ? t('fusion.itemsTruncated') : null,
    graph.compositionsTruncated ? t('fusion.graphCompositionsTruncated') : null,
    graph.toolsTruncated ? t('fusion.graphToolsTruncated') : null,
    graph.portsTruncated ? t('fusion.graphPortsTruncated') : null,
    graph.edgesTruncated ? t('fusion.graphEdgesTruncated') : null
  ].filter((value): value is string => Boolean(value)).join(' · ') || t('media.none');
  $('fusionGraphNote').textContent = t('fusion.graphNote', { unverified, bounded });
}

function paintFairlightMapping(): void {
  const summary = fairlightInspectorDetail()?.mapping ?? null;
  const statePill = $('fairlightMappingState');
  statePill.textContent = summary
    ? t('workflow.ready')
    : artifactWorkspace?.context.timeline ? t('workflow.pending') : t('edit.noTimeline');
  statePill.className = `pill ${summary ? 'good' : ''}`;
  if (!summary) {
    $('fairlightMappingFacts').replaceChildren(fact(t('fairlight.audioTracks'), t('common.unknown')), fact(t('fairlight.mappings'), t('common.unknown')));
    $('fairlightTrackList').replaceChildren();
    $('fairlightTrackNote').textContent = '';
    return;
  }
  $('fairlightMappingFacts').replaceChildren(
    fact(t('edit.timelineName'), summary.timelineLabel),
    fact(t('fairlight.audioTracks'), String(summary.audioTrackCount)),
    fact(t('fairlight.audioItems'), String(summary.audioItemCountObserved)),
    fact(t('fairlight.mappings'), t('fairlight.mappingValue', { verified: summary.sourceMappingVerifiedItemCount, unknown: summary.sourceMappingUnverifiedItemCount })),
    fact(t('fairlight.coverage'), t(summary.complete ? 'fairlight.coverageComplete' : 'fairlight.coverageBounded'))
  );
  $('fairlightTrackList').replaceChildren(
    domainRow('fairlight-row', [t('edit.column.track'), t('edit.column.name'), t('fairlight.column.type'), t('edit.column.enabled'), t('edit.column.locked'), t('fairlight.column.voice'), t('fairlight.column.mapping')], true),
    ...summary.tracks.map((track) => domainRow('fairlight-row', [
      `A${track.index}`,
      track.name ?? t('common.unknown'),
      track.subType ?? t('common.unknown'),
      track.enabled === true ? t('edit.enabled') : track.enabled === false ? t('edit.disabled') : t('common.unknown'),
      track.locked === true ? t('edit.locked') : track.locked === false ? t('edit.unlocked') : t('common.unknown'),
      track.voiceIsolation ? t('fairlight.voiceValue', { enabled: track.voiceIsolation.isEnabled ? t('common.yes') : t('common.no'), amount: track.voiceIsolation.amount ?? t('common.unknown') }) : t('common.unknown'),
      t('fairlight.mappingValue', { verified: track.sourceMappingVerifiedItemCount, unknown: track.sourceMappingUnverifiedItemCount })
    ]))
  );
  $('fairlightTrackNote').textContent = t('fairlight.tracksShowing', { shown: summary.tracks.length, scanned: summary.itemsScanned });
}

function paintFairlightProcessing(): void {
  const processing = fairlightInspectorDetail()?.processing ?? null;
  const statePill = $('fairlightProcessingState');
  statePill.textContent = processing
    ? t(processing.complete ? 'fairlight.processingReady' : 'fairlight.processingBounded')
    : artifactWorkspace?.context.timeline ? t('workflow.pending') : t('edit.noTimeline');
  statePill.className = `pill ${processing?.complete ? 'good' : ''}`;
  if (!processing) {
    $('fairlightProcessingFacts').replaceChildren(
      fact(t('edit.timelineName'), t('common.unknown')),
      fact(t('fairlight.processingItems'), t('common.unknown')),
      fact(t('fairlight.processingGetterEvidence'), t('common.unknown'))
    );
    $('fairlightProcessingList').replaceChildren();
    $('fairlightProcessingNote').textContent = fairlightProcessingError ?? '';
    return;
  }

  const matched = processing.items.filter((item) => item.voiceConsistency === 'matched').length;
  const contradictions = processing.items.filter((item) => item.voiceConsistency === 'contradiction').length;
  $('fairlightProcessingFacts').replaceChildren(
    fact(t('edit.timelineName'), processing.timelineLabel),
    fact(t('fairlight.processingTracks'), `${processing.tracksScanned} / ${processing.audioTrackCount}`),
    fact(t('fairlight.processingItems'), `${processing.itemsScanned} / ${processing.audioItemsObserved}`),
    fact(t('fairlight.processingGetterEvidence'), t('fairlight.processingGetterEvidenceValue', {
      observed: processing.methodEvidence.fullyObservedMethodCount,
      checked: processing.methodEvidence.checkedMethodCount,
      missing: processing.methodEvidence.missingMethodCount,
      failed: processing.methodEvidence.failedMethodCount
    })),
    fact(t('fairlight.processingVoiceCrossCheck'), t('fairlight.processingVoiceCrossCheckValue', { matched, contradictions })),
    fact(t('fairlight.coverage'), t(processing.complete ? 'fairlight.coverageComplete' : 'fairlight.coverageBounded'))
  );

  const enabled = (value: boolean | null): string => value === true ? t('edit.enabled') : value === false ? t('edit.disabled') : t('common.unknown');
  const rawNumber = (value: number | null): string => value === null ? t('common.unknown') : String(value);
  $('fairlightProcessingList').replaceChildren(
    domainRow('fairlight-processing-row', [
      t('edit.column.track'),
      t('fairlight.processingColumnItem'),
      t('fairlight.processingColumnVolume'),
      t('fairlight.processingColumnPanPitch'),
      t('fairlight.processingColumnVoice'),
      t('fairlight.processingColumnDialogue')
    ], true),
    ...processing.items.map((item) => domainRow('fairlight-processing-row', [
      `A${item.trackIndex}`,
      `${item.name} · ${item.semanticHandle}`,
      t('fairlight.processingVolumeValue', { enabled: enabled(item.volumeEnabled), value: rawNumber(item.volumeDb) }),
      t('fairlight.processingPanPitchValue', {
        panEnabled: enabled(item.panEnabled),
        pan: rawNumber(item.pan),
        pitchEnabled: enabled(item.pitchEnabled),
        semitones: rawNumber(item.pitchSemitones),
        cents: rawNumber(item.pitchCents)
      }),
      t('fairlight.processingVoiceValue', {
        enabled: enabled(item.voiceIsolationEnabled),
        amount: rawNumber(item.voiceIsolationAmount),
        consistency: t(`fairlight.processingVoiceConsistency.${item.voiceConsistency}` as Parameters<typeof t>[0])
      }),
      t('fairlight.processingDialogueValue', {
        enabled: enabled(item.dialogueLevelerEnabled),
        mode: rawNumber(item.dialogueLevelerMode),
        reduce: enabled(item.dialogueReduceLoud),
        lift: enabled(item.dialogueLiftSoft),
        background: enabled(item.dialogueBackgroundReduction),
        gain: rawNumber(item.dialogueOutputGainDb)
      })
    ]))
  );
  const unverified = processing.unverified.map((value) => t(`fairlight.processingUnverified.${value}` as Parameters<typeof t>[0])).join(' · ');
  const bounded = [processing.tracksTruncated ? t('fairlight.processingTracksTruncated') : null, processing.itemsTruncated ? t('fairlight.processingItemsTruncated') : null]
    .filter((value): value is string => Boolean(value)).join(' · ') || t('media.none');
  $('fairlightProcessingNote').textContent = t('fairlight.processingNote', { unverified, bounded });
}

function paintDeliver(): void {
  const detail = deliverInspectorDetail();
  const capabilities = detail?.capabilities ?? null;
  const settings = detail?.settings ?? null;
  const capPill = $('deliverCapabilityState');
  capPill.textContent = capabilities
    ? t('workflow.ready')
    : artifactWorkspace?.context.project ? t('workflow.pending') : t('workflow.noProject');
  capPill.className = `pill ${capabilities ? 'good' : ''}`;
  const settingsPill = $('deliverSettingsState');
  settingsPill.textContent = settings
    ? t('workflow.ready')
    : artifactWorkspace?.context.project ? t('workflow.pending') : t('workflow.noProject');
  settingsPill.className = `pill ${settings ? 'good' : ''}`;
  if (!capabilities || !settings) {
    $('deliverCapabilityFacts').replaceChildren(fact(t('deliver.videoFormats'), t('common.unknown')));
    $('deliverSettingsFacts').replaceChildren(fact(t('deliver.currentFormat'), t('common.unknown')));
    $('deliverFormatList').replaceChildren();
    $('deliverPresetNote').textContent = '';
    $('deliverJobList').replaceChildren();
    $('deliverJobNote').textContent = '';
    return;
  }
  $('deliverCapabilityFacts').replaceChildren(
    fact(t('deliver.videoFormats'), String(capabilities.videoFormatCount)),
    fact(t('deliver.videoCodecs'), String(capabilities.videoCodecCountObserved)),
    fact(t('deliver.audioFormats'), String(capabilities.audioFormatCount)),
    fact(t('deliver.audioCodecs'), String(capabilities.audioCodecCountObserved)),
    fact(t('deliver.resolutions'), String(capabilities.generalResolutions.length)),
    fact(
      t('deliver.currentSelectionResolutions'),
      capabilities.currentSelection
        ? t('deliver.currentSelectionResolutionsValue', {
            format: capabilities.currentSelection.format ?? t('common.unknown'),
            codec: capabilities.currentSelection.codec ?? t('common.unknown'),
            count: capabilities.currentSelection.resolutionCount
          })
        : t('common.unknown')
    ),
    fact(t('deliver.presets'), String(capabilities.renderPresetCount)),
    fact(t('deliver.quickPresets'), String(capabilities.quickExportPresetCount)),
    fact(t('deliver.coverage'), t(capabilities.complete ? 'deliver.coverageComplete' : 'deliver.coverageBounded'))
  );
  $('deliverFormatList').replaceChildren(
    domainRow('deliver-format-row', [t('deliver.column.format'), t('deliver.column.extension'), t('deliver.column.codecCount'), t('deliver.column.codecs')], true),
    ...capabilities.videoFormats.map((format) => domainRow('deliver-format-row', [
      format.name,
      format.extension,
      String(format.codecCount),
      format.codecs.join(' · ') || t('common.unknown')
    ]))
  );
  $('deliverPresetNote').textContent = t('deliver.presetNamesNote', {
    renderShown: capabilities.renderPresets.length,
    renderObserved: capabilities.renderPresetCount,
    renderNames: capabilities.renderPresets.join(' · ') || t('deliver.noPresets'),
    quickShown: capabilities.quickExportPresets.length,
    quickObserved: capabilities.quickExportPresetCount,
    quickNames: capabilities.quickExportPresets.join(' · ') || t('deliver.noPresets')
  });
  $('deliverSettingsFacts').replaceChildren(
    fact(t('deliver.currentFormat'), settings.currentFormat ?? t('common.unknown')),
    fact(t('deliver.currentCodec'), settings.currentCodec ?? t('common.unknown')),
    fact(t('deliver.renderMode'), settings.renderMode === 'singleClip' ? t('deliver.singleClip') : settings.renderMode === 'individualClips' ? t('deliver.individualClips') : t('common.unknown')),
    fact(t('deliver.rendering'), settings.renderingInProgress === null ? t('common.unknown') : settings.renderingInProgress ? t('common.yes') : t('common.no')),
    fact(t('deliver.queueJobs'), String(settings.renderJobCountObserved)),
    fact(t('deliver.currentSettingsLimit'), t('deliver.currentSettingsUnavailable'))
  );
  const jobRows = settings.jobs.map((job) => domainRow('deliver-job-row', [
    job.name ?? job.semanticHandle,
    job.timelineName ?? t('common.unknown'),
    job.status ?? t('common.unknown'),
    job.outputResolution ? resolutionLabel(job.outputResolution) : t('common.unknown'),
    [job.videoFormat, job.videoCodec, job.audioCodec].filter(Boolean).join(' · ') || t('common.unknown')
  ]));
  $('deliverJobList').replaceChildren(
    domainRow('deliver-job-row', [t('deliver.column.job'), t('deliver.column.timeline'), t('deliver.column.status'), t('deliver.column.resolution'), t('deliver.column.encoding')], true),
    ...jobRows
  );
  $('deliverJobNote').textContent = t('deliver.jobsShowing', { shown: settings.jobs.length, observed: settings.renderJobCountObserved });
}

function paintWorkflow(next: AppState): void {
  const active = next.gateway.active && next.gateway.schemaHash !== null;
  const connectionState = $('workflowConnectionState');
  const capabilityState = $('workflowCapabilityState');
  connectionState.textContent = active ? t('workflow.ready') : t('workflow.disconnected');
  capabilityState.textContent = active ? t('workflow.ready') : t('workflow.disconnected');
  connectionState.className = `pill ${active ? 'good' : ''}`;
  capabilityState.className = `pill ${active ? 'good' : ''}`;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-workflow]')) button.disabled = !active;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-media]')) button.disabled = !active;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-edit]')) button.disabled = !active;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-fusion]')) button.disabled = !active;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-color]')) button.disabled = !active;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-fairlight]')) button.disabled = !active;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-deliver]')) button.disabled = !active;

  if (!active) {
    workflowConnection = null;
    workflowCapabilities = null;
    resetLegacyDomainSnapshots();
    workflowRisk = null;
    workflowAudit = [];
  } else if ([workflowConnection, workflowCapabilities]
    .some((snapshot) => snapshot !== null && snapshot.schemaHash !== next.gateway.schemaHash)) {
    workflowConnection = null;
    workflowCapabilities = null;
    resetLegacyDomainSnapshots();
  }

  $('workflowConnectionFacts').replaceChildren(
    fact(t('workflow.resolveVersion'), workflowConnection?.resolveVersion ?? next.resolve.serverVersion ?? t('common.unknown')),
    fact(t('workflow.server'), workflowConnection?.serverName ?? next.resolve.serverName ?? t('common.unknown')),
    fact(t('fact.protocol'), workflowConnection?.protocolVersion ?? next.resolve.protocolVersion ?? t('common.unknown')),
    fact(t('workflow.schema'), shortHash(workflowConnection?.schemaHash ?? next.gateway.schemaHash))
  );
  $('workflowCapabilityFacts').replaceChildren(
    fact(t('workflow.rawTools'), String(workflowCapabilities?.officialToolCount ?? next.resolve.tools.length)),
    fact(t('workflow.protectedTools'), workflowCapabilities?.protectedTools.join(', ') ?? 'status, inspect, inspect_operation, audit, plan, execute'),
    fact(t('workflow.schema'), shortHash(workflowCapabilities?.schemaHash ?? next.gateway.schemaHash))
  );
  $('workflowSafetyFacts').replaceChildren(
    fact(t('workflow.workflowId'), workflowRisk?.workflowId ?? t('common.unknown')),
    fact(t('workflow.riskLevel'), workflowRiskLabel(workflowRisk)),
    fact(t('workflow.readOnly'), workflowRisk?.readOnly === true ? t('common.yes') : workflowRisk?.readOnly === false ? t('common.no') : t('common.unknown')),
    fact(t('workflow.destructive'), workflowRisk?.destructive === false ? t('common.no') : workflowRisk?.destructive === true ? t('common.yes') : t('common.unknown')),
    fact(t('workflow.blastRadius'), workflowBlastLabel(workflowRisk)),
    fact(t('workflow.confirmation'), workflowRisk?.confirmationRequired ? t('common.yes') : t('common.no')),
    fact(t('workflow.approval'), workflowApprovalLabel(workflowRisk)),
    fact(t('workflow.recovery'), workflowRisk?.recoveryClass ? t('workflow.recoveryClass', { value: workflowRisk.recoveryClass }) : t('common.unknown')),
    fact(t('workflow.preview'), workflowPreviewLabel(workflowRisk)),
    fact(t('workflow.verification'), workflowVerificationLabel(workflowRisk))
  );
  $('workflowSafetyState').textContent = workflowRisk?.riskEstablished ? t('workflow.ready') : t('workflow.pending');
  $('workflowSafetyState').className = `pill ${workflowRisk?.riskEstablished ? 'good' : ''}`;
  const auditNodes: HTMLElement[] = workflowAudit.map((entry) => {
    const row = document.createElement('div');
    row.className = 'workflow-audit-row';
    const main = document.createElement('div');
    const tool = document.createElement('b');
    const detail = document.createElement('span');
    tool.textContent = entry.tool;
    detail.textContent = `${new Date(entry.startedAt).toLocaleTimeString(uiLanguage() === 'zh-CN' ? 'zh-CN' : 'en')} · ${entry.durationMs} ms`;
    main.append(tool, detail);
    const outcome = document.createElement('span');
    outcome.className = `workflow-audit-outcome ${entry.outcome}`;
    outcome.textContent = t(entry.outcome === 'success' ? 'workflow.auditSuccess' : 'workflow.auditFailure');
    row.append(main, outcome);
    return row;
  });
  if (auditNodes.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'workflow-audit-empty';
    empty.textContent = t('workflow.auditEmpty');
    auditNodes.push(empty);
  }
  $('workflowAuditList').replaceChildren(...auditNodes);
  paintMediaInventory();
  paintMediaClip();
  paintMediaLinkStatus();
  paintEditTimeline();
  paintEditStructure();
  paintEditGapsOverlaps();
  paintEditSourceRanges();
  paintEditTransitions();
  paintEditAnnotations();
  paintFusionComposition();
  paintFusionGraph();
  paintColorPipeline();
  paintColorGraph();
  paintColorVersions();
  paintFairlightMapping();
  paintFairlightProcessing();
  paintDeliver();
}

function configFromUi(): AppConfig {
  return {
    tunnelId: $<HTMLInputElement>('tunnelId').value.trim(),
    workflowTunnelId: $<HTMLInputElement>('workflowTunnelId').value.trim(),
    projectLocations: state?.config.projectLocations ?? [],
    chatgptVerified: state?.config.chatgptVerified ?? false,
    workflowChatgptVerified: state?.config.workflowChatgptVerified ?? false,
    language: state?.config.language ?? 'system',
    navigationLayout: $<HTMLInputElement>('navigationLayoutSidebar').checked ? 'sidebar' : 'topbar',
    sidebarCollapsed: state?.config.sidebarCollapsed ?? false,
    autoConnectOnLaunch: $<HTMLInputElement>('autoConnectOnLaunch').checked,
    keepRunningOnWindowClose: $<HTMLInputElement>('keepRunningOnWindowClose').checked,
    showMenuBarIcon: $<HTMLInputElement>('showMenuBarIcon').checked,
    launchAtLogin: $<HTMLInputElement>('launchAtLogin').checked,
    developerMode: $<HTMLInputElement>('developerMode').checked
  };
}

async function saveSetup(): Promise<boolean> {
  const saved = await unwrap(api.saveConfig(configFromUi()));
  if (!saved) return false;
  paint(saved);
  const key = $<HTMLInputElement>('apiKey').value.trim();
  if (!key) return true;
  const withKey = await unwrap(api.setApiKey(key));
  if (!withKey) return false;
  $<HTMLInputElement>('apiKey').value = '';
  paint(withKey);
  return true;
}

function paint(next: AppState, preserveForm = false): void {
  const previous = state;
  state = next;
  setUiLanguage(next.config.language, next.preferredSystemLanguages);
  paintSharedContext();
  appRoot.dataset.navigationLayout = next.config.navigationLayout;
  paintSidebarCollapse(next);
  requestAnimationFrame(positionWorkspaceTabIndicator);
  try { window.localStorage.setItem(UI_LANGUAGE_BOOTSTRAP_KEY, next.config.language); } catch { /* optional */ }
  for (const option of document.querySelectorAll<HTMLButtonElement>('.language-option')) {
    const selected = option.dataset.language === next.config.language;
    option.classList.toggle('is-sel', selected);
    option.setAttribute('aria-checked', String(selected));
  }
  $('languageButtonLabel').textContent = t(next.config.language === 'system'
    ? 'language.system'
    : next.config.language === 'en'
      ? 'language.english'
      : 'language.chinese');
  $<HTMLInputElement>('workflowTunnelName').value = WORKFLOW_CONNECTOR_NAME;
  $<HTMLInputElement>('workflowTunnelDescription').value = t('connector.workflowDescriptionValue');
  $<HTMLInputElement>('tunnelName').value = CONNECTOR_NAME;
  $<HTMLInputElement>('connectorName').value = CONNECTOR_NAME;
  $<HTMLInputElement>('connectorDescription').value = t('connector.descriptionValue');
  $<HTMLInputElement>('workflowConnectorName').value = WORKFLOW_CONNECTOR_NAME;
  $<HTMLInputElement>('workflowConnectorDescription').value = t('connector.workflowDescriptionValue');
  $<HTMLInputElement>('navigationLayoutSidebar').checked = next.config.navigationLayout === 'sidebar';
  $<HTMLInputElement>('autoConnectOnLaunch').checked = next.config.autoConnectOnLaunch;
  $<HTMLInputElement>('keepRunningOnWindowClose').checked = next.config.keepRunningOnWindowClose;
  $<HTMLInputElement>('showMenuBarIcon').checked = next.config.showMenuBarIcon;
  $<HTMLInputElement>('launchAtLogin').checked = next.config.launchAtLogin;
  $<HTMLInputElement>('developerMode').checked = next.config.developerMode;
  $('advancedTunnelVersion').textContent = next.resolvedTunnelClientVersion
    ? `tunnel-client ${next.resolvedTunnelClientVersion.split('+')[0]}`
    : next.resolvedTunnelClient ? t('binary.ready') : t('binary.missing');
  $('developerDetails').hidden = !next.config.developerMode;
  $('developerMcpPath').textContent = next.resolve.mcpPath || t('common.notFound');
  $('developerTunnelPath').textContent = next.resolvedTunnelClient ?? t('common.notFound');
  $('developerHealth').textContent = [
    next.workflowTunnel.healthBase ? `Workflow ${next.workflowTunnel.healthBase}` : null,
    next.tunnel.healthBase ? `Raw ${next.tunnel.healthBase}` : null
  ].filter(Boolean).join(' · ') || t('common.notFound');
  const tunnelId = $<HTMLInputElement>('tunnelId');
  if (!preserveForm && (document.activeElement !== tunnelId || !previous)) tunnelId.value = next.config.tunnelId;
  const workflowTunnelId = $<HTMLInputElement>('workflowTunnelId');
  if (!preserveForm && (document.activeElement !== workflowTunnelId || !previous)) workflowTunnelId.value = next.config.workflowTunnelId;

  const resolveOk = next.resolve.installed && next.resolve.reachable;
  $('resolveSummary').textContent = resolveOk
    ? t('resolve.ready', { version: next.resolve.serverVersion ?? '' })
    : next.resolve.installed ? localizeRuntimeText(next.resolve.detail) : t('resolve.notFound');
  $('resolveSummary').className = `chosen ${resolveOk ? 'is-good' : 'is-warn'}`;
  $('resolveFacts').replaceChildren(
    fact(t('fact.mcpPath'), next.resolve.installed ? next.resolve.mcpPath : t('common.notFound')),
    fact(t('fact.protocol'), next.resolve.protocolVersion ?? t('common.unknown')),
    fact(t('fact.officialTools'), next.resolve.tools.length ? String(next.resolve.tools.length) : t('common.unknown')),
    fact(t('fact.resolveRunning'), next.resolve.running === null ? t('common.unknown') : next.resolve.running ? t('common.yes') : t('common.no'))
  );

  paintLocations(next);
  paintWorkflow(next);

  const apiKey = $<HTMLInputElement>('apiKey');
  const apiKeyUnavailable = next.apiKeyStorageState === 'unavailable';
  apiKey.disabled = !next.secureStorageAvailable || apiKeyUnavailable;
  apiKey.placeholder = next.hasApiKey && next.apiKeySuffix
    ? `sk-••••••••••••••••${next.apiKeySuffix}`
    : next.hasApiKey ? t('key.storedPlaceholder') : apiKeyUnavailable ? t('key.temporarilyUnavailablePlaceholder') : 'sk-…';
  $('apiKeyState').textContent = apiKeyUnavailable
    ? t('key.temporarilyUnavailable')
    : !next.secureStorageAvailable
    ? t('key.storageUnavailable')
    : next.hasApiKey ? t('key.stored') : t('key.secureHint');
  $('apiKeyState').className = `hint ${next.secureStorageAvailable && !apiKeyUnavailable ? '' : 'is-warn'}`;
  $<HTMLButtonElement>('removeApiKey').disabled = !next.hasApiKey;

  const rawConnected = next.tunnel.state === 'connected';
  const workflowConnected = next.workflowTunnel.state === 'connected';
  const connected = rawConnected || workflowConnected;
  const running = connected || next.tunnel.state === 'starting' || next.workflowTunnel.state === 'starting';
  const anyConfiguredTunnel = TUNNEL_ID_PATTERN.test(next.config.tunnelId) || TUNNEL_ID_PATTERN.test(next.config.workflowTunnelId);
  const connect = $<HTMLButtonElement>('wizConnect');
  connect.textContent = running ? t('common.disconnect') : t('common.connect');
  connect.disabled = !running && (!resolveOk || !anyConfiguredTunnel || !next.hasApiKey || !next.resolvedTunnelClient);
  $('wizStatus').textContent = connected
    ? t('connect.surfaceState', { workflow: workflowConnected ? t('common.connected') : t('common.notConfigured'), raw: rawConnected ? t('common.connected') : t('common.notConfigured') })
    : next.workflowTunnel.detail || next.tunnel.detail
      ? localizeRuntimeText(next.workflowTunnel.detail || next.tunnel.detail)
      : '';
  $('wizStatus').className = `chosen ${connected ? 'is-good' : next.tunnel.state === 'error' || next.workflowTunnel.state === 'error' ? 'is-warn' : ''}`;
  $('tunnelFacts').replaceChildren(
    fact(t('fact.transport'), next.resolvedTunnelClient
      ? next.resolvedTunnelClientVersion ? `tunnel-client ${next.resolvedTunnelClientVersion.split('+')[0]}` : t('binary.ready')
      : t('binary.missing')),
    fact(t('fact.workflowTunnel'), TUNNEL_ID_PATTERN.test(next.config.workflowTunnelId)
      ? next.workflowTunnel.state === 'connected' ? t('common.connected') : localizeRuntimeText(next.workflowTunnel.detail || next.workflowTunnel.state)
      : t('common.notConfigured')),
    fact(t('fact.rawTunnel'), TUNNEL_ID_PATTERN.test(next.config.tunnelId)
      ? next.tunnel.state === 'connected' ? t('common.connected') : localizeRuntimeText(next.tunnel.detail || next.tunnel.state)
      : t('common.notConfigured')),
    fact(t('fact.lastOpenAiPoll'), ago(Math.max(next.tunnel.lastPollSuccessMs ?? 0, next.workflowTunnel.lastPollSuccessMs ?? 0) || null))
  );
  paintHealth(next);

  const verified = next.config.chatgptVerified;
  $('chatgptState').textContent = verified ? t('chatgpt.verified') : connected ? '' : t('chatgpt.connectFirst');
  $('chatgptState').className = `chosen ${verified ? 'is-good' : ''}`;
  const confirmChatgpt = $<HTMLButtonElement>('confirmChatgpt');
  confirmChatgpt.textContent = t('chatgpt.confirm');
  confirmChatgpt.hidden = verified;
  confirmChatgpt.disabled = !rawConnected;

  const workflowVerified = next.config.workflowChatgptVerified;
  $('workflowChatgptState').textContent = workflowVerified ? t('chatgpt.verified') : workflowConnected ? '' : t('chatgpt.connectFirst');
  $('workflowChatgptState').className = `chosen ${workflowVerified ? 'is-good' : ''}`;
  const confirmWorkflowChatgpt = $<HTMLButtonElement>('confirmWorkflowChatgpt');
  confirmWorkflowChatgpt.textContent = t('chatgpt.workflowConfirm');
  confirmWorkflowChatgpt.hidden = workflowVerified;
  confirmWorkflowChatgpt.disabled = !workflowConnected;

  const done = new Set<string>();
  if (resolveOk) done.add('resolve');
  if (next.config.projectLocations.length > 0) done.add('locations');
  if (anyConfiguredTunnel) done.add('tunnel');
  if (next.hasApiKey) done.add('key');
  if (connected) done.add('connect');
  if (verified || workflowVerified) done.add('chatgpt');
  const requiredOrder = ['resolve', 'tunnel', 'key', 'connect', 'chatgpt'];
  const current = requiredOrder.find((name) => !done.has(name)) ?? null;
  for (const name of ['resolve', 'locations', 'tunnel', 'key', 'connect', 'chatgpt']) {
    const node = step(name);
    const completed = done.has(name);
    const active = name === current;
    const stateLabel = node.querySelector<HTMLElement>('.step-state')!;
    node.classList.toggle('is-done', completed);
    node.classList.toggle('is-current', active);
    if (active) node.setAttribute('aria-current', 'step');
    else node.removeAttribute('aria-current');
    stateLabel.dataset.state = completed ? 'completed' : active ? 'current' : 'pending';
    stateLabel.textContent = t(completed ? 'setup.status.completed' : active ? 'setup.status.current' : 'setup.status.pending');
  }

  const allRequiredDone = current === null;
  const wizard = $('wizard');
  wizard.classList.toggle('is-tidy', !showAllSteps);
  wizard.classList.toggle('is-complete', allRequiredDone);
  const expand = $<HTMLButtonElement>('wizExpand');
  expand.textContent = showAllSteps ? t('setup.hideFinished') : t('setup.showAll');

  const headline = $('headline');
  const headlineLabel = headline.querySelector<HTMLElement>('.connection-signal-label')!;
  const configured = isSetupComplete(next);
  const configuredRawBad = TUNNEL_ID_PATTERN.test(next.config.tunnelId) && (next.tunnel.state === 'error' || next.tunnel.state === 'offline');
  const configuredWorkflowBad = TUNNEL_ID_PATTERN.test(next.config.workflowTunnelId) && (next.workflowTunnel.state === 'error' || next.workflowTunnel.state === 'offline');
  const setConnectionSignal = (stateClass: 'is-idle' | 'is-connecting' | 'is-good' | 'is-bad', label: string): void => {
    headline.className = `connection-signal ${stateClass}`;
    const accessibleLabel = `${label} · ${t('setup.title')}`;
    headlineLabel.textContent = accessibleLabel;
    headline.setAttribute('aria-label', accessibleLabel);
    headline.setAttribute('title', accessibleLabel);
  };
  if (apiKeyUnavailable || configuredRawBad || configuredWorkflowBad || (configured && !resolveOk)) {
    setConnectionSignal('is-bad', t('headline.attention'));
  } else if (next.tunnel.state === 'starting' || next.workflowTunnel.state === 'starting') {
    setConnectionSignal('is-connecting', t('headline.connecting'));
  } else if (connected) {
    setConnectionSignal('is-good', t('headline.connected'));
  } else if (configured) {
    setConnectionSignal('is-idle', t('headline.disconnected'));
  } else {
    setConnectionSignal('is-idle', t('headline.needsSetup'));
  }

  if (agentSituation) paintSharedContext();
  if (artifactWorkspace) paintArtifactWorkspace();
  if (agentLoaded) paintAgentChat();
}

function positionWorkspaceTabIndicator(): void {
  const selected = workspaceTabs.querySelector<HTMLButtonElement>('button.is-sel');
  if (!selected) {
    workspaceTabs.style.setProperty('--tab-indicator-opacity', '0');
    return;
  }
  workspaceTabs.style.setProperty('--tab-indicator-x', `${selected.offsetLeft}px`);
  workspaceTabs.style.setProperty('--tab-indicator-width', `${selected.offsetWidth}px`);
  workspaceTabs.style.setProperty('--tab-indicator-opacity', '1');
}

async function unwrap<T>(promise: Promise<Reply<T>>): Promise<T | null> {
  const result = await promise;
  if (!result.ok) { window.alert(localizeRuntimeText(result.error)); return null; }
  return result.data;
}

function paintLog(): void {
  $('log').textContent = log.slice(-160).map((entry) => {
    const level = entry.level === 'info'
      ? t('activity.level.info')
      : entry.level === 'warn' ? t('activity.level.warn') : t('activity.level.error');
    const time = new Date(entry.time).toLocaleTimeString(uiLanguage() === 'zh-CN' ? 'zh-CN' : 'en');
    return `${time}  ${level.padEnd(5)}  ${localizeRuntimeText(entry.message)}`;
  }).join('\n');
  $('log').scrollTop = $('log').scrollHeight;
  const recent = log.slice(-160);
  const warns = recent.filter((entry) => entry.level === 'warn').length;
  const errors = recent.filter((entry) => entry.level === 'error').length;
  $('activityProblems').textContent = t('activity.problems', { warn: warns, error: errors });
}

function workflowPlanStateLabel(state: RendererWorkflowPlanProjection['state']): string {
  switch (state) {
    case 'ready': return t('activity.planState.ready');
    case 'approved': return t('activity.planState.approved');
    case 'rejected': return t('activity.planState.rejected');
    case 'expired': return t('activity.planState.expired');
    case 'stale': return t('activity.planState.stale');
    case 'consumed': return t('activity.planState.consumed');
  }
}

function workflowExecutionStateLabel(state: NonNullable<RendererWorkflowPlanProjection['execution']>['state']): string {
  return t(`activity.executionState.${state}` as Parameters<typeof t>[0]);
}

async function openWorkflowPlanTarget(projection: RendererWorkflowPlanProjection): Promise<void> {
  if (projection.target.kind === 'timeline_item') {
    let focusReply = await api.focusWorkflowPlanTarget(projection.planId);
    const colorPlan = projection.planKind === 'color_grade_version_create';
    const inspectorMissing = colorPlan ? !colorInspectorDetail()?.versions : !editInspectorDetail()?.structure;
    if (state?.gateway.active && (!focusReply.ok || inspectorMissing)) {
      if (colorPlan) await refreshColorPanel();
      else await refreshEditPanel();
      focusReply = await api.focusWorkflowPlanTarget(projection.planId);
    }
    if (!focusReply.ok) {
      await unwrap(Promise.resolve(focusReply));
      return;
    }
    await refreshAgentSituation();
  }
  selectAppView('cockpit');
  selectArtifactLens(projection.planKind === 'color_grade_version_create' ? 'color' : 'edit');
  paintFocusedEntityRows();
  requestAnimationFrame(scrollFocusedEntityIntoView);
}

async function openWorkflowPlanById(planId: string): Promise<void> {
  const existing = workflowPlans.find((projection) => projection.planId === planId) ?? null;
  const projection = existing ?? await unwrap(api.getWorkflowPlan(planId));
  if (!projection) return;
  await openWorkflowPlanTarget(projection);
}

function paintWorkflowPlans(): void {
  const list = $('workflowPlanList');
  if (workflowPlans.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'workflow-audit-empty';
    empty.textContent = t('activity.plansEmpty');
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...workflowPlans.map((projection) => {
    const row = document.createElement('div');
    row.className = 'workflow-plan-row';
    const main = document.createElement('div');
    main.className = 'workflow-plan-main';
    const title = document.createElement('b');
    const change = projection.proposedChange;
    title.textContent = change.kind === 'add_review_marker'
      ? `${t('activity.planMarker')} · ${change.name} · ${change.color}`
      : change.kind === 'add_track'
        ? `${t('activity.planTrackAdd')} · V${change.expectedTrackIndex}`
        : change.kind === 'create_grade_version'
          ? `${t('activity.planGradeVersion')} · ${change.name}`
          : `${projection.workflowId} · ${change.summary}`;
    const detail = document.createElement('span');
    const targetLabel = projection.target.handle
      ? `${projection.target.handle} · ${projection.target.label}`
      : projection.target.label;
    const expires = new Date(projection.expiresAt).toLocaleTimeString(uiLanguage() === 'zh-CN' ? 'zh-CN' : 'en', { hour: '2-digit', minute: '2-digit' });
    detail.textContent = change.kind === 'add_review_marker'
      ? [
        t('activity.planFrame', { frame: change.frameOffset }),
        t('activity.planTarget', { id: targetLabel }),
        t('activity.planExpires', { time: expires })
      ].join(' · ')
      : change.kind === 'add_track'
        ? [
          t('activity.planTrackIndex', { index: change.expectedTrackIndex }),
          t('activity.planTarget', { id: targetLabel }),
          t('activity.planExpires', { time: expires })
        ].join(' · ')
        : change.kind === 'create_grade_version'
          ? [
            t('activity.planTarget', { id: targetLabel }),
            t('activity.planExpires', { time: expires })
          ].join(' · ')
        : [
          t('activity.planTarget', { id: targetLabel }),
          t('activity.planExpires', { time: expires })
        ].join(' · ');
    main.append(title, detail);
    if (change.kind === 'add_review_marker' && change.note) {
      const note = document.createElement('span');
      note.textContent = change.note;
      main.append(note);
    }
    if (projection.execution) {
      const execution = document.createElement('span');
      execution.textContent = t('activity.executionSummary', {
        state: workflowExecutionStateLabel(projection.execution.state)
      });
      main.append(execution);
    }

    const actions = document.createElement('div');
    actions.className = 'workflow-plan-actions';
    const stateLabel = document.createElement('span');
    stateLabel.className = `workflow-plan-state ${projection.state}`;
    stateLabel.textContent = workflowPlanStateLabel(projection.state);
    actions.append(stateLabel);
    const openPlanButton = document.createElement('button');
    openPlanButton.className = 'btn';
    openPlanButton.type = 'button';
    openPlanButton.textContent = t('activity.openPlanTarget');
    openPlanButton.setAttribute('aria-label', t('activity.openPlanTargetAria', {
      name: change.kind === 'add_review_marker'
        ? change.name
        : change.kind === 'add_track'
          ? `${t('activity.planTrackAdd')} V${change.expectedTrackIndex}`
          : change.kind === 'create_grade_version'
            ? change.name
          : change.summary
    }));
    openPlanButton.addEventListener('click', () => { void openWorkflowPlanTarget(projection); });
    actions.append(openPlanButton);
    if (projection.state === 'ready' && (projection.planKind === 'review_marker_add' || projection.planKind === 'edit_track_add' || projection.planKind === 'color_grade_version_create')) {
      const approve = document.createElement('button');
      approve.className = 'btn btn-primary';
      approve.type = 'button';
      approve.textContent = t('activity.approve');
      approve.disabled = !state?.gateway.active;
      approve.addEventListener('click', async () => {
        await actionGate.run(`workflow-plan:${projection.planId}`, async () => {
          const updated = await unwrap(api.approveWorkflowPlan(projection.planId));
          if (!updated) return;
          await refreshWorkflowPlans();
        });
      });
      actions.append(approve);
    }
    if (projection.state === 'ready' || projection.state === 'approved') {
      const reject = document.createElement('button');
      reject.className = 'btn btn-danger';
      reject.type = 'button';
      reject.textContent = t('activity.reject');
      reject.addEventListener('click', async () => {
        await actionGate.run(`workflow-plan:${projection.planId}`, async () => {
          const updated = await unwrap(api.rejectWorkflowPlan(projection.planId));
          if (!updated) return;
          await refreshWorkflowPlans();
        });
      });
      actions.append(reject);
    }
    row.append(main, actions);
    return row;
  }));
}

async function refreshWorkflowPlans(): Promise<void> {
  const reply = await api.getRecentWorkflowPlans(8);
  if (!reply.ok) {
    window.alert(localizeRuntimeText(reply.error));
    return;
  }
  workflowPlans = reply.data;
  paintWorkflowPlans();
}

function paintAgentTraces(): void {
  const list = $('agentTraceList');
  const traces = (agentSession?.events ?? []).filter((event) => event.kind === 'turn_trace').slice(-8).reverse();
  if (traces.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'workflow-audit-empty';
    empty.textContent = t('activity.tracesEmpty');
    list.replaceChildren(empty);
    return;
  }
  list.replaceChildren(...traces.map((event) => {
    const traceRow = document.createElement('div');
    traceRow.className = 'agent-trace-row';
    traceRow.dataset.turnTraceId = event.trace.turnId;
    const main = document.createElement('div');
    const title = document.createElement('b');
    title.textContent = t('activity.traceTitle', { id: event.trace.turnId.slice(0, 12) });
    const detail = document.createElement('span');
    detail.textContent = t('activity.traceSummary', {
      outcome: t(`activity.traceOutcome.${event.trace.outcome}` as Parameters<typeof t>[0]),
      tools: event.trace.protectedToolCalls,
      resolve: event.trace.resolveCalls === null ? t('common.unknown') : event.trace.resolveCalls
    });
    main.append(title, detail);
    const workflows = document.createElement('span');
    workflows.className = 'agent-trace-workflows';
    workflows.textContent = event.trace.workflowIds.length
      ? event.trace.workflowIds.join(' · ')
      : t('activity.traceNoWorkflows');
    traceRow.append(main, workflows);
    return traceRow;
  }));
}

function openAgentTrace(turnId: string): void {
  selectAppView('activity');
  paintAgentTraces();
  requestAnimationFrame(() => {
    const target = [...document.querySelectorAll<HTMLElement>('[data-turn-trace-id]')]
      .find((row) => row.dataset.turnTraceId === turnId);
    target?.scrollIntoView({ block: 'center' });
  });
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function planIdFromAgentToolResult(text: string): string | null {
  try {
    const envelope = recordValue(JSON.parse(text));
    const result = recordValue(envelope?.['result']);
    const plan = recordValue(result?.['plan']);
    const planId = plan?.['plan_id'];
    return typeof planId === 'string' && planId.length > 0 ? planId : null;
  } catch {
    return null;
  }
}

function diagnosticsJson(): string {
  if (!state) return '{}';
  return JSON.stringify({
    createdAt: new Date().toISOString(),
    resolve: {
      installed: state.resolve.installed,
      reachable: state.resolve.reachable,
      running: state.resolve.running,
      serverName: state.resolve.serverName,
      serverVersion: state.resolve.serverVersion,
      protocolVersion: state.resolve.protocolVersion,
      officialToolCount: state.resolve.tools.length
    },
    tunnel: {
      state: state.tunnel.state,
      clientVersion: state.tunnel.clientVersion,
      health: state.tunnel.health,
      ready: state.tunnel.ready,
      probe: state.tunnel.probe,
      lastPollSuccessMs: state.tunnel.lastPollSuccessMs,
      toolCallCount: state.tunnel.toolCallCount
      ,lastToolCallMs: state.tunnel.lastToolCallMs
      ,lastToolName: state.tunnel.lastToolName
    },
    gateway: {
      active: state.gateway.active,
      rawRequestAt: state.gateway.rawRequestAt,
      workflowRequestAt: state.gateway.workflowRequestAt,
      lastToolCallAt: state.gateway.lastToolCallAt,
      lastToolName: state.gateway.lastToolName,
      schemaHash: state.gateway.schemaHash
    },
    diagnostics: state.diagnostics
  }, null, 2);
}

async function copyButton(button: HTMLButtonElement, value: string, copiedLabel: string, normalLabel: string): Promise<void> {
  const result = await api.writeClipboard(value);
  if (!result.ok) return;
  button.textContent = copiedLabel;
  setTimeout(() => { button.textContent = normalLabel; }, 900);
}

$('probeResolve').addEventListener('click', async () => {
  await actionGate.run('setup:probe-resolve', async () => { const next = await unwrap(api.probeResolve()); if (next) paint(next); });
});
$('addLocation').addEventListener('click', async () => {
  await actionGate.run('setup:add-location', async () => { const next = await unwrap(api.addProjectLocation()); if (next) paint(next); });
});
$('removeApiKey').addEventListener('click', async () => {
  await actionGate.run('setup:remove-api-key', async () => { const next = await unwrap(api.setApiKey('')); if (next) paint(next); });
});
$('wizConnect').addEventListener('click', async () => {
  await actionGate.run('setup:connection', async () => {
    if (state?.tunnel.state === 'connected' || state?.tunnel.state === 'starting') {
      const next = await unwrap(api.disconnect()); if (next) paint(next); return;
    }
    if (!(await saveSetup())) return;
    const next = await unwrap(api.connect()); if (next) paint(next);
  });
});
$('confirmChatgpt').addEventListener('click', async () => {
  await actionGate.run('setup:confirm-raw-chatgpt', async () => {
    if (state?.config.chatgptVerified) return;
    const next = await unwrap(api.setChatgptVerified(true));
    if (next) paint(next);
  });
});
$<HTMLButtonElement>('refreshWorkflowPlans').addEventListener('click', () => {
  void actionGate.run('workflow-plans:refresh', refreshWorkflowPlans);
});
$('confirmWorkflowChatgpt').addEventListener('click', async () => {
  await actionGate.run('setup:confirm-workflow-chatgpt', async () => {
    if (state?.config.workflowChatgptVerified) return;
    const next = await unwrap(api.setWorkflowChatgptVerified(true));
    if (next) paint(next);
  });
});
$('wizExpand').addEventListener('click', () => { showAllSteps = !showAllSteps; if (state) paint(state); });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-workflow]')) {
  button.addEventListener('click', () => { void refreshWorkflowPanel(); });
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-media]')) {
  button.addEventListener('click', () => { void refreshMediaPanel(); });
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-edit]')) {
  button.addEventListener('click', () => { void refreshEditPanel(); });
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-fusion]')) {
  button.addEventListener('click', () => { void refreshFusionPanel(); });
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-color]')) {
  button.addEventListener('click', () => { void refreshColorPanel(); });
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-fairlight]')) {
  button.addEventListener('click', () => { void refreshFairlightPanel(); });
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-deliver]')) {
  button.addEventListener('click', () => { void refreshDeliverPanel(); });
}
$<HTMLButtonElement>('copyActivity').addEventListener('click', () => {
  void copyButton(
    $<HTMLButtonElement>('copyActivity'),
    $('log').textContent ?? '',
    t('activity.copiedText'),
    t('activity.copyText')
  );
});
$<HTMLButtonElement>('copyDiagnostics').addEventListener('click', () => {
  void copyButton(
    $<HTMLButtonElement>('copyDiagnostics'),
    diagnosticsJson(),
    t('activity.copiedJson'),
    t('activity.copyJson')
  );
});

async function refreshWorkflowPanel(): Promise<void> {
  if (!state?.gateway.active) return;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-workflow]')) button.disabled = true;
  const [connectionReply, capabilitiesReply, projectReply, riskReply, auditReply] = await Promise.all([
    api.inspectWorkflow('connection'),
    api.inspectWorkflow('capabilities'),
    api.inspectWorkflow('project'),
    api.inspectWorkflowRisk('project.preflight.v1'),
    api.getWorkflowAudit(6)
  ]);
  const preflightReply = await api.inspectWorkflow('preflight');
  await refreshAgentSituation();
  if (connectionReply.ok && connectionReply.data.target === 'connection') workflowConnection = connectionReply.data;
  if (capabilitiesReply.ok && capabilitiesReply.data.target === 'capabilities') workflowCapabilities = capabilitiesReply.data;
  if (riskReply.ok) workflowRisk = riskReply.data;
  if (auditReply.ok) workflowAudit = auditReply.data;
  const error = !connectionReply.ok
    ? connectionReply.error
    : !capabilitiesReply.ok
      ? capabilitiesReply.error
      : !projectReply.ok
        ? projectReply.error
      : !riskReply.ok
          ? riskReply.error
          : !auditReply.ok ? auditReply.error : null;
  if (error) window.alert(localizeRuntimeText(error));
  if (!preflightReply.ok) window.alert(localizeRuntimeText(preflightReply.error));
  if (state) paintWorkflow(state);
}

async function refreshMediaPanel(): Promise<void> {
  if (!state?.gateway.active) return;
  const scope = legacyDomainRequestScope();
  if (!scope) return;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-media]')) button.disabled = true;
  const [reply, linkReply] = await Promise.all([
    api.inspectWorkflow('media'),
    api.inspectMediaLinkStatus()
  ]);
  if (!await reconcileLegacyDomainObservation(scope)) return;
  if (!reply.ok) window.alert(localizeRuntimeText(reply.error));
  if (!linkReply.ok) window.alert(localizeRuntimeText(linkReply.error));
  if (state) paintWorkflow(state);
}

async function refreshMediaClip(handle: string, generation: number): Promise<void> {
  if (!state?.gateway.active) return;
  const scope = legacyDomainRequestScope();
  if (!scope) return;
  const result = await mediaClipIntentGate.run(`${generation}:${handle}`, async () => {
    const clipReply = await api.inspectMediaClip(handle, generation);
    const linkReply = await api.inspectMediaLinkStatus(handle, generation);
    return { clipReply, linkReply };
  });
  if (!result.started || !result.current) return;
  const { clipReply, linkReply } = result.value;
  if (!await reconcileLegacyDomainObservation(scope)) return;
  if (!clipReply.ok) {
    window.alert(localizeRuntimeText(clipReply.error));
    return;
  }
  if (!linkReply.ok) {
    window.alert(localizeRuntimeText(linkReply.error));
    return;
  }
  if (clipReply.data.target !== 'media' || !clipReply.data.clip) return;
  if (linkReply.data.target !== 'media' || !linkReply.data.linkStatus) return;
  if (!artifactWorkspace) return;
  const artifact = artifactWorkspace.artifacts.find((candidate) =>
    candidate.kind === 'media_item'
    && candidate.semanticHandle === handle
    && candidate.generation === generation
  );
  if (!artifact) return;
  artifactPresentation = selectArtifactForInspection(artifactPresentation, artifactWorkspace, artifact.artifactId);
  if (state) paintWorkflow(state);
}

async function refreshEditPanel(): Promise<void> {
  if (!state?.gateway.active) return;
  const scope = legacyDomainRequestScope();
  if (!scope) return;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-edit]')) button.disabled = true;
  const [reply, structureReply, gapsReply, sourceRangesReply, transitionsReply, annotationsReply] = await Promise.all([
    api.inspectWorkflow('edit'),
    api.inspectEditStructure(),
    api.inspectEditGapsOverlaps(),
    api.inspectEditSourceRanges(),
    api.inspectEditTransitions(),
    api.inspectEditAnnotations()
  ]);
  if (!await reconcileLegacyDomainObservation(scope)) return;
  if (!reply.ok) window.alert(localizeRuntimeText(reply.error));
  if (!structureReply.ok) window.alert(localizeRuntimeText(structureReply.error));
  if (!gapsReply.ok) window.alert(localizeRuntimeText(gapsReply.error));
  const detailError = !sourceRangesReply.ok
    ? sourceRangesReply.error
    : !transitionsReply.ok
      ? transitionsReply.error
      : !annotationsReply.ok ? annotationsReply.error : null;
  if (detailError) window.alert(localizeRuntimeText(detailError));
  if (state) paintWorkflow(state);
}

async function refreshColorPanel(): Promise<void> {
  const schemaHash = state?.gateway.schemaHash;
  if (!state?.gateway.active || !schemaHash) return;
  const scope = legacyDomainRequestScope();
  if (!scope) return;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-color]')) button.disabled = true;
  const result = await colorIntentGate.run(`color:${schemaHash}`, async () => await Promise.all([
    api.inspectWorkflow('color'),
    api.inspectColorGraph(),
    api.inspectColorVersions()
  ]));
  if (!result.current || state?.gateway.schemaHash !== schemaHash) return;
  const [reply, graphReply, versionsReply] = result.value;
  if (!await reconcileLegacyDomainObservation(scope)) return;
  if (!reply.ok) window.alert(localizeRuntimeText(reply.error));
  if (graphReply.ok && graphReply.data.target === 'color' && graphReply.data.schemaHash === schemaHash) {
    colorGraphError = null;
  } else if (!graphReply.ok) {
    colorGraphError = localizeRuntimeText(graphReply.error);
  }
  if (versionsReply.ok && versionsReply.data.target === 'color' && versionsReply.data.schemaHash === schemaHash) {
    colorVersionsError = null;
  } else if (!versionsReply.ok) {
    colorVersionsError = localizeRuntimeText(versionsReply.error);
  }
  if (state) paintWorkflow(state);
}

async function refreshFusionPanel(): Promise<void> {
  const schemaHash = state?.gateway.schemaHash;
  if (!state?.gateway.active || !schemaHash) return;
  const scope = legacyDomainRequestScope();
  if (!scope) return;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-fusion]')) button.disabled = true;
  const result = await fusionIntentGate.run(`fusion:${schemaHash}`, async () => await Promise.all([
    api.inspectWorkflow('fusion'),
    api.inspectFusionGraph()
  ]));
  if (!result.current || state?.gateway.schemaHash !== schemaHash) return;
  const [reply, graphReply] = result.value;
  if (!await reconcileLegacyDomainObservation(scope)) return;
  fusionError = reply.ok ? null : localizeRuntimeText(reply.error);
  fusionGraphError = graphReply.ok ? null : localizeRuntimeText(graphReply.error);
  if (state) paintWorkflow(state);
}

async function refreshFairlightPanel(): Promise<void> {
  const schemaHash = state?.gateway.schemaHash;
  if (!state?.gateway.active || !schemaHash) return;
  const scope = legacyDomainRequestScope();
  if (!scope) return;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-fairlight]')) button.disabled = true;
  const [reply, processingReply] = await Promise.all([
    api.inspectWorkflow('fairlight'),
    api.inspectFairlightProcessing()
  ]);
  if (state?.gateway.schemaHash !== schemaHash) return;
  if (!await reconcileLegacyDomainObservation(scope)) return;
  if (!reply.ok) window.alert(localizeRuntimeText(reply.error));
  if (processingReply.ok && processingReply.data.target === 'fairlight' && processingReply.data.schemaHash === schemaHash) {
    fairlightProcessingError = null;
  } else if (!processingReply.ok) {
    fairlightProcessingError = localizeRuntimeText(processingReply.error);
  }
  if (state) paintWorkflow(state);
}

async function refreshDeliverPanel(): Promise<void> {
  if (!state?.gateway.active) return;
  const scope = legacyDomainRequestScope();
  if (!scope) return;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-refresh-deliver]')) button.disabled = true;
  const reply = await api.inspectWorkflow('deliver');
  if (!await reconcileLegacyDomainObservation(scope)) return;
  if (!reply.ok) window.alert(localizeRuntimeText(reply.error));
  if (state) paintWorkflow(state);
}

function agentMessageNode(role: 'user' | 'assistant', text: string): HTMLElement {
  const node = document.createElement('div');
  node.className = `agent-message ${role}`;
  node.textContent = text;
  return node;
}

function paintAgentChat(): void {
  const selectedId = agentSession?.summary.id ?? '';
  const sessionList = $('agentSessionList');
  sessionList.replaceChildren(...agentSessions.map((session) => {
    const sessionButton = document.createElement('button');
    sessionButton.type = 'button';
    sessionButton.dataset.sessionId = session.id;
    sessionButton.textContent = session.title;
    sessionButton.title = session.title;
    const selected = activeView === 'cockpit' && session.id === selectedId;
    sessionButton.classList.toggle('is-sel', selected);
    if (selected) sessionButton.setAttribute('aria-current', 'page');
    sessionButton.disabled = agentBusy;
    sessionButton.addEventListener('click', () => {
      if (agentBusy) return;
      selectAppView('cockpit');
      void api.getAgentSession(session.id).then((reply) => {
        if (reply.ok) {
          agentSession = reply.data;
          agentUiError = null;
        } else {
          agentUiError = reply.error;
        }
        paintAgentChat();
      });
    });
    return sessionButton;
  }));
  $('agentConversationTitle').textContent = agentSession?.summary.title || t('agent.title');
  $<HTMLButtonElement>('sidebarNewChat').disabled = true;
  $<HTMLButtonElement>('agentSend').disabled = true;
  $<HTMLTextAreaElement>('agentComposer').disabled = true;
  $('agentModelLine').textContent = t('agent.cosOwned');
  $('agentHistoryNote').hidden = !agentSession?.eventsTruncated;

  const transcript = $('agentTranscript');
  transcript.replaceChildren();
  let visible = 0;
  const resultIds = new Set(
    (agentSession?.events ?? []).filter((event) => event.kind === 'tool_call_result').map((event) => event.kind === 'tool_call_result' ? event.callId : '')
  );
  for (const event of agentSession?.events ?? []) {
    if (event.kind === 'user_message') {
      transcript.append(agentMessageNode('user', event.message.text));
      visible += 1;
    } else if (event.kind === 'assistant_message') {
      transcript.append(agentMessageNode('assistant', event.message.text));
      visible += 1;
    } else if (event.kind === 'tool_call_intent' && !resultIds.has(event.callId)) {
      const row = document.createElement('div');
      row.className = 'agent-tool-row';
      row.textContent = `${event.tool} · ${t('agent.thinking')}`;
      transcript.append(row);
      visible += 1;
    } else if (event.kind === 'tool_call_result') {
      const row = document.createElement('div');
      row.className = `agent-tool-row ${event.ok ? 'good' : 'bad'}`;
      row.textContent = t(event.ok ? 'agent.toolSucceeded' : 'agent.toolFailed', { tool: event.tool });
      const planId = event.ok && event.tool === 'plan' ? planIdFromAgentToolResult(event.result.text) : null;
      if (planId) {
        const planButton = document.createElement('button');
        planButton.type = 'button';
        planButton.textContent = t('agent.openPlan');
        planButton.setAttribute('aria-label', t('agent.openPlanAria'));
        planButton.addEventListener('click', () => { void openWorkflowPlanById(planId); });
        row.append(planButton);
      }
      transcript.append(row);
      visible += 1;
    } else if (event.kind === 'turn_trace') {
      const traceButton = document.createElement('button');
      traceButton.type = 'button';
      traceButton.className = 'agent-trace-link';
      traceButton.textContent = t('agent.traceLink');
      traceButton.setAttribute('aria-label', t('agent.traceLinkAria'));
      traceButton.addEventListener('click', () => openAgentTrace(event.trace.turnId));
      transcript.append(traceButton);
      visible += 1;
    } else if (event.kind === 'turn_failed') {
      const row = document.createElement('div');
      row.className = 'agent-turn-error';
      row.textContent = t('agent.turnFailed', { error: localizeRuntimeText(event.error.text) });
      transcript.append(row);
      visible += 1;
    } else if (event.kind === 'turn_interrupted') {
      const row = document.createElement('div');
      row.className = 'agent-turn-error';
      row.textContent = t('agent.turnInterrupted');
      transcript.append(row);
      visible += 1;
    }
  }
  if (visible === 0) {
    const empty = document.createElement('div');
    empty.className = 'agent-empty';
    const title = document.createElement('h2');
    title.textContent = t('agent.emptyTitle');
    const body = document.createElement('p');
    body.textContent = t('agent.emptyBody');
    empty.append(title, body);
    transcript.append(empty);
  }
  if (agentBusy) {
    const working = document.createElement('div');
    working.className = 'agent-working';
    working.textContent = t('agent.thinking');
    transcript.append(working);
  }
  if (agentUiError) {
    const error = document.createElement('div');
    error.className = 'agent-turn-error';
    error.textContent = t('agent.turnFailed', { error: localizeRuntimeText(agentUiError) });
    transcript.append(error);
  }
  paintAgentTraces();
  requestAnimationFrame(() => { transcript.scrollTop = transcript.scrollHeight; });
}

async function refreshAgentSessions(preferredId?: string): Promise<void> {
  const sessionsReply = await api.listAgentSessions();
  agentLoaded = true;
  if (!sessionsReply.ok) {
    agentUiError = sessionsReply.error;
    paintAgentChat();
    return;
  }
  agentUiError = null;
  agentSessions = sessionsReply.data;
  const targetId = preferredId ?? agentSession?.summary.id ?? agentSessions[0]?.id;
  if (!targetId) {
    agentSession = null;
    paintAgentChat();
    return;
  }
  const sessionReply = await api.getAgentSession(targetId);
  if (sessionReply.ok) agentSession = sessionReply.data;
  else agentUiError = sessionReply.error;
  paintAgentChat();
}

async function createAgentSessionFromUi(title = t('agent.newChat')): Promise<AgentSessionView | null> {
  const reply = await api.createAgentSession(title);
  if (!reply.ok) {
    agentUiError = reply.error;
    paintAgentChat();
    return null;
  }
  agentUiError = null;
  agentSession = reply.data;
  const listReply = await api.listAgentSessions();
  if (listReply.ok) agentSessions = listReply.data;
  agentLoaded = true;
  paintAgentChat();
  return reply.data;
}

async function sendAgentMessage(): Promise<void> {
  if (agentBusy) return;
  const composer = $<HTMLTextAreaElement>('agentComposer');
  const text = composer.value.trim();
  if (!text) return;
  let current = agentSession;
  if (!current) {
    const title = text.replace(/\s+/g, ' ').slice(0, 60) || 'New chat';
    current = await createAgentSessionFromUi(title);
    if (!current) return;
  }
  const sessionId = current.summary.id;
  agentUiError = null;
  agentBusy = true;
  paintAgentChat();
  try {
    const reply = await api.runAgentTurn(sessionId, text);
    if (reply.ok) {
      agentSession = reply.data.session;
      composer.value = '';
    } else {
      agentUiError = reply.error;
      const sessionReply = await api.getAgentSession(sessionId);
      if (sessionReply.ok) agentSession = sessionReply.data;
    }
    const listReply = await api.listAgentSessions();
    if (listReply.ok) agentSessions = listReply.data;
    await refreshAgentSituation();
    void api.probeResolve().then((probeReply) => { if (probeReply.ok) paint(probeReply.data); });
  } finally {
    agentBusy = false;
    paintAgentChat();
  }
}

function selectAppView(view: AppView): void {
  activeView = view;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
    const selected = button.dataset.tab === view;
    button.classList.toggle('is-sel', selected);
    if (selected) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  }
  requestAnimationFrame(positionWorkspaceTabIndicator);
  $('cockpitShell').classList.toggle('is-active', view === 'cockpit');
  for (const section of document.querySelectorAll<HTMLElement>('[data-panel]')) {
    section.classList.toggle('is-active', section.dataset.panel === view);
  }
  if (agentLoaded) paintAgentChat();
  if (view === 'activity') {
    paintLog();
    paintAgentTraces();
    void refreshWorkflowPlans();
  }
  if (view === 'cockpit') {
    if (!agentLoaded) void refreshAgentSessions();
  }
}

function selectArtifactLens(lens: AgentArtifactLensId): void {
  if (artifactWorkspace) {
    artifactPresentation = selectArtifactLensState(artifactPresentation, artifactWorkspace, lens);
  } else {
    artifactPresentation = { ...artifactPresentation, selectedLens: lens };
  }
  paintArtifactWorkspace();
}

window.addEventListener('resize', () => requestAnimationFrame(() => {
  positionWorkspaceTabIndicator();
  if (davinciWidthPx !== null && !davinciResizing) setDavinciWidth(davinciWidthPx);
}));

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-tab]')) {
  button.addEventListener('click', () => {
    const view = button.dataset.tab as AppView | undefined;
    if (view) selectAppView(view);
  });
}
$<HTMLButtonElement>('sidebarNewChat').addEventListener('click', () => {
  void createAgentSessionFromUi().then((created) => {
    if (created) selectAppView('cockpit');
  });
});
$<HTMLButtonElement>('agentSend').addEventListener('click', () => { void sendAgentMessage(); });
$<HTMLButtonElement>('agentFocusLink').addEventListener('click', () => { void openSharedFocus(); });
const davinciTabs = $<HTMLElement>('davinciTabs');
for (const button of davinciTabs.querySelectorAll<HTMLButtonElement>('button[data-artifact-lens]')) {
  button.addEventListener('click', () => {
    const lens = button.dataset.artifactLens as AgentArtifactLensId | undefined;
    if (lens) selectArtifactLens(lens);
  });
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const tabs = [...davinciTabs.querySelectorAll<HTMLButtonElement>('button[data-artifact-lens]:not(:disabled)')];
    const next = nextMenuIndex(tabs.indexOf(button), event.key as MenuNavigationKey, tabs.length);
    const target = tabs[next];
    const lens = target?.dataset.artifactLens as AgentArtifactLensId | undefined;
    if (!target || !lens) return;
    target.focus();
    selectArtifactLens(lens);
  });
}

$<HTMLSelectElement>('artifactSelect').addEventListener('change', (event) => {
  if (!artifactWorkspace) return;
  artifactPresentation = selectArtifactForInspection(
    artifactPresentation,
    artifactWorkspace,
    (event.currentTarget as HTMLSelectElement).value
  );
  paintArtifactWorkspace();
});
$<HTMLButtonElement>('artifactPin').addEventListener('click', () => {
  artifactPresentation = setArtifactPin(artifactPresentation, !artifactPresentation.pinned);
  paintArtifactWorkspace();
});
$<HTMLButtonElement>('artifactUseContext').addEventListener('click', async () => {
  const artifact = activeArtifact();
  if (!artifact?.semanticHandle || artifact.source === 'cached_projection') return;
  if (artifact.kind === 'media_item') {
    const reply = await api.setMediaArtifactFocus(artifact.semanticHandle, artifact.generation);
    if (reply.ok) await refreshAgentSituation();
    return;
  }
  if (artifact.kind !== 'timeline_item') return;
  await setWorkspaceFocus(artifact.semanticHandle, artifact.generation);
});
$<HTMLButtonElement>('artifactOpenActivity').addEventListener('click', () => selectAppView('activity'));

for (const id of ['navigationLayoutSidebar', 'autoConnectOnLaunch', 'keepRunningOnWindowClose', 'showMenuBarIcon', 'launchAtLogin', 'developerMode']) {
  $<HTMLInputElement>(id).addEventListener('change', async () => {
    if (!state) return;
    const previous = state;
    const next = await unwrap(api.saveConfig(configFromUi()));
    if (next) paint(next, true);
    else if (state === previous) paint(previous, true);
  });
}

sidebarCollapseButton.addEventListener('click', () => {
  if (!state || state.config.navigationLayout !== 'sidebar') return;
  const previous = state;
  void actionGate.run('navigation:sidebar-collapse', async () => {
    const next = await unwrap(api.saveConfig({
      ...previous.config,
      sidebarCollapsed: !previous.config.sidebarCollapsed
    }));
    if (next) paint(next, true);
    else if (state === previous) paint(previous, true);
  });
});

sidebarResizeHandle.addEventListener('pointerdown', (event) => {
  if (!state || state.config.navigationLayout !== 'sidebar') return;
  if (state.config.sidebarCollapsed && !sidebarPeek) return;
  event.preventDefault();
  const previous = state;
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startWidth = sidebarWidthPx;
  let collapseTriggered = false;
  sidebarResizing = true;
  sidebarResizeHandle.classList.add('is-resizing');
  sidebarResizeHandle.setPointerCapture(pointerId);
  const cleanup = (): void => {
    sidebarResizing = false;
    sidebarResizeHandle.classList.remove('is-resizing');
    sidebarResizeHandle.removeEventListener('pointermove', move);
    sidebarResizeHandle.removeEventListener('pointerup', finish);
    sidebarResizeHandle.removeEventListener('pointercancel', finish);
    if (sidebarResizeHandle.hasPointerCapture(pointerId)) sidebarResizeHandle.releasePointerCapture(pointerId);
  };
  const move = (moveEvent: PointerEvent): void => {
    if (moveEvent.pointerId !== pointerId) return;
    const nextWidth = startWidth + moveEvent.clientX - startX;
    if (nextWidth < SIDEBAR_MIN_WIDTH_PX) {
      setSidebarWidth(SIDEBAR_MIN_WIDTH_PX);
      if (collapseTriggered) return;
      collapseTriggered = true;
      cleanup();
      void actionGate.run('navigation:sidebar-collapse', async () => {
        const next = await unwrap(api.saveConfig({
          ...previous.config,
          sidebarCollapsed: true
        }));
        if (next) paint(next, true);
        else if (state === previous) paint(previous, true);
      });
      return;
    }
    setSidebarWidth(nextWidth);
  };
  const finish = (finishEvent: PointerEvent): void => {
    if (finishEvent.pointerId !== pointerId) return;
    cleanup();
  };
  sidebarResizeHandle.addEventListener('pointermove', move);
  sidebarResizeHandle.addEventListener('pointerup', finish);
  sidebarResizeHandle.addEventListener('pointercancel', finish);
});

davinciCollapseButton.addEventListener('click', () => {
  setDavinciCollapsed(!davinciCollapsed);
});

cockpitResizeHandle.addEventListener('pointerdown', (event) => {
  if (davinciCollapsed) return;
  event.preventDefault();
  const pointerId = event.pointerId;
  const startX = event.clientX;
  const startWidth = davinciWorkspace.getBoundingClientRect().width;
  let collapseTriggered = false;
  davinciResizing = true;
  cockpitResizeHandle.classList.add('is-resizing');
  cockpitResizeHandle.setPointerCapture(pointerId);
  const cleanup = (): void => {
    davinciResizing = false;
    cockpitResizeHandle.classList.remove('is-resizing');
    cockpitResizeHandle.removeEventListener('pointermove', move);
    cockpitResizeHandle.removeEventListener('pointerup', finish);
    cockpitResizeHandle.removeEventListener('pointercancel', finish);
    if (cockpitResizeHandle.hasPointerCapture(pointerId)) cockpitResizeHandle.releasePointerCapture(pointerId);
  };
  const move = (moveEvent: PointerEvent): void => {
    if (moveEvent.pointerId !== pointerId) return;
    const nextWidth = startWidth - (moveEvent.clientX - startX);
    if (nextWidth < DAVINCI_MIN_WIDTH_PX) {
      if (collapseTriggered) return;
      collapseTriggered = true;
      davinciRestoreWidthPx = startWidth;
      cleanup();
      setDavinciCollapsed(true);
      return;
    }
    setDavinciWidth(nextWidth);
  };
  const finish = (finishEvent: PointerEvent): void => {
    if (finishEvent.pointerId !== pointerId) return;
    cleanup();
  };
  cockpitResizeHandle.addEventListener('pointermove', move);
  cockpitResizeHandle.addEventListener('pointerup', finish);
  cockpitResizeHandle.addEventListener('pointercancel', finish);
});

document.addEventListener('pointermove', (event) => {
  const eligible = state?.config.navigationLayout === 'sidebar' && state.config.sidebarCollapsed;
  const target = event.target;
  const pointerInsideSidebar = target instanceof Node && (
    sidebarShell.contains(target)
    || sidebarCollapseButton.contains(target)
    || sidebarPeekZone.contains(target)
  );
  const pointerInsideEdgeZone = event.clientX >= 0 && event.clientX <= SIDEBAR_PEEK_EDGE_PX;
  setSidebarPeek(nextSidebarPeek(sidebarPeek, Boolean(eligible), pointerInsideSidebar, pointerInsideEdgeZone));
});
sidebarPeekZone.addEventListener('pointerenter', () => {
  const eligible = state?.config.navigationLayout === 'sidebar' && state.config.sidebarCollapsed;
  if (eligible) setSidebarPeek(true);
});
const retractSidebarPeekAfterLeave = (event: PointerEvent): void => {
  if (!sidebarPeek || sidebarResizing) return;
  const target = event.relatedTarget;
  if (target instanceof Node && (
    sidebarShell.contains(target)
    || sidebarCollapseButton.contains(target)
    || sidebarPeekZone.contains(target)
  )) return;
  setSidebarPeek(false);
};
sidebarShell.addEventListener('pointerleave', retractSidebarPeekAfterLeave);
sidebarCollapseButton.addEventListener('pointerleave', retractSidebarPeekAfterLeave);
sidebarPeekZone.addEventListener('pointerleave', retractSidebarPeekAfterLeave);
document.documentElement.addEventListener('pointerleave', () => {
  if (!sidebarResizing) setSidebarPeek(false);
});

const languageButton = $<HTMLButtonElement>('languageButton');
const languageOptions = $('languageOptions');
const languageMenuOptions = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('.language-option')];
function closeLanguageMenu(): void {
  languageOptions.hidden = true;
  languageButton.setAttribute('aria-expanded', 'false');
}
function openLanguageMenu(focusIndex?: number): void {
  languageOptions.hidden = false;
  languageButton.setAttribute('aria-expanded', 'true');
  if (focusIndex !== undefined) languageMenuOptions()[focusIndex]?.focus();
}
languageButton.addEventListener('click', (event) => {
  event.stopPropagation();
  if (languageOptions.hidden) openLanguageMenu();
  else closeLanguageMenu();
});
languageButton.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
  event.preventDefault();
  const options = languageMenuOptions();
  openLanguageMenu(event.key === 'ArrowUp' ? options.length - 1 : 0);
});
for (const option of document.querySelectorAll<HTMLButtonElement>('.language-option')) {
  option.addEventListener('click', async () => {
    if (!state) return;
    const language = option.dataset.language as UiLanguagePreference;
    closeLanguageMenu();
    const next = await unwrap(api.saveConfig({ ...state.config, language }));
    if (next) paint(next, true);
  });
  option.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeLanguageMenu();
      languageButton.focus();
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const options = languageMenuOptions();
    const next = nextMenuIndex(options.indexOf(option), event.key as MenuNavigationKey, options.length);
    options[next]?.focus();
  });
}
document.addEventListener('click', (event) => {
  if (!$('languageControl').contains(event.target as Node)) closeLanguageMenu();
});
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeLanguageMenu(); });

// The DaVinci panel state is renderer-local, so unlike the persisted sidebar it is
// not painted by AppState on startup. Seed its titlebar control explicitly so the
// right panel uses the same Lucide control from the first frame.
setDavinciCollapsed(false);

for (const button of document.querySelectorAll<HTMLButtonElement>('[data-link]')) {
  button.addEventListener('click', () => { const link = button.dataset.link; if (link) void api.openLink(link); });
}
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-copy]')) {
  button.addEventListener('click', async () => {
    const id = button.dataset.copy;
    if (!id) return;
    const value = $<HTMLInputElement>(id).value;
    const result = await api.writeClipboard(value);
    if (result.ok) {
      if (button.lastChild) button.lastChild.textContent = t('common.copied');
      setTimeout(() => { if (button.lastChild) button.lastChild.textContent = t('common.copy'); }, 900);
    }
  });
}

$<HTMLInputElement>('tunnelId').addEventListener('change', () => { void saveSetup(); });
$<HTMLInputElement>('apiKey').addEventListener('change', () => { void saveSetup(); });

void Promise.all([api.getState(), api.getLog()]).then(([stateReply, logReply]) => {
  if (stateReply.ok) {
    paint(stateReply.data);
    activeView = isSetupComplete(stateReply.data) ? 'cockpit' : 'setup';
  }
  if (logReply.ok) { log = logReply.data; paintLog(); }
  selectAppView(activeView);
  void refreshAgentSituation();
});
api.onStateChanged(paint);
api.onLogEntry((entry) => { log.push(entry); paintLog(); });
api.onZoomChanged(showZoomNotice);
void api.getZoom().then((reply) => {
  if (!reply.ok) return;
  currentZoomPercent = reply.data;
  syncTitlebarControlMetrics(reply.data);
});
setInterval(() => {
  if (state?.tunnel.state === 'connected' || state?.tunnel.state === 'starting') {
    void api.refreshHealth().then((reply) => { if (reply.ok) paint(reply.data); });
  }
}, 15000);
