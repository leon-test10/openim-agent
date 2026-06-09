import { mkdtempSync } from "node:fs";
import { mkdirSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import pino from "pino";
import { openDatabase } from "../../src/storage/db.js";
import { SemanticEventRepository } from "../../src/core/semantic-event.repository.js";
import { ConversationSummaryRepository } from "../../src/core/conversation-summary.repository.js";
import { SessionBindingRepository } from "../../src/core/session-binding.repository.js";
import { RuntimeJobRepository } from "../../src/core/runtime-job.repository.js";
import { RuntimeEventRepository } from "../../src/core/runtime-event.repository.js";
import { RuntimeProfileRepository } from "../../src/core/runtime-profile.repository.js";
import { OpenImHistoryRepository } from "../../src/core/openim-history.repository.js";
import { ConversationEventBus } from "../../src/core/conversation-event-bus.js";
import { createServer } from "../../src/server.js";
import type { AppContext } from "../../src/app-context.js";
import type { SemanticEvent } from "../../src/core/semantic-event.js";
import type { CodexCliAdapter, CodexResumeInput, CodexRunHandle, CodexRunInput, CodexRunResult } from "../../src/adapters/codex/codex-types.js";

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
  const config = {
    PORT: 8787,
    OPENIM_API_BASE_URL: "http://127.0.0.1:10002",
    OPENIM_ADMIN_USER_ID: "imAdmin",
    OPENIM_ADMIN_SECRET: "openIM123",
    OPENIM_ADMIN_TOKEN: "",
    OPENIM_BOT_USER_ID: "codex_bot",
    OPENIM_GROUP_BOT_ENABLED: false,
    OPENIM_GROUP_ALLOWLIST: "",
    OPENIM_GROUP_SENDER_ALLOWLIST: "",
    OPENIM_GROUP_REQUIRE_BINDING: false,
    OPENIM_GROUP_PROJECT_BINDINGS: "",
    OPENIM_GROUP_AUTO_REPLY_POLICY: "mention_or_reply" as const,
    RUNTIME_DEFAULT_KIND: "codex_cli" as const,
    CODEX_BIN: "codex",
    CODEX_DEFAULT_PROJECT_PATH: "/workspace/demo",
    CODEX_DEFAULT_MODEL: "",
    CODEX_EXEC_TIMEOUT_MS: 600000,
    CODEX_SESSION_HOME_ROOT: join(dir, "codex-homes"),
    CODEX_SESSION_HOME_MODE: "per-session" as const,
    CODEX_SESSION_HOME_SEED_MODE: "copy-auth-only" as const,
    CODEX_BASE_HOME: "",
    CODEX_SANDBOX_MODE: "",
    CODEX_WORKSPACE_ALLOWLIST: "/workspace/demo;/workspace/new;/workspace/other",
    CODEX_RUNTIME_ADMIN_TOKEN: "",
    OPENAI_COMPATIBLE_BASE_URL: "http://127.0.0.1:8000/v1",
    OPENAI_COMPATIBLE_API_KEY: "dummy",
    OPENAI_COMPATIBLE_MODEL: "test-model",
    OPENAI_COMPATIBLE_TIMEOUT_MS: 120000,
    OPENAI_COMPATIBLE_TEMPERATURE: 0.2,
    OPENAI_COMPATIBLE_MAX_TOKENS: 2048,
    OPENHANDS_BASE_URL: "http://127.0.0.1:3000",
    OPENHANDS_API_KEY: "",
    OPENHANDS_TIMEOUT_MS: 600000,
    CONTEXT_RECENT_EVENT_LIMIT: 30,
    CONTEXT_AUTO_SUMMARY_ENABLED: false,
    CONTEXT_SUMMARY_EVENT_THRESHOLD: 120,
    BRIDGE_SECRET_KEY: "0123456789abcdef0123456789abcdef",
    DATABASE_URL: `file:${join(dir, "bridge.sqlite")}`,
    LOG_LEVEL: "silent",
    NODE_ENV: "development"
  };
  return {
    config,
    db,
    semanticEvents: new SemanticEventRepository(db),
    conversationSummaries: new ConversationSummaryRepository(db),
    sessions: new SessionBindingRepository(db, {
      codexSessionHomeMode: config.CODEX_SESSION_HOME_MODE,
      codexSessionHomeRoot: config.CODEX_SESSION_HOME_ROOT,
      codexHomeSeedMode: config.CODEX_SESSION_HOME_SEED_MODE,
      sandboxMode: config.CODEX_SANDBOX_MODE
    }),
    jobs: new RuntimeJobRepository(db),
    runtimeEvents: new RuntimeEventRepository(db),
    runtimeProfiles: new RuntimeProfileRepository(db, config.BRIDGE_SECRET_KEY),
    openimHistory: new OpenImHistoryRepository(db),
    conversationEvents: new ConversationEventBus(),
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
  it("exposes bridge metadata and capabilities", async () => {
    const context = createTempContext();
    const app = await createServer(context, pino({ level: "silent" }));

    const meta = await app.inject({ method: "GET", url: "/api/meta" });
    expect(meta.statusCode).toBe(200);
    expect(meta.json()).toMatchObject({
      name: "openim-codex-bridge",
      capabilities: {
        sessionMetadata: true,
        sessionActivate: true,
        sessionRename: true,
        sessionArchive: true,
        runtimeApi: true,
        codexLegacyApi: true
      }
    });

    const health = await app.inject({ method: "GET", url: "/healthz" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toMatchObject({ ok: true, apiVersion: "2026-06-06.phase3i" });

    const preflight = await app.inject({
      method: "OPTIONS",
      url: "/api/conversations/single%3Acodex_bot%3Auser_1/codex-sessions/csr_1",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "PATCH"
      }
    });
    expect(preflight.statusCode).toBe(204);
    expect(preflight.headers["access-control-allow-methods"]).toContain("PATCH");

    await app.close();
    context.db.close();
  });

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
      latestJob: { id: job.id, status: "succeeded", canRetry: false, canCancel: false, totalDurationMs: null },
      recentJobs: [{ id: job.id, status: "succeeded", canRetry: false }]
    });

    const runtimeStatus = await app.inject({
      method: "GET",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/runtime-status`
    });
    expect(runtimeStatus.statusCode).toBe(200);
    expect(runtimeStatus.json()).toMatchObject({
      openimConversationId: event.openimConversationId,
      runtimeKind: "codex_cli",
      state: "completed",
      activeSession: {
        id: session.id,
        runtimeKind: "codex_cli",
        externalSessionId: "thread_1",
        projectPath: "/workspace/demo",
        legacyCodex: { codexSessionId: "thread_1" }
      },
      latestJob: {
        id: job.id,
        runtimeKind: "codex_cli",
        status: "succeeded",
        externalSessionIdBefore: "thread_1",
        externalSessionIdAfter: "thread_1"
      },
      recentJobs: [{ id: job.id, runtimeKind: "codex_cli", status: "succeeded" }]
    });

    const runtimeJob = await app.inject({
      method: "GET",
      url: `/api/runtime/jobs/${job.id}`
    });
    expect(runtimeJob.statusCode).toBe(200);
    expect(runtimeJob.json()).toMatchObject({
      id: job.id,
      runtimeKind: "codex_cli",
      externalSessionIdBefore: "thread_1",
      externalSessionIdAfter: "thread_1"
    });

    const legacyEvents = await app.inject({ method: "GET", url: `/api/jobs/${job.id}/events` });
    const runtimeEvents = await app.inject({ method: "GET", url: `/api/runtime/jobs/${job.id}/events` });
    expect(runtimeEvents.statusCode).toBe(200);
    expect(runtimeEvents.json()).toMatchObject({
      jobId: job.id,
      runtimeKind: "codex_cli",
      events: legacyEvents.json().events
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
      recentJobs: [],
      queuedJobCount: 0,
      pendingHistoryImport: null
    });

    const runtimeStatus = await app.inject({
      method: "GET",
      url: "/api/conversations/missing/runtime-status"
    });
    expect(runtimeStatus.statusCode).toBe(200);
    expect(runtimeStatus.json()).toMatchObject({
      openimConversationId: "missing",
      runtimeKind: "codex_cli",
      state: "unknown",
      activeSession: null,
      activeJob: null,
      latestJob: null,
      recentJobs: [],
      queuedJobCount: 0
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

  it("creates, activates, renames, and archives session records", async () => {
    const context = createTempContext();
    context.semanticEvents.insert(event);
    const original = context.sessions.getOrCreateActiveSession({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo",
      displayName: "Original session"
    });
    const app = await createServer(context, pino({ level: "silent" }));

    const created = await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions`,
      payload: {
        openimDisplayUserId: "user_1",
        codexProjectPath: "/workspace/new",
        displayName: "Investigate startup failure"
      }
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json();
    expect(createdBody).toMatchObject({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/new",
      displayName: "Investigate startup failure",
      displayNameSource: "auto",
      isActive: true,
      status: "active"
    });
    expect(context.sessions.getById(original.id)?.isActive).toBe(false);

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions/${createdBody.id}`,
      payload: { displayName: "Startup failure triage" }
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({
      id: createdBody.id,
      displayName: "Startup failure triage",
      displayNameSource: "manual"
    });

    const archived = await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions/${createdBody.id}/archive`
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({
      id: createdBody.id,
      isActive: false,
      status: "archived"
    });

    const sessions = await app.inject({
      method: "GET",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions`
    });
    expect(sessions.statusCode).toBe(200);
    expect(sessions.json().sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: createdBody.id,
          displayName: "Startup failure triage",
          displayNameSource: "manual",
          status: "archived"
        })
      ])
    );

    await app.close();
    context.db.close();
  });

  it("exposes runtime session lifecycle aliases without breaking legacy session records", async () => {
    const context = createTempContext();
    context.semanticEvents.insert(event);
    const original = context.sessions.getOrCreateActiveSession({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo",
      displayName: "Original session"
    });
    const app = await createServer(context, pino({ level: "silent" }));

    const created = await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/runtime-sessions`,
      payload: {
        openimDisplayUserId: "user_1",
        projectPath: "/workspace/new",
        displayName: "Runtime facade session"
      }
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json();
    expect(createdBody).toMatchObject({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: "user_1",
      runtimeKind: "codex_cli",
      projectPath: "/workspace/new",
      legacyCodex: { codexProjectPath: "/workspace/new" },
      isActive: true,
      status: "active"
    });
    expect(context.sessions.getById(original.id)?.isActive).toBe(false);

    const renamed = await app.inject({
      method: "PATCH",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/runtime-sessions/${createdBody.id}`,
      payload: { displayName: "Runtime facade renamed" }
    });
    expect(renamed.statusCode).toBe(200);
    expect(renamed.json()).toMatchObject({
      id: createdBody.id,
      runtimeKind: "codex_cli",
      displayName: "Runtime facade renamed"
    });

    const listed = await app.inject({
      method: "GET",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/runtime-sessions`
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toMatchObject({
      conversationId: event.openimConversationId,
      runtimeKind: "codex_cli"
    });
    expect(listed.json().sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: createdBody.id, runtimeKind: "codex_cli", projectPath: "/workspace/new" }),
        expect.objectContaining({ id: original.id, runtimeKind: "codex_cli", projectPath: "/workspace/demo" })
      ])
    );

    const archived = await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/runtime-sessions/${createdBody.id}/archive`
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({
      id: createdBody.id,
      runtimeKind: "codex_cli",
      isActive: false,
      status: "archived"
    });

    const legacySessions = await app.inject({
      method: "GET",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions`
    });
    expect(legacySessions.statusCode).toBe(200);
    expect(legacySessions.json().sessions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: createdBody.id, codexProjectPath: "/workspace/new", status: "archived" })
      ])
    );

    await app.close();
    context.db.close();
  });

  it("restores and soft-deletes session records through the sessions API", async () => {
    const context = createTempContext();
    const session = context.sessions.getOrCreateActiveSession({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo",
      displayName: "Restorable"
    });
    context.sessions.archiveSession(event.openimConversationId, session.id);
    const app = await createServer(context, pino({ level: "silent" }));

    const restored = await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions/${session.id}/restore`
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json()).toMatchObject({ id: session.id, status: "active", isActive: false });

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions/${session.id}`
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json()).toMatchObject({ id: session.id, status: "deleted", isActive: false });

    const visible = await app.inject({
      method: "GET",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions`
    });
    expect(visible.json().sessions).toHaveLength(0);

    const withDeleted = await app.inject({
      method: "GET",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions?includeDeleted=true`
    });
    expect(withDeleted.json().sessions).toEqual([
      expect.objectContaining({ id: session.id, status: "deleted" })
    ]);

    await app.close();
    context.db.close();
  });

  it("creates, masks, updates, tests, and deletes runtime profiles", async () => {
    const context = createTempContext();
    const app = await createServer(context, pino({ level: "silent" }));

    const created = await app.inject({
      method: "POST",
      url: "/api/runtime-profiles",
      payload: {
        name: "OpenAI compatible",
        providerType: "openai-compatible",
        model: "codex-mini-latest",
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        codexProfile: "dev",
        baseUrl: "https://example.test/v1",
        apiKey: "sk-live-123456"
      }
    });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({
      name: "OpenAI compatible",
      providerType: "openai-compatible",
      model: "codex-mini-latest",
      apiKeyMasked: "sk-l...3456"
    });
    expect(created.json().apiKey).toBeUndefined();

    const list = await app.inject({ method: "GET", url: "/api/runtime-profiles" });
    expect(list.statusCode).toBe(200);
    expect(list.json().profiles).toEqual([
      expect.objectContaining({ id: created.json().id, apiKeyMasked: "sk-l...3456" })
    ]);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/runtime-profiles/${created.json().id}`,
      payload: { name: "Renamed profile", model: "gpt-5" }
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ name: "Renamed profile", model: "gpt-5" });

    const test = await app.inject({
      method: "POST",
      url: `/api/runtime-profiles/${created.json().id}/test`,
      payload: {
        upstreamProbe: false,
        codexProbe: false
      }
    });
    expect(test.statusCode).toBe(200);
    expect(test.json()).toMatchObject({
      ok: true,
      profile: { id: created.json().id, apiKeyMasked: "sk-l...3456" },
      upstreamProbe: { ok: false, skipped: true },
      codexProbe: {
        ok: true,
        skipped: true,
        codexArgs: expect.arrayContaining(["--model", "gpt-5", "--profile", "dev"])
      }
    });
    expect(test.json().codexProbe.env.OPENAI_API_KEY).toBe("****");

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/runtime-profiles/${created.json().id}`
    });
    expect(deleted.statusCode).toBe(200);
    expect(deleted.json()).toMatchObject({ status: "deleted" });

    await app.close();
    context.db.close();
  });

  it("enforces production runtime profile permissions server-side", async () => {
    const context = createTempContext();
    context.config.NODE_ENV = "production";
    context.config.CODEX_RUNTIME_ADMIN_TOKEN = "admin-token";
    const app = await createServer(context, pino({ level: "silent" }));

    const denied = await app.inject({
      method: "POST",
      url: "/api/runtime-profiles",
      payload: {
        name: "Unsafe production profile",
        sandboxMode: "danger-full-access",
        codexHomeOverride: "/tmp/codex-home"
      }
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toMatchObject({
      error: "runtime_profile_admin_required"
    });

    const safe = await app.inject({
      method: "POST",
      url: "/api/runtime-profiles",
      headers: { "x-codex-admin-token": "admin-token" },
      payload: {
        name: "Admin profile",
        sandboxMode: "danger-full-access",
        codexHomeOverride: "/tmp/codex-home",
        apiKey: "sk-prod-hidden"
      }
    });
    expect(safe.statusCode).toBe(201);
    expect(safe.json()).toMatchObject({
      name: "Admin profile",
      sandboxMode: "danger-full-access",
      codexHomeOverride: "/tmp/codex-home",
      apiKeyMasked: "sk-p...dden"
    });
    expect(safe.json().apiKey).toBeUndefined();

    const visibleWithoutAdmin = await app.inject({ method: "GET", url: "/api/runtime-profiles" });
    expect(visibleWithoutAdmin.json().profiles[0]).toMatchObject({
      id: safe.json().id,
      codexHomeOverride: null,
      apiKeyMasked: "sk-p...dden"
    });
    expect(visibleWithoutAdmin.json().profiles[0].apiKey).toBeUndefined();

    await app.close();
    context.db.close();
  });

  it("rejects project paths outside the configured allowlist and reports diagnostics", async () => {
    const context = createTempContext();
    const app = await createServer(context, pino({ level: "silent" }));

    const rejected = await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions`,
      payload: {
        openimDisplayUserId: "user_1",
        codexProjectPath: "/etc"
      }
    });
    expect(rejected.statusCode).toBe(400);
    expect(rejected.json()).toMatchObject({
      error: "project_path_not_allowed",
      diagnostics: {
        requestedPath: "/etc",
        normalizedPath: "/etc",
        reason: "outside_allowlist"
      }
    });

    const escaped = await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions`,
      payload: {
        openimDisplayUserId: "user_1",
        codexProjectPath: "/workspace/demo/../secret"
      }
    });
    expect(escaped.statusCode).toBe(400);
    expect(escaped.json()).toMatchObject({
      diagnostics: { reason: "contains_parent_segment" }
    });

    await app.close();
    context.db.close();
  });

  it("publishes conversation-level events for history, job, runtime, and session changes", async () => {
    const seen: string[] = [];
    const context = createTempContext({
      codex: {
        runNewTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" }),
        resumeTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" }),
        runNewTaskCancellable: (input): CodexRunHandle => {
          input.onEvent?.({ type: "agent_message", message: "event stream visible" });
          return {
            pid: 1234,
            promise: Promise.resolve({
              ok: true,
              sessionId: "thread_stream",
              outputText: "done",
              rawOutput: ""
            }),
            cancel: async () => undefined
          };
        }
      }
    });
    context.conversationEvents!.subscribe(event.openimConversationId, (streamEvent) => {
      seen.push(streamEvent.type);
    });
    const app = await createServer(context, pino({ level: "silent" }));

    await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-single-msg",
      payload: {
        sendID: "user_1",
        recvID: "codex_bot",
        conversationID: event.openimConversationId,
        contentType: 101,
        content: JSON.stringify({ content: "/load_history 10" })
      }
    });
    const webhook = await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-single-msg",
      payload: {
        sendID: "user_1",
        recvID: "codex_bot",
        conversationID: event.openimConversationId,
        contentType: 101,
        content: JSON.stringify({ content: "please run" })
      }
    });
    const jobId = webhook.json().data.jobId as string;
    await waitFor(() => context.jobs.getById(jobId)?.status === "succeeded");

    expect(seen).toEqual(
      expect.arrayContaining([
        "history_import_requested",
        "session_changed",
        "job_created",
        "job_queued",
        "job_started",
        "runtime_event",
        "job_succeeded"
      ])
    );

    await app.close();
    context.db.close();
  });

  it("reports session resume diagnostics including rollout availability", async () => {
    const context = createTempContext();
    const app = await createServer(context, pino({ level: "silent" }));
    const session = context.sessions.getOrCreateActiveSession({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    context.sessions.updateCodexSessionId(session.id, "thread_ready");
    const withRuntime = context.sessions.ensureRuntimeFields(session.id)!;
    const rolloutDir = join(withRuntime.codexHomeDir!, "sessions", "2026", "06", "06");
    mkdirSync(rolloutDir, { recursive: true });
    writeFileSync(join(rolloutDir, "rollout-2026-06-06T00-00-00-thread_ready.jsonl"), "{}\n");

    const diagnostics = await app.inject({
      method: "GET",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions/${session.id}/diagnostics`
    });
    expect(diagnostics.statusCode).toBe(200);
    expect(diagnostics.json()).toMatchObject({
      sessionRecordId: session.id,
      codexSessionId: "thread_ready",
      homeExists: true,
      rolloutExists: true,
      resumeReady: true,
      lastJobId: null,
      lastResumeFailure: null
    });

    const created = await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions`,
      payload: { openimDisplayUserId: "user_1", codexProjectPath: "/workspace/demo" }
    });
    const missing = await app.inject({
      method: "GET",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions/${created.json().id}/diagnostics`
    });
    expect(missing.statusCode).toBe(200);
    expect(missing.json()).toMatchObject({
      codexSessionId: null,
      rolloutExists: false,
      resumeReady: false
    });

    await app.close();
    context.db.close();
  });

  it("treats load-history text commands as history import requests instead of Codex jobs", async () => {
    const sentTexts: string[] = [];
    const context = createTempContext({
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
        content: JSON.stringify({ content: "/load_history 80" })
      }
    });
    expect(webhook.statusCode).toBe(200);
    expect(webhook.json()).toMatchObject({
      data: { ignored: false, command: "load_history", requestedCount: 80 }
    });
    expect(context.jobs.listRecentByConversationId(event.openimConversationId)).toHaveLength(0);
    expect(sentTexts[0]).toContain("OpenIM history import requested");

    const status = await app.inject({
      method: "GET",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/status`
    });
    expect(status.json()).toMatchObject({
      pendingHistoryImport: {
        openimConversationId: event.openimConversationId,
        requestedCount: 80,
        status: "pending"
      }
    });

    const snapshot = await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/openim-history-snapshots`,
      payload: {
        requestId: status.json().pendingHistoryImport.id,
        messages: [
          { clientMsgID: "m1", sendID: "user_1", senderNickname: "User", contentType: 101, text: "remember phase four context", sendTime: 1000 },
          { clientMsgID: "m2", sendID: "codex_bot", senderNickname: "Codex", contentType: 101, text: "assistant context", sendTime: 2000, ex: { agent: { generated_by: "codex" } } },
          { clientMsgID: "m3", sendID: "user_1", senderNickname: "User", contentType: 102, preview: "image", sendTime: 3000 }
        ]
      }
    });
    expect(snapshot.statusCode).toBe(201);
    expect(snapshot.json()).toMatchObject({
      messageCount: 3,
      receivedCount: 3,
      importedCount: 2,
      skippedUnsupportedCount: 1
    });

    const duplicate = await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/openim-history-snapshots`,
      payload: {
        messages: [
          { clientMsgID: "m1", sendID: "user_1", senderNickname: "User", contentType: 101, text: "remember phase four context", sendTime: 1000 }
        ]
      }
    });
    expect(duplicate.statusCode).toBe(201);
    expect(duplicate.json()).toMatchObject({ importedCount: 0, skippedDuplicateCount: 1 });

    const semanticEvents = await app.inject({
      method: "GET",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/semantic-events`
    });
    expect(semanticEvents.statusCode).toBe(200);
    expect(semanticEvents.json().events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: "user", actorType: "human", text: "remember phase four context" }),
        expect.objectContaining({ role: "assistant", actorType: "codex_bot", text: "assistant context" })
      ])
    );

    const summary = await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/context/summarize?recentLimit=1`
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().summary.coveredEventIDs.length).toBeGreaterThan(0);

    const preview = await app.inject({
      method: "GET",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/context/preview?includePrompt=true`
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      conversationID: event.openimConversationId,
      summaryIncluded: true,
      recentEventCount: 3,
      roleCounts: { user: 2, assistant: 1 },
      promptRedacted: true
    });
    expect(preview.json().promptPreview).toContain("Recent OpenIM messages:");

    await app.close();
    context.db.close();
  });

  it("returns structured session API errors", async () => {
    const context = createTempContext();
    context.semanticEvents.insert(event);
    const session = context.sessions.getOrCreateActiveSession({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    const app = await createServer(context, pino({ level: "silent" }));

    const rename = await app.inject({
      method: "PATCH",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions/${session.id}`,
      payload: {}
    });
    expect(rename.statusCode).toBe(400);
    expect(rename.json()).toMatchObject({
      error: "display_name_required",
      message: "displayName is required."
    });

    const activateMissing = await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions/missing/activate`,
      payload: {}
    });
    expect(activateMissing.statusCode).toBe(404);
    expect(activateMissing.json()).toMatchObject({
      error: "session_not_found",
      message: "Session record not found."
    });

    context.jobs.createQueuedJob({
      sessionRecordId: session.id,
      semanticEventId: event.id,
      openimConversationId: event.openimConversationId,
      inputText: "queued",
      codexSessionIdBefore: null
    });
    const created = context.sessions.createAdditionalSession({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    const activateBlocked = await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/codex-sessions/${created.id}/activate`,
      payload: {}
    });
    expect(activateBlocked.statusCode).toBe(409);
    expect(activateBlocked.json()).toMatchObject({
      error: "active_job_exists"
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
    expect(rebind.json()).toMatchObject({ error: "active_job_exists" });

    const archive = await app.inject({
      method: "POST",
      url: `/api/bindings/${encodeURIComponent(event.openimConversationId)}/archive`
    });
    expect(archive.statusCode).toBe(409);
    expect(archive.json()).toMatchObject({ error: "active_job_exists" });

    await app.close();
    context.db.close();
  });

  it("returns queued job counts and runtime events for active conversations", async () => {
    const context = createTempContext();
    context.semanticEvents.insert(event);
    const session = context.sessions.getOrCreateActiveSession({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    const running = context.jobs.createQueuedJob({
      sessionRecordId: session.id,
      semanticEventId: event.id,
      openimConversationId: event.openimConversationId,
      inputText: "running",
      codexSessionIdBefore: null
    });
    context.jobs.markRunning(running.id, 2000);
    context.jobs.createQueuedJob({
      sessionRecordId: session.id,
      semanticEventId: event.id,
      openimConversationId: event.openimConversationId,
      inputText: "queued one",
      codexSessionIdBefore: null
    });
    context.jobs.createQueuedJob({
      sessionRecordId: session.id,
      semanticEventId: event.id,
      openimConversationId: event.openimConversationId,
      inputText: "queued two",
      codexSessionIdBefore: null
    });
    context.runtimeEvents.recordCodexJsonEvent({
      jobId: running.id,
      sessionRecordId: session.id,
      openimConversationId: event.openimConversationId,
      eventType: "tool.call",
      rawEvent: { type: "tool.call", name: "shell", command: "pwd" }
    });
    const app = await createServer(context, pino({ level: "silent" }));

    const status = await app.inject({
      method: "GET",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/status`
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      state: "running",
      queuedJobCount: 2,
      activeJob: { id: running.id, status: "running" }
    });

    const events = await app.inject({
      method: "GET",
      url: `/api/jobs/${running.id}/events`
    });
    expect(events.statusCode).toBe(200);
    expect(events.json()).toMatchObject({
      events: [
        {
          jobId: running.id,
          sequence: 1,
          eventType: "tool.call",
          rawEvent: { type: "tool.call", name: "shell", command: "pwd" }
        }
      ]
    });

    await app.close();
    context.db.close();
  });

  it("records failure reasons and retries terminal jobs", async () => {
    let runCount = 0;
    const sentTexts: string[] = [];
    const codex: CodexCliAdapter = {
      runNewTask: async () => {
        runCount += 1;
        if (runCount === 1) {
          return {
            ok: false,
            outputText: "",
            rawOutput: "",
            errorText: "mock timeout",
            exitCode: null,
            timedOut: true
          };
        }
        return {
          ok: true,
          sessionId: "thread_retry",
          outputText: "retry ok",
          rawOutput: ""
        };
      },
      resumeTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" })
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
        content: JSON.stringify({ content: "please run" })
      }
    });
    const sourceJobId = webhook.json().data.jobId as string;
    await waitFor(() => context.jobs.getById(sourceJobId)?.status === "failed");
    expect(context.jobs.getById(sourceJobId)).toMatchObject({
      status: "failed",
      failureReason: "timeout",
      errorText: "mock timeout"
    });
    expect(sentTexts).toContain("Runtime failed: mock timeout");

    const status = await app.inject({
      method: "GET",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/status`
    });
    expect(status.json()).toMatchObject({
      state: "failed",
      latestJob: {
        id: sourceJobId,
        status: "failed",
        failureReason: "timeout",
        canRetry: true,
        canCancel: false
      }
    });

    const retry = await app.inject({ method: "POST", url: `/api/jobs/${sourceJobId}/retry` });
    expect(retry.statusCode).toBe(201);
    const retryJobId = retry.json().id as string;
    expect(retry.json()).toMatchObject({
      status: "queued",
      retryOfJobId: sourceJobId,
      inputText: "please run"
    });
    await waitFor(() => context.jobs.getById(retryJobId)?.status === "succeeded");
    expect(context.jobs.getById(retryJobId)).toMatchObject({
      status: "succeeded",
      retryOfJobId: sourceJobId,
      outputText: "retry ok",
      codexSessionIdAfter: "thread_retry"
    });

    await app.close();
    context.db.close();
  });

  it("records Codex adapter runtime events while a webhook job runs", async () => {
    let capturedInput: CodexRunInput | null = null;
    const codex: CodexCliAdapter = {
      runNewTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" }),
      resumeTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" }),
      runNewTaskCancellable: (input): CodexRunHandle => {
        capturedInput = input;
        input.onEvent?.({ type: "agent_message", message: "thinking visibly" });
        input.onEvent?.({
          type: "item.started",
          item: { type: "tool_call", name: "shell", command: "git status --short" }
        });
        return {
          pid: 1234,
          promise: Promise.resolve({
            ok: true,
            sessionId: "thread_events",
            outputText: "done",
            rawOutput: ""
          }),
          cancel: async () => undefined
        };
      }
    };
    const context = createTempContext({ codex });
    const app = await createServer(context, pino({ level: "silent" }));

    await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/openim-history-snapshots`,
      payload: {
        messages: [
          { clientMsgID: "history_1", sendID: "user_1", senderNickname: "User", contentType: 101, text: "prior semantic instruction", sendTime: 1000 },
          { clientMsgID: "history_2", sendID: "codex_bot", senderNickname: "Codex", contentType: 101, text: "prior assistant answer", sendTime: 2000, ex: { agent: { generated_by: "codex" } } }
        ]
      }
    });

    const webhook = await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-single-msg",
      payload: {
        sendID: "user_1",
        recvID: "codex_bot",
        conversationID: event.openimConversationId,
        contentType: 101,
        content: JSON.stringify({ content: "please inspect status" })
      }
    });
    const jobId = webhook.json().data.jobId as string;
    await waitFor(() => context.jobs.getById(jobId)?.status === "succeeded");

    const runtimeEvents = context.runtimeEvents.listByJobId(jobId);
    expect(runtimeEvents.map((runtimeEvent) => runtimeEvent.eventType)).toEqual(
      expect.arrayContaining([
        "bridge.webhook_received",
        "bridge.worker_started",
        "codex.first_event",
        "agent_message",
        "item.started",
        "codex.process_spawned",
        "codex.process_completed",
        "openim.reply_started",
        "openim.reply_completed"
      ])
    );
    expect(runtimeEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "agent_message",
          title: "agent_message",
          summary: "thinking visibly"
        }),
        expect.objectContaining({
          eventType: "item.started",
          title: "tool_call",
          summary: "shell: git status --short"
        })
      ])
    );
    expect(capturedInput?.codexHomeDir).toContain("codex-homes");
    expect(capturedInput?.prompt).toContain("Recent OpenIM messages:");
    expect(capturedInput?.prompt).toContain("Human(User): prior semantic instruction");
    expect(capturedInput?.prompt).toContain("Assistant(Codex): prior assistant answer");
    expect(capturedInput?.prompt).toContain("Current user message:\nplease inspect status");
    expect(context.semanticEvents.listByConversationId(event.openimConversationId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: "prior semantic instruction",
          deliveredJobId: jobId,
          deliveredSessionRecordId: expect.any(String),
          deliveryReason: "new_codex_session"
        })
      ])
    );

    await app.close();
    context.db.close();
  });

  it("resumes an existing Codex session with only the current user message by default", async () => {
    let capturedInput: CodexResumeInput | null = null;
    const codex: CodexCliAdapter = {
      runNewTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" }),
      resumeTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" }),
      resumeTaskCancellable: (input): CodexRunHandle => {
        capturedInput = input;
        return {
          pid: 1234,
          promise: Promise.resolve({
            ok: true,
            sessionId: "thread_1",
            outputText: "resume ok",
            rawOutput: ""
          }),
          cancel: async () => undefined
        };
      }
    };
    const context = createTempContext({ codex });
    context.semanticEvents.insert(event);
    const session = context.sessions.getOrCreateActiveSession({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    context.sessions.updateCodexSessionId(session.id, "thread_1");
    const app = await createServer(context, pino({ level: "silent" }));

    await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(event.openimConversationId)}/openim-history-snapshots`,
      payload: {
        messages: [
          {
            clientMsgID: "delivered_history",
            sendID: "user_1",
            senderNickname: "User",
            contentType: 101,
            text: "already delivered history",
            sendTime: 1000
          }
        ]
      }
    });
    const imported = context.semanticEvents
      .listByConversationId(event.openimConversationId)
      .find((item) => item.text === "already delivered history")!;
    context.semanticEvents.markDelivered([imported.id], {
      jobId: "job_previous",
      sessionRecordId: session.id,
      codexSessionId: "thread_1",
      reason: "new_codex_session",
      deliveredAt: 2000
    });

    const webhook = await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-single-msg",
      payload: {
        sendID: "user_1",
        recvID: "codex_bot",
        conversationID: event.openimConversationId,
        contentType: 101,
        content: JSON.stringify({ content: "just continue current task" })
      }
    });
    const jobId = webhook.json().data.jobId as string;
    await waitFor(() => context.jobs.getById(jobId)?.status === "succeeded");

    expect(capturedInput?.sessionId).toBe("thread_1");
    expect(capturedInput?.prompt).toContain("User new message:\njust continue current task");
    expect(capturedInput?.prompt).not.toContain("Recent OpenIM messages:");
    expect(capturedInput?.prompt).not.toContain("already delivered history");

    await app.close();
    context.db.close();
  });

  it("falls back to a new Codex task when an isolated home cannot resume an old rollout", async () => {
    let resumeCalls = 0;
    let newTaskCalls = 0;
    const codex: CodexCliAdapter = {
      runNewTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" }),
      resumeTask: async () => ({ ok: true, outputText: "unused", rawOutput: "" }),
      resumeTaskCancellable: (): CodexRunHandle => {
        resumeCalls += 1;
        return {
          pid: 1234,
          promise: Promise.resolve({
            ok: false,
            outputText: "",
            rawOutput: "",
            errorText: "Error: thread/resume: thread/resume failed: no rollout found for thread id old_thread",
            exitCode: 1
          }),
          cancel: async () => undefined
        };
      },
      runNewTaskCancellable: (): CodexRunHandle => {
        newTaskCalls += 1;
        return {
          pid: 1235,
          promise: Promise.resolve({
            ok: true,
            sessionId: "new_thread",
            outputText: "fallback ok",
            rawOutput: ""
          }),
          cancel: async () => undefined
        };
      }
    };
    const sentTexts: string[] = [];
    const context = createTempContext({
      codex,
      openimSender: {
        sendBotText: async (message) => {
          sentTexts.push(message.text);
        }
      }
    });
    context.semanticEvents.insert(event);
    const session = context.sessions.getOrCreateActiveSession({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    context.sessions.updateCodexSessionId(session.id, "old_thread");
    const app = await createServer(context, pino({ level: "silent" }));

    const webhook = await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-single-msg",
      payload: {
        sendID: "user_1",
        recvID: "codex_bot",
        conversationID: event.openimConversationId,
        contentType: 101,
        content: JSON.stringify({ content: "please continue" })
      }
    });
    const jobId = webhook.json().data.jobId as string;
    await waitFor(() => context.jobs.getById(jobId)?.status === "succeeded");

    expect(resumeCalls).toBe(1);
    expect(newTaskCalls).toBe(1);
    expect(context.jobs.getById(jobId)).toMatchObject({
      status: "succeeded",
      outputText: "fallback ok",
      codexSessionIdBefore: "old_thread",
      codexSessionIdAfter: "new_thread"
    });
    expect(context.sessions.getById(session.id)?.codexSessionId).toBe("new_thread");
    expect(sentTexts).toContain("fallback ok");

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
