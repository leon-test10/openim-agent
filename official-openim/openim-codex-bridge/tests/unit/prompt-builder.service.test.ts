import { describe, expect, it } from "vitest";
import { buildCodexPrompt } from "../../src/core/prompt-builder.service.js";

describe("buildCodexPrompt", () => {
  it("includes OpenIM conversation, project path, active session metadata, and user text", () => {
    const prompt = buildCodexPrompt({
      openimConversationId: "single:codex_bot:user_1",
      codexProjectPath: "D:\\workspace\\demo",
      codexSessionId: "11111111-1111-1111-1111-111111111111",
      userText: "Please summarize README"
    });

    expect(prompt).toContain("OpenIM conversation_id:\nsingle:codex_bot:user_1");
    expect(prompt).toContain("Project directory:\nD:\\workspace\\demo");
    expect(prompt).toContain("Codex session_id:\n11111111-1111-1111-1111-111111111111");
    expect(prompt).toContain("User new message:\nPlease summarize README");
    expect(prompt).toContain("Do not invent files, command results, or OpenIM history");
  });

  it("includes imported OpenIM history when present", () => {
    const prompt = buildCodexPrompt({
      openimConversationId: "single:codex_bot:user_1",
      codexProjectPath: "/workspace/openim-demo",
      codexSessionId: null,
      userText: "continue",
      openimHistoryMessages: [
        {
          sendID: "user_1",
          senderNickname: "User",
          sendTime: 1780710000000,
          text: "我们之前讨论了 history import"
        }
      ]
    });

    expect(prompt).toContain("OpenIM imported history:");
    expect(prompt).toContain("User: 我们之前讨论了 history import");
  });

  it("marks the session as new when no Codex session id exists yet", () => {
    const prompt = buildCodexPrompt({
      openimConversationId: "single:codex_bot:user_1",
      codexProjectPath: "/workspace/openim-demo",
      codexSessionId: null,
      userText: "hello"
    });

    expect(prompt).toContain("Codex session_id:\n(new session)");
  });
});
