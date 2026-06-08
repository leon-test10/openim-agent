import type { SemanticEvent } from "./semantic-event.js";
import type { CodexSessionRecord } from "./session-binding.js";

export type ContextSupplementReason =
  | "codex_session_resume"
  | "new_codex_session"
  | "undelivered_openim_history"
  | "explicit_history_request"
  | "group_speaker_context"
  | "session_switch_or_rebind"
  | "diagnostics_preview";

export interface ContextSupplementDecision {
  includeSemanticContext: boolean;
  reason: ContextSupplementReason;
  deliverableEventIDs: string[];
}

export function decideContextSupplement(input: {
  session: CodexSessionRecord;
  currentEvent: SemanticEvent;
  recentEvents: SemanticEvent[];
  diagnosticsPreview?: boolean;
}): ContextSupplementDecision {
  if (input.diagnosticsPreview) {
    return include("diagnostics_preview", input.recentEvents);
  }
  if (!input.session.codexSessionId) {
    return include("new_codex_session", input.recentEvents);
  }
  if (input.session.createdReason === "manual_rebind" || input.session.parentSessionRecordId || input.session.forkedFromCodexSessionId) {
    return include("session_switch_or_rebind", input.recentEvents);
  }
  if (input.currentEvent.conversationType === "group" || Boolean(input.currentEvent.groupId)) {
    return include("group_speaker_context", input.recentEvents);
  }
  if (isExplicitHistoryRequest(input.currentEvent.text)) {
    return include("explicit_history_request", input.recentEvents);
  }
  if (input.recentEvents.some((event) => isUndeliveredHistoryForSession(event, input.session))) {
    return include("undelivered_openim_history", input.recentEvents);
  }
  return {
    includeSemanticContext: false,
    reason: "codex_session_resume",
    deliverableEventIDs: []
  };
}

function include(reason: ContextSupplementReason, events: SemanticEvent[]): ContextSupplementDecision {
  return {
    includeSemanticContext: true,
    reason,
    deliverableEventIDs: events
      .filter((event) => event.text?.trim())
      .filter((event) => event.role === "user" || event.role === "assistant")
      .map((event) => event.id)
  };
}

function isUndeliveredHistoryForSession(event: SemanticEvent, session: CodexSessionRecord): boolean {
  return event.source === "openim_history_snapshot" && event.deliveredSessionRecordId !== session.id;
}

function isExplicitHistoryRequest(text: string | null | undefined): boolean {
  if (!text) {
    return false;
  }
  return /previous|history|chat history|OpenIM history|earlier|之前|历史|上下文|聊天记录/i.test(text);
}
