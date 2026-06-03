import { describe, expect, it } from "vitest";
import { parseAfterSendSingleMsgPayload } from "../../src/adapters/openim/openim-message.parser.js";

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
