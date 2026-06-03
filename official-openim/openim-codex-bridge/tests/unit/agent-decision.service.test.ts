import { describe, expect, it } from "vitest";
import { shouldCreateRuntimeJob } from "../../src/core/agent-decision.service.js";
import type { SemanticEvent } from "../../src/core/semantic-event.js";

const baseEvent: SemanticEvent = {
  id: "evt_1",
  openimMessageId: "server_1",
  openimClientMsgId: "client_1",
  openimConversationId: "single:codex_bot:user_1",
  senderUserId: "user_1",
  receiverUserId: "codex_bot",
  groupId: null,
  eventType: "openim.single.text",
  contentType: 101,
  text: "hello",
  ex: null,
  rawPayload: {},
  createdAt: 1000
};

describe("shouldCreateRuntimeJob", () => {
  it("accepts text messages sent by a human to the configured bot", () => {
    const decision = shouldCreateRuntimeJob(baseEvent, { botUserId: "codex_bot" });

    expect(decision).toEqual({ shouldRun: true });
  });

  it("ignores messages not addressed to the bot", () => {
    const decision = shouldCreateRuntimeJob(
      { ...baseEvent, receiverUserId: "user_2" },
      { botUserId: "codex_bot" }
    );

    expect(decision).toEqual({ shouldRun: false, reason: "receiver_is_not_bot" });
  });

  it("ignores messages sent by the bot", () => {
    const decision = shouldCreateRuntimeJob(
      { ...baseEvent, senderUserId: "codex_bot" },
      { botUserId: "codex_bot" }
    );

    expect(decision).toEqual({ shouldRun: false, reason: "sender_is_bot" });
  });

  it("ignores bridge-generated messages to prevent callback loops", () => {
    const decision = shouldCreateRuntimeJob(
      { ...baseEvent, ex: { agent: { generated_by: "codex" } } },
      { botUserId: "codex_bot" }
    );

    expect(decision).toEqual({ shouldRun: false, reason: "generated_by_codex" });
  });

  it("ignores non-text messages for the MVP", () => {
    const decision = shouldCreateRuntimeJob(
      { ...baseEvent, contentType: 102, text: null },
      { botUserId: "codex_bot" }
    );

    expect(decision).toEqual({ shouldRun: false, reason: "unsupported_content_type" });
  });
});
