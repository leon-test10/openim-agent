import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import Fastify from "fastify";
import type { Logger } from "pino";
import type { AppContext } from "./app-context.js";
import { shouldCreateRuntimeJob } from "./core/agent-decision.service.js";
import { parseAfterSendSingleMsgPayload } from "./adapters/openim/openim-message.parser.js";
import { CodexRunnerWorker } from "./workers/codex-runner.worker.js";
import { deriveConversationState, toRuntimeJobView } from "./core/conversation-status.js";

export async function createServer(context: AppContext, logger: Logger) {
  const app = Fastify({ loggerInstance: logger });
  const worker = new CodexRunnerWorker(context, logger);

  await app.register(cors, {
    origin: true
  });
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
      codexProjectPath: context.config.CODEX_DEFAULT_PROJECT_PATH,
      displayName: summarizeUserText(event.text),
      lastSummary: summarizeUserText(event.text, 120)
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
      codexProjectPath: context.config.CODEX_DEFAULT_PROJECT_PATH,
      displayName: summarizeUserText(event.text),
      lastSummary: summarizeUserText(event.text, 120)
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

  app.get("/api/jobs/:jobId/events", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = context.jobs.getById(jobId);
    if (!job) {
      return reply.notFound("runtime job not found");
    }
    const after = Number((request.query as { after?: string }).after ?? 0);
    const events =
      Number.isFinite(after) && after > 0
        ? context.runtimeEvents.listByJobIdAfter(jobId, after)
        : context.runtimeEvents.listByJobId(jobId);
    return { jobId, events };
  });

  app.get("/api/jobs/:jobId/events/stream", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = context.jobs.getById(jobId);
    if (!job) {
      return reply.notFound("runtime job not found");
    }
    let lastSequence = Number((request.query as { after?: string }).after ?? 0);
    if (!Number.isFinite(lastSequence) || lastSequence < 0) {
      lastSequence = 0;
    }

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*"
    });

    const sendPendingEvents = () => {
      const events = context.runtimeEvents.listByJobIdAfter(jobId, lastSequence);
      for (const event of events) {
        lastSequence = event.sequence;
        reply.raw.write(`id: ${event.sequence}\n`);
        reply.raw.write("event: runtime_event\n");
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      const latestJob = context.jobs.getById(jobId);
      if (latestJob && !["queued", "running", "cancelling"].includes(latestJob.status)) {
        reply.raw.write("event: done\n");
        reply.raw.write(`data: ${JSON.stringify({ jobId, status: latestJob.status })}\n\n`);
        clearInterval(timer);
        reply.raw.end();
      }
    };

    const timer = setInterval(sendPendingEvents, 1000);
    request.raw.on("close", () => clearInterval(timer));
    sendPendingEvents();
    return reply;
  });

  app.post("/api/jobs/:jobId/cancel", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = await worker.cancelJob(jobId);
    if (!job) {
      return reply.notFound("runtime job not found");
    }
    return job;
  });

  app.post("/api/jobs/:jobId/retry", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const source = context.jobs.getById(jobId);
    if (!source) {
      return reply.notFound("runtime job not found");
    }
    if (source.status === "queued" || source.status === "running" || source.status === "cancelling") {
      return reply.code(409).send({
        error: "job is active",
        message: "Only failed, cancelled, or completed jobs can be retried.",
        sourceJob: source
      });
    }

    const retry = worker.retryJob(jobId);
    if (!retry) {
      return reply.code(409).send({
        error: "retry unavailable",
        message: "Retry requires an active session and the original semantic event.",
        sourceJob: source
      });
    }
    return reply.code(201).send(retry);
  });

  app.get("/api/bindings", async () => {
    const bindings = context.sessions.listActiveBindings().map((binding) => {
      const latestJob = context.jobs.getLatestByConversationId(binding.openimConversationId);
      return {
        ...binding,
        latestJobId: latestJob?.id ?? null,
        latestJobStatus: latestJob?.status ?? null,
        latestJobFailureReason: latestJob?.failureReason ?? null
      };
    });

    return { bindings };
  });

  app.get("/api/bindings/:conversationId", async (request, reply) => {
    const { conversationId: rawConversationId } = request.params as { conversationId: string };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const activeSession = context.sessions.getActiveByConversationId(conversationId);
    if (!activeSession) {
      return reply.notFound("binding not found");
    }

    return {
      openimConversationId: conversationId,
      activeSession,
      sessions: context.sessions.listByConversationId(conversationId),
      activeJob: toRuntimeJobView(context.jobs.getActiveByConversationId(conversationId)),
      latestJob: toRuntimeJobView(context.jobs.getLatestByConversationId(conversationId)),
      recentJobs: context.jobs.listRecentByConversationId(conversationId, 10).map((job) => toRuntimeJobView(job))
    };
  });

  app.post("/api/bindings/:conversationId/rebind", async (request, reply) => {
    const { conversationId: rawConversationId } = request.params as { conversationId: string };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
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
      codexSessionId: optionalString(body.codexSessionId),
      displayName: summarizeUserText(optionalString(body.displayName) ?? "New session"),
      lastSummary: summarizeUserText(optionalString(body.displayName) ?? "Manual rebind", 120)
    });

    return reply.code(201).send({
      openimConversationId: conversationId,
      activeSession: session,
      sessions: context.sessions.listByConversationId(conversationId),
      activeJob: null,
      latestJob: toRuntimeJobView(context.jobs.getLatestByConversationId(conversationId)),
      recentJobs: context.jobs.listRecentByConversationId(conversationId, 10).map((job) => toRuntimeJobView(job))
    });
  });

  app.post("/api/bindings/:conversationId/archive", async (request, reply) => {
    const { conversationId: rawConversationId } = request.params as { conversationId: string };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
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
      latestJob: toRuntimeJobView(context.jobs.getLatestByConversationId(conversationId)),
      recentJobs: context.jobs.listRecentByConversationId(conversationId, 10).map((job) => toRuntimeJobView(job))
    };
  });

  app.get("/api/conversations/:conversationId/status", async (request) => {
    const { conversationId: rawConversationId } = request.params as { conversationId: string };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const activeSession = context.sessions.getActiveByConversationId(conversationId);
    const activeJob = context.jobs.getActiveByConversationId(conversationId);
    const latestJob = context.jobs.getLatestByConversationId(conversationId);
    const recentJobs = context.jobs.listRecentByConversationId(conversationId, 10);

    return {
      openimConversationId: conversationId,
      state: deriveConversationState({ activeSession, activeJob, latestJob }),
      activeSession,
      activeJob: toRuntimeJobView(activeJob),
      latestJob: toRuntimeJobView(latestJob),
      recentJobs: recentJobs.map((job) => toRuntimeJobView(job)),
      queuedJobCount: context.jobs.countQueuedByConversationId(conversationId)
    };
  });

  app.get("/api/conversations/:conversationId/codex-sessions", async (request) => {
    const { conversationId: rawConversationId } = request.params as { conversationId: string };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    return {
      conversationId,
      sessions: context.sessions.listByConversationId(conversationId)
    };
  });

  app.post("/api/conversations/:conversationId/codex-sessions", async (request, reply) => {
    const { conversationId: rawConversationId } = request.params as { conversationId: string };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
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
      codexProjectPath: optionalString(body.codexProjectPath) ?? active?.codexProjectPath ?? context.config.CODEX_DEFAULT_PROJECT_PATH,
      displayName: summarizeUserText(optionalString(body.displayName) ?? "New session"),
      lastSummary: summarizeUserText(optionalString(body.displayName) ?? "Manual new session", 120)
    });
    const activated = context.sessions.activateSession(conversationId, session.id);
    return reply.code(201).send(activated);
  });

  app.post("/api/conversations/:conversationId/codex-sessions/:sessionRecordId/activate", async (request) => {
    const { conversationId: rawConversationId, sessionRecordId } = request.params as {
      conversationId: string;
      sessionRecordId: string;
    };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    return context.sessions.activateSession(conversationId, sessionRecordId);
  });

  app.patch("/api/conversations/:conversationId/codex-sessions/:sessionRecordId", async (request, reply) => {
    const { conversationId: rawConversationId, sessionRecordId } = request.params as {
      conversationId: string;
      sessionRecordId: string;
    };
    const body = isRecord(request.body) ? request.body : {};
    const displayName = optionalString(body.displayName);
    if (!displayName) {
      return reply.badRequest("displayName is required");
    }
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const session = context.sessions.getById(sessionRecordId);
    if (!session || session.openimConversationId !== conversationId) {
      return reply.notFound("session record not found");
    }
    return context.sessions.updateDisplayName(sessionRecordId, displayName);
  });

  app.post("/api/conversations/:conversationId/codex-sessions/:sessionRecordId/archive", async (request, reply) => {
    const { conversationId: rawConversationId, sessionRecordId } = request.params as {
      conversationId: string;
      sessionRecordId: string;
    };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const activeJob = context.jobs.getActiveByConversationId(conversationId);
    if (activeJob) {
      return reply.code(409).send({
        error: "active job exists",
        message: "Cannot archive a session while a runtime job is queued, running, or cancelling.",
        activeJob
      });
    }
    const archived = context.sessions.archiveSession(conversationId, sessionRecordId);
    if (!archived) {
      return reply.notFound("session record not found");
    }
    return archived;
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

function summarizeUserText(value: string | null | undefined, maxLength = 40): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function normalizeOpenImConversationId(conversationId: string, botUserId: string): string {
  if (conversationId.startsWith("single:")) {
    return conversationId;
  }

  if (!conversationId.startsWith("si_")) {
    return conversationId;
  }

  const suffix = `_${botUserId}`;
  const prefix = `si_${botUserId}_`;
  if (conversationId.endsWith(suffix)) {
    const humanUserId = conversationId.slice(3, -suffix.length);
    return humanUserId ? `single:${botUserId}:${humanUserId}` : conversationId;
  }
  if (conversationId.startsWith(prefix)) {
    const humanUserId = conversationId.slice(prefix.length);
    return humanUserId ? `single:${botUserId}:${humanUserId}` : conversationId;
  }

  return conversationId;
}
