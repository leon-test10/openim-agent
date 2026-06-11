import { SessionType } from "@openim/wasm-client-sdk";

interface ConversationLike {
  conversationID?: string;
  conversationType?: number;
  userID?: string;
}

export function isCodexSingleConversation(
  conversation: ConversationLike | undefined,
  routeConversationID: string | undefined,
  botUserID: string,
) {
  if (
    conversation?.conversationType === SessionType.Single &&
    conversation.userID === botUserID
  ) {
    return true;
  }

  return isCodexConversationID(routeConversationID, botUserID);
}

export function isCodexGroupConversation(
  conversation: ConversationLike | undefined,
) {
  return conversation?.conversationType === SessionType.Group;
}

export function isCodexConversation(
  conversation: ConversationLike | undefined,
  routeConversationID: string | undefined,
  botUserID: string,
) {
  return (
    isCodexSingleConversation(conversation, routeConversationID, botUserID) ||
    isCodexGroupConversation(conversation)
  );
}

export function resolveCodexConversationID(
  conversation: ConversationLike | undefined,
  routeConversationID: string | undefined,
) {
  return conversation?.conversationID ?? routeConversationID;
}

function isCodexConversationID(conversationID: string | undefined, botUserID: string) {
  if (!conversationID) {
    return false;
  }

  if (conversationID.startsWith(`single:${botUserID}:`)) {
    return true;
  }

  if (conversationID.startsWith("si_")) {
    return (
      conversationID.endsWith(`_${botUserID}`) ||
      conversationID.startsWith(`si_${botUserID}_`)
    );
  }

  if (
    conversationID.startsWith("group:") ||
    conversationID.startsWith("group_") ||
    conversationID.startsWith("sg_")
  ) {
    return true;
  }

  return false;
}
