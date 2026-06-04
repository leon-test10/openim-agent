import { describe, expect, it } from "vitest";
import { deriveConversationState } from "../../src/core/conversation-status.js";
import type { RuntimeJob } from "../../src/core/runtime-job.js";
import type { CodexSessionRecord } from "../../src/core/session-binding.js";

const session: CodexSessionRecord = {
  id: "session_1",
  openimConversationId: "conversation_1",
  openimDisplayUserId: "user_1",
  codexSessionId: "thread_1",
  codexProjectPath: "/workspace/demo",
  codexHomeDir: null,
  codexHomeSeedMode: null,
  sandboxMode: null,
  isActive: true,
  status: "active",
  parentSessionRecordId: null,
  forkedFromCodexSessionId: null,
  createdReason: "test",
  createdAt: 1000,
  updatedAt: 1000
};

function job(status: RuntimeJob["status"]): RuntimeJob {
  return {
    id: `job_${status}`,
    sessionRecordId: session.id,
    semanticEventId: "event_1",
    openimConversationId: session.openimConversationId,
    status,
    inputText: "hello",
    codexSessionIdBefore: "thread_1",
    codexSessionIdAfter: "thread_1",
    outputText: status === "succeeded" ? "done" : null,
    errorText: status === "failed" ? "error" : null,
    failureReason: status === "failed" ? "codex_exit" : null,
    retryOfJobId: null,
    cancelRequestedAt: status === "cancelled" || status === "cancelling" ? 1100 : null,
    cancelledAt: status === "cancelled" ? 1200 : null,
    cancelMethod: status === "cancelled" || status === "cancelling" ? "api" : null,
    createdAt: 1000,
    startedAt: null,
    finishedAt: null
  };
}

describe("deriveConversationState", () => {
  it("returns unknown when the conversation has no active session", () => {
    expect(deriveConversationState({ activeSession: null, activeJob: null, latestJob: null })).toBe("unknown");
  });

  it("prioritizes active running and queued jobs", () => {
    expect(deriveConversationState({ activeSession: session, activeJob: job("running"), latestJob: job("failed") })).toBe(
      "running"
    );
    expect(deriveConversationState({ activeSession: session, activeJob: job("queued"), latestJob: job("succeeded") })).toBe(
      "queued"
    );
    expect(
      deriveConversationState({ activeSession: session, activeJob: job("cancelling"), latestJob: job("succeeded") })
    ).toBe("cancelling");
  });

  it("maps latest terminal job state when no active job exists", () => {
    expect(deriveConversationState({ activeSession: session, activeJob: null, latestJob: null })).toBe("idle");
    expect(deriveConversationState({ activeSession: session, activeJob: null, latestJob: job("succeeded") })).toBe(
      "completed"
    );
    expect(deriveConversationState({ activeSession: session, activeJob: null, latestJob: job("failed") })).toBe("failed");
    expect(deriveConversationState({ activeSession: session, activeJob: null, latestJob: job("cancelled") })).toBe("idle");
  });
});
