import { mkdtempSync } from "node:fs";
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

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function createTempContext(): AppContext {
  const dir = mkdtempSync(join(tmpdir(), "openim-codex-context-api-"));
  tempDirs.push(dir);
  const db = openDatabase(`file:${join(dir, "bridge.sqlite")}`);
  const config = {
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
    CODEX_SESSION_HOME_ROOT: join(dir, "codex-homes"),
    CODEX_SESSION_HOME_MODE: "per-session" as const,
    CODEX_SESSION_HOME_SEED_MODE: "copy-auth-only" as const,
    CODEX_BASE_HOME: "",
    CODEX_SANDBOX_MODE: "",
    CODEX_WORKSPACE_ALLOWLIST: "/workspace/demo",
    CODEX_RUNTIME_ADMIN_TOKEN: "",
    CONTEXT_RECENT_EVENT_LIMIT: 1,
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
    sessions: new SessionBindingRepository(db),
    jobs: new RuntimeJobRepository(db),
    runtimeEvents: new RuntimeEventRepository(db),
    runtimeProfiles: new RuntimeProfileRepository(db, config.BRIDGE_SECRET_KEY),
    openimHistory: new OpenImHistoryRepository(db),
    conversationEvents: new ConversationEventBus(),
    codex: {
      runNewTask: async () => ({ ok: true, outputText: "ok", rawOutput: "" }),
      resumeTask: async () => ({ ok: true, outputText: "ok", rawOutput: "" })
    },
    openimSender: { sendBotText: async () => undefined }
  };
}

describe("context API", () => {
  it("imports history, summarizes, and previews semantic context diagnostics", async () => {
    const context = createTempContext();
    const conversationID = "single:codex_bot:user_1";
    context.sessions.getOrCreateActiveSession({
      openimConversationId: conversationID,
      openimDisplayUserId: "user_1",
      codexProjectPath: "/workspace/demo"
    });
    const app = await createServer(context, pino({ level: "silent" }));

    const snapshot = await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(conversationID)}/openim-history-snapshots`,
      payload: {
        messages: [
          { clientMsgID: "old", sendID: "user_1", senderNickname: "User", contentType: 101, text: "old context", sendTime: 1000 },
          { clientMsgID: "new", sendID: "user_1", senderNickname: "User", contentType: 101, text: "new context", sendTime: 2000 }
        ]
      }
    });
    expect(snapshot.statusCode).toBe(201);
    expect(snapshot.json()).toMatchObject({ importedCount: 2, skippedDuplicateCount: 0 });

    const summary = await app.inject({
      method: "POST",
      url: `/api/conversations/${encodeURIComponent(conversationID)}/context/summarize?recentLimit=1`
    });
    expect(summary.statusCode).toBe(200);
    expect(summary.json().summary.coveredEventIDs).toHaveLength(1);

    const preview = await app.inject({
      method: "GET",
      url: `/api/conversations/${encodeURIComponent(conversationID)}/context/preview?includePrompt=true&recentLimit=1`
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json()).toMatchObject({
      conversationID,
      summaryIncluded: true,
      recentEventCount: 2,
      skippedReasons: {},
      semanticContextIncluded: true,
      semanticContextReason: "diagnostics_preview",
      promptRedacted: true
    });
    expect(preview.json().promptPreview).toContain("Recent OpenIM messages:");

    await app.close();
    context.db.close();
  });
});
