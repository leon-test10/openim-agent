import { describe, expect, it } from "vitest";
import { decideContextSupplement } from "../../src/core/context-supplement-policy.js";
import type { CodexSessionRecord } from "../../src/core/session-binding.js";
import type { SemanticEvent } from "../../src/core/semantic-event.js";

const session: CodexSessionRecord = {
  id: "csr_1",
  openimConversationId: "single:codex_bot:user_1",
  openimDisplayUserId: "user_1",
  codexSessionId: "thread_1",
  codexProjectPath: "/workspace/demo",
  codexHomeDir: null,
  codexHomeSeedMode: null,
  sandboxMode: null,
  runtimeProfileId: null,
  displayName: null,
  displayNameSource: null,
  lastSummary: null,
  isActive: true,
  status: "active",
  parentSessionRecordId: null,
  forkedFromCodexSessionId: null,
  createdReason: "auto",
  createdAt: 1000,
  updatedAt: 1000
};

const currentEvent: SemanticEvent = {
  id: "evt_current",
  openimMessageId: "server_current",
  openimClientMsgId: "client_current",
  openimConversationId: "single:codex_bot:user_1",
  conversationType: "single",
  senderUserId: "user_1",
  receiverUserId: "codex_bot",
  groupId: null,
  eventType: "message.created",
  contentType: 101,
  text: "please continue",
  role: "user",
  actorType: "human",
  ex: null,
  rawPayload: {},
  createdAt: 2000
};

describe("decideContextSupplement", () => {
  it("omits semantic context for normal Codex resume with no supplement triggers", () => {
    const decision = decideContextSupplement({
      session,
      currentEvent,
      recentEvents: [currentEvent]
    });

    expect(decision).toEqual({
      includeSemanticContext: false,
      reason: "codex_session_resume",
      deliverableEventIDs: []
    });
  });

  it("includes semantic context for a new Codex session", () => {
    const decision = decideContextSupplement({
      session: { ...session, codexSessionId: null },
      currentEvent,
      recentEvents: [currentEvent]
    });

    expect(decision.includeSemanticContext).toBe(true);
    expect(decision.reason).toBe("new_codex_session");
    expect(decision.deliverableEventIDs).toEqual(["evt_current"]);
  });

  it("includes imported OpenIM history that has not been delivered to the active session", () => {
    const imported: SemanticEvent = {
      ...currentEvent,
      id: "evt_imported",
      source: "openim_history_snapshot",
      text: "earlier OpenIM fact"
    };
    const decision = decideContextSupplement({
      session,
      currentEvent,
      recentEvents: [imported, currentEvent]
    });

    expect(decision.includeSemanticContext).toBe(true);
    expect(decision.reason).toBe("undelivered_openim_history");
    expect(decision.deliverableEventIDs).toEqual(["evt_imported", "evt_current"]);
  });

  it("does not re-deliver imported history already delivered to the same session record", () => {
    const delivered: SemanticEvent = {
      ...currentEvent,
      id: "evt_delivered",
      source: "openim_history_snapshot",
      deliveredSessionRecordId: "csr_1",
      deliveredJobId: "job_1",
      deliveredAt: 3000,
      deliveryReason: "undelivered_openim_history"
    };
    const decision = decideContextSupplement({
      session,
      currentEvent,
      recentEvents: [delivered, currentEvent]
    });

    expect(decision).toEqual({
      includeSemanticContext: false,
      reason: "codex_session_resume",
      deliverableEventIDs: []
    });
  });

  it("includes semantic context when the user explicitly asks for OpenIM history", () => {
    const decision = decideContextSupplement({
      session,
      currentEvent: { ...currentEvent, text: "use previous OpenIM chat history for this" },
      recentEvents: [currentEvent]
    });

    expect(decision.includeSemanticContext).toBe(true);
    expect(decision.reason).toBe("explicit_history_request");
  });
});
