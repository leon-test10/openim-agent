import type { ConversationSummary, SemanticEvent } from "./semantic-event.js";
import type { SemanticEventRepository } from "./semantic-event.repository.js";
import type { ConversationSummaryRepository } from "./conversation-summary.repository.js";
import type { SessionBindingRepository } from "./session-binding.repository.js";

export interface ConversationContext {
  conversationID: string;
  conversationType: "single" | "group" | "unknown";
  projectPath?: string;
  activeCodexSessionID?: string;
  summary?: ConversationSummary;
  recentEvents: SemanticEvent[];
  undeliveredHistoryEvents: SemanticEvent[];
  currentEvent?: SemanticEvent;
  skipped: Array<{ eventID?: string; reason: string }>;
}

export class ConversationContextBuilder {
  constructor(
    private readonly deps: {
      semanticEvents: SemanticEventRepository;
      summaries: ConversationSummaryRepository;
      sessions: SessionBindingRepository;
      recentLimit?: number;
    }
  ) {}

  build(conversationID: string, options: { recentLimit?: number; currentEvent?: SemanticEvent } = {}): ConversationContext {
    const active = this.deps.sessions.getActiveByConversationId(conversationID);
    const limit = options.recentLimit ?? this.deps.recentLimit ?? 30;
    const allEvents = this.deps.semanticEvents.listLatestByConversationId(conversationID, {
      limit: 1000,
      includeRuntime: true
    });
    const promptCandidates = allEvents.filter((event) => event.text?.trim() && (event.role === "user" || event.role === "assistant"));
    const recentWindowEvents = promptCandidates.slice(-limit);
    const undeliveredHistoryEvents = active
      ? this.deps.semanticEvents.listUndeliveredHistoryPromptEvents(conversationID, active.id)
      : [];
    const recentEvents = uniqueById([...undeliveredHistoryEvents, ...recentWindowEvents]);
    const included = new Set(recentEvents.map((event) => event.id));
    const skipped = allEvents
      .filter((event) => !included.has(event.id))
      .map((event) => ({ eventID: event.id, reason: skipReason(event, promptCandidates, limit) }));
    if (options.currentEvent?.deliveredAt) {
      skipped.push({ eventID: options.currentEvent.id, reason: "already_delivered" });
    }
    const firstEvent = recentEvents[0] ?? options.currentEvent;
    return {
      conversationID,
      conversationType: firstEvent?.conversationType ?? (firstEvent?.groupId ? "group" : "single"),
      projectPath: active?.codexProjectPath,
      activeCodexSessionID: active?.codexSessionId ?? undefined,
      summary: this.deps.summaries.get(conversationID) ?? undefined,
      recentEvents,
      undeliveredHistoryEvents,
      currentEvent: options.currentEvent,
      skipped
    };
  }
}

export interface ContextPreview {
  conversationID: string;
  conversationType: string;
  projectPath?: string;
  activeCodexSessionID?: string;
  summaryIncluded: boolean;
  summaryUpdatedAt?: number;
  summaryEventCount?: number;
  recentEventCount: number;
  includedEventIDs: string[];
  skippedEventCount: number;
  skippedReasons: Record<string, number>;
  roleCounts: Record<string, number>;
  actorCounts: Record<string, number>;
  semanticContextIncluded?: boolean;
  semanticContextReason?: string;
  promptPreview?: string;
  promptRedacted: boolean;
}

export function buildContextPreview(
  context: ConversationContext,
  promptPreview?: string,
  supplement?: { includeSemanticContext: boolean; reason: string }
): ContextPreview {
  return {
    conversationID: context.conversationID,
    conversationType: context.conversationType,
    projectPath: context.projectPath,
    activeCodexSessionID: context.activeCodexSessionID,
    summaryIncluded: Boolean(context.summary),
    summaryUpdatedAt: context.summary?.updatedAt,
    summaryEventCount: context.summary?.coveredEventIDs.length,
    recentEventCount: context.recentEvents.length,
    includedEventIDs: context.recentEvents.map((event) => event.id),
    skippedEventCount: context.skipped.length,
    skippedReasons: countBy(context.skipped.map((item) => item.reason)),
    roleCounts: countBy(context.recentEvents.map((event) => event.role ?? "unknown")),
    actorCounts: countBy(context.recentEvents.map((event) => event.actorType ?? "unknown")),
    semanticContextIncluded: supplement?.includeSemanticContext,
    semanticContextReason: supplement?.reason,
    promptPreview,
    promptRedacted: Boolean(promptPreview)
  };
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1;
    return acc;
  }, {});
}

function uniqueById(events: SemanticEvent[]): SemanticEvent[] {
  const seen = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.id)) {
      return false;
    }
    seen.add(event.id);
    return true;
  });
}

function skipReason(event: SemanticEvent, promptCandidates: SemanticEvent[], limit: number): string {
  if (!event.text?.trim() || event.contentType !== 101) {
    return "non_text_content";
  }
  if (event.role === "runtime") {
    return "runtime_event_excluded";
  }
  if (event.role !== "user" && event.role !== "assistant") {
    return "unsupported_role";
  }
  const recentCandidateIds = new Set(promptCandidates.slice(-limit).map((item) => item.id));
  if (!recentCandidateIds.has(event.id)) {
    return "outside_recent_window";
  }
  if (event.deliveredAt) {
    return "already_delivered";
  }
  return "duplicate_current_event";
}
