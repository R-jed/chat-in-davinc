import type {
  AgentActionOffer,
  AgentCompletionCriterion,
  AgentCompletionReport,
  AgentDecisionKind,
  AgentEvidenceRef,
  AgentGoalFrame
} from '../shared/agent-system.js';
import type { ProtectedVerificationLevel } from '../shared/types.js';
import { agentEvidenceIsCurrent } from './agent-world-model.js';

function criteria(goal: AgentGoalFrame): string[] {
  const explicit = goal.completionCriteria.map((item) => item.trim()).filter(Boolean);
  if (explicit.length > 0) return [...new Set(explicit)];
  const fallback = goal.desiredOutcome?.trim() || goal.originalRequest?.text.trim() || '';
  return fallback ? [fallback] : [];
}

function verificationSatisfies(
  actual: ProtectedVerificationLevel | null,
  required: ProtectedVerificationLevel
): boolean {
  return actual === required;
}

function strongest(levels: Array<ProtectedVerificationLevel | null>): ProtectedVerificationLevel | null {
  const exact = [...new Set(levels.filter((level): level is ProtectedVerificationLevel => level !== null))];
  return exact.length === 1 ? exact[0]! : null;
}

export function deriveAgentCompletionReport(options: {
  sessionId: string;
  generation: number;
  goal: AgentGoalFrame;
  actionOffers: readonly AgentActionOffer[];
  evidence: readonly AgentEvidenceRef[];
  blockers?: readonly string[];
  materialUnknowns?: readonly string[];
}): AgentCompletionReport {
  const rows: AgentCompletionCriterion[] = criteria(options.goal).map((criterion) => {
    const offers = options.actionOffers.filter((offer) => offer.advancesCriterion === criterion);
    const applicable = offers.filter((offer) => offer.applicability === 'applicable' && offer.implementation);
    const evidence = applicable.flatMap((offer) =>
      options.evidence.filter((item) =>
        item.generation === options.generation
        && agentEvidenceIsCurrent(item, options.generation)
        && item.workflowId === offer.implementation!.implementationId
        && (offer.targetHandle === null ? item.targetHandle === null : item.targetHandle === offer.targetHandle)
        && (!offer.dispatch?.profile || item.preflightProfile === offer.dispatch.profile)
        && item.verificationStatus === 'passed'
        && verificationSatisfies(item.verificationLevel, offer.verificationRequirement)
      )
    );
    const uniqueEvidence = [...new Map(evidence.map((item) => [item.id, item])).values()];
    if (uniqueEvidence.length > 0) {
      return {
        criterion,
        status: 'satisfied',
        evidenceIds: uniqueEvidence.map((item) => item.id),
        strongestVerification: strongest(uniqueEvidence.map((item) => item.verificationLevel)),
        blockingReason: null
      };
    }
    const staleMatch = applicable.some((offer) => options.evidence.some((item) =>
      item.generation === options.generation
      && item.workflowId === offer.implementation!.implementationId
      && (offer.targetHandle === null ? item.targetHandle === null : item.targetHandle === offer.targetHandle)
      && (!offer.dispatch?.profile || item.preflightProfile === offer.dispatch.profile)
      && item.verificationStatus === 'passed'
      && verificationSatisfies(item.verificationLevel, offer.verificationRequirement)
      && !agentEvidenceIsCurrent(item, options.generation)
    ));
    const blocked = offers.find((offer) => offer.applicability === 'blocked' || offer.applicability === 'unavailable');
    const unknown = offers.find((offer) => offer.applicability === 'unknown');
    return {
      criterion,
      status: blocked ? 'blocked' : unknown || offers.length === 0 ? 'unknown' : 'missing_evidence',
      evidenceIds: [],
      strongestVerification: null,
      blockingReason: blocked?.blockingReason
        ?? unknown?.blockingReason
        ?? (staleMatch
          ? 'Matching qualified evidence was invalidated for this semantic slice; refresh this exact capability and target.'
          : null)
        ?? (offers.length === 0
          ? 'No state-bound ActionOffer currently advances this criterion.'
          : 'The applicable capability has no current qualified verification evidence.')
    };
  });
  const blockers = [...new Set([
    ...(options.blockers ?? []),
    ...rows.filter((row) => row.status === 'blocked').flatMap((row) => row.blockingReason ? [row.blockingReason] : [])
  ])];
  const materialUnknowns = [...new Set([
    ...(options.materialUnknowns ?? []),
    ...rows.filter((row) => row.status === 'unknown').flatMap((row) => row.blockingReason ? [row.blockingReason] : [])
  ])];
  const evidenceIds = [...new Set(rows.flatMap((row) => row.evidenceIds))];
  return {
    schemaVersion: 1,
    sessionId: options.sessionId,
    evaluatedAt: Date.now(),
    generation: options.generation,
    complete: rows.length > 0 && rows.every((row) => row.status === 'satisfied') && blockers.length === 0 && materialUnknowns.length === 0,
    criteria: rows,
    blockers,
    materialUnknowns,
    evidenceIds,
    strongestVerification: strongest(rows.map((row) => row.strongestVerification))
  };
}

/**
 * CompletionReport stays the evidence authority. This helper only maps that criterion-level
 * state to the next Agent control posture; it never invents completion from visible evidence.
 */
export function deriveDecisionKindFromCompletion(options: {
  completion: AgentCompletionReport;
  actionOffers: readonly AgentActionOffer[];
  materialUncertainty: string | null;
  approvalPending?: boolean;
}): AgentDecisionKind {
  if (options.completion.complete) return 'finish_check';
  if (options.approvalPending) return 'approval_wait';
  const applicable = options.actionOffers.filter((offer) => offer.applicability === 'applicable');
  if (options.materialUncertainty && applicable.length === 0) return 'clarify';
  if (applicable.some((offer) => offer.kind === 'mutate')) return 'act';
  return 'observe';
}
