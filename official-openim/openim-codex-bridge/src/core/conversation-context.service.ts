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
    const recentEvents = this.deps.semanticEvents.listRecentPromptEvents(
      conversationID,
      options.recentLimit ?? this.deps.recentLimit ?? 30
    );
    const firstEvent = recentEvents[0] ?? options.currentEvent;
    return {
      conversationID,
      conversationType: firstEvent?.conversationType ?? (firstEvent?.groupId ? "group" : "single"),
      projectPath: active?.codexProjectPath,
      activeCodexSessionID: active?.codexSessionId ?? undefined,
      summary: this.deps.summaries.get(conversationID) ?? undefined,
      recentEvents,
      currentEvent: options.currentEvent,
      skipped: []
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
  promptPreview?: string;
  promptRedacted: boolean;
}

export function buildContextPreview(context: ConversationContext, promptPreview?: string): ContextPreview {
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
