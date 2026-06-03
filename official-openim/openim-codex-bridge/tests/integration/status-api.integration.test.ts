import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import pino from "pino";
import { openDatabase } from "../../src/storage/db.js";
import { SemanticEventRepository } from "../../src/core/semantic-event.repository.js";
import { SessionBindingRepository } from "../../src/core/session-binding.repository.js";
import { RuntimeJobRepository } from "../../src/core/runtime-job.repository.js";
import { createServer } from "../../src/server.js";
import type { AppContext } from "../../src/app-context.js";
import type { SemanticEvent } from "../../src/core/semantic-event.js";
import type { CodexCliAdapter, CodexRunHandle, CodexRunResult } from "../../src/adapters/codex/codex-types.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function createTempContext(overrides: Partial<Pick<AppContext, "codex" | "openimSender">> = {}): AppContext {
  const dir = mkdtempSync(join(tmpdir(), "openim-codex-bridge-api-"));
  tempDirs.push(dir);
  const db = openDatabase(`file:${join(dir, "bridge.sqlite")}`);
  return {
    config: {
      PORT: 8787,
      OPENIM_API_BASE_URL: "http://127.0.0.1:10002",
      OPENIM_ADMIN_USER_ID: "imAdmin",
      OPENIM_ADMIN_SECRET: "openIM123",
      OPENIM_ADMIN_TOKEN: "",
      OPENIM_BOT_USER_ID: "codex_bot",
      CODEX_BIN: "codex",
      CODEX_DEFAULT_PROJECT_PATH: "/workspace/demo",
      CODEX_DEFAULT_MODEL: "",
      CODEX_EXEC_TIMEOUT_MS: 600000,
      DATABASE_URL: `file:${join(dir, "bridge.sqlite")}`,
      LOG_LEVEL: "silent"
    },
    db,
    semanticEvents: new SemanticEventRepository(db),
    sessions: new SessionBindingRepository(db),
    jobs: new RuntimeJobRepository(db),
    codex: overrides.codex ?? {
      runNewTask: async () => ({ ok: true, outputText: "ok", rawOutput: "" }),
      resumeTask: async () => ({ ok: true, outputText: "ok", rawOutput: "" })
    },
    openimSender: overrides.openimSender ?? {
      sendBotText: async () => undefined
    }
  };
}

const event: SemanticEvent = {
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

describe("status API", () => {
  it("returns bindings and detailed binding status for known conversations", async () => {
    const context = createTempContext();
    context.semanticEvents.insert(event);
    const session = context.sessions.getOrCreateActiveSession({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    context.sessions.updateCodexSessionId(session.id, "thread_1");
    const job = context.jobs.createQueuedJob({
      sessionRecordId: session.id,
      semanticEventId: event.id,
      openimConversationId: event.openimConversationId,
      inputText: "hello",
      codexSessionIdBefore: "thread_1"
    });
    context.jobs.markSucceeded(job.id, {
      outputText: "done",
      codexSessionIdAfter: "thread_1",
      finishedAt: 3000
    });

    const app = await createServer(context, pino({ level: "silent" }));

    const bindings = await app.inject({ method: "GET", url: "/api/bindings" });
    expect(bindings.statusCode).toBe(200);
    expect(bindings.json()).toMatchObject({
      bindings: [
        {
          openimConversationId: event.openimConversationId,
          openimDisplayUserId: "user_1",
          activeSessionRecordId: session.id,
          codexSessionId: "thread_1",
          latestJobId: job.id,
          latestJobStatus: "succeeded"
        }
      ]
    });

    const detail = await app.inject({
      method: "GET",
      url: `/api/bindings/${encodeURIComponent(event.openimConversationId)}`
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json()).toMatchObject({
      openimConversationId: event.openimConversationId,
      activeSession: { id: session.id, codexSessionId: "thread_1" },
      recentJobs: [{ id: job.id, status: "succeeded" }]
    });

    await app.close();
    context.db.close();
  });

  it("returns unknown state for missing conversation status and 404 for missing binding", async () => {
    const context = createTempContext();
    const app = await createServer(context, pino({ level: "silent" }));

    const status = await app.inject({
      method: "GET",
      url: "/api/conversations/missing/status"
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toEqual({
      openimConversationId: "missing",
      state: "unknown",
      activeSession: null,
      activeJob: null,
      latestJob: null,
      recentJobs: []
    });

    const binding = await app.inject({
      method: "GET",
      url: "/api/bindings/missing"
    });
    expect(binding.statusCode).toBe(404);

    await app.close();
    context.db.close();
  });

  it("cancels a queued job through the jobs API", async () => {
    const context = createTempContext();
    context.semanticEvents.insert(event);
    const session = context.sessions.getOrCreateActiveSession({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    const job = context.jobs.createQueuedJob({
      sessionRecordId: session.id,
      semanticEventId: event.id,
      openimConversationId: event.openimConversationId,
      inputText: "hello",
      codexSessionIdBefore: null
    });

    const app = await createServer(context, pino({ level: "silent" }));
    const cancel = await app.inject({ method: "POST", url: `/api/jobs/${job.id}/cancel` });

    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toMatchObject({
      id: job.id,
      status: "cancelled",
      cancelMethod: "api"
    });

    await app.close();
    context.db.close();
  });

  it("cancels a running job through the worker cancel handle", async () => {
    let jobId: string | null = null;
    let cancelCalls = 0;
    let resolveRun: ((result: CodexRunResult) => void) | null = null;
    const sentTexts: string[] = [];
    const codex: CodexCliAdapter = {
      runNewTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" }),
      resumeTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" }),
      runNewTaskCancellable: (): CodexRunHandle => ({
        pid: 1234,
        promise: new Promise<CodexRunResult>((resolve) => {
          resolveRun = resolve;
        }),
        cancel: async () => {
          cancelCalls += 1;
          resolveRun?.({
            ok: false,
            outputText: "",
            rawOutput: "",
            errorText: "Codex CLI run cancelled (api)",
            exitCode: null,
            cancelled: true
          });
        }
      })
    };
    const context = createTempContext({
      codex,
      openimSender: {
        sendBotText: async (message) => {
          sentTexts.push(message.text);
        }
      }
    });
    const app = await createServer(context, pino({ level: "silent" }));

    const webhook = await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-single-msg",
      payload: {
        sendID: "user_1",
        recvID: "codex_bot",
        conversationID: event.openimConversationId,
        contentType: 101,
        content: JSON.stringify({ content: "please run a long task" })
      }
    });
    expect(webhook.statusCode).toBe(200);
    jobId = webhook.json().data.jobId;
    await waitFor(() => context.jobs.getById(jobId!)?.status === "running");

    const cancel = await app.inject({ method: "POST", url: `/api/jobs/${jobId}/cancel` });
    expect(cancel.statusCode).toBe(200);
    expect(cancel.json()).toMatchObject({ id: jobId, status: "cancelling", cancelMethod: "api" });
    await waitFor(() => context.jobs.getById(jobId!)?.status === "cancelled");

    expect(cancelCalls).toBe(1);
    expect(context.jobs.getById(jobId!)).toMatchObject({
      status: "cancelled",
      cancelMethod: "api",
      errorText: "Codex CLI run cancelled (api)"
    });
    expect(sentTexts).toContain("Codex job was cancelled.");

    await app.close();
    context.db.close();
  });

  it("rebinds and archives a conversation binding", async () => {
    const context = createTempContext();
    context.semanticEvents.insert(event);
    const original = context.sessions.getOrCreateActiveSession({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    context.sessions.updateCodexSessionId(original.id, "thread_original");
    const app = await createServer(context, pino({ level: "silent" }));

    const rebind = await app.inject({
      method: "POST",
      url: `/api/bindings/${encodeURIComponent(event.openimConversationId)}/rebind`,
      payload: {
        codexProjectPath: "/workspace/other",
        codexSessionId: "thread_manual"
      }
    });
    expect(rebind.statusCode).toBe(201);
    expect(rebind.json()).toMatchObject({
      openimConversationId: event.openimConversationId,
      activeSession: {
        codexProjectPath: "/workspace/other",
        codexSessionId: "thread_manual",
        parentSessionRecordId: original.id,
        forkedFromCodexSessionId: "thread_original",
        createdReason: "manual_rebind"
      }
    });

    const archive = await app.inject({
      method: "POST",
      url: `/api/bindings/${encodeURIComponent(event.openimConversationId)}/archive`
    });
    expect(archive.statusCode).toBe(200);
    expect(archive.json()).toMatchObject({
      openimConversationId: event.openimConversationId,
      archivedSession: { status: "archived", isActive: false },
      activeSession: null
    });

    const status = await app.inject({
      method: "GET",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/status`
    });
    expect(status.json()).toMatchObject({
      openimConversationId: event.openimConversationId,
      state: "unknown",
      activeSession: null
    });

    await app.close();
    context.db.close();
  });

  it("rejects rebind and archive while a job is active", async () => {
    const context = createTempContext();
    context.semanticEvents.insert(event);
    const session = context.sessions.getOrCreateActiveSession({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    context.jobs.createQueuedJob({
      sessionRecordId: session.id,
      semanticEventId: event.id,
      openimConversationId: event.openimConversationId,
      inputText: "queued",
      codexSessionIdBefore: null
    });
    const app = await createServer(context, pino({ level: "silent" }));

    const rebind = await app.inject({
      method: "POST",
      url: `/api/bindings/${encodeURIComponent(event.openimConversationId)}/rebind`,
      payload: { codexProjectPath: "/workspace/other" }
    });
    expect(rebind.statusCode).toBe(409);
    expect(rebind.json()).toMatchObject({ error: "active job exists" });

    const archive = await app.inject({
      method: "POST",
      url: `/api/bindings/${encodeURIComponent(event.openimConversationId)}/archive`
    });
    expect(archive.statusCode).toBe(409);
    expect(archive.json()).toMatchObject({ error: "active job exists" });

    await app.close();
    context.db.close();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
