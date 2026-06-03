import sensible from "@fastify/sensible";
import Fastify from "fastify";
import type { Logger } from "pino";
import type { AppContext } from "./app-context.js";
import { shouldCreateRuntimeJob } from "./core/agent-decision.service.js";
import { parseAfterSendSingleMsgPayload } from "./adapters/openim/openim-message.parser.js";
import { CodexRunnerWorker } from "./workers/codex-runner.worker.js";
import { deriveConversationState } from "./core/conversation-status.js";

export async function createServer(context: AppContext, logger: Logger) {
  const app = Fastify({ loggerInstance: logger });
  const worker = new CodexRunnerWorker(context, logger);

  await app.register(sensible);

  app.get("/healthz", async () => ({ ok: true }));

  app.post("/webhooks/openim/after-send-single-msg", async (request, reply) => {
    if (!isRecord(request.body)) {
      return reply.badRequest("OpenIM callback payload must be an object");
    }

    const event = parseAfterSendSingleMsgPayload(request.body, {
      botUserId: context.config.OPENIM_BOT_USER_ID
    });
    context.semanticEvents.insert(event);
    logger.info(
      {
        eventId: event.id,
        openimMessageId: event.openimMessageId,
        conversationId: event.openimConversationId,
        sendID: event.senderUserId,
        recvID: event.receiverUserId,
        contentType: event.contentType
      },
      "received OpenIM single-message callback"
    );

    const decision = shouldCreateRuntimeJob(event, { botUserId: context.config.OPENIM_BOT_USER_ID });
    if (!decision.shouldRun) {
      return openImCallbackOk({ ignored: true, reason: decision.reason });
    }

    const session = context.sessions.getOrCreateActiveSession({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: event.senderUserId,
      codexProjectPath: context.config.CODEX_DEFAULT_PROJECT_PATH
    });
    const job = context.jobs.createQueuedJob({
      sessionRecordId: session.id,
      semanticEventId: event.id,
      openimConversationId: event.openimConversationId,
      inputText: event.text ?? "",
      codexSessionIdBefore: session.codexSessionId
    });

    worker.enqueue(job, event);
    return openImCallbackOk({ ignored: false, jobId: job.id, sessionRecordId: session.id });
  });

  app.post("/webhooks/openim/after-send-single-msg/:command", async (request, reply) => {
    if (!isRecord(request.body)) {
      return reply.badRequest("OpenIM callback payload must be an object");
    }

    const event = parseAfterSendSingleMsgPayload(request.body, {
      botUserId: context.config.OPENIM_BOT_USER_ID
    });
    context.semanticEvents.insert(event);
    logger.info(
      {
        eventId: event.id,
        openimMessageId: event.openimMessageId,
        conversationId: event.openimConversationId,
        sendID: event.senderUserId,
        recvID: event.receiverUserId,
        contentType: event.contentType
      },
      "received OpenIM single-message callback"
    );

    const decision = shouldCreateRuntimeJob(event, { botUserId: context.config.OPENIM_BOT_USER_ID });
    if (!decision.shouldRun) {
      return openImCallbackOk({ ignored: true, reason: decision.reason });
    }

    const session = context.sessions.getOrCreateActiveSession({
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: event.senderUserId,
      codexProjectPath: context.config.CODEX_DEFAULT_PROJECT_PATH
    });
    const job = context.jobs.createQueuedJob({
      sessionRecordId: session.id,
      semanticEventId: event.id,
      openimConversationId: event.openimConversationId,
      inputText: event.text ?? "",
      codexSessionIdBefore: session.codexSessionId
    });

    worker.enqueue(job, event);
    return openImCallbackOk({ ignored: false, jobId: job.id, sessionRecordId: session.id });
  });

  app.get("/api/jobs/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = context.jobs.getById(jobId);
    if (!job) {
      return reply.notFound("runtime job not found");
    }
    return job;
  });

  app.post("/api/jobs/:jobId/cancel", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = await worker.cancelJob(jobId);
    if (!job) {
      return reply.notFound("runtime job not found");
    }
    return job;
  });

  app.get("/api/bindings", async () => {
    const bindings = context.sessions.listActiveBindings().map((binding) => {
      const latestJob = context.jobs.getLatestByConversationId(binding.openimConversationId);
      return {
        ...binding,
        latestJobId: latestJob?.id ?? null,
        latestJobStatus: latestJob?.status ?? null
      };
    });

    return { bindings };
  });

  app.get("/api/bindings/:conversationId", async (request, reply) => {
    const { conversationId } = request.params as { conversationId: string };
    const activeSession = context.sessions.getActiveByConversationId(conversationId);
    if (!activeSession) {
      return reply.notFound("binding not found");
    }

    return {
      openimConversationId: conversationId,
      activeSession,
      sessions: context.sessions.listByConversationId(conversationId),
      activeJob: context.jobs.getActiveByConversationId(conversationId),
      latestJob: context.jobs.getLatestByConversationId(conversationId),
      recentJobs: context.jobs.listRecentByConversationId(conversationId, 10)
    };
  });

  app.post("/api/bindings/:conversationId/rebind", async (request, reply) => {
    const { conversationId } = request.params as { conversationId: string };
    const activeJob = context.jobs.getActiveByConversationId(conversationId);
    if (activeJob) {
      return reply.code(409).send({
        error: "active job exists",
        message: "Cannot rebind while a runtime job is queued, running, or cancelling.",
        activeJob
      });
    }

    const body = isRecord(request.body) ? request.body : {};
    const activeSession = context.sessions.getActiveByConversationId(conversationId);
    const openimDisplayUserId =
      optionalString(body.openimDisplayUserId) ?? activeSession?.openimDisplayUserId ?? optionalString(body.userId);
    if (!openimDisplayUserId) {
      return reply.badRequest("openimDisplayUserId is required when the conversation is unknown");
    }

    const session = context.sessions.rebindConversation({
      openimConversationId: conversationId,
      openimDisplayUserId,
      codexProjectPath:
        optionalString(body.codexProjectPath) ??
        activeSession?.codexProjectPath ??
        context.config.CODEX_DEFAULT_PROJECT_PATH,
      codexSessionId: optionalString(body.codexSessionId)
    });

    return reply.code(201).send({
      openimConversationId: conversationId,
      activeSession: session,
      sessions: context.sessions.listByConversationId(conversationId),
      activeJob: null,
      latestJob: context.jobs.getLatestByConversationId(conversationId),
      recentJobs: context.jobs.listRecentByConversationId(conversationId, 10)
    });
  });

  app.post("/api/bindings/:conversationId/archive", async (request, reply) => {
    const { conversationId } = request.params as { conversationId: string };
    const activeJob = context.jobs.getActiveByConversationId(conversationId);
    if (activeJob) {
      return reply.code(409).send({
        error: "active job exists",
        message: "Cannot archive while a runtime job is queued, running, or cancelling.",
        activeJob
      });
    }

    const archivedSession = context.sessions.archiveActiveBinding(conversationId);
    if (!archivedSession) {
      return reply.notFound("binding not found");
    }

    return {
      openimConversationId: conversationId,
      archivedSession,
      activeSession: null,
      sessions: context.sessions.listByConversationId(conversationId),
      latestJob: context.jobs.getLatestByConversationId(conversationId),
      recentJobs: context.jobs.listRecentByConversationId(conversationId, 10)
    };
  });

  app.get("/api/conversations/:conversationId/status", async (request) => {
    const { conversationId } = request.params as { conversationId: string };
    const activeSession = context.sessions.getActiveByConversationId(conversationId);
    const activeJob = context.jobs.getActiveByConversationId(conversationId);
    const latestJob = context.jobs.getLatestByConversationId(conversationId);
    const recentJobs = context.jobs.listRecentByConversationId(conversationId, 10);

    return {
      openimConversationId: conversationId,
      state: deriveConversationState({ activeSession, activeJob, latestJob }),
      activeSession,
      activeJob,
      latestJob,
      recentJobs
    };
  });

  app.get("/api/conversations/:conversationId/codex-sessions", async (request) => {
    const { conversationId } = request.params as { conversationId: string };
    return {
      conversationId,
      sessions: context.sessions.listByConversationId(conversationId)
    };
  });

  app.post("/api/conversations/:conversationId/codex-sessions", async (request, reply) => {
    const { conversationId } = request.params as { conversationId: string };
    const body = isRecord(request.body) ? request.body : {};
    const active = context.sessions.getActiveByConversationId(conversationId);
    const displayUserId =
      optionalString(body.openimDisplayUserId) ?? active?.openimDisplayUserId ?? optionalString(body.userId);
    if (!displayUserId) {
      return reply.badRequest("openimDisplayUserId is required when the conversation is unknown");
    }

    const session = context.sessions.createAdditionalSession({
      openimConversationId: conversationId,
      openimDisplayUserId: displayUserId,
      codexProjectPath: optionalString(body.codexProjectPath) ?? context.config.CODEX_DEFAULT_PROJECT_PATH
    });
    return reply.code(201).send(session);
  });

  app.post("/api/conversations/:conversationId/codex-sessions/:sessionRecordId/activate", async (request) => {
    const { conversationId, sessionRecordId } = request.params as {
      conversationId: string;
      sessionRecordId: string;
    };
    return context.sessions.activateSession(conversationId, sessionRecordId);
  });

  return app;
}

function openImCallbackOk(data: Record<string, unknown>) {
  return {
    actionCode: 0,
    errCode: 0,
    errMsg: "",
    data
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}
