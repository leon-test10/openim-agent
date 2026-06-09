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
import { OpenAiCompatibleRunner } from "../../src/runtime/openai-compatible.runner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

function createTempContext(
  runner: AgentRunner,
  sentTexts: string[],
  sentMessages: Array<{ text: string; recvId: string; groupId?: string | null }> = []
): AppContext {
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
    OPENIM_GROUP_BOT_ENABLED: false,
    OPENIM_GROUP_ALLOWLIST: "",
    OPENIM_GROUP_SENDER_ALLOWLIST: "",
    OPENIM_GROUP_REQUIRE_BINDING: false,
    OPENIM_GROUP_PROJECT_BINDINGS: "",
    OPENIM_GROUP_AUTO_REPLY_POLICY: "mention_or_reply" as const,
    RUNTIME_DEFAULT_KIND: runner.kind,
    CODEX_BIN: "codex",
    CODEX_DEFAULT_PROJECT_PATH: "/workspace/demo",
    CODEX_DEFAULT_MODEL: "",
    CODEX_EXEC_TIMEOUT_MS: 600000,
    CODEX_SESSION_HOME_ROOT: join(dir, "codex-homes"),
    CODEX_SESSION_HOME_MODE: "per-session" as const,
    CODEX_SESSION_HOME_SEED_MODE: "copy-auth-only" as const,
    CODEX_BASE_HOME: "",
    CODEX_SANDBOX_MODE: "",
    CODEX_WORKSPACE_ALLOWLIST: "/workspace/demo;/workspace/group-demo",
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
    runner,
    openimSender: {
      sendBotText: async (message) => {
        sentTexts.push(message.text);
        sentMessages.push({ text: message.text, recvId: message.recvId, groupId: message.groupId });
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

  it("can run the OpenAI-compatible runner without a Codex external session", async () => {
    const sentTexts: string[] = [];
    const fetchCalls: RequestInit[] = [];
    const runner = new OpenAiCompatibleRunner({
      baseUrl: "http://127.0.0.1:8000/v1",
      apiKey: "dummy",
      model: "test-model",
      timeoutMs: 120000,
      temperature: 0.2,
      maxTokens: 256,
      fetchImpl: async (_url, init) => {
        fetchCalls.push(init);
        return new Response(JSON.stringify({ choices: [{ message: { content: "OPENAI_COMPATIBLE_ACK" } }] }), {
          status: 200
        });
      }
    });
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
        content: JSON.stringify({ content: "please reply OPENAI_COMPATIBLE_ACK" })
      }
    });

    expect(webhook.statusCode).toBe(200);
    const jobId = webhook.json().data.jobId as string;
    await waitFor(() => context.jobs.getById(jobId)?.status === "succeeded");

    expect(fetchCalls).toHaveLength(1);
    expect(context.jobs.getById(jobId)).toMatchObject({
      status: "succeeded",
      outputText: "OPENAI_COMPATIBLE_ACK",
      codexSessionIdAfter: null
    });
    expect(context.runtimeEvents.listByJobId(jobId).map((event) => event.eventType)).toContain(
      "openai_compatible.response_completed"
    );
    expect(sentTexts).toEqual(["OPENAI_COMPATIBLE_ACK"]);

    const runtimeStatus = await app.inject({
      method: "GET",
      url: "/api/conversations/single%3Acodex_bot%3Abridge_user_1/runtime-status"
    });
    expect(runtimeStatus.json()).toMatchObject({
      runtimeKind: "openai_compatible",
      activeSession: { externalSessionId: null },
      latestJob: { externalSessionIdAfter: null }
    });

    await app.close();
    context.db.close();
  });

  it("queues a group webhook job when the bot is mentioned or replied to and replies to the group", async () => {
    const sentTexts: string[] = [];
    const sentMessages: Array<{ text: string; recvId: string; groupId?: string | null }> = [];
    const runnerCalls: string[] = [];
    const runnerProjectPaths: string[] = [];
    const runner: AgentRunner = {
      kind: "codex_cli",
      run: (input): RuntimeRunHandle => {
        runnerCalls.push(`${input.openimConversationId}:${input.inputText}`);
        runnerProjectPaths.push(input.projectPath);
        return {
          pid: 42,
          promise: Promise.resolve({
            ok: true,
            externalSessionId: "thread_group_1",
            outputText: "GROUP_ACK",
            rawOutput: ""
          }),
          cancel: async () => undefined
        };
      }
    };
    const context = createTempContext(runner, sentTexts, sentMessages);
    context.config.OPENIM_GROUP_BOT_ENABLED = true;
    context.config.OPENIM_GROUP_ALLOWLIST = "group_1";
    context.config.OPENIM_GROUP_SENDER_ALLOWLIST = "bridge_user_1";
    context.config.OPENIM_GROUP_REQUIRE_BINDING = true;
    const app = await createServer(context, pino({ level: "silent" }));

    const deniedGroup = await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-group-msg",
      payload: {
        sendID: "bridge_user_1",
        groupID: "group_2",
        contentType: 101,
        content: JSON.stringify({ content: "@codex_bot denied group" })
      }
    });
    expect(deniedGroup.statusCode).toBe(200);
    expect(deniedGroup.json().data).toMatchObject({
      ignored: true,
      reason: "group_not_allowed"
    });

    const deniedSender = await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-group-msg",
      payload: {
        sendID: "other_user",
        groupID: "group_1",
        contentType: 101,
        content: JSON.stringify({ content: "@codex_bot denied sender" })
      }
    });
    expect(deniedSender.statusCode).toBe(200);
    expect(deniedSender.json().data).toMatchObject({
      ignored: true,
      reason: "group_sender_not_allowed"
    });

    const ignored = await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-group-msg",
      payload: {
        sendID: "bridge_user_1",
        groupID: "group_1",
        contentType: 101,
        content: JSON.stringify({ content: "general chat" })
      }
    });
    expect(ignored.statusCode).toBe(200);
    expect(ignored.json().data).toMatchObject({
      ignored: true,
      reason: "group_message_not_addressed_to_bot"
    });

    const missingBinding = await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-group-msg",
      payload: {
        sendID: "bridge_user_1",
        groupID: "group_1",
        contentType: 101,
        content: JSON.stringify({ content: "@codex_bot needs binding" })
      }
    });
    expect(missingBinding.statusCode).toBe(200);
    expect(missingBinding.json().data).toMatchObject({
      ignored: true,
      reason: "group_binding_required",
      groupId: "group_1"
    });

    context.config.OPENIM_GROUP_PROJECT_BINDINGS = "group_1=/workspace/group-demo";

    const webhook = await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-single-msg/callbackAfterSendGroupMsgCommand",
      payload: {
        sendID: "bridge_user_1",
        groupID: "group_1",
        contentType: 101,
        content: JSON.stringify({ content: "@codex_bot please reply GROUP_ACK" })
      }
    });

    expect(webhook.statusCode).toBe(200);
    const jobId = webhook.json().data.jobId as string;
    await waitFor(() => context.jobs.getById(jobId)?.status === "succeeded");

    expect(runnerCalls).toEqual(["group:group_1:@codex_bot please reply GROUP_ACK"]);
    expect(runnerProjectPaths).toEqual(["/workspace/group-demo"]);
    expect(context.jobs.getById(jobId)).toMatchObject({
      status: "succeeded",
      outputText: "GROUP_ACK"
    });
    expect(sentMessages).toEqual([
      { text: "GROUP_ACK", recvId: "bridge_user_1", groupId: "group_1" }
    ]);

    context.config.OPENIM_GROUP_AUTO_REPLY_POLICY = "mention_only";
    const quoteReplyDenied = await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-group-msg",
      payload: {
        sendID: "bridge_user_1",
        groupID: "group_1",
        contentType: 114,
        content: JSON.stringify({
          quoteElem: {
            text: "please continue but policy denies",
            quoteMessage: {
              sendID: "codex_bot",
              clientMsgID: "bot_reply_denied"
            }
          }
        })
      }
    });
    expect(quoteReplyDenied.statusCode).toBe(200);
    expect(quoteReplyDenied.json().data).toMatchObject({
      ignored: true,
      reason: "group_message_not_addressed_to_bot"
    });

    context.config.OPENIM_GROUP_AUTO_REPLY_POLICY = "mention_or_reply";
    const quoteReply = await app.inject({
      method: "POST",
      url: "/webhooks/openim/after-send-group-msg",
      payload: {
        sendID: "bridge_user_1",
        groupID: "group_1",
        contentType: 114,
        content: JSON.stringify({
          quoteElem: {
            text: "please continue GROUP_ACK",
            quoteMessage: {
              sendID: "codex_bot",
              clientMsgID: "bot_reply_1"
            }
          }
        })
      }
    });
    expect(quoteReply.statusCode).toBe(200);
    const quoteJobId = quoteReply.json().data.jobId as string;
    await waitFor(() => context.jobs.getById(quoteJobId)?.status === "succeeded");

    expect(runnerCalls).toEqual([
      "group:group_1:@codex_bot please reply GROUP_ACK",
      "group:group_1:please continue GROUP_ACK"
    ]);
    expect(runnerProjectPaths).toEqual(["/workspace/group-demo", "/workspace/group-demo"]);
    expect(context.semanticEvents.getById(context.jobs.getById(quoteJobId)!.semanticEventId!)).toMatchObject({
      metadata: { groupTrigger: "reply_to_bot" }
    });
    expect(sentMessages).toEqual([
      { text: "GROUP_ACK", recvId: "bridge_user_1", groupId: "group_1" },
      { text: "GROUP_ACK", recvId: "bridge_user_1", groupId: "group_1" }
    ]);

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
