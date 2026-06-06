import type { BridgeDatabase } from "../storage/db.js";
import { createId } from "../utils/ids.js";

export interface OpenImHistoryImportRequest {
  id: string;
  openimConversationId: string;
  requestedCount: number;
  status: "pending" | "fulfilled" | "failed";
  createdAt: number;
  fulfilledAt: number | null;
}

export interface OpenImHistorySnapshot {
  id: string;
  requestId: string | null;
  openimConversationId: string;
  source: string;
  messageCount: number;
  messages: OpenImHistoryMessage[];
  createdAt: number;
}

export interface OpenImHistoryMessage {
  clientMsgID?: string;
  serverMsgID?: string;
  sendID?: string;
  senderNickname?: string;
  contentType?: number;
  sendTime?: number;
  text?: string;
  preview?: string;
}

interface ImportRequestRow {
  id: string;
  openim_conversation_id: string;
  requested_count: number;
  status: OpenImHistoryImportRequest["status"];
  created_at: number;
  fulfilled_at: number | null;
}

interface SnapshotRow {
  id: string;
  request_id: string | null;
  openim_conversation_id: string;
  source: string;
  message_count: number;
  messages_json: string;
  created_at: number;
}

export class OpenImHistoryRepository {
  constructor(private readonly db: BridgeDatabase) {}

  createImportRequest(input: { openimConversationId: string; requestedCount: number }): OpenImHistoryImportRequest {
    const id = createId("hist_req");
    const createdAt = Date.now();
    this.db
      .prepare(
        `
        INSERT INTO openim_history_import_requests (
          id, openim_conversation_id, requested_count, status, created_at
        ) VALUES (
          @id, @openimConversationId, @requestedCount, 'pending', @createdAt
        )
      `
      )
      .run({ id, createdAt, ...input });
    return this.getImportRequest(id)!;
  }

  getImportRequest(id: string): OpenImHistoryImportRequest | null {
    const row = this.db.prepare("SELECT * FROM openim_history_import_requests WHERE id = ?").get(id) as
      | ImportRequestRow
      | undefined;
    return row ? mapImportRequest(row) : null;
  }

  getPendingByConversationId(openimConversationId: string): OpenImHistoryImportRequest | null {
    const row = this.db
      .prepare(
        `
        SELECT * FROM openim_history_import_requests
        WHERE openim_conversation_id = ? AND status = 'pending'
        ORDER BY created_at DESC
        LIMIT 1
      `
      )
      .get(openimConversationId) as ImportRequestRow | undefined;
    return row ? mapImportRequest(row) : null;
  }

  createSnapshot(input: {
    requestId?: string | null;
    openimConversationId: string;
    source?: string;
    messages: OpenImHistoryMessage[];
  }): OpenImHistorySnapshot {
    const id = createId("hist");
    const createdAt = Date.now();
    const messages = sanitizeMessages(input.messages);
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `
          INSERT INTO openim_history_snapshots (
            id, request_id, openim_conversation_id, source, message_count,
            messages_json, created_at
          ) VALUES (
            @id, @requestId, @openimConversationId, @source, @messageCount,
            @messagesJson, @createdAt
          )
        `
        )
        .run({
          id,
          requestId: input.requestId ?? null,
          openimConversationId: input.openimConversationId,
          source: input.source ?? "electron-sdk",
          messageCount: messages.length,
          messagesJson: JSON.stringify(messages),
          createdAt
        });
      if (input.requestId) {
        this.db
          .prepare(
            `
            UPDATE openim_history_import_requests
            SET status = 'fulfilled', fulfilled_at = ?
            WHERE id = ? AND openim_conversation_id = ?
          `
          )
          .run(createdAt, input.requestId, input.openimConversationId);
      }
    });
    transaction();
    return this.getSnapshot(id)!;
  }

  getLatestSnapshot(openimConversationId: string): OpenImHistorySnapshot | null {
    const row = this.db
      .prepare(
        `
        SELECT * FROM openim_history_snapshots
        WHERE openim_conversation_id = ?
        ORDER BY created_at DESC
        LIMIT 1
      `
      )
      .get(openimConversationId) as SnapshotRow | undefined;
    return row ? mapSnapshot(row) : null;
  }

  private getSnapshot(id: string): OpenImHistorySnapshot | null {
    const row = this.db.prepare("SELECT * FROM openim_history_snapshots WHERE id = ?").get(id) as SnapshotRow | undefined;
    return row ? mapSnapshot(row) : null;
  }
}

function sanitizeMessages(messages: OpenImHistoryMessage[]): OpenImHistoryMessage[] {
  return messages.slice(0, 200).map((message) => ({
    clientMsgID: normalizeString(message.clientMsgID),
    serverMsgID: normalizeString(message.serverMsgID),
    sendID: normalizeString(message.sendID),
    senderNickname: normalizeString(message.senderNickname),
    contentType: typeof message.contentType === "number" ? message.contentType : undefined,
    sendTime: typeof message.sendTime === "number" ? message.sendTime : undefined,
    text: normalizeString(message.text),
    preview: normalizeString(message.preview)
  }));
}

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 4000) : undefined;
}

function mapImportRequest(row: ImportRequestRow): OpenImHistoryImportRequest {
  return {
    id: row.id,
    openimConversationId: row.openim_conversation_id,
    requestedCount: row.requested_count,
    status: row.status,
    createdAt: row.created_at,
    fulfilledAt: row.fulfilled_at
  };
}

function mapSnapshot(row: SnapshotRow): OpenImHistorySnapshot {
  return {
    id: row.id,
    requestId: row.request_id,
    openimConversationId: row.openim_conversation_id,
    source: row.source,
    messageCount: row.message_count,
    messages: JSON.parse(row.messages_json) as OpenImHistoryMessage[],
    createdAt: row.created_at
  };
}
