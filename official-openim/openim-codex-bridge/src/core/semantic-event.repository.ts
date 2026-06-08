import type { BridgeDatabase } from "../storage/db.js";
import type { SemanticEvent } from "./semantic-event.js";

interface SemanticEventRow {
  id: string;
  conversation_type: string | null;
  source: SemanticEvent["source"] | null;
  source_message_id: string | null;
  openim_message_id: string | null;
  openim_client_msg_id: string | null;
  openim_conversation_id: string;
  sender_user_id: string;
  receiver_user_id: string | null;
  group_id: string | null;
  actor_id: string | null;
  actor_type: SemanticEvent["actorType"] | null;
  actor_display_name: string | null;
  role: SemanticEvent["role"] | null;
  event_type: string;
  content_type: number | null;
  text: string | null;
  timestamp: number | null;
  metadata_json: string | null;
  dedup_key: string | null;
  ex_json: string | null;
  raw_payload_json: string;
  created_at: number;
  updated_at: number | null;
}

export class SemanticEventRepository {
  constructor(private readonly db: BridgeDatabase) {}

  insert(event: SemanticEvent): void {
    this.insertOrIgnore(event);
  }

  insertOrIgnore(event: SemanticEvent): boolean {
    const result = this.db
      .prepare(
        `
        INSERT OR IGNORE INTO semantic_events (
          id, openim_message_id, openim_client_msg_id, openim_conversation_id,
          sender_user_id, receiver_user_id, group_id, event_type, content_type,
          text, ex_json, raw_payload_json, created_at, conversation_type, source,
          source_message_id, actor_id, actor_type, actor_display_name, role,
          timestamp, metadata_json, dedup_key, updated_at
        ) VALUES (
          @id, @openimMessageId, @openimClientMsgId, @openimConversationId,
          @senderUserId, @receiverUserId, @groupId, @eventType, @contentType,
          @text, @exJson, @rawPayloadJson, @createdAt, @conversationType, @source,
          @sourceMessageID, @actorID, @actorType, @actorDisplayName, @role,
          @timestamp, @metadataJson, @dedupKey, @updatedAt
        )
      `
      )
      .run(toParams(event));
    return result.changes > 0;
  }

  upsert(event: SemanticEvent): { inserted: boolean; event: SemanticEvent } {
    const inserted = this.insertOrIgnore(event);
    if (inserted) {
      return { inserted: true, event };
    }
    const existing = this.findDuplicate(event);
    return { inserted: false, event: existing ?? event };
  }

  private findDuplicate(event: SemanticEvent): SemanticEvent | null {
    const pairs: Array<[string, string | null | undefined]> = [
      ["openim_message_id", event.serverMsgID ?? event.openimMessageId],
      ["openim_client_msg_id", event.clientMsgID ?? event.openimClientMsgId],
      ["source_message_id", event.sourceMessageID],
      ["dedup_key", event.dedupKey]
    ];
    for (const [column, value] of pairs) {
      if (!value) continue;
      const row = this.db
        .prepare(`SELECT * FROM semantic_events WHERE openim_conversation_id = ? AND ${column} = ? LIMIT 1`)
        .get(event.openimConversationId, value) as SemanticEventRow | undefined;
      if (row) return mapSemanticEventRow(row);
    }
    return null;
  }

  insertLegacy(event: SemanticEvent): void {
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

  listByConversationId(openimConversationId: string, options: { limit?: number; includeRuntime?: boolean } = {}): SemanticEvent[] {
    const limit = Math.max(1, Math.min(options.limit ?? 200, 1000));
    const runtimeFilter = options.includeRuntime ? "" : "AND COALESCE(role, '') != 'runtime'";
    const rows = this.db
      .prepare(
        `
        SELECT * FROM semantic_events
        WHERE openim_conversation_id = ? ${runtimeFilter}
        ORDER BY COALESCE(timestamp, created_at) ASC, created_at ASC
        LIMIT ?
      `
      )
      .all(openimConversationId, limit) as SemanticEventRow[];
    return rows.map(mapSemanticEventRow);
  }

  listRecentPromptEvents(openimConversationId: string, limit: number): SemanticEvent[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM (
          SELECT * FROM semantic_events
          WHERE openim_conversation_id = ?
            AND text IS NOT NULL
            AND COALESCE(role, '') IN ('user', 'assistant')
          ORDER BY COALESCE(timestamp, created_at) DESC, created_at DESC
          LIMIT ?
        ) ORDER BY COALESCE(timestamp, created_at) ASC, created_at ASC
      `
      )
      .all(openimConversationId, Math.max(1, Math.min(limit, 200))) as SemanticEventRow[];
    return rows.map(mapSemanticEventRow);
  }
}

function mapSemanticEventRow(row: SemanticEventRow): SemanticEvent {
  return {
    id: row.id,
    conversationID: row.openim_conversation_id,
    conversationType: (row.conversation_type as SemanticEvent["conversationType"]) ?? "unknown",
    source: row.source ?? undefined,
    sourceMessageID: row.source_message_id,
    clientMsgID: row.openim_client_msg_id,
    serverMsgID: row.openim_message_id,
    actorID: row.actor_id ?? row.sender_user_id,
    actorType: row.actor_type ?? "unknown",
    actorDisplayName: row.actor_display_name,
    role: row.role ?? undefined,
    openimMessageId: row.openim_message_id,
    openimClientMsgId: row.openim_client_msg_id,
    openimConversationId: row.openim_conversation_id,
    senderUserId: row.sender_user_id,
    receiverUserId: row.receiver_user_id,
    groupId: row.group_id,
    sendID: row.sender_user_id,
    recvID: row.receiver_user_id,
    groupID: row.group_id,
    eventType: row.event_type,
    contentType: row.content_type,
    text: row.text,
    timestamp: row.timestamp ?? row.created_at,
    metadata: parseJson(row.metadata_json) as Record<string, unknown> | null,
    dedupKey: row.dedup_key,
    ex: parseJson(row.ex_json),
    rawPayload: parseJson(row.raw_payload_json) as Record<string, unknown>,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toParams(event: SemanticEvent): Record<string, unknown> {
  return {
    id: event.id,
    openimMessageId: event.serverMsgID ?? event.openimMessageId,
    openimClientMsgId: event.clientMsgID ?? event.openimClientMsgId,
    openimConversationId: event.conversationID ?? event.openimConversationId,
    senderUserId: event.sendID ?? event.senderUserId,
    receiverUserId: event.recvID ?? event.receiverUserId,
    groupId: event.groupID ?? event.groupId,
    eventType: event.eventType,
    contentType: event.contentType,
    text: event.text,
    exJson: JSON.stringify(event.ex),
    rawPayloadJson: JSON.stringify(event.rawPayload),
    createdAt: event.createdAt,
    conversationType: event.conversationType ?? "unknown",
    source: event.source ?? null,
    sourceMessageID: event.sourceMessageID ?? null,
    actorID: event.actorID ?? event.senderUserId,
    actorType: event.actorType ?? "unknown",
    actorDisplayName: event.actorDisplayName ?? null,
    role: event.role ?? null,
    timestamp: event.timestamp ?? event.createdAt,
    metadataJson: JSON.stringify(event.metadata ?? null),
    dedupKey: event.dedupKey ?? null,
    updatedAt: event.updatedAt ?? null
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
