import { describe, expect, it } from "vitest";
import { buildCodexPrompt } from "../../src/core/prompt-builder.service.js";

describe("buildCodexPrompt", () => {
  it("includes OpenIM conversation, project path, active session metadata, and user text", () => {
    const prompt = buildCodexPrompt({
      openimConversationId: "single:codex_bot:user_1",
      codexProjectPath: "D:\\workspace\\demo",
      codexSessionId: "11111111-1111-1111-1111-111111111111",
      userText: "请总结 README"
    });

    expect(prompt).toContain("OpenIM conversation_id:\nsingle:codex_bot:user_1");
    expect(prompt).toContain("项目目录:\nD:\\workspace\\demo");
    expect(prompt).toContain("Codex session_id:\n11111111-1111-1111-1111-111111111111");
    expect(prompt).toContain("用户新消息:\n请总结 README");
    expect(prompt).toContain("不要编造不存在的文件或结果");
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
