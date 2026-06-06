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

export function buildCodexPrompt(input: BuildCodexPromptInput): string {
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
