import { createHash } from "node:crypto";
import { createId } from "../utils/ids.js";
import type { SemanticEvent } from "./semantic-event.js";
import type { SemanticEventRepository } from "./semantic-event.repository.js";

export interface HistorySnapshotMessage {
  clientMsgID?: string;
  serverMsgID?: string;
  sourceMessageID?: string;
  sendID?: string;
  recvID?: string;
  groupID?: string;
  senderNickname?: string;
  contentType?: number;
  sendTime?: number;
  text?: string;
  preview?: string;
  ex?: unknown;
}

export interface HistoryImportResult {
  conversationID: string;
  receivedCount: number;
  importedCount: number;
  skippedDuplicateCount: number;
  skippedUnsupportedCount: number;
  earliestTimestamp?: number;
  latestTimestamp?: number;
  importedEventIDs: string[];
  errors?: Array<{ index: number; reason: string }>;
}

export class SemanticEventIngestService {
  constructor(
    private readonly semanticEvents: SemanticEventRepository,
    private readonly options: { botUserId: string }
  ) {}

  ingestOpenImEvent(event: SemanticEvent): { inserted: boolean; event: SemanticEvent } {
    return this.semanticEvents.upsert(normalizeSemanticEvent(event, this.options.botUserId, "openim_webhook"));
  }

  importHistorySnapshot(input: { conversationID: string; messages: HistorySnapshotMessage[] }): HistoryImportResult {
    const result: HistoryImportResult = {
      conversationID: input.conversationID,
      receivedCount: input.messages.length,
      importedCount: 0,
      skippedDuplicateCount: 0,
      skippedUnsupportedCount: 0,
      importedEventIDs: [],
      errors: []
    };

    input.messages.slice(0, 200).forEach((message, index) => {
      const timestamp = typeof message.sendTime === "number" ? message.sendTime : Date.now();
      result.earliestTimestamp = result.earliestTimestamp === undefined ? timestamp : Math.min(result.earliestTimestamp, timestamp);
      result.latestTimestamp = result.latestTimestamp === undefined ? timestamp : Math.max(result.latestTimestamp, timestamp);

      if (message.contentType !== 101) {
        result.skippedUnsupportedCount += 1;
        return;
      }
      const text = normalizeText(message.text ?? message.preview);
      if (!text) {
        result.skippedUnsupportedCount += 1;
        result.errors?.push({ index, reason: "text_required" });
        return;
      }

      const event = buildEventFromHistory(input.conversationID, message, text, timestamp, this.options.botUserId);
      const upserted = this.semanticEvents.upsert(event);
      if (upserted.inserted) {
        result.importedCount += 1;
        result.importedEventIDs.push(upserted.event.id);
      } else {
        result.skippedDuplicateCount += 1;
      }
    });

    if (!result.errors?.length) {
      delete result.errors;
    }
    return result;
  }
}

export function normalizeSemanticEvent(
  event: SemanticEvent,
  botUserId: string,
  source: SemanticEvent["source"] = "openim_webhook"
): SemanticEvent {
  const actor = mapActor({
    sendID: event.senderUserId,
    botUserId,
    ex: event.ex,
    contentType: event.contentType
  });
  const timestamp = event.timestamp ?? event.createdAt;
  const serverMsgID = event.serverMsgID ?? event.openimMessageId;
  const clientMsgID = event.clientMsgID ?? event.openimClientMsgId;
  return {
    ...event,
    conversationID: event.openimConversationId,
    conversationType: event.groupId ? "group" : "single",
    source,
    sourceMessageID: event.sourceMessageID ?? serverMsgID ?? clientMsgID ?? null,
    serverMsgID,
    clientMsgID,
    sendID: event.senderUserId,
    recvID: event.receiverUserId,
    groupID: event.groupId,
    actorID: event.actorID ?? event.senderUserId,
    actorType: event.actorType ?? actor.actorType,
    role: event.role ?? actor.role,
    eventType: event.eventType === "openim.single.text" ? actor.eventType : event.eventType,
    timestamp,
    metadata: event.metadata ?? {},
    dedupKey: event.dedupKey ?? buildDedupKey(event.openimConversationId, event.senderUserId, normalizeText(event.text), timestamp)
  };
}

function buildEventFromHistory(
  conversationID: string,
  message: HistorySnapshotMessage,
  text: string,
  timestamp: number,
  botUserId: string
): SemanticEvent {
  const sendID = message.sendID ?? "unknown";
  const actor = mapActor({ sendID, botUserId, ex: message.ex, contentType: message.contentType ?? null });
  return {
    id: createId("evt"),
    conversationID,
    conversationType: message.groupID ? "group" : "single",
    source: "openim_history_snapshot",
    sourceMessageID: message.sourceMessageID ?? message.serverMsgID ?? message.clientMsgID ?? null,
    clientMsgID: message.clientMsgID ?? null,
    serverMsgID: message.serverMsgID ?? null,
    actorID: sendID,
    actorType: actor.actorType,
    actorDisplayName: message.senderNickname ?? null,
    role: actor.role,
    openimMessageId: message.serverMsgID ?? null,
    openimClientMsgId: message.clientMsgID ?? null,
    openimConversationId: conversationID,
    senderUserId: sendID,
    receiverUserId: message.recvID ?? null,
    groupId: message.groupID ?? null,
    sendID,
    recvID: message.recvID ?? null,
    groupID: message.groupID ?? null,
    eventType: actor.eventType === "message.created" ? "message.imported" : actor.eventType,
    contentType: message.contentType ?? null,
    text,
    timestamp,
    metadata: {},
    dedupKey: buildDedupKey(conversationID, sendID, text, timestamp),
    ex: message.ex ?? null,
    rawPayload: message,
    createdAt: Date.now()
  };
}

function mapActor(input: { sendID: string; botUserId: string; ex: unknown; contentType: number | null }): {
  role: NonNullable<SemanticEvent["role"]>;
  actorType: NonNullable<SemanticEvent["actorType"]>;
  eventType: string;
} {
  const generatedByCodex = isRecord(input.ex) && isRecord(input.ex.agent) && input.ex.agent.generated_by === "codex";
  if (input.sendID === input.botUserId && generatedByCodex) {
    return { role: "assistant", actorType: "codex_bot", eventType: "agent.reply" };
  }
  if (input.contentType !== 101) {
    return { role: "system", actorType: "system", eventType: "system.notice" };
  }
  return { role: "user", actorType: "human", eventType: "message.created" };
}

function buildDedupKey(conversationID: string, sendID: string, text: string | null, timestamp: number): string {
  return createHash("sha256").update([conversationID, sendID, text ?? "", String(timestamp)].join("\u0000")).digest("hex");
}

function normalizeText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.replace(/\s+/g, " ").trim().slice(0, 4000) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
