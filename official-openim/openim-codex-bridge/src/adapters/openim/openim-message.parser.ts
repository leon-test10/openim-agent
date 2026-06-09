import { createId } from "../../utils/ids.js";
import type { SemanticEvent } from "../../core/semantic-event.js";

export interface ParseOpenImPayloadOptions {
  botUserId: string;
}

export function parseAfterSendSingleMsgPayload(
  payload: Record<string, unknown>,
  options: ParseOpenImPayloadOptions
): SemanticEvent {
  const senderUserId = requiredString(payload.sendID, "sendID");
  const receiverUserId = optionalString(payload.recvID);
  const conversationId =
    optionalString(payload.conversationID) ??
    optionalString(payload.conversationId) ??
    deriveSingleConversationId(options.botUserId, senderUserId, receiverUserId);
  const contentType = optionalNumber(payload.contentType);
  const ex = parseMaybeJson(payload.ex);

  return {
    id: createId("evt"),
    openimMessageId: optionalString(payload.serverMsgID) ?? optionalString(payload.serverMsgId),
    openimClientMsgId: optionalString(payload.clientMsgID) ?? optionalString(payload.clientMsgId),
    openimConversationId: conversationId,
    senderUserId,
    receiverUserId,
    groupId: optionalString(payload.groupID) ?? optionalString(payload.groupId),
    eventType: contentType === 101 ? "openim.single.text" : "openim.single.unsupported",
    contentType,
    text: contentType === 101 ? parseTextContent(payload.content) : null,
    ex,
    rawPayload: payload,
    createdAt: Date.now()
  };
}

export function parseAfterSendGroupMsgPayload(
  payload: Record<string, unknown>,
  options: ParseOpenImPayloadOptions
): SemanticEvent {
  const senderUserId = requiredString(payload.sendID, "sendID");
  const groupId = requiredString(payload.groupID ?? payload.groupId, "groupID");
  const conversationId =
    optionalString(payload.conversationID) ??
    optionalString(payload.conversationId) ??
    `group:${groupId}`;
  const contentType = optionalNumber(payload.contentType);
  const ex = parseMaybeJson(payload.ex);
  const parsedContent = parseMaybeJson(payload.content);
  const isSupportedText = contentType === 101 || contentType === 114;
  const replyToBot = isReplyOrQuoteToBot(parsedContent, options.botUserId) || isReplyOrQuoteToBot(ex, options.botUserId);

  return {
    id: createId("evt"),
    openimMessageId: optionalString(payload.serverMsgID) ?? optionalString(payload.serverMsgId),
    openimClientMsgId: optionalString(payload.clientMsgID) ?? optionalString(payload.clientMsgId),
    openimConversationId: conversationId,
    senderUserId,
    receiverUserId: optionalString(payload.recvID) ?? null,
    groupId,
    eventType: contentType === 101 ? "openim.group.text" : contentType === 114 ? "openim.group.quote" : "openim.group.unsupported",
    contentType,
    text: isSupportedText ? parseTextContent(payload.content) : null,
    metadata: replyToBot ? { groupTrigger: "reply_to_bot" } : {},
    ex,
    rawPayload: payload,
    createdAt: Date.now()
  };
}

function deriveSingleConversationId(
  botUserId: string,
  senderUserId: string,
  receiverUserId: string | null
): string {
  const humanUserId = senderUserId === botUserId ? receiverUserId : senderUserId;
  return `single:${botUserId}:${humanUserId ?? "unknown"}`;
}

function parseTextContent(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const parsed = parseMaybeJson(value);
  if (parsed && typeof parsed === "object") {
    const content = (parsed as { content?: unknown }).content;
    if (typeof content === "string") {
      return content;
    }
    const text = (parsed as { text?: unknown }).text;
    if (typeof text === "string") {
      return text;
    }
    const quoteElem = (parsed as { quoteElem?: unknown }).quoteElem;
    if (quoteElem && typeof quoteElem === "object") {
      const quoteText = (quoteElem as { text?: unknown }).text ?? (quoteElem as { content?: unknown }).content;
      if (typeof quoteText === "string") {
        return quoteText;
      }
    }
    return value;
  }

  return value;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return value ?? null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return value;
  }
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`OpenIM payload field ${name} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isReplyOrQuoteToBot(value: unknown, botUserId: string, path: string[] = [], depth = 0): boolean {
  if (!value || depth > 8) {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((item, index) => isReplyOrQuoteToBot(item, botUserId, [...path, String(index)], depth + 1));
  }
  if (typeof value !== "object") {
    return false;
  }

  const record = value as Record<string, unknown>;
  const isQuotePath = path.some((part) => /quote|reply|refer|source|message/i.test(part));
  const sender =
    optionalString(record.sendID) ??
    optionalString(record.sendId) ??
    optionalString(record.senderUserID) ??
    optionalString(record.senderUserId) ??
    optionalString(record.userID) ??
    optionalString(record.userId);
  if (isQuotePath && sender === botUserId) {
    return true;
  }

  return Object.entries(record).some(([key, child]) =>
    isReplyOrQuoteToBot(child, botUserId, [...path, key], depth + 1)
  );
}
