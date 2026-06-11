import { MessageItem, MessageType, ViewType } from "@openim/wasm-client-sdk";

type OpenImSdkLike = {
  getAdvancedHistoryMessageList: (params: {
    conversationID: string;
    startClientMsgID: string;
    count: number;
    viewType: ViewType;
  }) => Promise<{ data: { messageList: MessageItem[]; isEnd?: boolean } }>;
  searchLocalMessages: (params: {
    conversationID: string;
    keywordList: string[];
    messageTypeList?: MessageType[];
    count: number;
    pageIndex: number;
  }) => Promise<{ data: unknown }>;
};

const conversationMessageCache = new Map<string, MessageItem[]>();

export function cacheConversationMessages(
  conversationID: string | undefined,
  messages: MessageItem[],
) {
  if (!conversationID) return;
  for (const alias of getConversationAliases(conversationID)) {
    conversationMessageCache.set(alias, tagConversationMessages(messages, alias));
  }
}

export function getCachedConversationMessages(conversationID: string | undefined) {
  if (!conversationID) return [];
  const byId = new Map<string, MessageItem>();
  for (const alias of getConversationAliases(conversationID)) {
    for (const message of conversationMessageCache.get(alias) ?? []) {
      byId.set(message.clientMsgID, tagConversationMessage(message, conversationID));
    }
  }
  return Array.from(byId.values());
}

export async function searchConversationMessages(input: {
  sdk: OpenImSdkLike;
  conversationID: string;
  keyword: string;
  messageType?: MessageType | "all";
  seedMessages?: MessageItem[];
  maxHistoryPages?: number;
  pageSize?: number;
}): Promise<MessageItem[]> {
  const keyword = input.keyword.trim();
  if (!keyword) return [];

  const messageType = input.messageType ?? "all";
  const pageSize = input.pageSize ?? 50;
  const maxHistoryPages = input.maxHistoryPages ?? 4;
  const results: MessageItem[] = [];
  const seen = new Set<string>();
  const add = (messages: MessageItem[]) => {
    for (const message of messages) {
      if (seen.has(message.clientMsgID)) continue;
      const tagged = tagConversationMessage(message, input.conversationID);
      if (!matchesMessage(tagged, keyword, messageType)) continue;
      seen.add(message.clientMsgID);
      results.push(tagged);
    }
  };

  add(input.seedMessages ?? getCachedConversationMessages(input.conversationID));

  let startClientMsgID = "";
  for (let page = 0; page < maxHistoryPages; page += 1) {
    const { data } = await input.sdk.getAdvancedHistoryMessageList({
      conversationID: input.conversationID,
      startClientMsgID,
      count: pageSize,
      viewType: ViewType.History,
    });
    add(data.messageList ?? []);
    if (data.isEnd || !data.messageList?.length) break;
    startClientMsgID = data.messageList[data.messageList.length - 1]?.clientMsgID ?? "";
  }

  try {
    const { data } = await input.sdk.searchLocalMessages({
      conversationID: input.conversationID,
      keywordList: [keyword],
      messageTypeList: messageType === "all" ? undefined : [messageType as MessageType],
      count: pageSize,
      pageIndex: 1,
    });
    add(normalizeSearchResult(data));
  } catch {
    // Local message search is best-effort; history/current-list fallback is authoritative for UI.
  }

  return results;
}

export function getConversationAliases(conversationID: string): string[] {
  const aliases = new Set([conversationID]);
  if (conversationID.startsWith("single:")) {
    const [, botID, userID] = conversationID.split(":");
    if (botID && userID) {
      aliases.add(`si_${userID}_${botID}`);
      aliases.add(`si_${botID}_${userID}`);
    }
  }
  if (conversationID.startsWith("si_")) {
    const raw = conversationID.slice(3);
    const parts = raw.split("_");
    if (parts.length >= 2) {
      const first = parts[0];
      const last = parts[parts.length - 1];
      const middle = parts.slice(1).join("_");
      const beforeLast = parts.slice(0, -1).join("_");
      if (last && beforeLast) aliases.add(`single:${last}:${beforeLast}`);
      if (first && middle) aliases.add(`single:${first}:${middle}`);
    }
  }
  return Array.from(aliases);
}

function tagConversationMessages(messages: MessageItem[], conversationID: string) {
  return messages.map((message) => tagConversationMessage(message, conversationID));
}

function tagConversationMessage(
  message: MessageItem,
  conversationID: string,
): MessageItem {
  return {
    ...message,
    conversationID: message.conversationID || conversationID,
  };
}

export function matchesMessage(
  message: MessageItem,
  keyword: string,
  messageType: MessageType | "all" = "all",
) {
  if (messageType !== "all" && message.contentType !== messageType) return false;
  const normalized = keyword.toLowerCase();
  return getMessagePreview(message).toLowerCase().includes(normalized);
}

export function getMessagePreview(message: MessageItem): string {
  if (message.textElem?.content) return message.textElem.content;
  if (message.atTextElem?.text) return message.atTextElem.text;
  if (message.pictureElem) return "[Image]";
  if (message.fileElem) return `[File] ${message.fileElem.fileName}`;
  return `[${message.contentType}]`;
}

export function normalizeSearchResult(data: unknown): MessageItem[] {
  if (Array.isArray(data)) {
    return data as MessageItem[];
  }
  const result = data as {
    searchResultItems?: Array<{ messageList?: MessageItem[] }>;
    findResultItems?: Array<{ messageList?: MessageItem[] }>;
  };
  return (result.searchResultItems ?? result.findResultItems ?? []).flatMap(
    (item) => item.messageList ?? [],
  );
}
