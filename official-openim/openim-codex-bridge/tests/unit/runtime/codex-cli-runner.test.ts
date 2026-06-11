import { describe, expect, it } from "vitest";
import { CodexCliRunner } from "../../../src/runtime/codex-cli.runner.js";
import type { CodexCliAdapter, CodexRunHandle } from "../../../src/adapters/codex/codex-types.js";

function createHandle(outputText: string, sessionId?: string): CodexRunHandle {
  return {
    pid: 123,
    promise: Promise.resolve({
      ok: true,
      sessionId,
      outputText,
      rawOutput: outputText
    }),
    cancel: async () => undefined
  };
}

describe("CodexCliRunner", () => {
  it("starts a new Codex CLI task when no external session id is present", async () => {
    const calls: string[] = [];
    const adapter: CodexCliAdapter = {
      runNewTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" }),
      resumeTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" }),
      runNewTaskCancellable: (input) => {
        calls.push(`new:${input.projectPath}:${input.prompt}`);
        return createHandle("new result", "thread_new");
      }
    };
    const runner = new CodexCliRunner(adapter);

    const handle = runner.run({
      jobId: "job_1",
      sessionRecordId: "csr_1",
      openimConversationId: "single:codex_bot:user_1",
      inputText: "hello",
      prompt: "prompt text",
      projectPath: "/workspace/demo",
      externalSessionId: null
    });

    await expect(handle.promise).resolves.toMatchObject({
      ok: true,
      externalSessionId: "thread_new",
      outputText: "new result"
    });
    expect(handle.pid).toBe(123);
    expect(calls).toEqual(["new:/workspace/demo:prompt text"]);
  });

  it("resumes Codex CLI when an external session id is present", async () => {
    const calls: string[] = [];
    const adapter: CodexCliAdapter = {
      runNewTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" }),
      resumeTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" }),
      resumeTaskCancellable: (input) => {
        calls.push(`resume:${input.sessionId}:${input.projectPath}:${input.prompt}`);
        return createHandle("resume result", "thread_existing");
      }
    };
    const runner = new CodexCliRunner(adapter);

    const handle = runner.run({
      jobId: "job_1",
      sessionRecordId: "csr_1",
      openimConversationId: "single:codex_bot:user_1",
      inputText: "hello",
      prompt: "prompt text",
      projectPath: "/workspace/demo",
      externalSessionId: "thread_existing"
    });

    await expect(handle.promise).resolves.toMatchObject({
      ok: true,
      externalSessionId: "thread_existing",
      outputText: "resume result"
    });
    expect(calls).toEqual(["resume:thread_existing:/workspace/demo:prompt text"]);
  });

  it("passes cancellation through to the underlying Codex handle", async () => {
    const cancelledReasons: string[] = [];
    const adapter: CodexCliAdapter = {
      runNewTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" }),
      resumeTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" }),
      runNewTaskCancellable: () => ({
        pid: 321,
        promise: Promise.resolve({ ok: false, outputText: "", rawOutput: "", cancelled: true }),
        cancel: async (reason) => {
          cancelledReasons.push(reason ?? "");
        }
      })
    };
    const runner = new CodexCliRunner(adapter);

    const handle = runner.run({
      jobId: "job_1",
      sessionRecordId: "csr_1",
      openimConversationId: "single:codex_bot:user_1",
      inputText: "hello",
      prompt: "prompt text",
      projectPath: "/workspace/demo"
    });
    await handle.cancel("api");

    expect(cancelledReasons).toEqual(["api"]);
  });
});
