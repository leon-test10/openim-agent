import { describe, expect, it } from "vitest";
import { OpenHandsRunner } from "../../../src/runtime/openhands.runner.js";

describe("OpenHandsRunner", () => {
  it("is an explicit spike stub that reports unsupported execution", async () => {
    const events: Record<string, unknown>[] = [];
    const runner = new OpenHandsRunner({
      baseUrl: "http://127.0.0.1:3000",
      apiKey: "dev-key",
      timeoutMs: 600000
    });

    const handle = runner.run({
      jobId: "job_1",
      sessionRecordId: "csr_1",
      openimConversationId: "single:codex_bot:user_1",
      inputText: "fix tests",
      prompt: "fix tests",
      projectPath: "/workspace/demo",
      onEvent: (event) => events.push(event)
    });
    const result = await handle.promise;

    expect(handle.pid).toBeNull();
    expect(result).toMatchObject({
      ok: false,
      outputText: "",
      errorText:
        "OpenHands runtime spike is configured but not executable yet. See docs/openhands-spike.md for the required adapter contract."
    });
    expect(events).toEqual([
      expect.objectContaining({
        type: "openhands.spike.not_implemented",
        baseUrl: "http://127.0.0.1:3000",
        apiKeyConfigured: true
      })
    ]);
  });
});
