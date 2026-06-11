import { describe, expect, it } from "vitest";
import { normalizeCodexJsonEvent, parseCodexJsonlOutput } from "../../src/adapters/codex/codex-output.parser.js";

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

  it("normalizes visible Codex JSON events for runtime trace display", () => {
    expect(
      normalizeCodexJsonEvent({
        type: "item.started",
        item: { type: "tool_call", name: "shell", command: "git status --short" }
      })
    ).toMatchObject({
      eventType: "item.started",
      title: "tool_call",
      summary: "shell: git status --short"
    });

    expect(normalizeCodexJsonEvent({ type: "agent_message", message: "done" })).toMatchObject({
      eventType: "agent_message",
      title: "agent_message",
      summary: "done"
    });

    expect(
      normalizeCodexJsonEvent({
        type: "turn.completed",
        usage: {
          input_tokens: 255023,
          cached_input_tokens: 199808,
          output_tokens: 3274,
          reasoning_output_tokens: 645
        }
      })
    ).toMatchObject({
      eventType: "turn.completed",
      title: "turn.completed",
      summary: "usage: input 255023, cached 199808, output 3274, reasoning 645"
    });
  });
});
