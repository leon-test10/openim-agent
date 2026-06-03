import type { BridgeDatabase } from "../storage/db.js";
import type { SemanticEvent } from "./semantic-event.js";

interface SemanticEventRow {
  id: string;
  openim_message_id: string | null;
  openim_client_msg_id: string | null;
  openim_conversation_id: string;
  sender_user_id: string;
  receiver_user_id: string | null;
  group_id: string | null;
  event_type: string;
  content_type: number | null;
  text: string | null;
  ex_json: string | null;
  raw_payload_json: string;
  created_at: number;
}

export class SemanticEventRepository {
  constructor(private readonly db: BridgeDatabase) {}

  insert(event: SemanticEvent): void {
    this.db
      .prepare(
        `
        INSERT INTO semantic_events (
          id, openim_message_id, openim_client_msg_id, openim_conversation_id,
          sender_user_id, receiver_user_id, group_id, event_type, content_type,
          text, ex_json, raw_payload_json, created_at
        ) VALUES (
          @id, @openimMessageId, @openimClientMsgId, @openimConversationId,
          @senderUserId, @receiverUserId, @groupId, @eventType, @contentType,
          @text, @exJson, @rawPayloadJson, @createdAt
        )
      `
      )
      .run({
        ...event,
        exJson: JSON.stringify(event.ex),
        rawPayloadJson: JSON.stringify(event.rawPayload)
      });
  }

  getById(id: string): SemanticEvent | null {
    const row = this.db.prepare("SELECT * FROM semantic_events WHERE id = ?").get(id) as SemanticEventRow | undefined;
    return row ? mapSemanticEventRow(row) : null;
  }
}

function mapSemanticEventRow(row: SemanticEventRow): SemanticEvent {
  return {
    id: row.id,
    openimMessageId: row.openim_message_id,
    openimClientMsgId: row.openim_client_msg_id,
    openimConversationId: row.openim_conversation_id,
    senderUserId: row.sender_user_id,
    receiverUserId: row.receiver_user_id,
    groupId: row.group_id,
    eventType: row.event_type,
    contentType: row.content_type,
    text: row.text,
    ex: parseJson(row.ex_json),
    rawPayload: parseJson(row.raw_payload_json) as Record<string, unknown>,
    createdAt: row.created_at
  };
}

function parseJson(value: string | null): unknown {
  if (!value) {
    return null;
  }
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}
