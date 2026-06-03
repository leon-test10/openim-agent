import type { BridgeDatabase } from "../storage/db.js";
import type { SemanticEvent } from "./semantic-event.js";

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
}

