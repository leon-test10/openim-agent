export interface BuildCodexPromptInput {
  openimConversationId: string;
  codexProjectPath: string;
  codexSessionId: string | null;
  userText: string;
}

export function buildCodexPrompt(input: BuildCodexPromptInput): string {
  return [
    "你是通过 OpenIM 会话连接到用户的 Codex coding agent。",
    "",
    "OpenIM conversation_id:",
    input.openimConversationId,
    "",
    "项目目录:",
    input.codexProjectPath,
    "",
    "Codex session_id:",
    input.codexSessionId ?? "(new session)",
    "",
    "用户新消息:",
    input.userText,
    "",
    "执行要求:",
    "1. 先理解用户意图。",
    "2. 如果需要查看代码，请直接使用 Codex CLI 能力。",
    "3. 回复时说明你做了什么、发现了什么、下一步建议。",
    "4. 不要编造不存在的文件或结果。"
  ].join("\n");
}

