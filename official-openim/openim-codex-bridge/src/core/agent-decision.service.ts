import type { SemanticEvent } from "./semantic-event.js";

export type AgentDecisionReason =
  | "receiver_is_not_bot"
  | "sender_is_bot"
  | "generated_by_codex"
  | "unsupported_content_type"
  | "empty_text"
  | "group_bot_disabled"
  | "group_auto_reply_disabled"
  | "group_not_allowed"
  | "group_sender_not_allowed"
  | "group_message_not_addressed_to_bot";

export type AgentDecision =
  | { shouldRun: true }
  | { shouldRun: false; reason: AgentDecisionReason };

export interface AgentDecisionConfig {
  botUserId: string;
  groupBotEnabled?: boolean;
  groupAllowlist?: readonly string[];
  groupSenderAllowlist?: readonly string[];
  groupAutoReplyPolicy?: "mention_or_reply" | "mention_only" | "reply_only" | "disabled";
}

export function shouldCreateRuntimeJob(
  event: SemanticEvent,
  config: AgentDecisionConfig
): AgentDecision {
  if (event.groupId) {
    return shouldCreateGroupRuntimeJob(event, config);
  }

  if (event.receiverUserId !== config.botUserId) {
    return { shouldRun: false, reason: "receiver_is_not_bot" };
  }

  if (event.senderUserId === config.botUserId) {
    return { shouldRun: false, reason: "sender_is_bot" };
  }

  if (isGeneratedByCodex(event.ex)) {
    return { shouldRun: false, reason: "generated_by_codex" };
  }

  if (event.contentType !== 101) {
    return { shouldRun: false, reason: "unsupported_content_type" };
  }

  if (!event.text?.trim()) {
    return { shouldRun: false, reason: "empty_text" };
  }

  return { shouldRun: true };
}

function shouldCreateGroupRuntimeJob(event: SemanticEvent, config: AgentDecisionConfig): AgentDecision {
  if (!config.groupBotEnabled) {
    return { shouldRun: false, reason: "group_bot_disabled" };
  }

  if (!isAllowed(event.groupId, config.groupAllowlist)) {
    return { shouldRun: false, reason: "group_not_allowed" };
  }

  if (!isAllowed(event.senderUserId, config.groupSenderAllowlist)) {
    return { shouldRun: false, reason: "group_sender_not_allowed" };
  }

  if (event.senderUserId === config.botUserId) {
    return { shouldRun: false, reason: "sender_is_bot" };
  }

  if (isGeneratedByCodex(event.ex)) {
    return { shouldRun: false, reason: "generated_by_codex" };
  }

  if (event.contentType !== 101 && event.contentType !== 114) {
    return { shouldRun: false, reason: "unsupported_content_type" };
  }

  const text = event.text?.trim();
  if (!text) {
    return { shouldRun: false, reason: "empty_text" };
  }

  const addressedToBot = isAddressedToBot(text, config.botUserId);
  const replyToBot = isReplyToBot(event);
  const triggerAllowed = isGroupTriggerAllowed(config.groupAutoReplyPolicy ?? "mention_or_reply", {
    addressedToBot,
    replyToBot
  });
  if (!triggerAllowed.shouldRun) {
    return { shouldRun: false, reason: triggerAllowed.reason };
  }

  return { shouldRun: true };
}

function isGroupTriggerAllowed(
  policy: NonNullable<AgentDecisionConfig["groupAutoReplyPolicy"]>,
  input: { addressedToBot: boolean; replyToBot: boolean }
): AgentDecision {
  if (policy === "disabled") {
    return { shouldRun: false, reason: "group_auto_reply_disabled" };
  }
  if (policy === "mention_only") {
    return input.addressedToBot ? { shouldRun: true } : { shouldRun: false, reason: "group_message_not_addressed_to_bot" };
  }
  if (policy === "reply_only") {
    return input.replyToBot ? { shouldRun: true } : { shouldRun: false, reason: "group_message_not_addressed_to_bot" };
  }
  if (!input.addressedToBot && !input.replyToBot) {
    return { shouldRun: false, reason: "group_message_not_addressed_to_bot" };
  }
  return { shouldRun: true };
}

function isGeneratedByCodex(ex: unknown): boolean {
  if (!ex || typeof ex !== "object") {
    return false;
  }

  const agent = (ex as { agent?: unknown }).agent;
  if (!agent || typeof agent !== "object") {
    return false;
  }

  return (agent as { generated_by?: unknown }).generated_by === "codex";
}

function isAddressedToBot(text: string, botUserId: string): boolean {
  const escaped = botUserId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\s)@?${escaped}($|\\s|:|,|，|：)`, "i").test(text);
}

function isAllowed(value: string | null | undefined, allowlist: readonly string[] | undefined): boolean {
  if (!allowlist?.length) {
    return true;
  }
  return Boolean(value && allowlist.includes(value));
}

function isReplyToBot(event: SemanticEvent): boolean {
  return event.metadata?.groupTrigger === "reply_to_bot";
}
