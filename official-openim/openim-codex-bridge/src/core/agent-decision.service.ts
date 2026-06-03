import type { SemanticEvent } from "./semantic-event.js";

export type AgentDecisionReason =
  | "receiver_is_not_bot"
  | "sender_is_bot"
  | "generated_by_codex"
  | "unsupported_content_type"
  | "empty_text";

export type AgentDecision =
  | { shouldRun: true }
  | { shouldRun: false; reason: AgentDecisionReason };

export interface AgentDecisionConfig {
  botUserId: string;
}

export function shouldCreateRuntimeJob(
  event: SemanticEvent,
  config: AgentDecisionConfig
): AgentDecision {
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

