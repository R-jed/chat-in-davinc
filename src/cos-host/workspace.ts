/**
 * Deliberate no-op replacement for COS coding-workspace inheritance.
 *
 * Chat in DaVinci workers receive Resolve context through CID's Context Compiler/World Model and
 * may never acquire filesystem roots by becoming a worker. Keeping these exact broker hooks as
 * no-ops preserves COS worker lifecycle semantics without importing its coding sandbox authority.
 */
export function inheritWorkspace(_toAgent: string, _primeConversationId: string | null, _runId?: string): boolean {
  return false;
}

export function releasePrimeWorkspace(_primeConversationId: string | null, _runId?: string): boolean {
  return false;
}

export function bindAgentWorkspace(_agentId: string, _conversationId: string, _runId?: string): boolean {
  return false;
}
