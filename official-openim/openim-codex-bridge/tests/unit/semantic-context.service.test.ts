import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openDatabase } from "../../src/storage/db.js";
import { SemanticEventRepository } from "../../src/core/semantic-event.repository.js";
import { ConversationSummaryRepository } from "../../src/core/conversation-summary.repository.js";
import { SemanticEventIngestService } from "../../src/core/semantic-event-ingest.service.js";
import { ConversationContextBuilder } from "../../src/core/conversation-context.service.js";
import { SessionBindingRepository } from "../../src/core/session-binding.repository.js";
import { buildCodexPrompt } from "../../src/core/prompt-builder.service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function createRepositories() {
  const dir = mkdtempSync(join(tmpdir(), "openim-codex-semantic-"));
  tempDirs.push(dir);
  const db = openDatabase(`file:${join(dir, "bridge.sqlite")}`);
  return {
    db,
    semanticEvents: new SemanticEventRepository(db),
    summaries: new ConversationSummaryRepository(db),
    sessions: new SessionBindingRepository(db)
  };
}

describe("semantic context services", () => {
  it("imports history snapshots as idempotent semantic events with role mapping", () => {
    const repositories = createRepositories();
    const ingest = new SemanticEventIngestService(repositories.semanticEvents, { botUserId: "codex_bot" });

    const result = ingest.importHistorySnapshot({
      conversationID: "single:codex_bot:user_1",
      messages: [
        { serverMsgID: "s1", clientMsgID: "c1", sendID: "user_1", senderNickname: "User", contentType: 101, text: "first", sendTime: 1000 },
        {
          serverMsgID: "s2",
          clientMsgID: "c2",
          sendID: "codex_bot",
          senderNickname: "Codex",
          contentType: 101,
          text: "answer",
          sendTime: 2000,
          ex: { agent: { generated_by: "codex" } }
        },
        { serverMsgID: "s3", clientMsgID: "c3", sendID: "user_1", contentType: 102, text: "image", sendTime: 3000 }
      ]
    });
    const duplicate = ingest.importHistorySnapshot({
      conversationID: "single:codex_bot:user_1",
      messages: [
        { serverMsgID: "s1", clientMsgID: "c1", sendID: "user_1", senderNickname: "User", contentType: 101, text: "first", sendTime: 1000 }
      ]
    });

    expect(result).toMatchObject({
      conversationID: "single:codex_bot:user_1",
      receivedCount: 3,
      importedCount: 2,
      skippedDuplicateCount: 0,
      skippedUnsupportedCount: 1,
      earliestTimestamp: 1000,
      latestTimestamp: 3000
    });
    expect(duplicate).toMatchObject({ importedCount: 0, skippedDuplicateCount: 1 });

    const events = repositories.semanticEvents.listByConversationId("single:codex_bot:user_1");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      serverMsgID: "s1",
      role: "user",
      actorType: "human",
      actorDisplayName: "User",
      eventType: "message.imported",
      text: "first"
    });
    expect(events[1]).toMatchObject({
      role: "assistant",
      actorType: "codex_bot",
      eventType: "agent.reply",
      text: "answer"
    });

    repositories.db.close();
  });

  it("builds context and prompt from summary plus recent semantic events with redaction", () => {
    const repositories = createRepositories();
    const ingest = new SemanticEventIngestService(repositories.semanticEvents, { botUserId: "codex_bot" });
    const imported = ingest.importHistorySnapshot({
      conversationID: "single:codex_bot:user_1",
      messages: [
        { serverMsgID: "s1", sendID: "user_1", senderNickname: "User", contentType: 101, text: "Use workspace-write only", sendTime: 1000 },
        { serverMsgID: "s2", sendID: "codex_bot", senderNickname: "Codex", contentType: 101, text: "Noted", sendTime: 2000, ex: { agent: { generated_by: "codex" } } },
        { serverMsgID: "s3", sendID: "user_1", senderNickname: "User", contentType: 101, text: "Current needs sk-secret-123456", sendTime: 3000 }
      ]
    });
    repositories.summaries.upsert({
      conversationID: "single:codex_bot:user_1",
      summaryText: "The user is stabilizing OpenIM Codex bridge.",
      coveredEventIDs: [repositories.semanticEvents.listByConversationId("single:codex_bot:user_1")[0].id],
      importantDecisions: ["OpenIM history is source of truth"],
      unresolvedTasks: ["Finish semantic context"],
      coveredEventUntilTimestamp: 1000
    });
    const session = repositories.sessions.getOrCreateActiveSession({
      openimConversationId: "single:codex_bot:user_1",
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    repositories.sessions.updateCodexSessionId(session.id, "thread_1");

    const builder = new ConversationContextBuilder({
      semanticEvents: repositories.semanticEvents,
      summaries: repositories.summaries,
      sessions: repositories.sessions,
      recentLimit: 2
    });
    const context = builder.build("single:codex_bot:user_1");
    const prompt = buildCodexPrompt({ context, currentEvent: repositories.semanticEvents.getById(imported.importedEventIDs.at(-1)!)! });

    expect(context.recentEvents.map((event) => event.serverMsgID)).toEqual(["s2", "s3"]);
    expect(prompt).toContain("Long-term summary:\nThe user is stabilizing OpenIM Codex bridge.");
    expect(prompt).toContain("Important decisions:\n- OpenIM history is source of truth");
    expect(prompt).toContain("Assistant(Codex): Noted");
    expect(prompt).toContain("Human(User): Current needs sk-****");
    expect(prompt).not.toContain("sk-secret-123456");

    repositories.db.close();
  });
});
