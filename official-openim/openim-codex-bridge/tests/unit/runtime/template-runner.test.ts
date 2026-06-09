import { describe, expect, it } from "vitest";
import { TemplateRunner } from "../../../src/runtime/template.runner.js";

function input(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job_1",
    sessionRecordId: "csr_1",
    openimConversationId: "single:codex_bot:user_1",
    inputText: "  hello   template  ",
    prompt: "prompt text",
    projectPath: "/workspace/demo",
    ...overrides
  };
}

describe("TemplateRunner", () => {
  it("returns deterministic local output and emits events", async () => {
    const events: Record<string, unknown>[] = [];
    const runner = new TemplateRunner({ responsePrefix: "LOCAL_ACK" });

    const result = await runner.run(input({ onEvent: (event: Record<string, unknown>) => events.push(event) })).promise;

    expect(result).toMatchObject({
      ok: true,
      externalSessionId: null,
      outputText: "LOCAL_ACK: hello template",
      rawOutput: "LOCAL_ACK: hello template",
      exitCode: 0
    });
    expect(events.map((event) => event.type)).toEqual([
      "template.request_started",
      "template.response_completed"
    ]);
  });

  it("supports cancellation before execution resolves", async () => {
    const events: Record<string, unknown>[] = [];
    const runner = new TemplateRunner();

    const handle = runner.run(input({ onEvent: (event: Record<string, unknown>) => events.push(event) }));
    await handle.cancel("manual");
    const result = await handle.promise;

    expect(result).toMatchObject({
      ok: false,
      outputText: "",
      errorText: "Template runtime cancelled: manual",
      cancelled: true
    });
    expect(events.map((event) => event.type)).toEqual([
      "template.request_started",
      "template.request_cancelled"
    ]);
  });
});
