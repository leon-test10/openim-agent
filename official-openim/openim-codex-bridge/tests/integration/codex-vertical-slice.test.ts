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
import type { AgentRunner, RuntimeRunHandle } from "../../src/runtime/runner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function createTempContext(runner: AgentRunner, sentTexts: string[]): AppContext {
  const dir = mkdtempSync(join(tmpdir(), "openim-codex-vertical-"));
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
    runner,
    openimSender: {
      sendBotText: async (message) => {
        sentTexts.push(message.text);
      }
    }
  };
}

describe("Codex vertical slice through AgentRunner", () => {
  it("queues a webhook job, runs the injected runner, records events, and replies to OpenIM", async () => {
    const sentTexts: string[] = [];
    const runnerCalls: string[] = [];
    const runner: AgentRunner = {
      kind: "codex_cli",
      run: (input): RuntimeRunHandle => {
        runnerCalls.push(`${input.jobId}:${input.projectPath}:${input.inputText}`);
        input.onEvent?.({ type: "agent_message", message: "SMOKE_ACK" });
        return {
          pid: 42,
          promise: Promise.resolve({
            ok: true,
            externalSessionId: "thread_1",
            outputText: "SMOKE_ACK",
            rawOutput: "{\"type\":\"agent_message\",\"message\":\"SMOKE_ACK\"}"
          }),
          cancel: async () => undefined
        };
      }
    };
    const context = createTempContext(runner, sentTexts);
    const app = await createServer(context, pino({ level: "silent" }));

    const webhook = await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-single-msg",
      payload: {
        sendID: "bridge_user_1",
        recvID: "codex_bot",
        conversationID: "single:codex_bot:bridge_user_1",
        contentType: 101,
        content: JSON.stringify({ content: "please reply SMOKE_ACK" })
      }
    });

    expect(webhook.statusCode).toBe(200);
    const jobId = webhook.json().data.jobId as string;
    await waitFor(() => context.jobs.getById(jobId)?.status === "succeeded");

    expect(runnerCalls).toHaveLength(1);
    expect(runnerCalls[0]).toContain("please reply SMOKE_ACK");
    expect(context.jobs.getById(jobId)).toMatchObject({
      status: "succeeded",
      outputText: "SMOKE_ACK",
      codexSessionIdAfter: "thread_1"
    });
    expect(context.runtimeEvents.listByJobId(jobId).map((event) => event.eventType)).toContain("agent_message");
    expect(sentTexts).toEqual(["SMOKE_ACK"]);

    await app.close();
    context.db.close();
  });

  it("does not create runtime jobs for bot loops or unsupported messages", async () => {
    const sentTexts: string[] = [];
    let runnerCalls = 0;
    const runner: AgentRunner = {
      kind: "codex_cli",
      run: () => {
        runnerCalls += 1;
        return {
          pid: 42,
          promise: Promise.resolve({ ok: true, outputText: "unused", rawOutput: "" }),
          cancel: async () => undefined
        };
      }
    };
    const context = createTempContext(runner, sentTexts);
    const app = await createServer(context, pino({ level: "silent" }));

    const botSender = await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-single-msg",
      payload: {
        sendID: "codex_bot",
        recvID: "bridge_user_1",
        conversationID: "single:codex_bot:bridge_user_1",
        contentType: 101,
        content: JSON.stringify({ content: "bot reply" })
      }
    });
    const generatedByCodex = await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-single-msg",
      payload: {
        sendID: "codex_bot",
        recvID: "bridge_user_1",
        conversationID: "single:codex_bot:bridge_user_1",
        contentType: 101,
        content: JSON.stringify({ content: "bot reply" }),
        ex: JSON.stringify({ agent: { generated_by: "codex" } })
      }
    });
    const nonText = await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-single-msg",
      payload: {
        sendID: "bridge_user_1",
        recvID: "codex_bot",
        conversationID: "single:codex_bot:bridge_user_1",
        contentType: 102,
        content: JSON.stringify({ content: "image" })
      }
    });

    expect(botSender.statusCode).toBe(200);
    expect(generatedByCodex.statusCode).toBe(200);
    expect(nonText.statusCode).toBe(200);
    expect(runnerCalls).toBe(0);
    expect(context.jobs.listRecentByConversationId("single:codex_bot:bridge_user_1")).toHaveLength(0);
    expect(sentTexts).toEqual([]);

    await app.close();
    context.db.close();
  });
});

async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("timed out waiting for condition");
}
