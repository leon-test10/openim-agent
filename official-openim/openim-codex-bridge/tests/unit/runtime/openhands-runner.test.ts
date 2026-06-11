import { PassThrough } from "node:stream";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenHandsRunner } from "../../../src/runtime/openhands.runner.js";

describe("OpenHandsRunner", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("runs a new OpenHands CLI headless task and parses assistant output", async () => {
    const events: Record<string, unknown>[] = [];
    const child = createFakeChild();
    const runner = new OpenHandsRunner({
      openhandsBin: "openhands",
      baseUrl: "http://127.0.0.1:3000",
      apiKey: "dev-key",
      timeoutMs: 600000,
      spawnImpl: vi.fn(() => child as never)
    });

    const handle = runner.run({
      jobId: "job_1",
      sessionRecordId: "csr_1",
      openimConversationId: "single:codex_bot:user_1",
      inputText: "respond exactly once",
      prompt: "Respond with exactly OPENIM_OPENHANDS_OK.",
      projectPath: "C:/workspace/demo",
      runtimeHomeDir: "C:/workspace/runtime-home",
      model: "Qwen3.6-35B-A3B-UD-Q4_K_M.gguf",
      onEvent: (event) => events.push(event)
    });

    child.stdout.emit("data", "Initializing agent...\n");
    child.stdout.emit("data", "{\"kind\":\"MessageEvent\",\"source\":\"agent\",\"llm_message\":{\"content\":[{\"text\":\"OPENIM_OPENHANDS_OK\"}]}}\n");
    child.stdout.emit("data", "Agent finished\nConversation ID: ee41bc6dbc274753b64fc565b3121ee2\n");
    child.stderr.emit(
      "data",
      "openai.py:25: AuthlibDeprecationWarning: authlib.jose module is deprecated\nIt will be compatible before version 2.0.0.\nfrom authlib.jose import JsonWebKey, jwt\n"
    );
    child.emit("close", 0);

    const result = await handle.promise;

    expect(handle.pid).toBe(4242);
    expect(result).toMatchObject({
      ok: true,
      outputText: "OPENIM_OPENHANDS_OK",
      externalSessionId: "ee41bc6d-bc27-4753-b64f-c565b3121ee2",
      exitCode: 0
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "openhands.initializing" }),
        expect.objectContaining({ type: "openhands.message_event", summary: "OPENIM_OPENHANDS_OK" }),
        expect.objectContaining({ type: "openhands.conversation_id" })
      ])
    );
    const spawnCall = vi.mocked(runner["spawnImpl"]).mock.calls[0];
    expect(spawnCall?.[0]).toBe("openhands");
    expect(spawnCall?.[1]).toEqual([
      "--headless",
      "--json",
      "--override-with-envs",
      "-t",
      "Respond with exactly OPENIM_OPENHANDS_OK."
    ]);
    expect(spawnCall?.[2].cwd).toBe("C:/workspace/demo");
    expect(spawnCall?.[2].env?.LLM_MODEL).toBe("openai/Qwen3.6-35B-A3B-UD-Q4_K_M.gguf");
    expect(spawnCall?.[2].env?.HOME).toBe("C:/workspace/runtime-home");
    expect(spawnCall?.[2].env).toMatchObject({
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.longpaths",
      GIT_CONFIG_VALUE_0: "true",
      PYTHONIOENCODING: "utf-8",
      PYTHONUTF8: "1",
      PYTHONUNBUFFERED: "1"
    });
  });

  it("supports resuming an existing OpenHands conversation id", async () => {
    const child = createFakeChild();
    const spawnImpl = vi.fn(() => child as never);
    const runner = new OpenHandsRunner({
      openhandsBin: "openhands",
      baseUrl: "http://127.0.0.1:3000",
      timeoutMs: 600000,
      spawnImpl
    });

    const handle = runner.run({
      jobId: "job_resume",
      sessionRecordId: "csr_resume",
      openimConversationId: "single:codex_bot:user_1",
      inputText: "resume",
      prompt: "Respond with exactly OPENIM_OPENHANDS_RESUME_OK.",
      projectPath: "C:/workspace/demo",
      externalSessionId: "ee41bc6d-bc27-4753-b64f-c565b3121ee2"
    });

    child.stdout.emit("data", "{\"kind\":\"MessageEvent\",\"source\":\"agent\",\"llm_message\":{\"content\":[{\"text\":\"OPENIM_OPENHANDS_RESUME_OK\"}]}}\n");
    child.emit("close", 0);
    const result = await handle.promise;

    expect(result).toMatchObject({
      ok: true,
      outputText: "OPENIM_OPENHANDS_RESUME_OK",
      externalSessionId: "ee41bc6d-bc27-4753-b64f-c565b3121ee2"
    });
    expect(spawnImpl.mock.calls[0]?.[1]).toEqual([
      "--headless",
      "--json",
      "--override-with-envs",
      "--resume",
      "ee41bc6d-bc27-4753-b64f-c565b3121ee2",
      "-t",
      "Respond with exactly OPENIM_OPENHANDS_RESUME_OK."
    ]);
  });

  it("surfaces ConversationErrorEvent details on failure", async () => {
    const child = createFakeChild();
    const runner = new OpenHandsRunner({
      openhandsBin: "openhands",
      baseUrl: "http://127.0.0.1:3000",
      timeoutMs: 600000,
      spawnImpl: vi.fn(() => child as never)
    });

    const handle = runner.run({
      jobId: "job_fail",
      sessionRecordId: "csr_fail",
      openimConversationId: "single:codex_bot:user_1",
      inputText: "fail",
      prompt: "cause failure",
      projectPath: "C:/workspace/demo"
    });

    child.stdout.emit(
      "data",
      "{\"kind\":\"ConversationErrorEvent\",\"source\":\"environment\",\"code\":\"LLMBadRequestError\",\"detail\":\"provider missing\"}\n"
    );
    child.emit("close", 1);
    const result = await handle.promise;

    expect(result).toMatchObject({
      ok: false,
      outputText: "",
      errorText: "LLMBadRequestError: provider missing",
      exitCode: 1
    });
  });

  it("finishes from the exit event when inherited handles prevent close", async () => {
    const child = createFakeChild();
    const runner = new OpenHandsRunner({
      openhandsBin: "openhands",
      baseUrl: "https://api.deepseek.com/v1",
      timeoutMs: 600000,
      spawnImpl: vi.fn(() => child as never)
    });

    const handle = runner.run({
      jobId: "job_exit_only",
      sessionRecordId: "csr_exit_only",
      openimConversationId: "single:codex_bot:user_1",
      inputText: "exit only",
      prompt: "Reply with EXIT_ONLY_OK.",
      projectPath: "C:/workspace/demo"
    });

    child.stdout.emit("data", "{\"kind\":\"MessageEvent\",\"source\":\"agent\",\"llm_message\":{\"content\":[{\"text\":\"EXIT_ONLY_OK\"}]}}\n");
    child.emit("exit", 0);

    await expect(handle.promise).resolves.toMatchObject({
      ok: true,
      outputText: "EXIT_ONLY_OK",
      exitCode: 0
    });
  });

  it("finishes when the Windows launcher disappears without exit or close", async () => {
    const child = createFakeChild();
    const runner = new OpenHandsRunner({
      openhandsBin: "openhands",
      baseUrl: "https://api.deepseek.com/v1",
      timeoutMs: 600000,
      exitPollMs: 5,
      processAliveImpl: async () => false,
      spawnImpl: vi.fn(() => child as never)
    });

    const handle = runner.run({
      jobId: "job_missing_process",
      sessionRecordId: "csr_missing_process",
      openimConversationId: "group:group_1",
      inputText: "missing process",
      prompt: "Reply with MISSING_PROCESS_OK.",
      projectPath: "C:/workspace/demo"
    });

    child.stdout.emit("data", "{\"kind\":\"MessageEvent\",\"source\":\"agent\",\"llm_message\":{\"content\":[{\"text\":\"MISSING_PROCESS_OK\"}]}}\n");

    await expect(handle.promise).resolves.toMatchObject({
      ok: true,
      outputText: "MISSING_PROCESS_OK"
    });
  });

  it("can launch OpenHands through an explicit Python entrypoint on Windows", async () => {
    const originalPlatform = process.platform;
    Object.defineProperty(process, "platform", { value: "win32" });
    try {
      const child = createFakeChild();
      const spawnImpl = vi.fn(() => child as never);
      const runner = new OpenHandsRunner({
        openhandsBin: "openhands",
        openhandsPythonBin: "C:/Python312/python.exe",
        baseUrl: "https://api.deepseek.com/v1",
        timeoutMs: 600000,
        spawnImpl
      });

      const handle = runner.run({
        jobId: "job_python_entrypoint",
        sessionRecordId: "csr_python_entrypoint",
        openimConversationId: "single:codex_bot:user_1",
        inputText: "python entrypoint",
        prompt: "Reply with exactly PYTHON_ENTRYPOINT_OK.",
        projectPath: "C:/workspace/demo"
      });

      child.stdout.emit("data", "{\"kind\":\"MessageEvent\",\"source\":\"agent\",\"llm_message\":{\"content\":[{\"text\":\"PYTHON_ENTRYPOINT_OK\"}]}}\n");
      child.emit("close", 0);

      await expect(handle.promise).resolves.toMatchObject({
        ok: true,
        outputText: "PYTHON_ENTRYPOINT_OK"
      });
      expect(spawnImpl.mock.calls[0]?.[0]).toBe("C:/Python312/python.exe");
      expect(spawnImpl.mock.calls[0]?.[1]).toEqual([
        "-m",
        "openhands_cli.entrypoint",
        "--headless",
        "--json",
        "--override-with-envs",
        "-t",
        "Reply with exactly PYTHON_ENTRYPOINT_OK."
      ]);
    } finally {
      Object.defineProperty(process, "platform", { value: originalPlatform });
    }
  });
});

function createFakeChild() {
  const child = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    pid: number;
    kill: ReturnType<typeof vi.fn>;
  };
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.pid = 4242;
  child.kill = vi.fn();
  return child;
}
