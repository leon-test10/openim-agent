import { describe, expect, it } from "vitest";
import { parseAfterSendGroupMsgPayload, parseAfterSendSingleMsgPayload } from "../../src/adapters/openim/openim-message.parser.js";

describe("parseAfterSendSingleMsgPayload", () => {
  it("parses text callback payloads and derives a stable single-chat conversation id", () => {
    const event = parseAfterSendSingleMsgPayload(
      {
        sendID: "user_1",
        recvID: "codex_bot",
        serverMsgID: "server_1",
        clientMsgID: "client_1",
        operationID: "op_1",
        contentType: 101,
        content: JSON.stringify({ content: "hello bot" }),
        ex: JSON.stringify({ trace: "x" })
      },
      { botUserId: "codex_bot" }
    );

    expect(event.openimConversationId).toBe("single:codex_bot:user_1");
    expect(event.text).toBe("hello bot");
    expect(event.ex).toEqual({ trace: "x" });
    expect(event.openimMessageId).toBe("server_1");
    expect(event.openimClientMsgId).toBe("client_1");
  });

  it("uses OpenIM conversationID when the callback supplies one", () => {
    const event = parseAfterSendSingleMsgPayload(
      {
        sendID: "user_1",
        recvID: "codex_bot",
        conversationID: "si_user_1_codex_bot",
        contentType: 101,
        content: "hello"
      },
      { botUserId: "codex_bot" }
    );

    expect(event.openimConversationId).toBe("si_user_1_codex_bot");
    expect(event.text).toBe("hello");
  });
});

describe("parseAfterSendGroupMsgPayload", () => {
  it("parses text callback payloads and derives a group conversation id", () => {
    const event = parseAfterSendGroupMsgPayload(
      {
        sendID: "user_1",
        groupID: "group_1",
        serverMsgID: "server_1",
        clientMsgID: "client_1",
        contentType: 101,
        content: JSON.stringify({ content: "@codex_bot help" })
      },
      { botUserId: "codex_bot" }
    );

    expect(event.openimConversationId).toBe("group:group_1");
    expect(event.groupId).toBe("group_1");
    expect(event.receiverUserId).toBeNull();
    expect(event.text).toBe("@codex_bot help");
    expect(event.eventType).toBe("openim.group.text");
  });

  it("extracts group quote text and marks replies to the bot", () => {
    const event = parseAfterSendGroupMsgPayload(
      {
        sendID: "user_1",
        groupID: "group_1",
        contentType: 114,
        content: JSON.stringify({
          quoteElem: {
            text: "please follow up",
            quoteMessage: {
              sendID: "codex_bot",
              clientMsgID: "bot_reply_1"
            }
          }
        })
      },
      { botUserId: "codex_bot" }
    );

    expect(event.eventType).toBe("openim.group.quote");
    expect(event.text).toBe("please follow up");
    expect(event.metadata).toEqual({ groupTrigger: "reply_to_bot" });
  });
});
