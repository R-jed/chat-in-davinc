import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppConfig,
  AppState,
  LogEntry,
  RendererWorkflowObservationReceipt,
  RendererWorkflowPlanProjection,
  Reply,
  WorkflowAuditEntry,
  WorkflowInspectResult,
  WorkflowInspectTarget,
  WorkflowRiskAssessment
} from '../shared/types.js';
import type { AgentCompactionResult, AgentSessionSummary, AgentSessionView, AgentTurnResult } from '../shared/agent-session.js';
import type {
  AgentArtifactWorkspaceProjection,
  AgentSharedFocus,
  AgentSituationFrame,
  AgentSystemSpineProjection
} from '../shared/agent-system.js';

const call = <T>(channel: string, payload?: unknown): Promise<Reply<T>> => ipcRenderer.invoke(channel, payload) as Promise<Reply<T>>;

const api = {
  getState: () => call<AppState>('state:get'),
  saveConfig: (config: AppConfig) => call<AppState>('config:save', config),
  setApiKey: (value: string) => call<AppState>('secret:set', value),
  addProjectLocation: () => call<AppState>('locations:add'),
  removeProjectLocation: (name: string) => call<AppState>('locations:remove', name),
  setChatgptVerified: (verified: boolean) => call<AppState>('verification:set', verified),
  setWorkflowChatgptVerified: (verified: boolean) => call<AppState>('workflow-verification:set', verified),
  probeResolve: () => call<AppState>('resolve:probe'),
  connect: () => call<AppState>('tunnel:connect'),
  disconnect: () => call<AppState>('tunnel:disconnect'),
  refreshHealth: () => call<AppState>('tunnel:health'),
  inspectWorkflow: (target: WorkflowInspectTarget) => call<WorkflowInspectResult | RendererWorkflowObservationReceipt>('workflow:inspect', target),
  inspectMediaClip: (handle: string, generation: number) => call<WorkflowInspectResult>('workflow:media-clip', { handle, generation }),
  inspectMediaLinkStatus: (handle?: string, generation?: number) => call<WorkflowInspectResult>(
    'workflow:media-link-status',
    handle === undefined ? undefined : { handle, generation }
  ),
  inspectEditStructure: () => call<WorkflowInspectResult>('workflow:edit-structure'),
  inspectEditGapsOverlaps: () => call<WorkflowInspectResult>('workflow:edit-gaps-overlaps'),
  inspectEditSourceRanges: () => call<WorkflowInspectResult>('workflow:edit-source-ranges'),
  inspectEditTransitions: () => call<WorkflowInspectResult>('workflow:edit-transitions'),
  inspectEditAnnotations: () => call<WorkflowInspectResult>('workflow:edit-annotations'),
  inspectFusionGraph: () => call<RendererWorkflowObservationReceipt>('workflow:fusion-graph'),
  inspectColorGraph: () => call<RendererWorkflowObservationReceipt>('workflow:color-graph'),
  inspectColorVersions: () => call<RendererWorkflowObservationReceipt>('workflow:color-versions'),
  inspectFairlightProcessing: () => call<RendererWorkflowObservationReceipt>('workflow:fairlight-processing'),
  inspectWorkflowRisk: (tool: string) => call<WorkflowRiskAssessment>('workflow:risk', tool),
  getWorkflowAudit: (limit = 10) => call<WorkflowAuditEntry[]>('workflow:audit', limit),
  getWorkflowPlan: (planId: string) => call<RendererWorkflowPlanProjection | null>('workflow:plan:get', planId),
  getRecentWorkflowPlans: (limit = 10) => call<RendererWorkflowPlanProjection[]>('workflow:plans:recent', limit),
  approveWorkflowPlan: (planId: string) => call<RendererWorkflowPlanProjection>('workflow:approval:grant', planId),
  rejectWorkflowPlan: (planId: string) => call<RendererWorkflowPlanProjection>('workflow:approval:reject', planId),
  getAgentModel: () => call<string>('agent:model'),
  listAgentSessions: () => call<AgentSessionSummary[]>('agent:sessions:list'),
  createAgentSession: (title?: string) => call<AgentSessionView>('agent:session:create', title),
  getAgentSession: (sessionId: string) => call<AgentSessionView>('agent:session:get', sessionId),
  runAgentTurn: (sessionId: string, text: string) => call<{ turn: AgentTurnResult; session: AgentSessionView }>('agent:turn:run', { sessionId, text }),
  compactAgentSession: (sessionId: string) => call<AgentCompactionResult>('agent:session:compact', sessionId),
  setTimelineArtifactFocus: (handle: string, generation: number) => call<AgentSharedFocus>('agent:focus:timeline-artifact', { handle, generation }),
  setMediaArtifactFocus: (handle: string, generation: number) => call<AgentSharedFocus>('agent:focus:media-artifact', { handle, generation }),
  focusWorkflowPlanTarget: (planId: string) => call<AgentSharedFocus>('agent:focus:plan', planId),
  getAgentSituation: () => call<AgentSituationFrame>('agent:situation:get'),
  getAgentSpine: () => call<AgentSystemSpineProjection | null>('agent:spine:get'),
  getArtifactWorkspace: () => call<AgentArtifactWorkspaceProjection | null>('agent:artifact-workspace:get'),
  getLog: () => call<LogEntry[]>('log:get'),
  getZoom: () => call<number>('zoom:get'),
  setZoom: (percent: number) => call<number>('zoom:set', percent),
  writeClipboard: (value: string) => call<boolean>('clipboard:write', value),
  openLink: (value: string) => call<boolean>('link:open', value),
  onStateChanged: (listener: (state: AppState) => void): (() => void) => {
    const wrapped = (_event: unknown, state: AppState): void => listener(state);
    ipcRenderer.on('state:changed', wrapped);
    return () => ipcRenderer.removeListener('state:changed', wrapped);
  },
  onLogEntry: (listener: (entry: LogEntry) => void): (() => void) => {
    const wrapped = (_event: unknown, entry: LogEntry): void => listener(entry);
    ipcRenderer.on('log:entry', wrapped);
    return () => ipcRenderer.removeListener('log:entry', wrapped);
  },
  onZoomChanged: (listener: (percent: number) => void): (() => void) => {
    const wrapped = (_event: unknown, percent: number): void => listener(percent);
    ipcRenderer.on('zoom:changed', wrapped);
    return () => ipcRenderer.removeListener('zoom:changed', wrapped);
  }
};

export type AppApi = typeof api;
contextBridge.exposeInMainWorld('api', api);
