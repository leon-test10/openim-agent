import { describe, expect, it } from "vitest";
import { parseCodexJsonlOutput } from "../../src/adapters/codex/codex-output.parser.js";

describe("parseCodexJsonlOutput", () => {
  it("extracts session id and final assistant text from JSONL events", () => {
    const rawOutput = [
      JSON.stringify({ type: "session.started", session_id: "11111111-1111-1111-1111-111111111111" }),
      JSON.stringify({ type: "agent_message", message: "我读取了 README。" }),
      JSON.stringify({ type: "task.complete", last_message: "最终总结" })
    ].join("\n");

    const parsed = parseCodexJsonlOutput(rawOutput);

    expect(parsed.sessionId).toBe("11111111-1111-1111-1111-111111111111");
    expect(parsed.outputText).toBe("最终总结");
  });

  it("falls back to the last assistant-like message when no explicit final message exists", () => {
    const rawOutput = [
      JSON.stringify({ type: "assistant_message", text: "first" }),
      JSON.stringify({ type: "agent_message", message: "second" })
    ].join("\n");

    const parsed = parseCodexJsonlOutput(rawOutput);

    expect(parsed.outputText).toBe("second");
  });

  it("ignores malformed lines and returns raw output text as a final fallback", () => {
    const rawOutput = "not json\nplain output";

    const parsed = parseCodexJsonlOutput(rawOutput);

    expect(parsed.outputText).toBe(rawOutput);
  });

  it("extracts thread id and nested agent message from current Codex item events", () => {
    const rawOutput = [
      JSON.stringify({ type: "thread.started", thread_id: "019e8650-b763-7d91-a3f1-85d49321b45a" }),
      JSON.stringify({
        type: "item.completed",
        item: { id: "item_1", type: "agent_message", text: "ACK." }
      }),
      JSON.stringify({ type: "turn.completed" })
    ].join("\n");

    const parsed = parseCodexJsonlOutput(rawOutput);

    expect(parsed.sessionId).toBe("019e8650-b763-7d91-a3f1-85d49321b45a");
    expect(parsed.outputText).toBe("ACK.");
  });
});
