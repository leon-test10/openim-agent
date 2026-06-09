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

  it("ignores group messages while group bot is disabled", () => {
    const decision = shouldCreateRuntimeJob(
      {
        ...baseEvent,
        openimConversationId: "group:group_1",
        receiverUserId: null,
        groupId: "group_1",
        text: "@codex_bot help"
      },
      { botUserId: "codex_bot" }
    );

    expect(decision).toEqual({ shouldRun: false, reason: "group_bot_disabled" });
  });

  it("accepts group text only when it mentions the bot", () => {
    const decision = shouldCreateRuntimeJob(
      {
        ...baseEvent,
        openimConversationId: "group:group_1",
        receiverUserId: null,
        groupId: "group_1",
        text: "@codex_bot help"
      },
      { botUserId: "codex_bot", groupBotEnabled: true }
    );

    expect(decision).toEqual({ shouldRun: true });
  });

  it("ignores mentioned group text from groups outside the backend allowlist", () => {
    const decision = shouldCreateRuntimeJob(
      {
        ...baseEvent,
        openimConversationId: "group:group_2",
        receiverUserId: null,
        groupId: "group_2",
        text: "@codex_bot help"
      },
      { botUserId: "codex_bot", groupBotEnabled: true, groupAllowlist: ["group_1"] }
    );

    expect(decision).toEqual({ shouldRun: false, reason: "group_not_allowed" });
  });

  it("ignores mentioned group text from senders outside the backend allowlist", () => {
    const decision = shouldCreateRuntimeJob(
      {
        ...baseEvent,
        openimConversationId: "group:group_1",
        receiverUserId: null,
        groupId: "group_1",
        senderUserId: "user_2",
        text: "@codex_bot help"
      },
      { botUserId: "codex_bot", groupBotEnabled: true, groupSenderAllowlist: ["user_1"] }
    );

    expect(decision).toEqual({ shouldRun: false, reason: "group_sender_not_allowed" });
  });

  it("ignores group text that does not mention the bot", () => {
    const decision = shouldCreateRuntimeJob(
      {
        ...baseEvent,
        openimConversationId: "group:group_1",
        receiverUserId: null,
        groupId: "group_1",
        text: "general chat"
      },
      { botUserId: "codex_bot", groupBotEnabled: true }
    );

    expect(decision).toEqual({ shouldRun: false, reason: "group_message_not_addressed_to_bot" });
  });

  it("accepts group text that replies to a bot message without a mention", () => {
    const decision = shouldCreateRuntimeJob(
      {
        ...baseEvent,
        openimConversationId: "group:group_1",
        receiverUserId: null,
        groupId: "group_1",
        contentType: 114,
        eventType: "openim.group.quote",
        text: "please continue this thread",
        metadata: { groupTrigger: "reply_to_bot" }
      },
      { botUserId: "codex_bot", groupBotEnabled: true }
    );

    expect(decision).toEqual({ shouldRun: true });
  });

  it("disables group auto replies when policy is disabled", () => {
    const decision = shouldCreateRuntimeJob(
      {
        ...baseEvent,
        openimConversationId: "group:group_1",
        receiverUserId: null,
        groupId: "group_1",
        text: "@codex_bot help"
      },
      { botUserId: "codex_bot", groupBotEnabled: true, groupAutoReplyPolicy: "disabled" }
    );

    expect(decision).toEqual({ shouldRun: false, reason: "group_auto_reply_disabled" });
  });

  it("honors mention-only and reply-only group auto reply policies", () => {
    const replyOnlyEvent: SemanticEvent = {
      ...baseEvent,
      openimConversationId: "group:group_1",
      receiverUserId: null,
      groupId: "group_1",
      contentType: 114,
      eventType: "openim.group.quote",
      text: "continue this",
      metadata: { groupTrigger: "reply_to_bot" }
    };
    const mentionEvent: SemanticEvent = {
      ...baseEvent,
      openimConversationId: "group:group_1",
      receiverUserId: null,
      groupId: "group_1",
      text: "@codex_bot help"
    };

    expect(
      shouldCreateRuntimeJob(replyOnlyEvent, {
        botUserId: "codex_bot",
        groupBotEnabled: true,
        groupAutoReplyPolicy: "mention_only"
      })
    ).toEqual({ shouldRun: false, reason: "group_message_not_addressed_to_bot" });
    expect(
      shouldCreateRuntimeJob(mentionEvent, {
        botUserId: "codex_bot",
        groupBotEnabled: true,
        groupAutoReplyPolicy: "reply_only"
      })
    ).toEqual({ shouldRun: false, reason: "group_message_not_addressed_to_bot" });
  });
});
