import { describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleRunner } from "../../../src/runtime/openai-compatible.runner.js";

function createRunner(response: Response | Promise<Response>, timeoutMs = 1000) {
  const fetchImpl = vi.fn().mockResolvedValue(response);
  const runner = new OpenAiCompatibleRunner({
    baseUrl: "http://127.0.0.1:8000/v1/",
    apiKey: "test-key",
    model: "test-model",
    timeoutMs,
    temperature: 0.2,
    maxTokens: 128,
    fetchImpl
  });
  return { runner, fetchImpl };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job_1",
    sessionRecordId: "csr_1",
    openimConversationId: "single:codex_bot:user_1",
    inputText: "hello",
    prompt: "prompt text",
    projectPath: "/workspace/demo",
    ...overrides
  };
}

describe("OpenAiCompatibleRunner", () => {
  it("calls chat/completions and returns assistant content", async () => {
    const events: Record<string, unknown>[] = [];
    const { runner, fetchImpl } = createRunner(
      new Response(JSON.stringify({ choices: [{ message: { content: "OPENAI_ACK" } }] }), { status: 200 })
    );

    const handle = runner.run(input({ onEvent: (event: Record<string, unknown>) => events.push(event) }));
    const result = await handle.promise;

    expect(result).toMatchObject({
      ok: true,
      externalSessionId: null,
      outputText: "OPENAI_ACK",
      exitCode: 0
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8000/v1/chat/completions",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer test-key" })
      })
    );
    const body = JSON.parse(String(fetchImpl.mock.calls[0][1].body));
    expect(body).toMatchObject({
      model: "test-model",
      messages: [
        { role: "system", content: "You are an assistant inside an OpenIM conversation." },
        { role: "user", content: "prompt text" }
      ],
      stream: false
    });
    expect(events.map((event) => event.type)).toEqual([
      "openai_compatible.request_started",
      "openai_compatible.response_completed"
    ]);
  });

  it("returns HTTP errors with provider message when present", async () => {
    const { runner } = createRunner(
      new Response(JSON.stringify({ error: { message: "bad api key" } }), { status: 401 })
    );

    const result = await runner.run(input()).promise;

    expect(result).toMatchObject({
      ok: false,
      outputText: "",
      errorText: "bad api key",
      exitCode: 401
    });
  });

  it("rejects malformed JSON", async () => {
    const { runner } = createRunner(new Response("not json", { status: 200 }));

    const result = await runner.run(input()).promise;

    expect(result).toMatchObject({
      ok: false,
      errorText: "OpenAI-compatible runtime returned malformed JSON."
    });
  });

  it("rejects empty choices", async () => {
    const { runner } = createRunner(new Response(JSON.stringify({ choices: [] }), { status: 200 }));

    const result = await runner.run(input()).promise;

    expect(result).toMatchObject({
      ok: false,
      errorText: "OpenAI-compatible runtime returned no assistant content."
    });
  });

  it("supports process-level cancellation", async () => {
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("api")));
      });
    });
    const runner = new OpenAiCompatibleRunner({
      baseUrl: "http://127.0.0.1:8000/v1",
      apiKey: "test-key",
      model: "test-model",
      timeoutMs: 1000,
      temperature: 0.2,
      maxTokens: 128,
      fetchImpl
    });

    const handle = runner.run(input());
    await handle.cancel("api");
    const result = await handle.promise;

    expect(result).toMatchObject({
      ok: false,
      cancelled: true,
      errorText: "OpenAI-compatible runtime cancelled: api"
    });
  });

  it("marks timeout aborts as timedOut", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn((_url: string, init: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => reject(new Error("openai_compatible_timeout")));
      });
    });
    const runner = new OpenAiCompatibleRunner({
      baseUrl: "http://127.0.0.1:8000/v1",
      apiKey: "test-key",
      model: "test-model",
      timeoutMs: 5,
      temperature: 0.2,
      maxTokens: 128,
      fetchImpl
    });

    const handle = runner.run(input());
    await vi.advanceTimersByTimeAsync(5);
    const result = await handle.promise;
    vi.useRealTimers();

    expect(result).toMatchObject({
      ok: false,
      cancelled: true,
      timedOut: true,
      errorText: "OpenAI-compatible runtime cancelled: openai_compatible_timeout"
    });
  });
});
