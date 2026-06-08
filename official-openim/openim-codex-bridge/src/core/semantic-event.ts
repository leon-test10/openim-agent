export interface SemanticEvent {
  id: string;
  conversationID?: string;
  conversationType?: "single" | "group" | "unknown";
  source?: "openim_webhook" | "openim_history_snapshot" | "bridge_runtime" | "codex_runtime";
  sourceMessageID?: string | null;
  clientMsgID?: string | null;
  serverMsgID?: string | null;
  actorID?: string | null;
  actorType?: "human" | "codex_bot" | "system" | "runtime" | "unknown";
  actorDisplayName?: string | null;
  role?: "user" | "assistant" | "system" | "tool" | "runtime";
  openimMessageId: string | null;
  openimClientMsgId: string | null;
  openimConversationId: string;
  senderUserId: string;
  receiverUserId: string | null;
  groupId: string | null;
  eventType: string;
  contentType: number | null;
  text: string | null;
  sendID?: string | null;
  recvID?: string | null;
  groupID?: string | null;
  timestamp?: number;
  metadata?: Record<string, unknown> | null;
  dedupKey?: string | null;
  ex: unknown;
  rawPayload: unknown;
  createdAt: number;
  updatedAt?: number | null;
}

export interface ConversationSummary {
  conversationID: string;
  summaryText: string;
  coveredEventIDs: string[];
  coveredEventUntilTimestamp?: number | null;
  importantDecisions: string[];
  unresolvedTasks: string[];
  updatedAt: number;
}
