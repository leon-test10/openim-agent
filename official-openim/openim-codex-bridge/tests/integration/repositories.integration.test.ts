import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/storage/db.js";
import { SemanticEventRepository } from "../../src/core/semantic-event.repository.js";
import { SessionBindingRepository } from "../../src/core/session-binding.repository.js";
import { RuntimeJobRepository } from "../../src/core/runtime-job.repository.js";
import { RuntimeProfileRepository } from "../../src/core/runtime-profile.repository.js";
import type { SemanticEvent } from "../../src/core/semantic-event.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function createTempDb() {
  const dir = mkdtempSync(join(tmpdir(), "openim-codex-bridge-"));
  tempDirs.push(dir);
  return openDatabase(`file:${join(dir, "bridge.sqlite")}`);
}

const semanticEvent: SemanticEvent = {
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
  rawPayload: { sendID: "user_1" },
  createdAt: 1000
};

describe("repositories", () => {
  it("persists events, creates active session records, and updates job status", () => {
    const db = createTempDb();
    const events = new SemanticEventRepository(db);
    const sessions = new SessionBindingRepository(db, {
      codexSessionHomeRoot: join(tmpdir(), "openim-codex-bridge-test-homes"),
      codexHomeSeedMode: "copy-auth-only",
      sandboxMode: "workspace-write"
    });
    const jobs = new RuntimeJobRepository(db);

    events.insert(semanticEvent);
    const session = sessions.getOrCreateActiveSession({
      openimConversationId: "single:codex_bot:user_1",
      openimDisplayUserId: "user_1",
      runtimeKind: "openai_compatible",
      codexProjectPath: "/workspace/demo"
    });
    const sameSession = sessions.getOrCreateActiveSession({
      openimConversationId: "single:codex_bot:user_1",
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });

    expect(sameSession.id).toBe(session.id);
    expect(session.isActive).toBe(true);
    expect(session.runtimeKind).toBe("openai_compatible");
    expect(sessions.getById(session.id)?.runtimeKind).toBe("openai_compatible");
    expect(session.codexSessionId).toBeNull();
    expect(session.codexHomeDir).toContain("openim-codex-bridge-test-homes");
    expect(session.codexHomeDir).toContain(session.id);
    expect(session.codexHomeSeedMode).toBe("copy-auth-only");
    expect(session.sandboxMode).toBe("workspace-write");

    const job = jobs.createQueuedJob({
      sessionRecordId: session.id,
      semanticEventId: semanticEvent.id,
      openimConversationId: semanticEvent.openimConversationId,
      inputText: "hello",
      runtimeKind: "openai_compatible",
      codexSessionIdBefore: null
    });
    jobs.markRunning(job.id, 1100);
    jobs.markSucceeded(job.id, {
      finishedAt: 1200,
      outputText: "done",
      codexSessionIdAfter: "11111111-1111-1111-1111-111111111111"
    });
    sessions.updateCodexSessionId(session.id, "11111111-1111-1111-1111-111111111111");

    expect(jobs.getById(job.id)?.status).toBe("succeeded");
    expect(jobs.getById(job.id)?.runtimeKind).toBe("openai_compatible");
    expect(jobs.getById(job.id)?.failureReason).toBeNull();
    expect(sessions.getActiveByConversationId("single:codex_bot:user_1")?.codexSessionId).toBe(
      "11111111-1111-1111-1111-111111111111"
    );

    db.close();
  });

  it("lists active bindings and recent jobs for conversation status views", () => {
    const db = createTempDb();
    const events = new SemanticEventRepository(db);
    const sessions = new SessionBindingRepository(db);
    const jobs = new RuntimeJobRepository(db);

    events.insert(semanticEvent);
    const session = sessions.getOrCreateActiveSession({
      openimConversationId: semanticEvent.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    sessions.updateCodexSessionId(session.id, "thread_1");
    const queued = jobs.createQueuedJob({
      sessionRecordId: session.id,
      semanticEventId: semanticEvent.id,
      openimConversationId: semanticEvent.openimConversationId,
      inputText: "queued",
      codexSessionIdBefore: "thread_1"
    });
    const running = jobs.createQueuedJob({
      sessionRecordId: session.id,
      semanticEventId: semanticEvent.id,
      openimConversationId: semanticEvent.openimConversationId,
      inputText: "running",
      codexSessionIdBefore: "thread_1"
    });
    jobs.markRunning(running.id, 2000);
    const succeeded = jobs.createQueuedJob({
      sessionRecordId: session.id,
      semanticEventId: semanticEvent.id,
      openimConversationId: semanticEvent.openimConversationId,
      inputText: "latest",
      codexSessionIdBefore: "thread_1"
    });
    jobs.markSucceeded(succeeded.id, {
      outputText: "done",
      codexSessionIdAfter: "thread_1",
      finishedAt: 3000
    });

    const bindings = sessions.listActiveBindings();
    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      openimConversationId: semanticEvent.openimConversationId,
      openimDisplayUserId: "user_1",
      codexSessionId: "thread_1",
      codexProjectPath: "/workspace/demo",
      sessionStatus: "active"
    });

    expect(jobs.getActiveByConversationId(semanticEvent.openimConversationId)?.id).toBe(running.id);
    expect(jobs.getLatestByConversationId(semanticEvent.openimConversationId)?.id).toBe(succeeded.id);
    expect(jobs.listRecentByConversationId(semanticEvent.openimConversationId, 2).map((job) => job.id)).toEqual([
      succeeded.id,
      running.id
    ]);
    expect(jobs.getById(queued.id)?.status).toBe("queued");

    db.close();
  });

  it("tracks queued and running job cancellation state", () => {
    const db = createTempDb();
    const events = new SemanticEventRepository(db);
    const sessions = new SessionBindingRepository(db);
    const jobs = new RuntimeJobRepository(db);

    events.insert(semanticEvent);
    const session = sessions.getOrCreateActiveSession({
      openimConversationId: semanticEvent.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    const queued = jobs.createQueuedJob({
      sessionRecordId: session.id,
      semanticEventId: semanticEvent.id,
      openimConversationId: semanticEvent.openimConversationId,
      inputText: "queued",
      codexSessionIdBefore: null
    });
    const cancelledQueued = jobs.cancelQueued(queued.id, { cancelledAt: 1500, cancelMethod: "api" });
    expect(cancelledQueued).toMatchObject({
      status: "cancelled",
      cancelRequestedAt: 1500,
      cancelledAt: 1500,
      cancelMethod: "api",
      finishedAt: 1500
    });

    const running = jobs.createQueuedJob({
      sessionRecordId: session.id,
      semanticEventId: semanticEvent.id,
      openimConversationId: semanticEvent.openimConversationId,
      inputText: "running",
      codexSessionIdBefore: null
    });
    jobs.markRunning(running.id, 2000);
    const cancelling = jobs.markCancelling(running.id, { cancelRequestedAt: 2100, cancelMethod: "api" });
    expect(cancelling?.status).toBe("cancelling");
    expect(jobs.getActiveByConversationId(semanticEvent.openimConversationId)?.id).toBe(running.id);
    const cancelledRunning = jobs.markCancelled(running.id, {
      cancelledAt: 2200,
      cancelMethod: "api",
      errorText: "Cancelled"
    });
    expect(cancelledRunning).toMatchObject({
      status: "cancelled",
      cancelRequestedAt: 2100,
      cancelledAt: 2200,
      cancelMethod: "api",
      errorText: "Cancelled"
    });

    db.close();
  });

  it("tracks failure reasons and creates retry jobs from terminal jobs", () => {
    const db = createTempDb();
    const events = new SemanticEventRepository(db);
    const sessions = new SessionBindingRepository(db);
    const jobs = new RuntimeJobRepository(db);

    events.insert(semanticEvent);
    expect(events.getById(semanticEvent.id)).toMatchObject({
      id: semanticEvent.id,
      senderUserId: "user_1",
      receiverUserId: "codex_bot",
      text: "hello"
    });
    const session = sessions.getOrCreateActiveSession({
      openimConversationId: semanticEvent.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    sessions.updateCodexSessionId(session.id, "thread_1");
    const failed = jobs.createQueuedJob({
      sessionRecordId: session.id,
      semanticEventId: semanticEvent.id,
      openimConversationId: semanticEvent.openimConversationId,
      inputText: "retry me",
      runtimeKind: "template",
      codexSessionIdBefore: "thread_1"
    });
    jobs.markRunning(failed.id, 1100);
    jobs.markFailed(failed.id, {
      finishedAt: 1200,
      errorText: "timeout",
      failureReason: "timeout"
    });

    expect(jobs.getById(failed.id)).toMatchObject({
      status: "failed",
      failureReason: "timeout",
      errorText: "timeout"
    });

    const retry = jobs.createRetryJob({
      sourceJobId: failed.id,
      sessionRecordId: session.id,
      codexSessionIdBefore: "thread_1"
    });
    expect(retry).toMatchObject({
      status: "queued",
      runtimeKind: "template",
      retryOfJobId: failed.id,
      inputText: "retry me",
      semanticEventId: semanticEvent.id,
      codexSessionIdBefore: "thread_1"
    });
    expect(jobs.createRetryJob({ sourceJobId: retry!.id, sessionRecordId: session.id, codexSessionIdBefore: "thread_1" })).toBeNull();

    db.close();
  });

  it("rebinds and archives active session records", () => {
    const db = createTempDb();
    const sessions = new SessionBindingRepository(db);

    const original = sessions.getOrCreateActiveSession({
      openimConversationId: semanticEvent.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    sessions.updateCodexSessionId(original.id, "thread_original");

    const rebound = sessions.rebindConversation({
      openimConversationId: semanticEvent.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/other",
      codexSessionId: "thread_manual"
    });

    expect(rebound).toMatchObject({
      isActive: true,
      status: "active",
      codexProjectPath: "/workspace/other",
      codexSessionId: "thread_manual",
      parentSessionRecordId: original.id,
      forkedFromCodexSessionId: "thread_original",
      createdReason: "manual_rebind"
    });
    expect(sessions.getById(original.id)?.isActive).toBe(false);
    expect(sessions.getActiveByConversationId(semanticEvent.openimConversationId)?.id).toBe(rebound.id);

    const archived = sessions.archiveActiveBinding(semanticEvent.openimConversationId);
    expect(archived).toMatchObject({
      id: rebound.id,
      isActive: false,
      status: "archived"
    });
    expect(sessions.getActiveByConversationId(semanticEvent.openimConversationId)).toBeNull();
    expect(() => sessions.activateSession(semanticEvent.openimConversationId, rebound.id)).toThrow(
      `Cannot activate session record ${rebound.id}`
    );

    db.close();
  });

  it("restores archived sessions and soft-deletes session records", () => {
    const db = createTempDb();
    const sessions = new SessionBindingRepository(db);

    const original = sessions.getOrCreateActiveSession({
      openimConversationId: semanticEvent.openimConversationId,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    sessions.archiveSession(semanticEvent.openimConversationId, original.id);

    const restored = sessions.restoreSession(semanticEvent.openimConversationId, original.id);
    expect(restored).toMatchObject({
      id: original.id,
      isActive: false,
      status: "active"
    });
    expect(sessions.getActiveByConversationId(semanticEvent.openimConversationId)).toBeNull();
    expect(sessions.listByConversationId(semanticEvent.openimConversationId)).toHaveLength(1);

    const deleted = sessions.deleteSession(semanticEvent.openimConversationId, original.id);
    expect(deleted).toMatchObject({
      id: original.id,
      isActive: false,
      status: "deleted"
    });
    expect(sessions.listByConversationId(semanticEvent.openimConversationId)).toHaveLength(0);
    expect(sessions.listByConversationId(semanticEvent.openimConversationId, { includeDeleted: true })).toHaveLength(1);

    db.close();
  });

  it("stores runtime profiles with masked encrypted API keys", () => {
    const db = createTempDb();
    const profiles = new RuntimeProfileRepository(db, "0123456789abcdef0123456789abcdef");

    const created = profiles.create({
      name: "OpenAI production",
      providerType: "openai",
      model: "codex-mini-latest",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      codexProfile: "prod",
      baseUrl: "https://api.openai.com/v1",
      apiKey: "sk-test-1234567890"
    });

    expect(created).toMatchObject({
      name: "OpenAI production",
      providerType: "openai",
      model: "codex-mini-latest",
      sandboxMode: "workspace-write",
      approvalPolicy: "never",
      codexProfile: "prod",
      baseUrl: "https://api.openai.com/v1",
      apiKeyMasked: "sk-t...7890"
    });
    expect(created.apiKey).toBeUndefined();
    expect(profiles.getSecret(created.id)).toBe("sk-test-1234567890");

    const updated = profiles.update(created.id, { apiKey: "sk-next-abcdef" });
    expect(updated?.apiKeyMasked).toBe("sk-n...cdef");
    expect(profiles.getSecret(created.id)).toBe("sk-next-abcdef");

    profiles.delete(created.id);
    expect(profiles.getById(created.id)).toBeNull();

    db.close();
  });
});
