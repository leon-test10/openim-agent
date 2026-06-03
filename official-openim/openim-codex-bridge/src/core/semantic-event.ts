export interface SemanticEvent {
  id: string;
  openimMessageId: string | null;
  openimClientMsgId: string | null;
  openimConversationId: string;
  senderUserId: string;
  receiverUserId: string | null;
  groupId: string | null;
  eventType: string;
  contentType: number | null;
  text: string | null;
  ex: unknown;
  rawPayload: unknown;
  createdAt: number;
}

