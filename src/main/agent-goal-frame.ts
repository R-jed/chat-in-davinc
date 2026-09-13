import type { AgentSessionEvent } from '../shared/agent-session.js';
import type { AgentGoalDirective, AgentGoalFrame } from '../shared/agent-system.js';

const MAX_DIRECTIVE_CHARS = 24_000;

function directive(event: Extract<AgentSessionEvent, { kind: 'user_message' }>, maxChars = event.message.text.length): AgentGoalDirective {
  const text = event.message.text.slice(0, maxChars);
  return {
    turnId: event.turnId ?? '',
    seq: event.seq,
    text,
    chars: event.message.chars,
    truncated: event.message.truncated || text.length < event.message.text.length
  };
}

export function deriveAgentGoalFrame(events: readonly AgentSessionEvent[]): AgentGoalFrame {
  const allUserRows = events.filter((event): event is Extract<AgentSessionEvent, { kind: 'user_message' }> => event.kind === 'user_message');
  const lastCompletion = [...events].reverse().find((event) => event.kind === 'goal_completed') ?? null;
  const rowsAfterCompletion = lastCompletion ? allUserRows.filter((event) => event.seq > lastCompletion.seq) : [];
  const userRows = rowsAfterCompletion.length > 0 ? rowsAfterCompletion : allUserRows;
  const original = userRows[0] ?? null;
  const updates = userRows.slice(1);
  const selected: AgentGoalDirective[] = [];
  let remaining = MAX_DIRECTIVE_CHARS;
  for (let index = updates.length - 1; index >= 0 && remaining > 0; index -= 1) {
    const event = updates[index]!;
    const item = directive(event, remaining);
    selected.push(item);
    remaining -= item.text.length;
  }
  selected.reverse();
  return {
    schemaVersion: 1,
    originalRequest: original ? directive(original) : null,
    userDirectives: selected,
    sourceUserMessages: userRows.length,
    omittedUserDirectives: Math.max(0, updates.length - selected.length),
    desiredOutcome: null,
    hardConstraints: [],
    userPreferences: [],
    explicitNonGoals: [],
    completionCriteria: [],
    requiredEvidence: [],
    assumptions: [],
    decisions: [],
    corrections: [],
    openObligations: []
  };
}
