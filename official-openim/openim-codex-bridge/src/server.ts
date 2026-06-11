import sensible from "@fastify/sensible";
import cors from "@fastify/cors";
import Fastify from "fastify";
import type { FastifyReply } from "fastify";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { Logger } from "pino";
import type { AppContext } from "./app-context.js";
import { shouldCreateRuntimeJob } from "./core/agent-decision.service.js";
import { parseAfterSendGroupMsgPayload, parseAfterSendSingleMsgPayload } from "./adapters/openim/openim-message.parser.js";
import { buildCodexRuntimeArgs, buildCodexRuntimeEnv, runCodexRuntimeProbe } from "./adapters/codex/codex-cli.adapter.js";
import { CodexCliRunner } from "./runtime/codex-cli.runner.js";
import { RuntimeRunnerWorker } from "./workers/runtime-runner.worker.js";
import { deriveConversationState, toRuntimeJobView } from "./core/conversation-status.js";
import { toRuntimeJobApiView, toRuntimeSessionView } from "./core/runtime-api-view.js";
import type { RuntimeKind } from "./runtime/runner.js";
import type { RuntimeProfileInput } from "./core/runtime-profile.js";
import { ConversationEventBus, type ConversationStreamEvent } from "./core/conversation-event-bus.js";
import { SemanticEventIngestService } from "./core/semantic-event-ingest.service.js";
import { buildContextPreview, ConversationContextBuilder } from "./core/conversation-context.service.js";
import { buildCodexPrompt } from "./core/prompt-builder.service.js";
import { decideContextSupplement } from "./core/context-supplement-policy.js";
import type { SemanticEvent } from "./core/semantic-event.js";
import { parseProjectPathAllowlist, validateProjectPath } from "./core/project-path-policy.js";
import { getRuntimeProfilePolicy,
  redactRuntimeProfileForPolicy,
  validateRuntimeProfileInput
} from "./core/runtime-profile-policy.js";
import { type RuntimeScopeConfig, type ScopeType } from "./core/runtime-scope-config.repository.js";

const BRIDGE_META = {
  name: "openim-codex-bridge",
  version: "0.1.0",
  apiVersion: "2026-06-06.phase3i",
  capabilities: {
    sessionMetadata: true,
    sessionActivate: true,
    sessionRename: true,
    sessionArchive: true,
    sessionRestore: true,
    sessionDelete: true,
    runtimeEvents: true,
    jobCancel: true,
    jobRetry: true,
    runtimeProfiles: true,
    runtimeApi: true,
    codexLegacyApi: true,
    templateRuntime: true,
    openaiCompatibleRuntime: true,
    openHandsRuntime: true,
    conversationEvents: true,
    sessionResumeDiagnostics: true,
    openimHistoryImport: true,
    semanticContext: true,
    groupPolicyPreview: true
  }
} as const;

export async function createServer(context: AppContext, logger: Logger) {
  const app = Fastify({ loggerInstance: logger });
  const conversationEvents = context.conversationEvents ?? new ConversationEventBus();
  context.conversationEvents = conversationEvents;
  const semanticIngest = new SemanticEventIngestService(context.semanticEvents, {
    botUserId: context.config.OPENIM_BOT_USER_ID
  });
  context.runner ??= createLegacyCodexRunner(context);
  const worker = new RuntimeRunnerWorker(context, logger);

  await app.register(cors, {
    origin: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"]
  });
  await app.register(sensible);

  app.get("/healthz", async (request) => ({ ok: true, ...buildBridgeMeta(context, request.headers) }));
  app.get("/api/meta", async (request) => buildBridgeMeta(context, request.headers));

  app.post("/api/group-policy/preview", async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {};
    const payload = isRecord(body.payload) ? body.payload : body;
    if (!isRecord(payload)) {
      return bridgeApiError(reply, 400, "openim_payload_required", "A group OpenIM callback payload is required.");
    }

    let event: SemanticEvent;
    try {
      event = parseAfterSendGroupMsgPayload(payload, {
        botUserId: context.config.OPENIM_BOT_USER_ID
      });
    } catch (error) {
      return bridgeApiError(reply, 400, "openim_payload_invalid", error instanceof Error ? error.message : String(error));
    }

    return buildGroupPolicyPreview(context, event);
  });

  app.get("/api/runtime-profiles", async (request) => {
    const includeDeleted = parseBooleanQuery((request.query as { includeDeleted?: string }).includeDeleted);
    const policy = runtimeProfilePolicyForRequest(context, request.headers);
    return {
      profiles: context.runtimeProfiles.list({ includeDeleted }).map((profile) => redactRuntimeProfileForPolicy(profile, policy))
    };
  });

  app.get("/api/runtime/profiles", async (request) => {
    const includeDeleted = parseBooleanQuery((request.query as { includeDeleted?: string }).includeDeleted);
    const policy = runtimeProfilePolicyForRequest(context, request.headers);
    return {
      runtimeKind: activeRuntimeKind(context),
      profiles: context.runtimeProfiles.list({ includeDeleted }).map((profile) => redactRuntimeProfileForPolicy(profile, policy))
    };
  });

  app.post("/api/runtime-profiles", async (request, reply) => {
    const body = isRecord(request.body) ? request.body : {};
    const name = optionalString(body.name);
    if (!name) {
      return bridgeApiError(reply, 400, "name_required", "name is required.");
    }
    try {
      const input = toRuntimeProfileInput({ ...body, name });
      const validation = validateRuntimeProfileInput(input, runtimeProfilePolicyForRequest(context, request.headers));
      if (!validation.ok) {
        return bridgeApiError(reply, 403, validation.code, validation.message);
      }
      const profile = context.runtimeProfiles.create(input);
      return reply.code(201).send(redactRuntimeProfileForPolicy(profile, runtimeProfilePolicyForRequest(context, request.headers)));
    } catch (error) {
      return bridgeApiError(reply, 400, "runtime_profile_invalid", error instanceof Error ? error.message : String(error));
    }
  });

  app.patch("/api/runtime-profiles/:profileId", async (request, reply) => {
    const { profileId } = request.params as { profileId: string };
    const body = isRecord(request.body) ? request.body : {};
    try {
      const input = toRuntimeProfileInput(body, true);
      const validation = validateRuntimeProfileInput(input, runtimeProfilePolicyForRequest(context, request.headers));
      if (!validation.ok) {
        return bridgeApiError(reply, 403, validation.code, validation.message);
      }
      const profile = context.runtimeProfiles.update(profileId, input);
      if (!profile) {
        return bridgeApiError(reply, 404, "runtime_profile_not_found", "Runtime profile not found.");
      }
      return redactRuntimeProfileForPolicy(profile, runtimeProfilePolicyForRequest(context, request.headers));
    } catch (error) {
      return bridgeApiError(reply, 400, "runtime_profile_invalid", error instanceof Error ? error.message : String(error));
    }
  });

  app.delete("/api/runtime-profiles/:profileId", async (request, reply) => {
    const policy = runtimeProfilePolicyForRequest(context, request.headers);
    if (!policy.canModify) {
      return bridgeApiError(reply, 403, "runtime_profile_admin_required", "Runtime profile modification requires backend admin authorization.");
    }
    const { profileId } = request.params as { profileId: string };
    const profile = context.runtimeProfiles.delete(profileId);
    if (!profile) {
      return bridgeApiError(reply, 404, "runtime_profile_not_found", "Runtime profile not found.");
    }
    return redactRuntimeProfileForPolicy(profile, policy);
  });

  app.post("/api/runtime-profiles/:profileId/test", async (request, reply) => {
    const policy = runtimeProfilePolicyForRequest(context, request.headers);
    if (!policy.canModify) {
      return bridgeApiError(reply, 403, "runtime_profile_admin_required", "Runtime profile test requires backend admin authorization.");
    }
    const { profileId } = request.params as { profileId: string };
    const profile = context.runtimeProfiles.getWithSecret(profileId);
    if (!profile) {
      return bridgeApiError(reply, 404, "runtime_profile_not_found", "Runtime profile not found.");
    }
    const body = isRecord(request.body) ? request.body : {};
    const shouldRunUpstreamProbe = optionalBoolean(body.upstreamProbe) ?? true;
    const shouldRunCodexProbe = optionalBoolean(body.codexProbe) ?? true;
    const probeRuntime = buildRuntimeProfileProbeInput(profile);
    const codexArgs = buildCodexRuntimeArgs(probeRuntime);
    const env = buildCodexRuntimeEnv({}, {
      apiKey: profile.apiKey ?? undefined,
      apiKeyEnvName: probeRuntime.apiKeyEnvName,
      baseUrl: profile.baseUrl ?? undefined
    });
    const upstreamProbe = shouldRunUpstreamProbe
      ? await runUpstreamProbe(profile)
      : { ok: false, skipped: true, errorText: "upstream probe disabled" };
    const codexProbe = shouldRunCodexProbe
      ? await runCodexRuntimeProbe({
          codexBin: context.config.CODEX_BIN,
          args: codexArgs,
          env,
          codexHomeDir: profile.codexHomeOverride ?? undefined,
          timeoutMs: Math.min(context.config.CODEX_EXEC_TIMEOUT_MS, 120000)
        })
      : { ok: true, skipped: true, codexArgs, env: redactRuntimeEnv(env) };
    return {
      ok: upstreamProbe.ok || codexProbe.ok,
      profile: context.runtimeProfiles.getById(profileId)
        ? redactRuntimeProfileForPolicy(context.runtimeProfiles.getById(profileId)!, policy)
        : null,
      upstreamProbe,
      codexProbe
    };
  });

  app.get("/api/runtime-scope-configs/resolve", async (request) => {
    const query = request.query as { conversationId?: string; groupId?: string };
    const config = resolveRuntimeScopeConfig(
      context,
      query.conversationId ?? undefined,
      query.groupId ?? undefined
    );
    return config;
  });

  app.put("/api/runtime-scope-configs/:scopeType/:scopeKey", async (request, reply) => {
    const { scopeType, scopeKey } = request.params as { scopeType: string; scopeKey: string };
    if (!["shared", "conversation", "group"].includes(scopeType)) {
      return bridgeApiError(reply, 400, "scope_type_invalid", "scopeType must be shared, conversation, or group.");
    }
    const body = isRecord(request.body) ? request.body : {};
    const runtimeKind = optionalString(body.runtimeKind) as RuntimeKind | null;
    const runtimeProfileId = optionalString(body.runtimeProfileId);
    const policy = runtimeProfilePolicyForRequest(context, request.headers);
    if (!policy.canModify) {
      return bridgeApiError(reply, 403, "scope_config_admin_required", "Scope config modification requires backend admin authorization.");
    }
    const config = context.scopeConfigs.upsert(scopeType as ScopeType, scopeKey, {
      runtimeKind: runtimeKind ?? context.config.RUNTIME_DEFAULT_KIND,
      runtimeProfileId
    });
    const profile = config.runtimeProfileId
      ? context.runtimeProfiles.getById(config.runtimeProfileId)
      : null;
    return {
      config,
      profile: profile ? redactRuntimeProfileForPolicy(profile, policy) : null
    };
  });

  app.delete("/api/runtime-scope-configs/:scopeType/:scopeKey", async (request, reply) => {
    const { scopeType, scopeKey } = request.params as { scopeType: string; scopeKey: string };
    if (!["shared", "conversation", "group"].includes(scopeType)) {
      return bridgeApiError(reply, 400, "scope_type_invalid", "scopeType must be shared, conversation, or group.");
    }
    const policy = runtimeProfilePolicyForRequest(context, request.headers);
    if (!policy.canModify) {
      return bridgeApiError(reply, 403, "scope_config_admin_required", "Scope config deletion requires backend admin authorization.");
    }
    const deleted = context.scopeConfigs.delete(scopeType as ScopeType, scopeKey);
    if (!deleted) {
      return bridgeApiError(reply, 404, "scope_config_not_found", "Scope config not found.");
    }
    return { deleted };
  });

  app.post("/webhooks/openim/after-send-single-msg", async (request, reply) => {
    if (!isRecord(request.body)) {
      return reply.badRequest("OpenIM callback payload must be an object");
    }

    const parsedEvent = parseAfterSendSingleMsgPayload(request.body, {
      botUserId: context.config.OPENIM_BOT_USER_ID
    });
    const ingestion = semanticIngest.ingestOpenImEvent(parsedEvent);
    const event = ingestion.event;
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
    if (!ingestion.inserted) {
      return openImCallbackOk({ ignored: true, reason: "duplicate_semantic_event", eventId: event.id });
    }

    const decision = shouldCreateRuntimeJob(event, { botUserId: context.config.OPENIM_BOT_USER_ID });
    if (!decision.shouldRun) {
      return openImCallbackOk({ ignored: true, reason: decision.reason });
    }

    const historyCommand = parseHistoryImportCommand(event.text);
    if (historyCommand) {
      const importRequest = context.openimHistory.createImportRequest({
        openimConversationId: event.openimConversationId,
        requestedCount: historyCommand.requestedCount
      });
      conversationEvents.publishHistoryImportRequested(importRequest);
      await context.openimSender.sendBotText({
        operationId: importRequest.id,
        recvId: event.senderUserId,
        text: `OpenIM history import requested (${historyCommand.requestedCount} messages). Keep this Electron client open so it can upload the local conversation history snapshot.`,
        metadata: { jobId: importRequest.id, sessionRecordId: "history_import", codexSessionId: null }
      }).catch((error: unknown) => {
        logger.warn({ err: error, importRequestId: importRequest.id }, "failed to send history import acknowledgement");
      });
      return openImCallbackOk({
        ignored: false,
        command: "load_history",
        requestedCount: historyCommand.requestedCount,
        importRequestId: importRequest.id
      });
    }

    const project = validateRequestedProjectPath(context, context.config.CODEX_DEFAULT_PROJECT_PATH);
    if (!project.ok) {
      return bridgeApiError(reply, 400, "project_path_not_allowed", "CODEX_DEFAULT_PROJECT_PATH is outside the configured workspace allowlist.", {
        diagnostics: project.diagnostics
      });
    }
    const runtime = resolveRuntimeScopeConfig(context, event.openimConversationId, event.groupId ?? undefined);
    const session = getOrCreateRuntimeSession(context, {
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: event.senderUserId,
      runtimeKind: runtime.runtimeKind,
      codexProjectPath: project.normalizedPath!,
      runtimeProfileId: runtime.runtimeProfileId,
      displayName: summarizeUserText(event.text),
      lastSummary: summarizeUserText(event.text, 120)
    });
    const job = context.jobs.createQueuedJob({
      runtimeKind: runtime.runtimeKind,
      sessionRecordId: session.id,
      semanticEventId: event.id,
      openimConversationId: event.openimConversationId,
      inputText: event.text ?? "",
      codexSessionIdBefore: session.codexSessionId
    });

    conversationEvents.publishSessionChanged(event.openimConversationId, session, "active_session_created");
    conversationEvents.publishJob("job_created", job);
    conversationEvents.publishJob("job_queued", job);
    worker.enqueue(job, event);
    return openImCallbackOk({ ignored: false, jobId: job.id, sessionRecordId: session.id });
  });

  const handleGroupOpenImCallback = async (body: unknown, reply: FastifyReply) => {
    if (!isRecord(body)) {
      return reply.badRequest("OpenIM callback payload must be an object");
    }

    const parsedEvent = parseAfterSendGroupMsgPayload(body, {
      botUserId: context.config.OPENIM_BOT_USER_ID
    });
    const ingestion = semanticIngest.ingestOpenImEvent(parsedEvent);
    const event = ingestion.event;
    logger.info(
      {
        eventId: event.id,
        openimMessageId: event.openimMessageId,
        conversationId: event.openimConversationId,
        groupID: event.groupId,
        sendID: event.senderUserId,
        contentType: event.contentType
      },
      "received OpenIM group-message callback"
    );
    if (!ingestion.inserted) {
      return openImCallbackOk({ ignored: true, reason: "duplicate_semantic_event", eventId: event.id });
    }

    const decision = shouldCreateRuntimeJob(event, {
      botUserId: context.config.OPENIM_BOT_USER_ID,
      groupBotEnabled: context.config.OPENIM_GROUP_BOT_ENABLED,
      groupAllowlist: parseConfigList(context.config.OPENIM_GROUP_ALLOWLIST),
      groupSenderAllowlist: parseConfigList(context.config.OPENIM_GROUP_SENDER_ALLOWLIST),
      groupAutoReplyPolicy: context.config.OPENIM_GROUP_AUTO_REPLY_POLICY
    });
    if (!decision.shouldRun) {
      return openImCallbackOk({ ignored: true, reason: decision.reason });
    }

    const groupProjectPath = resolveGroupProjectPath(context, event.groupId);
    if (!groupProjectPath.ok) {
      return openImCallbackOk({ ignored: true, reason: groupProjectPath.reason, groupId: event.groupId });
    }

    const project = validateRequestedProjectPath(context, groupProjectPath.projectPath);
    if (!project.ok) {
      return bridgeApiError(reply, 400, "project_path_not_allowed", "CODEX_DEFAULT_PROJECT_PATH is outside the configured workspace allowlist.", {
        diagnostics: project.diagnostics
      });
    }
    const runtime = resolveRuntimeScopeConfig(context, event.openimConversationId, event.groupId ?? undefined);
    const session = getOrCreateRuntimeSession(context, {
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: event.groupId ?? event.senderUserId,
      runtimeKind: runtime.runtimeKind,
      codexProjectPath: project.normalizedPath!,
      runtimeProfileId: runtime.runtimeProfileId,
      displayName: summarizeUserText(event.text),
      lastSummary: summarizeUserText(event.text, 120)
    });
    const job = context.jobs.createQueuedJob({
      runtimeKind: runtime.runtimeKind,
      sessionRecordId: session.id,
      semanticEventId: event.id,
      openimConversationId: event.openimConversationId,
      inputText: event.text ?? "",
      codexSessionIdBefore: session.codexSessionId
    });

    conversationEvents.publishSessionChanged(event.openimConversationId, session, "group_session_created");
    conversationEvents.publishJob("job_created", job);
    conversationEvents.publishJob("job_queued", job);
    worker.enqueue(job, event);
    return openImCallbackOk({ ignored: false, jobId: job.id, sessionRecordId: session.id });
  };

  app.post("/webhooks/openim/after-send-single-msg/:command", async (request, reply) => {
    const { command } = request.params as { command?: string };
    if (isGroupCallbackCommand(command)) {
      return handleGroupOpenImCallback(request.body, reply);
    }

    if (!isRecord(request.body)) {
      return reply.badRequest("OpenIM callback payload must be an object");
    }

    const parsedEvent = parseAfterSendSingleMsgPayload(request.body, {
      botUserId: context.config.OPENIM_BOT_USER_ID
    });
    const ingestion = semanticIngest.ingestOpenImEvent(parsedEvent);
    const event = ingestion.event;
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
    if (!ingestion.inserted) {
      return openImCallbackOk({ ignored: true, reason: "duplicate_semantic_event", eventId: event.id });
    }

    const decision = shouldCreateRuntimeJob(event, { botUserId: context.config.OPENIM_BOT_USER_ID });
    if (!decision.shouldRun) {
      return openImCallbackOk({ ignored: true, reason: decision.reason });
    }

    const historyCommand = parseHistoryImportCommand(event.text);
    if (historyCommand) {
      const importRequest = context.openimHistory.createImportRequest({
        openimConversationId: event.openimConversationId,
        requestedCount: historyCommand.requestedCount
      });
      conversationEvents.publishHistoryImportRequested(importRequest);
      await context.openimSender.sendBotText({
        operationId: importRequest.id,
        recvId: event.senderUserId,
        text: `OpenIM history import requested (${historyCommand.requestedCount} messages). Keep this Electron client open so it can upload the local conversation history snapshot.`,
        metadata: { jobId: importRequest.id, sessionRecordId: "history_import", codexSessionId: null }
      }).catch((error: unknown) => {
        logger.warn({ err: error, importRequestId: importRequest.id }, "failed to send history import acknowledgement");
      });
      return openImCallbackOk({
        ignored: false,
        command: "load_history",
        requestedCount: historyCommand.requestedCount,
        importRequestId: importRequest.id
      });
    }

    const project = validateRequestedProjectPath(context, context.config.CODEX_DEFAULT_PROJECT_PATH);
    if (!project.ok) {
      return bridgeApiError(reply, 400, "project_path_not_allowed", "CODEX_DEFAULT_PROJECT_PATH is outside the configured workspace allowlist.", {
        diagnostics: project.diagnostics
      });
    }
    const runtime = resolveRuntimeScopeConfig(context, event.openimConversationId, event.groupId ?? undefined);
    const session = getOrCreateRuntimeSession(context, {
      openimConversationId: event.openimConversationId,
      openimDisplayUserId: event.senderUserId,
      runtimeKind: runtime.runtimeKind,
      codexProjectPath: project.normalizedPath!,
      runtimeProfileId: runtime.runtimeProfileId,
      displayName: summarizeUserText(event.text),
      lastSummary: summarizeUserText(event.text, 120)
    });
    const job = context.jobs.createQueuedJob({
      runtimeKind: runtime.runtimeKind,
      sessionRecordId: session.id,
      semanticEventId: event.id,
      openimConversationId: event.openimConversationId,
      inputText: event.text ?? "",
      codexSessionIdBefore: session.codexSessionId
    });

    conversationEvents.publishSessionChanged(event.openimConversationId, session, "active_session_created");
    conversationEvents.publishJob("job_created", job);
    conversationEvents.publishJob("job_queued", job);
    worker.enqueue(job, event);
    return openImCallbackOk({ ignored: false, jobId: job.id, sessionRecordId: session.id });
  });

  app.post("/webhooks/openim/after-send-group-msg", async (request, reply) => {
    return handleGroupOpenImCallback(request.body, reply);
  });

  app.post("/webhooks/openim/after-send-group-msg/:command", async (request, reply) => {
    return handleGroupOpenImCallback(request.body, reply);
  });

  app.get("/api/jobs/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = context.jobs.getById(jobId);
    if (!job) {
      return reply.notFound("runtime job not found");
    }
    return job;
  });

  app.get("/api/runtime/jobs/:jobId", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = context.jobs.getById(jobId);
    if (!job) {
      return reply.notFound("runtime job not found");
    }
    return toRuntimeJobApiView(toRuntimeJobView(job), activeRuntimeKind(context));
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

  app.get("/api/runtime/jobs/:jobId/events", async (request, reply) => {
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
    return { jobId, runtimeKind: activeRuntimeKind(context), events };
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

  app.get("/api/runtime/jobs/:jobId/events/stream", async (request, reply) => {
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
        reply.raw.write(`data: ${JSON.stringify({ runtimeKind: activeRuntimeKind(context), ...event })}\n\n`);
      }
      const latestJob = context.jobs.getById(jobId);
      if (latestJob && !["queued", "running", "cancelling"].includes(latestJob.status)) {
        reply.raw.write("event: done\n");
        reply.raw.write(`data: ${JSON.stringify({ jobId, runtimeKind: activeRuntimeKind(context), status: latestJob.status })}\n\n`);
        clearInterval(timer);
        reply.raw.end();
      }
    };

    const timer = setInterval(sendPendingEvents, 1000);
    request.raw.on("close", () => clearInterval(timer));
    sendPendingEvents();
    return reply;
  });

  app.get("/api/conversations/:conversationId/events/stream", async (request, reply) => {
    const { conversationId: rawConversationId } = request.params as { conversationId: string };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);

    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "access-control-allow-origin": "*"
    });

    const writeEvent = (event: ConversationStreamEvent) => {
      reply.raw.write(`id: ${event.id}\n`);
      reply.raw.write(`event: ${event.type}\n`);
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };
    const unsubscribe = conversationEvents.subscribe(conversationId, writeEvent);
    const heartbeat = setInterval(() => {
      reply.raw.write(": keep-alive\n\n");
    }, 15000);
    request.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
    reply.raw.write("event: connected\n");
    reply.raw.write(`data: ${JSON.stringify({ conversationId })}\n\n`);
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

  app.post("/api/runtime/jobs/:jobId/cancel", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const job = await worker.cancelJob(jobId);
    if (!job) {
      return reply.notFound("runtime job not found");
    }
    return toRuntimeJobApiView(toRuntimeJobView(job), activeRuntimeKind(context));
  });

  app.post("/api/jobs/:jobId/retry", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const source = context.jobs.getById(jobId);
    if (!source) {
      return reply.notFound("runtime job not found");
    }
    if (source.status === "queued" || source.status === "running" || source.status === "cancelling") {
      return bridgeApiError(reply, 409, "job_active", "Only failed, cancelled, or completed jobs can be retried.", {
        sourceJob: source
      });
    }

    const retry = worker.retryJob(jobId);
    if (!retry) {
      return bridgeApiError(reply, 409, "retry_unavailable", "Retry requires an active session and the original semantic event.", {
        sourceJob: source
      });
    }
    return reply.code(201).send(retry);
  });

  app.post("/api/runtime/jobs/:jobId/retry", async (request, reply) => {
    const { jobId } = request.params as { jobId: string };
    const source = context.jobs.getById(jobId);
    if (!source) {
      return reply.notFound("runtime job not found");
    }
    if (source.status === "queued" || source.status === "running" || source.status === "cancelling") {
      return bridgeApiError(reply, 409, "job_active", "Only failed, cancelled, or completed jobs can be retried.", {
        sourceJob: toRuntimeJobApiView(toRuntimeJobView(source), activeRuntimeKind(context))
      });
    }

    const retry = worker.retryJob(jobId);
    if (!retry) {
      return bridgeApiError(reply, 409, "retry_unavailable", "Retry requires an active session and the original semantic event.", {
        sourceJob: toRuntimeJobApiView(toRuntimeJobView(source), activeRuntimeKind(context))
      });
    }
    return reply.code(201).send(toRuntimeJobApiView(toRuntimeJobView(retry), activeRuntimeKind(context)));
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
      return bridgeApiError(reply, 409, "active_job_exists", "Cannot rebind while a runtime job is queued, running, or cancelling.", {
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

    const project = validateRequestedProjectPath(
      context,
      optionalString(body.codexProjectPath) ?? activeSession?.codexProjectPath ?? context.config.CODEX_DEFAULT_PROJECT_PATH
    );
    if (!project.ok) {
      return bridgeApiError(reply, 400, "project_path_not_allowed", "Project path is outside the configured workspace allowlist.", {
        diagnostics: project.diagnostics
      });
    }

    const session = context.sessions.rebindConversation({
      openimConversationId: conversationId,
      openimDisplayUserId,
      runtimeKind: activeRuntimeKind(context),
      codexProjectPath: project.normalizedPath!,
      codexSessionId: optionalString(body.codexSessionId),
      runtimeProfileId: optionalString(body.runtimeProfileId) ?? activeSession?.runtimeProfileId ?? null,
      displayName: summarizeUserText(optionalString(body.displayName) ?? "New session"),
      lastSummary: summarizeUserText(optionalString(body.displayName) ?? "Manual rebind", 120)
    });
    conversationEvents.publishBindingChanged(conversationId, { activeSession: session, reason: "manual_rebind" });
    conversationEvents.publishSessionChanged(conversationId, session, "manual_rebind");

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
      return bridgeApiError(reply, 409, "active_job_exists", "Cannot archive while a runtime job is queued, running, or cancelling.", {
        activeJob
      });
    }

    const archivedSession = context.sessions.archiveActiveBinding(conversationId);
    if (!archivedSession) {
      return reply.notFound("binding not found");
    }
    conversationEvents.publishBindingChanged(conversationId, { archivedSession, activeSession: null, reason: "binding_archived" });

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
      queuedJobCount: context.jobs.countQueuedByConversationId(conversationId),
      pendingHistoryImport: context.openimHistory.getPendingByConversationId(conversationId)
    };
  });

  app.get("/api/conversations/:conversationId/runtime-status", async (request) => {
    const { conversationId: rawConversationId } = request.params as { conversationId: string };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const activeSession = context.sessions.getActiveByConversationId(conversationId);
    const activeJob = context.jobs.getActiveByConversationId(conversationId);
    const latestJob = context.jobs.getLatestByConversationId(conversationId);
    const recentJobs = context.jobs.listRecentByConversationId(conversationId, 10);
    const runtime = resolveRuntimeScopeConfig(context, conversationId, groupIdFromConversationId(conversationId));

    return {
      openimConversationId: conversationId,
      runtimeKind: runtime.runtimeKind,
      state: deriveConversationState({ activeSession, activeJob, latestJob }),
      activeSession: toRuntimeSessionView(activeSession, runtime.runtimeKind),
      activeJob: toRuntimeJobApiView(toRuntimeJobView(activeJob), runtime.runtimeKind),
      latestJob: toRuntimeJobApiView(toRuntimeJobView(latestJob), runtime.runtimeKind),
      recentJobs: recentJobs.map((job) => toRuntimeJobApiView(toRuntimeJobView(job), runtime.runtimeKind)),
      queuedJobCount: context.jobs.countQueuedByConversationId(conversationId),
      pendingHistoryImport: context.openimHistory.getPendingByConversationId(conversationId)
    };
  });

  app.get("/api/conversations/:conversationId/codex-sessions", async (request) => {
    const { conversationId: rawConversationId } = request.params as { conversationId: string };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const query = request.query as { includeArchived?: string; includeDeleted?: string };
    return {
      conversationId,
      sessions: context.sessions.listByConversationId(conversationId, {
        includeArchived: parseBooleanQuery(query.includeArchived, true),
        includeDeleted: parseBooleanQuery(query.includeDeleted)
      })
    };
  });

  app.get("/api/conversations/:conversationId/runtime-sessions", async (request) => {
    const { conversationId: rawConversationId } = request.params as { conversationId: string };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const query = request.query as { includeArchived?: string; includeDeleted?: string };
    const runtime = resolveRuntimeScopeConfig(context, conversationId, groupIdFromConversationId(conversationId));
    return {
      conversationId,
      runtimeKind: runtime.runtimeKind,
      sessions: context.sessions.listByConversationId(conversationId, {
        includeArchived: parseBooleanQuery(query.includeArchived, true),
        includeDeleted: parseBooleanQuery(query.includeDeleted)
      }).map((session) => toRuntimeSessionView(session, runtime.runtimeKind))
    };
  });

  app.get("/api/conversations/:conversationId/codex-sessions/:sessionRecordId/diagnostics", async (request, reply) => {
    const { conversationId: rawConversationId, sessionRecordId } = request.params as {
      conversationId: string;
      sessionRecordId: string;
    };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const session = context.sessions.getById(sessionRecordId);
    if (!session || session.openimConversationId !== conversationId) {
      return bridgeApiError(reply, 404, "session_not_found", "Session record not found.");
    }
    const latestJob = context.jobs.listRecentByConversationId(conversationId, 50).find((job) => job.sessionRecordId === session.id) ?? null;
    const homeExists = Boolean(session.codexHomeDir && existsSync(session.codexHomeDir));
    const rolloutExists = Boolean(session.codexSessionId && session.codexHomeDir && hasRolloutFile(session.codexHomeDir, session.codexSessionId));
    const lastResumeFailure = latestJob && latestJob.codexSessionIdBefore && latestJob.codexSessionIdAfter && latestJob.codexSessionIdBefore !== latestJob.codexSessionIdAfter
      ? "fallback_new_task"
      : null;
    return {
      conversationId,
      sessionRecordId: session.id,
      codexSessionId: session.codexSessionId,
      codexHomeDir: session.codexHomeDir,
      homeExists,
      rolloutExists,
      resumeReady: Boolean(session.codexSessionId && homeExists && rolloutExists),
      lastJobId: latestJob?.id ?? null,
      lastResumeFailure,
      projectPathValidation: validateRequestedProjectPath(context, session.codexProjectPath).diagnostics
    };
  });

  app.get("/api/conversations/:conversationId/semantic-events", async (request) => {
    const { conversationId: rawConversationId } = request.params as { conversationId: string };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const query = request.query as { limit?: string; includeRuntime?: string };
    return {
      conversationID: conversationId,
      events: context.semanticEvents.listByConversationId(conversationId, {
        limit: parsePositiveInteger(query.limit, 200),
        includeRuntime: parseBooleanQuery(query.includeRuntime)
      })
    };
  });

  app.get("/api/conversations/:conversationId/context/summary", async (request) => {
    const { conversationId: rawConversationId } = request.params as { conversationId: string };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    return {
      conversationID: conversationId,
      summary: context.conversationSummaries.get(conversationId)
    };
  });

  app.post("/api/conversations/:conversationId/context/summarize", async (request) => {
    const { conversationId: rawConversationId } = request.params as { conversationId: string };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const recentLimit = parsePositiveInteger((request.query as { recentLimit?: string }).recentLimit, 30);
    const events = context.semanticEvents.listByConversationId(conversationId, { limit: 1000 });
    const olderEvents = events.slice(0, Math.max(0, events.length - recentLimit)).filter((event) => event.text);
    const summary = context.conversationSummaries.upsert({
      conversationID: conversationId,
      summaryText: buildDeterministicSummaryText(olderEvents),
      coveredEventIDs: olderEvents.map((event) => event.id),
      coveredEventUntilTimestamp: olderEvents.at(-1)?.timestamp,
      importantDecisions: extractImportantLines(olderEvents),
      unresolvedTasks: extractUnresolvedTasks(olderEvents)
    });
    return { conversationID: conversationId, summary };
  });

  app.get("/api/conversations/:conversationId/context/preview", async (request) => {
    const { conversationId: rawConversationId } = request.params as { conversationId: string };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const query = request.query as { includePrompt?: string; recentLimit?: string };
    const builder = new ConversationContextBuilder({
      semanticEvents: context.semanticEvents,
      summaries: context.conversationSummaries,
      sessions: context.sessions,
      recentLimit: parsePositiveInteger(query.recentLimit, 30)
    });
    const conversationContext = builder.build(conversationId);
    const activeSession = context.sessions.getActiveByConversationId(conversationId);
    const currentEvent = conversationContext.recentEvents.at(-1);
    const supplement = activeSession && currentEvent
      ? decideContextSupplement({
          session: activeSession,
          currentEvent,
          recentEvents: conversationContext.recentEvents,
          diagnosticsPreview: parseBooleanQuery(query.includePrompt)
        })
      : undefined;
    const promptPreview = parseBooleanQuery(query.includePrompt)
      ? buildCodexPrompt({ context: conversationContext })
      : undefined;
    return buildContextPreview(conversationContext, promptPreview, supplement);
  });

  app.post("/api/conversations/:conversationId/openim-history-snapshots", async (request, reply) => {
    const { conversationId: rawConversationId } = request.params as { conversationId: string };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const body = isRecord(request.body) ? request.body : {};
    const messages = Array.isArray(body.messages) ? body.messages : [];
    if (!messages.length) {
      return bridgeApiError(reply, 400, "history_messages_required", "messages is required.");
    }
    const snapshot = context.openimHistory.createSnapshot({
      requestId: optionalString(body.requestId),
      openimConversationId: conversationId,
      source: optionalString(body.source) ?? "electron-sdk",
      messages: messages.map(toHistoryMessage)
    });
    const importResult = semanticIngest.importHistorySnapshot({
      conversationID: conversationId,
      messages: snapshot.messages
    });
    conversationEvents.publish("history_import_requested", conversationId, { snapshot, status: "fulfilled" });
    return reply.code(201).send({
      ...importResult,
      messageCount: snapshot.messageCount,
      snapshotId: snapshot.id,
      requestId: snapshot.requestId
    });
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

    const project = validateRequestedProjectPath(
      context,
      optionalString(body.codexProjectPath) ?? active?.codexProjectPath ?? context.config.CODEX_DEFAULT_PROJECT_PATH
    );
    if (!project.ok) {
      return bridgeApiError(reply, 400, "project_path_not_allowed", "Project path is outside the configured workspace allowlist.", {
        diagnostics: project.diagnostics
      });
    }

    const session = context.sessions.createAdditionalSession({
      openimConversationId: conversationId,
      openimDisplayUserId: displayUserId,
      runtimeKind: activeRuntimeKind(context),
      codexProjectPath: project.normalizedPath!,
      runtimeProfileId: optionalString(body.runtimeProfileId) ?? active?.runtimeProfileId ?? null,
      displayName: summarizeUserText(optionalString(body.displayName) ?? "New session"),
      lastSummary: summarizeUserText(optionalString(body.displayName) ?? "Manual new session", 120)
    });
    const activated = context.sessions.activateSession(conversationId, session.id);
    conversationEvents.publishSessionChanged(conversationId, activated, "manual_new_session");
    conversationEvents.publishBindingChanged(conversationId, { activeSession: activated, reason: "manual_new_session" });
    return reply.code(201).send(activated);
  });

  app.post("/api/conversations/:conversationId/runtime-sessions", async (request, reply) => {
    const { conversationId: rawConversationId } = request.params as { conversationId: string };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const body = isRecord(request.body) ? request.body : {};
    const active = context.sessions.getActiveByConversationId(conversationId);
    const displayUserId =
      optionalString(body.openimDisplayUserId) ?? active?.openimDisplayUserId ?? optionalString(body.userId);
    if (!displayUserId) {
      return reply.badRequest("openimDisplayUserId is required when the conversation is unknown");
    }

    const project = validateRequestedProjectPath(
      context,
      optionalString(body.projectPath) ?? optionalString(body.codexProjectPath) ?? active?.codexProjectPath ?? context.config.CODEX_DEFAULT_PROJECT_PATH
    );
    if (!project.ok) {
      return bridgeApiError(reply, 400, "project_path_not_allowed", "Project path is outside the configured workspace allowlist.", {
        diagnostics: project.diagnostics
      });
    }

    const session = context.sessions.createAdditionalSession({
      openimConversationId: conversationId,
      openimDisplayUserId: displayUserId,
      runtimeKind: activeRuntimeKind(context),
      codexProjectPath: project.normalizedPath!,
      runtimeProfileId: optionalString(body.runtimeProfileId) ?? active?.runtimeProfileId ?? null,
      displayName: summarizeUserText(optionalString(body.displayName) ?? "New session"),
      lastSummary: summarizeUserText(optionalString(body.displayName) ?? "Manual new session", 120)
    });
    const activated = context.sessions.activateSession(conversationId, session.id);
    conversationEvents.publishSessionChanged(conversationId, activated, "manual_new_runtime_session");
    conversationEvents.publishBindingChanged(conversationId, { activeSession: activated, reason: "manual_new_runtime_session" });
    return reply.code(201).send(toRuntimeSessionView(activated, activeRuntimeKind(context)));
  });

  app.post("/api/conversations/:conversationId/codex-sessions/:sessionRecordId/activate", async (request, reply) => {
    const { conversationId: rawConversationId, sessionRecordId } = request.params as {
      conversationId: string;
      sessionRecordId: string;
    };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const activeJob = context.jobs.getActiveByConversationId(conversationId);
    if (activeJob) {
      return bridgeApiError(reply, 409, "active_job_exists", "Cannot activate a session while a runtime job is queued, running, or cancelling.", {
        activeJob
      });
    }
    const session = context.sessions.getById(sessionRecordId);
    if (!session || session.openimConversationId !== conversationId) {
      return bridgeApiError(reply, 404, "session_not_found", "Session record not found.");
    }
    if (session.status === "archived") {
      return bridgeApiError(reply, 409, "session_archived", "Archived sessions cannot be activated.", {
        session
      });
    }
    const activated = context.sessions.activateSession(conversationId, sessionRecordId);
    conversationEvents.publishSessionChanged(conversationId, activated, "manual_activate");
    conversationEvents.publishBindingChanged(conversationId, { activeSession: activated, reason: "manual_activate" });
    return activated;
  });

  app.post("/api/conversations/:conversationId/runtime-sessions/:sessionRecordId/activate", async (request, reply) => {
    const { conversationId: rawConversationId, sessionRecordId } = request.params as {
      conversationId: string;
      sessionRecordId: string;
    };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const activeJob = context.jobs.getActiveByConversationId(conversationId);
    if (activeJob) {
      return bridgeApiError(reply, 409, "active_job_exists", "Cannot activate a session while a runtime job is queued, running, or cancelling.", {
        activeJob: toRuntimeJobApiView(toRuntimeJobView(activeJob), activeRuntimeKind(context))
      });
    }
    const session = context.sessions.getById(sessionRecordId);
    if (!session || session.openimConversationId !== conversationId) {
      return bridgeApiError(reply, 404, "session_not_found", "Session record not found.");
    }
    if (session.status === "archived") {
      return bridgeApiError(reply, 409, "session_archived", "Archived sessions cannot be activated.", {
        session: toRuntimeSessionView(session, activeRuntimeKind(context))
      });
    }
    const activated = context.sessions.activateSession(conversationId, sessionRecordId);
    conversationEvents.publishSessionChanged(conversationId, activated, "manual_runtime_activate");
    conversationEvents.publishBindingChanged(conversationId, { activeSession: activated, reason: "manual_runtime_activate" });
    return toRuntimeSessionView(activated, activeRuntimeKind(context));
  });

  app.patch("/api/conversations/:conversationId/codex-sessions/:sessionRecordId", async (request, reply) => {
    const { conversationId: rawConversationId, sessionRecordId } = request.params as {
      conversationId: string;
      sessionRecordId: string;
    };
    const body = isRecord(request.body) ? request.body : {};
    const displayName = optionalString(body.displayName);
    if (!displayName) {
      return bridgeApiError(reply, 400, "display_name_required", "displayName is required.");
    }
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const session = context.sessions.getById(sessionRecordId);
    if (!session || session.openimConversationId !== conversationId) {
      return bridgeApiError(reply, 404, "session_not_found", "Session record not found.");
    }
    const updated = context.sessions.updateDisplayName(sessionRecordId, displayName);
    conversationEvents.publishSessionChanged(conversationId, updated, "manual_rename");
    return updated;
  });

  app.patch("/api/conversations/:conversationId/runtime-sessions/:sessionRecordId", async (request, reply) => {
    const { conversationId: rawConversationId, sessionRecordId } = request.params as {
      conversationId: string;
      sessionRecordId: string;
    };
    const body = isRecord(request.body) ? request.body : {};
    const displayName = optionalString(body.displayName);
    if (!displayName) {
      return bridgeApiError(reply, 400, "display_name_required", "displayName is required.");
    }
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const session = context.sessions.getById(sessionRecordId);
    if (!session || session.openimConversationId !== conversationId) {
      return bridgeApiError(reply, 404, "session_not_found", "Session record not found.");
    }
    const updated = context.sessions.updateDisplayName(sessionRecordId, displayName);
    conversationEvents.publishSessionChanged(conversationId, updated, "manual_runtime_rename");
    return toRuntimeSessionView(updated, activeRuntimeKind(context));
  });

  app.post("/api/conversations/:conversationId/codex-sessions/:sessionRecordId/archive", async (request, reply) => {
    const { conversationId: rawConversationId, sessionRecordId } = request.params as {
      conversationId: string;
      sessionRecordId: string;
    };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const activeJob = context.jobs.getActiveByConversationId(conversationId);
    if (activeJob) {
      return bridgeApiError(reply, 409, "active_job_exists", "Cannot archive a session while a runtime job is queued, running, or cancelling.", {
        activeJob
      });
    }
    const archived = context.sessions.archiveSession(conversationId, sessionRecordId);
    if (!archived) {
      return bridgeApiError(reply, 404, "session_not_found", "Session record not found.");
    }
    conversationEvents.publishSessionChanged(conversationId, archived, "manual_archive");
    conversationEvents.publishBindingChanged(conversationId, { session: archived, reason: "manual_archive" });
    return archived;
  });

  app.post("/api/conversations/:conversationId/runtime-sessions/:sessionRecordId/archive", async (request, reply) => {
    const { conversationId: rawConversationId, sessionRecordId } = request.params as {
      conversationId: string;
      sessionRecordId: string;
    };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const activeJob = context.jobs.getActiveByConversationId(conversationId);
    if (activeJob) {
      return bridgeApiError(reply, 409, "active_job_exists", "Cannot archive a session while a runtime job is queued, running, or cancelling.", {
        activeJob: toRuntimeJobApiView(toRuntimeJobView(activeJob), activeRuntimeKind(context))
      });
    }
    const archived = context.sessions.archiveSession(conversationId, sessionRecordId);
    if (!archived) {
      return bridgeApiError(reply, 404, "session_not_found", "Session record not found.");
    }
    conversationEvents.publishSessionChanged(conversationId, archived, "manual_runtime_archive");
    conversationEvents.publishBindingChanged(conversationId, { session: archived, reason: "manual_runtime_archive" });
    return toRuntimeSessionView(archived, activeRuntimeKind(context));
  });

  app.post("/api/conversations/:conversationId/codex-sessions/:sessionRecordId/restore", async (request, reply) => {
    const { conversationId: rawConversationId, sessionRecordId } = request.params as {
      conversationId: string;
      sessionRecordId: string;
    };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const activeJob = context.jobs.getActiveByConversationId(conversationId);
    if (activeJob) {
      return bridgeApiError(reply, 409, "active_job_exists", "Cannot restore a session while a runtime job is queued, running, or cancelling.", {
        activeJob
      });
    }
    const restored = context.sessions.restoreSession(conversationId, sessionRecordId);
    if (!restored) {
      return bridgeApiError(reply, 404, "session_not_found", "Session record not found.");
    }
    conversationEvents.publishSessionChanged(conversationId, restored, "manual_restore");
    return restored;
  });

  app.delete("/api/conversations/:conversationId/codex-sessions/:sessionRecordId", async (request, reply) => {
    const { conversationId: rawConversationId, sessionRecordId } = request.params as {
      conversationId: string;
      sessionRecordId: string;
    };
    const conversationId = normalizeOpenImConversationId(rawConversationId, context.config.OPENIM_BOT_USER_ID);
    const activeJob = context.jobs.getActiveByConversationId(conversationId);
    if (activeJob) {
      return bridgeApiError(reply, 409, "active_job_exists", "Cannot delete a session while a runtime job is queued, running, or cancelling.", {
        activeJob
      });
    }
    const deleted = context.sessions.deleteSession(conversationId, sessionRecordId);
    if (!deleted) {
      return bridgeApiError(reply, 404, "session_not_found", "Session record not found.");
    }
    conversationEvents.publishSessionChanged(conversationId, deleted, "manual_delete");
    return deleted;
  });

  return app;
}

function buildGroupPolicyPreview(context: AppContext, event: SemanticEvent) {
  const groupAllowlist = parseConfigList(context.config.OPENIM_GROUP_ALLOWLIST);
  const groupSenderAllowlist = parseConfigList(context.config.OPENIM_GROUP_SENDER_ALLOWLIST);
  const decision = shouldCreateRuntimeJob(event, {
    botUserId: context.config.OPENIM_BOT_USER_ID,
    groupBotEnabled: context.config.OPENIM_GROUP_BOT_ENABLED,
    groupAllowlist,
    groupSenderAllowlist,
    groupAutoReplyPolicy: context.config.OPENIM_GROUP_AUTO_REPLY_POLICY
  });
  const bindings = parseConfigMap(context.config.OPENIM_GROUP_PROJECT_BINDINGS);
  const binding = decision.shouldRun ? resolveGroupProjectPath(context, event.groupId) : null;
  const project = binding?.ok ? validateRequestedProjectPath(context, binding.projectPath) : null;
  const wouldCreateJob = decision.shouldRun && Boolean(binding?.ok) && Boolean(project?.ok);
  const reason = decision.shouldRun
    ? binding?.ok
      ? project?.ok
        ? "would_create_job"
        : "project_path_not_allowed"
      : binding?.reason
    : decision.reason;

  return {
    wouldCreateJob,
    reason,
    decision,
    event: {
      openimConversationId: event.openimConversationId,
      groupId: event.groupId,
      senderUserId: event.senderUserId,
      contentType: event.contentType,
      eventType: event.eventType,
      metadata: event.metadata ?? {}
    },
    policy: {
      groupBotEnabled: context.config.OPENIM_GROUP_BOT_ENABLED,
      autoReplyPolicy: context.config.OPENIM_GROUP_AUTO_REPLY_POLICY,
      groupAllowlistConfigured: groupAllowlist.length > 0,
      groupSenderAllowlistConfigured: groupSenderAllowlist.length > 0,
      requireBinding: context.config.OPENIM_GROUP_REQUIRE_BINDING
    },
    binding: {
      evaluated: decision.shouldRun,
      hasGroupBinding: Boolean(event.groupId && bindings.has(event.groupId)),
      usedDefaultProject: Boolean(binding?.ok && event.groupId && !bindings.has(event.groupId)),
      ok: binding?.ok ?? false,
      reason: binding ? binding.ok ? "allowed" : binding.reason : "not_evaluated"
    },
    projectPathPolicy: project
      ? {
          evaluated: true,
          ok: project.ok,
          reason: project.reason,
          matchedWorkspaceConfigured: Boolean(project.diagnostics.matchedWorkspace),
          allowlistConfigured: project.diagnostics.allowlist.length > 0
        }
      : {
          evaluated: false,
          ok: false,
          reason: binding ? binding.ok ? "not_evaluated" : binding.reason : "not_evaluated",
          matchedWorkspaceConfigured: false,
          allowlistConfigured: parseProjectPathAllowlist(context.config.CODEX_WORKSPACE_ALLOWLIST, context.config.CODEX_DEFAULT_PROJECT_PATH).length > 0
        }
  };
}

function openImCallbackOk(data: Record<string, unknown>) {
  return {
    actionCode: 0,
    errCode: 0,
    errMsg: "",
    data
  };
}

type HeaderBag = Record<string, string | string[] | undefined>;

function buildBridgeMeta(context: AppContext, headers: HeaderBag) {
  return {
    ...BRIDGE_META,
    runtimeKind: activeRuntimeKind(context),
    runtimePolicy: runtimeProfilePolicyForRequest(context, headers),
    projectPathPolicy: {
      allowlist: parseProjectPathAllowlist(context.config.CODEX_WORKSPACE_ALLOWLIST, context.config.CODEX_DEFAULT_PROJECT_PATH)
    },
    groupBotPolicy: {
      enabled: context.config.OPENIM_GROUP_BOT_ENABLED,
      autoReplyPolicy: context.config.OPENIM_GROUP_AUTO_REPLY_POLICY,
      groupAllowlist: parseConfigList(context.config.OPENIM_GROUP_ALLOWLIST),
      senderAllowlist: parseConfigList(context.config.OPENIM_GROUP_SENDER_ALLOWLIST),
      requireBinding: context.config.OPENIM_GROUP_REQUIRE_BINDING,
      boundGroups: Array.from(parseConfigMap(context.config.OPENIM_GROUP_PROJECT_BINDINGS).keys())
    }
  };
}

function runtimeProfilePolicyForRequest(context: AppContext, headers: HeaderBag) {
  return getRuntimeProfilePolicy({
    environment: context.config.NODE_ENV,
    adminTokenConfigured: Boolean(context.config.CODEX_RUNTIME_ADMIN_TOKEN),
    isAdmin: isAdminRequest(context, headers)
  });
}

function activeRuntimeKind(context: AppContext): RuntimeKind {
  return context.runner?.kind ?? context.config.RUNTIME_DEFAULT_KIND;
}

function isAdminRequest(context: AppContext, headers: HeaderBag): boolean {
  if (!context.config.CODEX_RUNTIME_ADMIN_TOKEN) {
    return context.config.NODE_ENV !== "production";
  }
  const header = headers["x-codex-admin-token"];
  const value = Array.isArray(header) ? header[0] : header;
  return value === context.config.CODEX_RUNTIME_ADMIN_TOKEN;
}

function resolveRuntimeScopeConfig(
  context: AppContext,
  conversationId?: string,
  groupId?: string
) {
  const policy = getRuntimeProfilePolicy({
    environment: context.config.NODE_ENV,
    adminTokenConfigured: Boolean(context.config.CODEX_RUNTIME_ADMIN_TOKEN),
    isAdmin: true
  });

  if (!context.scopeConfigs) {
    return {
      source: "env" as const,
      runtimeKind: activeRuntimeKind(context),
      runtimeProfileId: null,
      config: null,
      profile: null
    };
  }

  const groupConfig = groupId ? context.scopeConfigs.getByScope("group", groupId) : null;
  if (groupConfig) {
    const profile = groupConfig.runtimeProfileId ? context.runtimeProfiles.getById(groupConfig.runtimeProfileId) : null;
    return {
      source: "group" as const,
      runtimeKind: groupConfig.runtimeKind,
      runtimeProfileId: groupConfig.runtimeProfileId,
      config: groupConfig,
      profile: profile ? redactRuntimeProfileForPolicy(profile, policy) : null
    };
  }

  const conversationConfig = conversationScopeKeys(conversationId, groupId, context.config.OPENIM_BOT_USER_ID)
    .map((scopeKey) => context.scopeConfigs.getByScope("conversation", scopeKey))
    .find((config): config is RuntimeScopeConfig => Boolean(config)) ?? null;
  if (conversationConfig) {
    const profile = conversationConfig.runtimeProfileId ? context.runtimeProfiles.getById(conversationConfig.runtimeProfileId) : null;
    return {
      source: "conversation" as const,
      runtimeKind: conversationConfig.runtimeKind,
      runtimeProfileId: conversationConfig.runtimeProfileId,
      config: conversationConfig,
      profile: profile ? redactRuntimeProfileForPolicy(profile, policy) : null
    };
  }

  const sharedConfig = context.scopeConfigs.getByScope("shared", "__shared__");
  if (sharedConfig) {
    const profile = sharedConfig.runtimeProfileId ? context.runtimeProfiles.getById(sharedConfig.runtimeProfileId) : null;
    return {
      source: "shared" as const,
      runtimeKind: sharedConfig.runtimeKind,
      runtimeProfileId: sharedConfig.runtimeProfileId,
      config: sharedConfig,
      profile: profile ? redactRuntimeProfileForPolicy(profile, policy) : null
    };
  }

  return {
    source: "env" as const,
    runtimeKind: activeRuntimeKind(context),
    runtimeProfileId: null,
    config: null,
    profile: null
  };
}

function getOrCreateRuntimeSession(
  context: AppContext,
  input: {
    openimConversationId: string;
    openimDisplayUserId: string;
    runtimeKind: RuntimeKind;
    codexProjectPath: string;
    runtimeProfileId: string | null;
    displayName: string | null;
    lastSummary: string | null;
  }
) {
  const existing = context.sessions.getActiveByConversationId(input.openimConversationId);
  if (
    existing &&
    (existing.runtimeKind !== input.runtimeKind ||
      (existing.runtimeProfileId ?? null) !== input.runtimeProfileId)
  ) {
    return context.sessions.rebindConversation(input);
  }
  return context.sessions.getOrCreateActiveSession(input);
}

function conversationScopeKeys(conversationId: string | undefined, groupId: string | undefined, botUserId: string): string[] {
  const keys = new Set<string>();
  if (conversationId) {
    keys.add(conversationId);
    keys.add(normalizeOpenImConversationId(conversationId, botUserId));
  }
  if (groupId) {
    keys.add(`group:${groupId}`);
    keys.add(`sg_${groupId}`);
  }
  return [...keys].filter(Boolean);
}

function groupIdFromConversationId(conversationId: string): string | undefined {
  if (conversationId.startsWith("group:")) return conversationId.slice("group:".length) || undefined;
  if (conversationId.startsWith("sg_")) return conversationId.slice("sg_".length) || undefined;
  return undefined;
}

function validateRequestedProjectPath(context: AppContext, projectPath: string) {
  return validateProjectPath(
    projectPath,
    parseProjectPathAllowlist(context.config.CODEX_WORKSPACE_ALLOWLIST, context.config.CODEX_DEFAULT_PROJECT_PATH)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return undefined;
}

function parseHistoryImportCommand(text: string | null | undefined): { requestedCount: number } | null {
  const normalized = text?.trim();
  if (!normalized) {
    return null;
  }
  const match = normalized.match(/^(?:\/load_history|\/history\s+import|加载历史)(?:\s+(\d+))?$/i);
  if (!match) {
    return null;
  }
  const requested = Number(match[1] ?? 50);
  const requestedCount = Math.max(1, Math.min(Number.isFinite(requested) ? requested : 50, 200));
  return { requestedCount };
}

function toHistoryMessage(value: unknown) {
  const row = isRecord(value) ? value : {};
  return {
    clientMsgID: optionalString(row.clientMsgID) ?? undefined,
    serverMsgID: optionalString(row.serverMsgID) ?? undefined,
    sendID: optionalString(row.sendID) ?? undefined,
    recvID: optionalString(row.recvID) ?? undefined,
    groupID: optionalString(row.groupID) ?? optionalString(row.groupId) ?? undefined,
    senderNickname: optionalString(row.senderNickname) ?? undefined,
    contentType: typeof row.contentType === "number" ? row.contentType : undefined,
    sendTime: typeof row.sendTime === "number" ? row.sendTime : undefined,
    text: optionalString(row.text) ?? undefined,
    preview: optionalString(row.preview) ?? undefined,
    ex: row.ex
  };
}

function hasRolloutFile(codexHomeDir: string, codexSessionId: string): boolean {
  for (const root of [join(codexHomeDir, "sessions"), join(codexHomeDir, "archived_sessions")]) {
    if (findFileNameContaining(root, codexSessionId)) {
      return true;
    }
  }
  return false;
}

function findFileNameContaining(root: string, needle: string): boolean {
  if (!existsSync(root)) {
    return false;
  }
  const stack = [root];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.name.includes(needle)) {
        return true;
      }
    }
  }
  return false;
}

function parseBooleanQuery(value: string | undefined, defaultValue = false): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  return value === "true" || value === "1";
}

function parsePositiveInteger(value: string | undefined, defaultValue: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 1000) : defaultValue;
}

function toRuntimeProfileInput(body: Record<string, unknown>, partial = false): RuntimeProfileInput {
  const input: Partial<RuntimeProfileInput> = {};
  const name = optionalString(body.name);
  if (name || !partial) input.name = name ?? "";
  const providerType = optionalString(body.providerType);
  if (providerType) input.providerType = providerType as RuntimeProfileInput["providerType"];
  const providerMode = optionalString(body.providerMode);
  if (providerMode !== null || Object.prototype.hasOwnProperty.call(body, "providerMode")) input.providerMode = providerMode as RuntimeProfileInput["providerMode"];
  const model = optionalString(body.model);
  if (model !== null || Object.prototype.hasOwnProperty.call(body, "model")) input.model = model;
  const sandboxMode = optionalString(body.sandboxMode);
  if (sandboxMode !== null || Object.prototype.hasOwnProperty.call(body, "sandboxMode")) input.sandboxMode = sandboxMode;
  const approvalPolicy = optionalString(body.approvalPolicy);
  if (approvalPolicy !== null || Object.prototype.hasOwnProperty.call(body, "approvalPolicy")) input.approvalPolicy = approvalPolicy;
  const codexProfile = optionalString(body.codexProfile);
  if (codexProfile !== null || Object.prototype.hasOwnProperty.call(body, "codexProfile")) input.codexProfile = codexProfile;
  const baseUrl = optionalString(body.baseUrl);
  if (baseUrl !== null || Object.prototype.hasOwnProperty.call(body, "baseUrl")) input.baseUrl = baseUrl;
  const bridgeBaseUrl = optionalString(body.bridgeBaseUrl);
  if (bridgeBaseUrl !== null || Object.prototype.hasOwnProperty.call(body, "bridgeBaseUrl")) input.bridgeBaseUrl = bridgeBaseUrl;
  const wireApi = optionalString(body.wireApi);
  if (wireApi !== null || Object.prototype.hasOwnProperty.call(body, "wireApi")) input.wireApi = wireApi;
  const authEnvKey = optionalString(body.authEnvKey);
  if (authEnvKey !== null || Object.prototype.hasOwnProperty.call(body, "authEnvKey")) input.authEnvKey = authEnvKey;
  const codexHomeOverride = optionalString(body.codexHomeOverride);
  if (codexHomeOverride !== null || Object.prototype.hasOwnProperty.call(body, "codexHomeOverride")) input.codexHomeOverride = codexHomeOverride;
  const localProvider = optionalString(body.localProvider);
  if (localProvider) input.localProvider = localProvider as RuntimeProfileInput["localProvider"];
  const useOss = optionalBoolean(body.useOss);
  if (useOss !== undefined) input.useOss = useOss;
  if (Object.prototype.hasOwnProperty.call(body, "apiKey")) {
    input.apiKey = optionalString(body.apiKey);
  }
  return input as RuntimeProfileInput;
}

function buildRuntimeProfileProbeInput(profile: {
  id: string;
  providerMode: string | null;
  model: string | null;
  sandboxMode: string | null;
  approvalPolicy: string | null;
  codexProfile: string | null;
  baseUrl: string | null;
  bridgeBaseUrl: string | null;
  wireApi: string | null;
  authEnvKey: string | null;
  localProvider: "lmstudio" | "ollama" | null;
  useOss: boolean;
}) {
  const providerId = sanitizeProviderId(profile.id);
  const providerBaseUrl = profile.providerMode === "deepseek-via-responses-bridge"
    ? profile.bridgeBaseUrl
    : profile.providerMode === "openai-responses"
      ? profile.baseUrl
      : null;
  return {
    model: profile.model ?? undefined,
    sandboxMode: profile.sandboxMode ?? undefined,
    approvalPolicy: profile.approvalPolicy ?? undefined,
    codexProfile: profile.codexProfile ?? undefined,
    useOss: profile.useOss,
    localProvider: profile.localProvider ?? undefined,
    modelProviderId: providerBaseUrl ? providerId : undefined,
    modelProviderBaseUrl: providerBaseUrl ?? undefined,
    modelProviderWireApi: profile.wireApi ?? "responses",
    apiKeyEnvName: profile.authEnvKey ?? `CODEX_RUNTIME_PROFILE_${providerId.toUpperCase()}_API_KEY`
  };
}

async function runUpstreamProbe(profile: { baseUrl: string | null; model: string | null; apiKey: string | null }) {
  if (!profile.baseUrl || !profile.model || !profile.apiKey) {
    return { ok: false, skipped: true, errorText: "baseUrl, model, or API key missing" };
  }
  const url = `${profile.baseUrl.replace(/\/$/, "")}/chat/completions`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${profile.apiKey}`
      },
      body: JSON.stringify({
        model: profile.model,
        messages: [{ role: "user", content: "Return exactly OPENIM_CODEX_BRIDGE_OK." }],
        max_tokens: 16,
        stream: false
      }),
      signal: AbortSignal.timeout(30000)
    });
    if (!response.ok) {
      return { ok: false, skipped: false, status: response.status, errorText: await response.text().then(redactSecretsInText) };
    }
    return { ok: true, skipped: false, status: response.status };
  } catch (error) {
    return { ok: false, skipped: false, errorText: error instanceof Error ? redactSecretsInText(error.message) : String(error) };
  }
}

function sanitizeProviderId(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}

function redactSecretsInText(value: string): string {
  return value.replace(/sk-[A-Za-z0-9_-]+/g, "sk-****");
}

function redactRuntimeEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const redacted: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    redacted[key] = key.toLowerCase().includes("key") || key.toLowerCase().includes("token") ? "****" : value;
  }
  return redacted;
}

function createLegacyCodexRunner(context: AppContext) {
  if (!context.codex) {
    throw new Error("Agent runner is not configured.");
  }
  return new CodexCliRunner(context.codex);
}

function bridgeApiError(
  reply: { code: (statusCode: number) => { send: (payload: Record<string, unknown>) => unknown } },
  statusCode: number,
  code: string,
  message: string,
  details: Record<string, unknown> = {}
) {
  return reply.code(statusCode).send({
    error: code,
    message,
    ...details
  });
}

function summarizeUserText(value: string | null | undefined, maxLength = 40): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function buildDeterministicSummaryText(events: SemanticEvent[]): string {
  const lines = events
    .filter((event) => event.role === "user" && event.text)
    .slice(-10)
    .map((event) => `- ${speakerName(event)}: ${redactSecretsInText(event.text!)}`);
  return lines.length ? lines.join("\n") : "No older text messages summarized yet.";
}

function extractImportantLines(events: SemanticEvent[]): string[] {
  return events
    .filter((event) => event.role === "user" && event.text)
    .map((event) => redactSecretsInText(event.text!))
    .filter((text) => /\b(must|should|source of truth|do not|不要|禁止|必须|需要)\b/i.test(text))
    .slice(-12);
}

function extractUnresolvedTasks(events: SemanticEvent[]): string[] {
  return events
    .filter((event) => event.role === "user" && event.text)
    .map((event) => redactSecretsInText(event.text!))
    .filter((text) => /\b(todo|fix|implement|add|verify|补充|新增|实现|验证|修复)\b/i.test(text))
    .slice(-12);
}

function speakerName(event: SemanticEvent): string {
  return event.actorDisplayName ?? event.actorID ?? event.senderUserId;
}

function normalizeOpenImConversationId(conversationId: string, botUserId: string): string {
  if (conversationId.startsWith("single:")) {
    return conversationId;
  }

  if (conversationId.startsWith("sg_")) {
    const groupId = conversationId.slice("sg_".length);
    return groupId ? `group:${groupId}` : conversationId;
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

function isGroupCallbackCommand(command: string | undefined): boolean {
  return command?.toLowerCase().includes("group") ?? false;
}

function parseConfigList(value: string | undefined): string[] {
  return (value ?? "")
    .split(/[;,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function resolveGroupProjectPath(
  context: AppContext,
  groupId: string | null | undefined
): { ok: true; projectPath: string } | { ok: false; reason: "group_binding_required" } {
  const bindings = parseConfigMap(context.config.OPENIM_GROUP_PROJECT_BINDINGS);
  const boundProjectPath = groupId ? bindings.get(groupId) : undefined;
  if (boundProjectPath) {
    return { ok: true, projectPath: boundProjectPath };
  }
  if (context.config.OPENIM_GROUP_REQUIRE_BINDING) {
    return { ok: false, reason: "group_binding_required" };
  }
  return { ok: true, projectPath: context.config.CODEX_DEFAULT_PROJECT_PATH };
}

function parseConfigMap(value: string | undefined): Map<string, string> {
  const result = new Map<string, string>();
  for (const item of parseConfigList(value)) {
    const separatorIndex = item.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = item.slice(0, separatorIndex).trim();
    const mapValue = item.slice(separatorIndex + 1).trim();
    if (key && mapValue) {
      result.set(key, mapValue);
    }
  }
  return result;
}
