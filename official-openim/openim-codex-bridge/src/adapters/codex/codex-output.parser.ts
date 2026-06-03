export interface ParsedCodexOutput {
  sessionId?: string;
  outputText: string;
}

const SESSION_ID_KEYS = [
  "session_id",
  "sessionId",
  "thread_id",
  "threadId",
  "conversation_id",
  "conversationId"
];
const FINAL_TEXT_KEYS = ["last_message", "lastMessage", "final_message", "finalMessage", "output_text", "outputText"];
const MESSAGE_TEXT_KEYS = ["message", "text", "content", "delta"];

export function parseCodexJsonlOutput(rawOutput: string): ParsedCodexOutput {
  const lines = rawOutput.split(/\r?\n/).filter((line) => line.trim().length > 0);
  let sessionId: string | undefined;
  let lastAssistantText: string | undefined;
  let finalText: string | undefined;

  for (const line of lines) {
    const event = parseJsonObject(line);
    if (!event) {
      continue;
    }

    sessionId ??= pickString(event, SESSION_ID_KEYS);
    const item = isRecord(event.item) ? event.item : null;
    if (item) {
      sessionId ??= pickString(item, SESSION_ID_KEYS);
    }

    const explicitFinalText = pickString(event, FINAL_TEXT_KEYS);
    if (explicitFinalText) {
      finalText = explicitFinalText;
    }

    if (item && looksLikeAssistantEvent(item)) {
      const assistantText = pickString(item, MESSAGE_TEXT_KEYS);
      if (assistantText) {
        lastAssistantText = assistantText;
      }
    }

    if (looksLikeAssistantEvent(event)) {
      const assistantText = pickString(event, MESSAGE_TEXT_KEYS);
      if (assistantText) {
        lastAssistantText = assistantText;
      }
    }
  }

  return {
    sessionId,
    outputText: finalText ?? lastAssistantText ?? rawOutput
  };
}

function parseJsonObject(line: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(line) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function pickString(event: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = event[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function looksLikeAssistantEvent(event: Record<string, unknown>): boolean {
  const type = event.type;
  return (
    typeof type === "string" &&
    (type.includes("assistant") || type.includes("agent_message") || type.includes("message"))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
