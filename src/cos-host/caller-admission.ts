import {
  cosSessionForConversation,
  currentCosSessionForConversation,
  type CosSessionView
} from './session-runtime.js';

export interface ExactCosCallerEvidence {
  conversationId?: string | null;
  sessionId?: string | null;
  turnId?: string | null;
  messageId?: string | null;
  tool?: string | null;
}

export interface ExactCosCallerAdmission {
  conversationId: string;
  session: CosSessionView;
  turnId: string;
  messageId: string;
}

/**
 * One exact caller admission shared by COS control tools, protected product tools and browser
 * request-correlation ingestion. Durable request-id evidence is necessary but never sufficient:
 * it must still name the current conversation owner, current Session, current active turn, one
 * actually recorded message on that turn, and the exact tool being invoked.
 */
export function admitExactCosCaller(
  resolved: ExactCosCallerEvidence | null | undefined,
  expectedTool: string
): ExactCosCallerAdmission {
  if (!resolved?.conversationId) {
    throw new Error('Exact ChatGPT conversation identity is required for ' + expectedTool);
  }
  const historical = cosSessionForConversation(resolved.conversationId);
  const session = currentCosSessionForConversation(resolved.conversationId);
  if (!session && historical) {
    throw new Error('This ChatGPT conversation was superseded by Compact & Resume');
  }
  if (!session || !resolved.sessionId || resolved.sessionId !== session.sessionId) {
    throw new Error('Exact COS Session identity is required for ' + expectedTool);
  }
  if (!resolved.turnId || !session.activeTurnId || resolved.turnId !== session.activeTurnId) {
    throw new Error(expectedTool + ' requires this caller’s exact active COS turn');
  }
  if (
    !resolved.messageId ||
    !session.events.some((event) =>
      (event.kind === 'user_message' || event.kind === 'assistant_message')
      && event.turnId === resolved.turnId
      && event.messageId === resolved.messageId
    )
  ) {
    throw new Error('COS caller message identity conflicts with the exact recorded turn');
  }
  if (resolved.tool !== expectedTool) {
    throw new Error('COS caller tool identity conflicts with the exact request correlation');
  }
  return {
    conversationId: resolved.conversationId,
    session,
    turnId: resolved.turnId,
    messageId: resolved.messageId
  };
}
