import type { ConversationContext } from "./conversation-context.service.js";
import type { SemanticEvent } from "./semantic-event.js";

export interface BuildCodexPromptInput {
  openimConversationId: string;
  codexProjectPath: string;
  codexSessionId: string | null;
  userText: string;
  openimHistoryMessages?: Array<{
    sendID?: string;
    senderNickname?: string;
    sendTime?: number;
    text?: string;
    preview?: string;
  }>;
}

export interface BuildCodexPromptFromContextInput {
  context: ConversationContext;
  currentEvent?: SemanticEvent;
}

export function buildCodexPrompt(input: BuildCodexPromptInput | BuildCodexPromptFromContextInput): string {
  if ("context" in input) {
    return buildCodexPromptFromContext(input);
  }

  return [
    "You are a Codex coding agent connected to the user through an OpenIM conversation.",
    "",
    "OpenIM conversation_id:",
    input.openimConversationId,
    "",
    "Project directory:",
    input.codexProjectPath,
    "",
    "Codex session_id:",
    input.codexSessionId ?? "(new session)",
    "",
    ...buildHistoryBlock(input.openimHistoryMessages),
    "User new message:",
    input.userText,
    "",
    "Execution requirements:",
    "1. Understand the user's intent before acting.",
    "2. If code inspection is needed, use the available Codex CLI capabilities.",
    "3. In the reply, explain what you did, what you found, and the next step.",
    "4. Do not invent files, command results, or OpenIM history that is not present in this prompt."
  ].join("\n");
}

function buildCodexPromptFromContext(input: BuildCodexPromptFromContextInput): string {
  const context = input.context;
  const currentEvent = input.currentEvent ?? context.currentEvent ?? context.recentEvents.at(-1);
  return [
    "You are Codex running as an OpenIM conversation coding assistant.",
    "",
    "Use OpenIM semantic context as the source of truth for user-facing conversation facts.",
    "Use the Codex session only as runtime continuation state.",
    "Do not assume hidden context that is not present in the semantic events or the current repository.",
    "",
    "Conversation:",
    `- conversation_id: ${context.conversationID}`,
    `- conversation_type: ${context.conversationType}`,
    `- project_path: ${context.projectPath ?? "(unbound)"}`,
    `- active_codex_session_id: ${context.activeCodexSessionID ?? "(new session)"}`,
    "",
    "Long-term summary:",
    context.summary?.summaryText ? redactSecretsInText(context.summary.summaryText) : "(none)",
    "",
    "Important decisions:",
    ...formatList(context.summary?.importantDecisions),
    "",
    "Unresolved tasks:",
    ...formatList(context.summary?.unresolvedTasks),
    "",
    "Recent OpenIM messages:",
    ...formatSemanticMessages(context.recentEvents),
    "",
    "Current user message:",
    currentEvent?.text ? redactSecretsInText(currentEvent.text) : "(none)",
    "",
    "Execution constraints:",
    "- Keep changes minimal and consistent with the existing codebase.",
    "- Do not modify OpenIM sendMessage flow unless explicitly requested.",
    "- Do not assume Electron can call Codex CLI directly.",
    "- Preserve server-side bridge boundary.",
    "- Do not invent files, command results, or OpenIM history that is not present in this prompt."
  ].join("\n");
}

function buildHistoryBlock(messages: BuildCodexPromptInput["openimHistoryMessages"]): string[] {
  if (!messages?.length) {
    return [];
  }

  const lines = messages.slice(-80).map((message) => {
    const actor = message.senderNickname || message.sendID || "unknown";
    const text = message.text || message.preview || "";
    const time = message.sendTime ? new Date(message.sendTime).toISOString() : "";
    return `[${time}] ${actor}: ${text}`.trim();
  });

  return [
    "OpenIM imported history:",
    ...lines,
    ""
  ];
}

function formatSemanticMessages(events: SemanticEvent[]): string[] {
  if (!events.length) {
    return ["(none)"];
  }
  return events.map((event) => {
    const label = speakerLabel(event);
    return `${label}: ${redactSecretsInText(event.text ?? "")}`;
  });
}

function speakerLabel(event: SemanticEvent): string {
  const name = event.actorDisplayName ?? event.actorID ?? event.senderUserId ?? "unknown";
  if (event.role === "assistant") return `Assistant(${name})`;
  if (event.role === "system") return "System";
  if (event.role === "runtime") return "Runtime";
  return `Human(${name})`;
}

function formatList(values: string[] | undefined): string[] {
  return values?.length ? values.map((value) => `- ${redactSecretsInText(value)}`) : ["- (none)"];
}

export function redactSecretsInText(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]+/g, "sk-****")
    .replace(/([A-Za-z0-9_]*token[A-Za-z0-9_]*\s*[:=]\s*)\S+/gi, "$1****")
    .replace(/([A-Za-z0-9_]*key[A-Za-z0-9_]*\s*[:=]\s*)\S+/gi, "$1****");
}
