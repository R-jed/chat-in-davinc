import type { ReasoningEffort } from './shared/session.js';

/**
 * Narrow COS host configuration used by the imported COS multi-agent broker.
 *
 * This is intentionally limited to the fields the broker itself consumes. The target owner of
 * these values is the COS upper runtime/UI; CID does not add a second general-purpose settings
 * model. Until that host settings layer is physically rebased, safe defaults keep the broker
 * deterministic and an explicit setter is the only way tests/host bootstrap can change them.
 */
export interface CosHostMultiAgentConfig {
  enabled: boolean;
  defaultModel?: string;
  defaultReasoning?: ReasoningEffort;
  maxWorkers: number;
}

const DEFAULT_MULTI_AGENT: CosHostMultiAgentConfig = {
  enabled: true,
  maxWorkers: 8
};

let multiAgent: CosHostMultiAgentConfig = { ...DEFAULT_MULTI_AGENT };

export function configureCosHostMultiAgent(next: Partial<CosHostMultiAgentConfig>): CosHostMultiAgentConfig {
  const maxWorkers = next.maxWorkers ?? multiAgent.maxWorkers;
  if (!Number.isInteger(maxWorkers) || maxWorkers < 1 || maxWorkers > 8) {
    throw new Error('COS maxWorkers must be an integer between 1 and 8');
  }
  multiAgent = {
    ...multiAgent,
    ...next,
    maxWorkers
  };
  return { ...multiAgent };
}

export function getConfig(): { multiAgent: CosHostMultiAgentConfig } {
  return { multiAgent: { ...multiAgent } };
}

export function resetCosHostConfigForTests(): void {
  multiAgent = { ...DEFAULT_MULTI_AGENT };
}
