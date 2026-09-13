import type {
  AgentArtifactLensId,
  AgentArtifactSummary,
  AgentArtifactWorkspaceProjection
} from '../shared/agent-system.js';

export const ARTIFACT_MANUAL_INSPECTION_HOLD_MS = 10_000;

export interface ArtifactWorkspacePresentationState {
  scopeKey: string | null;
  activeArtifactId: string | null;
  selectedLens: AgentArtifactLensId;
  pinned: boolean;
  manualInspectionUntil: number;
  manualInspectionActive: boolean;
  manualBaselineSuggestedArtifactId: string | null;
}

export function createArtifactWorkspacePresentationState(): ArtifactWorkspacePresentationState {
  return {
    scopeKey: null,
    activeArtifactId: null,
    selectedLens: 'summary',
    pinned: false,
    manualInspectionUntil: 0,
    manualInspectionActive: false,
    manualBaselineSuggestedArtifactId: null
  };
}

export function artifactWorkspaceSemanticScope(projection: AgentArtifactWorkspaceProjection): string {
  return [
    projection.sessionId,
    projection.workspace?.workspaceId ?? 'unbound',
    String(projection.generation),
    projection.context.project?.handle ?? '',
    String(projection.context.project?.generation ?? ''),
    projection.context.timeline?.handle ?? '',
    String(projection.context.timeline?.generation ?? '')
  ].join('\u0000');
}

export function artifactById(
  projection: AgentArtifactWorkspaceProjection,
  artifactId: string | null
): AgentArtifactSummary | null {
  if (!artifactId) return null;
  return projection.artifacts.find((artifact) => artifact.artifactId === artifactId) ?? null;
}

function firstAvailableLens(artifact: AgentArtifactSummary | null): AgentArtifactLensId {
  return artifact?.lenses.find((lens) => lens.availability === 'available')?.id ?? 'summary';
}

function lensIsAvailable(artifact: AgentArtifactSummary | null, lensId: AgentArtifactLensId): boolean {
  return artifact?.lenses.some((lens) => lens.id === lensId && lens.availability === 'available') ?? false;
}

export function reconcileArtifactWorkspacePresentation(
  current: ArtifactWorkspacePresentationState,
  projection: AgentArtifactWorkspaceProjection,
  now = Date.now()
): ArtifactWorkspacePresentationState {
  const nextScope = artifactWorkspaceSemanticScope(projection);
  if (current.scopeKey !== nextScope) {
    const activeArtifactId = projection.suggestedArtifactId ?? projection.artifacts[0]?.artifactId ?? null;
    const activeArtifact = artifactById(projection, activeArtifactId);
    return {
      scopeKey: nextScope,
      activeArtifactId,
      selectedLens: firstAvailableLens(activeArtifact),
      pinned: false,
      manualInspectionUntil: 0,
      manualInspectionActive: false,
      manualBaselineSuggestedArtifactId: null
    };
  }

  let activeArtifactId = current.activeArtifactId;
  let pinned = current.pinned;
  let manualInspectionUntil = current.manualInspectionUntil;
  let manualInspectionActive = current.manualInspectionActive;
  let manualBaselineSuggestedArtifactId = current.manualBaselineSuggestedArtifactId;
  if (!artifactById(projection, activeArtifactId)) {
    activeArtifactId = projection.suggestedArtifactId ?? projection.artifacts[0]?.artifactId ?? null;
    pinned = false;
    manualInspectionUntil = 0;
    manualInspectionActive = false;
    manualBaselineSuggestedArtifactId = null;
  } else if (!pinned && projection.suggestedArtifactId) {
    if (!manualInspectionActive) {
      activeArtifactId = projection.suggestedArtifactId;
    } else if (now >= manualInspectionUntil
      && projection.suggestedArtifactId !== manualBaselineSuggestedArtifactId) {
      activeArtifactId = projection.suggestedArtifactId;
      manualInspectionUntil = 0;
      manualInspectionActive = false;
      manualBaselineSuggestedArtifactId = null;
    }
  }
  const activeArtifact = artifactById(projection, activeArtifactId);
  return {
    ...current,
    scopeKey: nextScope,
    activeArtifactId,
    pinned,
    manualInspectionUntil,
    manualInspectionActive,
    manualBaselineSuggestedArtifactId,
    selectedLens: lensIsAvailable(activeArtifact, current.selectedLens)
      ? current.selectedLens
      : firstAvailableLens(activeArtifact)
  };
}

export function selectArtifactForInspection(
  current: ArtifactWorkspacePresentationState,
  projection: AgentArtifactWorkspaceProjection,
  artifactId: string,
  now = Date.now()
): ArtifactWorkspacePresentationState {
  const artifact = artifactById(projection, artifactId);
  if (!artifact) return current;
  return {
    ...current,
    activeArtifactId: artifact.artifactId,
    selectedLens: lensIsAvailable(artifact, current.selectedLens)
      ? current.selectedLens
      : firstAvailableLens(artifact),
    manualInspectionUntil: now + ARTIFACT_MANUAL_INSPECTION_HOLD_MS,
    manualInspectionActive: true,
    manualBaselineSuggestedArtifactId: projection.suggestedArtifactId
  };
}

export function setArtifactPin(
  current: ArtifactWorkspacePresentationState,
  pinned: boolean
): ArtifactWorkspacePresentationState {
  return { ...current, pinned };
}

export function selectArtifactLens(
  current: ArtifactWorkspacePresentationState,
  projection: AgentArtifactWorkspaceProjection,
  lensId: AgentArtifactLensId,
  now = Date.now()
): ArtifactWorkspacePresentationState {
  const artifact = artifactById(projection, current.activeArtifactId);
  if (!lensIsAvailable(artifact, lensId)) return current;
  return {
    ...current,
    selectedLens: lensId,
    manualInspectionUntil: now + ARTIFACT_MANUAL_INSPECTION_HOLD_MS,
    manualInspectionActive: true,
    manualBaselineSuggestedArtifactId: projection.suggestedArtifactId
  };
}
