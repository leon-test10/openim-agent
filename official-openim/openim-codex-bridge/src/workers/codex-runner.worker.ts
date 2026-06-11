import type { Logger } from "pino";
import type { AppContext } from "../app-context.js";
import type { RuntimeJob } from "../core/runtime-job.js";
import type { SemanticEvent } from "../core/semantic-event.js";
import { ensureCodexRuntimeHome } from "../core/codex-runtime-home.service.js";
import { buildCodexPrompt } from "../core/prompt-builder.service.js";
import { ConversationContextBuilder } from "../core/conversation-context.service.js";
import { decideContextSupplement } from "../core/context-supplement-policy.js";
import { normalizeRuntimeEvent } from "../runtime/runtime-event-mapper.js";
import type { AgentRunner, RuntimeKind, RuntimeRunHandle } from "../runtime/runner.js";
import { createId } from "../utils/ids.js";

export class CodexRunnerWorker {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly runningJobs = new Map<string, RuntimeRunHandle>();
  constructor(
    private readonly context: AppContext,
    private readonly logger: Logger
  ) {
    if (!context.runner) {
      throw new Error("Agent runner is not configured.");
    }
  }

  enqueue(job: RuntimeJob, event: SemanticEvent): void {
    const previous = this.chains.get(job.openimConversationId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(() => this.runJob(job.id, event))
      .finally(() => {
        if (this.chains.get(job.openimConversationId) === next) {
          this.chains.delete(job.openimConversationId);
        }
      });
    this.chains.set(job.openimConversationId, next);
  }

  async cancelJob(jobId: string): Promise<RuntimeJob | null> {
    const job = this.context.jobs.getById(jobId);
    if (!job) {
      return null;
    }

    if (job.status === "queued") {
      const cancelled = this.context.jobs.cancelQueued(jobId, { cancelMethod: "api" });
      if (cancelled) {
        this.context.conversationEvents?.publishJob("job_cancelled", cancelled);
      }
      return cancelled;
    }

    if (job.status === "running" || job.status === "cancelling") {
      const cancellingJob =
        job.status === "running"
          ? this.context.jobs.markCancelling(jobId, { cancelMethod: "api" })
          : this.context.jobs.getById(jobId);
      const handle = this.runningJobs.get(jobId);
      if (handle) {
        await handle.cancel("api");
      }
      return cancellingJob;
    }

    return job;
  }

  retryJob(jobId: string): RuntimeJob | null {
    const source = this.context.jobs.getById(jobId);
    if (!source || source.status === "queued" || source.status === "running" || source.status === "cancelling") {
      return null;
    }

    const session = this.context.sessions.getActiveByConversationId(source.openimConversationId);
    if (!session) {
      return null;
    }

    const event = this.context.semanticEvents.getById(source.semanticEventId);
    if (!event) {
      return null;
    }

    const retry = this.context.jobs.createRetryJob({
      sourceJobId: source.id,
      sessionRecordId: session.id,
      codexSessionIdBefore: session.codexSessionId
    });
    if (retry) {
      this.context.conversationEvents?.publishJob("job_created", retry);
      this.context.conversationEvents?.publishJob("job_queued", retry);
      this.enqueue(retry, event);
    }
    return retry;
  }

  private async runJob(jobId: string, event: SemanticEvent): Promise<void> {
    const job = this.context.jobs.getById(jobId);
    if (!job) {
      this.logger.error({ jobId }, "runtime job not found");
      return;
    }
    if (job.status === "cancelled") {
      this.logger.info({ jobId }, "runtime job skipped because it was cancelled before start");
      return;
    }
    const runner = this.resolveRunner(job.runtimeKind);

    const session = this.context.sessions.ensureRuntimeFields(job.sessionRecordId);
      if (!session) {
        this.context.jobs.markFailed(jobId, {
        errorText: "Runtime session record not found",
        failureReason: "missing_session"
      });
      const failed = this.context.jobs.getById(jobId);
      if (failed) this.context.conversationEvents?.publishJob("job_failed", failed);
      return;
    }

    const contextBuilder = new ConversationContextBuilder({
      semanticEvents: this.context.semanticEvents,
      summaries: this.context.conversationSummaries,
      sessions: this.context.sessions,
      recentLimit: this.context.config.CONTEXT_RECENT_EVENT_LIMIT
    });
    const conversationContext = contextBuilder.build(job.openimConversationId, { currentEvent: event });
    const supplementDecision = decideContextSupplement({
      session,
      currentEvent: event,
      recentEvents: conversationContext.recentEvents
    });
    const prompt = supplementDecision.includeSemanticContext
      ? buildCodexPrompt({
          context: conversationContext,
          currentEvent: event
        })
      : buildCodexPrompt({
          openimConversationId: job.openimConversationId,
          codexProjectPath: session.codexProjectPath,
          codexSessionId: session.codexSessionId,
          userText: job.inputText
        });
    const codexHomeDir = ensureCodexRuntimeHome(session, this.context.config);
    const runtimeProfile = session.runtimeProfileId
      ? this.context.runtimeProfiles.getWithSecret(session.runtimeProfileId)
      : null;
    const providerId = runtimeProfile ? sanitizeProviderId(runtimeProfile.id) : undefined;
    const providerBaseUrl = runtimeProfile?.providerMode === "deepseek-via-responses-bridge"
      ? runtimeProfile.bridgeBaseUrl
      : runtimeProfile?.providerMode === "openai-responses"
        ? runtimeProfile.baseUrl
        : null;
    const apiKeyEnvName = runtimeProfile?.authEnvKey ?? (providerId ? `CODEX_RUNTIME_PROFILE_${providerId.toUpperCase()}_API_KEY` : undefined);
    const runtimeOptions = {
      model:
        runtimeProfile?.model ??
        (job.runtimeKind === "openhands"
          ? this.context.config.OPENAI_COMPATIBLE_MODEL
          : this.context.config.CODEX_DEFAULT_MODEL || undefined),
      runtimeHomeDir: runtimeProfile?.codexHomeOverride ?? codexHomeDir,
      sandboxMode: runtimeProfile?.sandboxMode ?? session.sandboxMode ?? undefined,
      approvalPolicy: runtimeProfile?.approvalPolicy ?? undefined,
      codexProfile: runtimeProfile?.codexProfile ?? undefined,
      baseUrl: runtimeProfile?.baseUrl ?? undefined,
      modelProviderId: providerBaseUrl ? providerId : undefined,
      modelProviderBaseUrl: providerBaseUrl ?? undefined,
      modelProviderWireApi: runtimeProfile?.wireApi ?? "responses",
      apiKeyEnvName,
      localProvider: runtimeProfile?.localProvider ?? undefined,
      useOss: runtimeProfile?.useOss ?? undefined,
      apiKey: runtimeProfile?.apiKey ?? undefined
    };

    try {
      const workerStartedAt = Date.now();
      this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, {
        type: "bridge.job_queued",
        createdAt: job.createdAt
      });
      this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, {
        type: "bridge.webhook_received",
        createdAt: job.createdAt
      });
      this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, {
        type: "bridge.worker_started",
        queuedMs: workerStartedAt - job.createdAt,
        createdAt: workerStartedAt,
        semanticContextIncluded: supplementDecision.includeSemanticContext,
        semanticContextReason: supplementDecision.reason,
        semanticContextEventCount: supplementDecision.deliverableEventIDs.length
      });
      if (supplementDecision.includeSemanticContext) {
        this.context.semanticEvents.markDelivered(supplementDecision.deliverableEventIDs, {
          jobId,
          sessionRecordId: session.id,
          codexSessionId: session.codexSessionId,
          reason: supplementDecision.reason,
          deliveredAt: workerStartedAt
        });
      }
      let firstCodexEventSeen = false;
      const recordCodexEvent = (codexEvent: Record<string, unknown>) => {
        if (!firstCodexEventSeen) {
          firstCodexEventSeen = true;
          this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, {
            type: "codex.first_event",
            sinceWorkerStartedMs: Date.now() - workerStartedAt
          });
        }
        this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, codexEvent);
      };

      const handle = session.codexSessionId
        ? (this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, {
            type: "codex.resume.started",
            sessionId: session.codexSessionId
          }),
          runner.run({
            jobId,
            sessionRecordId: session.id,
            openimConversationId: job.openimConversationId,
            inputText: job.inputText,
            projectPath: session.codexProjectPath,
            externalSessionId: session.codexSessionId,
            prompt,
            ...runtimeOptions,
            onEvent: recordCodexEvent
          }))
        : runner.run({
            jobId,
            sessionRecordId: session.id,
            openimConversationId: job.openimConversationId,
            inputText: job.inputText,
            projectPath: session.codexProjectPath,
            externalSessionId: null,
            prompt,
            ...runtimeOptions,
            onEvent: recordCodexEvent
          });

      this.runningJobs.set(jobId, handle);
      this.context.jobs.markRunning(jobId);
      this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, {
        type: "bridge.job_running",
        createdAt: Date.now()
      });
      const runningJob = this.context.jobs.getById(jobId);
      if (runningJob) this.context.conversationEvents?.publishJob("job_started", runningJob);
      this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, {
        type: "codex.process_spawned",
        pid: handle.pid
      });
      const startedJob = this.context.jobs.getById(jobId);
      if (startedJob?.status === "cancelled") {
        await handle.cancel("api");
        this.runningJobs.delete(jobId);
        return;
      }
      let result = await handle.promise;
      this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, {
        type: "codex.process_completed",
        ok: result.ok,
        exitCode: result.exitCode,
        timedOut: result.timedOut,
        cancelled: result.cancelled,
        sinceWorkerStartedMs: Date.now() - workerStartedAt
      });
      this.runningJobs.delete(jobId);
      if (session.codexSessionId && result.ok) {
        this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, {
          type: "codex.resume.succeeded",
          sessionId: session.codexSessionId
        });
      }

      if (!result.ok && session.codexSessionId && isMissingCodexRolloutError(result.errorText)) {
        this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, {
          type: "codex.resume.failed",
          sessionId: session.codexSessionId,
          error: result.errorText
        });
        this.logger.warn(
          { jobId, sessionRecordId: session.id, codexSessionId: session.codexSessionId, codexHomeDir },
          "Codex resume failed because the isolated home does not contain the old rollout; starting a new task"
        );
        const fallbackHandle = runner.run({
          jobId,
          sessionRecordId: session.id,
          openimConversationId: job.openimConversationId,
          inputText: job.inputText,
          projectPath: session.codexProjectPath,
          externalSessionId: null,
          prompt,
          ...runtimeOptions,
          onEvent: recordCodexEvent
        });
        this.runningJobs.set(jobId, fallbackHandle);
        this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, {
          type: "codex.resume.fallback_new_task",
          previousSessionId: session.codexSessionId
        });
        result = await fallbackHandle.promise;
        this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, {
          type: "codex.fallback_process_completed",
          ok: result.ok,
          exitCode: result.exitCode,
          timedOut: result.timedOut,
          cancelled: result.cancelled,
          sinceWorkerStartedMs: Date.now() - workerStartedAt
        });
        this.runningJobs.delete(jobId);
      }

      const latestJob = this.context.jobs.getById(jobId);
      if (result.cancelled || latestJob?.status === "cancelling" || latestJob?.status === "cancelled") {
        this.context.jobs.markCancelled(jobId, {
          cancelMethod: latestJob?.cancelMethod ?? "process",
          errorText: result.errorText ?? "Cancelled"
        });
        const cancelled = this.context.jobs.getById(jobId);
        if (cancelled) this.context.conversationEvents?.publishJob("job_cancelled", cancelled);
        await this.reply(
          event,
          jobId,
          session.id,
          session.codexSessionId,
          job.runtimeKind === "codex_cli" ? "Codex job was cancelled." : `${runtimeLabel(job.runtimeKind)} job was cancelled.`
        );
        return;
      }

      if (!result.ok) {
        const errorText = result.errorText ?? `${runtimeLabel(job.runtimeKind)} exited with ${result.exitCode}`;
        this.context.jobs.markFailed(jobId, {
          errorText,
          failureReason: result.timedOut ? "timeout" : `${job.runtimeKind}_exit`
        });
        const failed = this.context.jobs.getById(jobId);
        if (failed) this.context.conversationEvents?.publishJob("job_failed", failed);
        await this.reply(event, jobId, session.id, session.codexSessionId, `Runtime failed: ${errorText}`).catch(
          (replyError: unknown) => {
            this.context.jobs.markFailed(jobId, {
              errorText: `OpenIM failure reply failed after runtime error: ${replyError instanceof Error ? replyError.message : String(replyError)}`,
              failureReason: "openim_send_failed"
            });
            const failedReply = this.context.jobs.getById(jobId);
            if (failedReply) this.context.conversationEvents?.publishJob("job_failed", failedReply);
            this.logger.error({ jobId, err: replyError }, "failed to send runtime failure reply");
          }
        );
        return;
      }

      if (result.externalSessionId) {
        this.context.sessions.updateCodexSessionId(session.id, result.externalSessionId);
        this.context.conversationEvents?.publishSessionChanged(
          job.openimConversationId,
          this.context.sessions.getById(session.id),
          "codex_session_id_updated"
        );
      }
      this.context.sessions.updateAutoSummary(session.id, {
        displayName: job.inputText,
        lastSummary: result.outputText
      });
      this.context.jobs.markSucceeded(jobId, {
        outputText: result.outputText,
        codexSessionIdAfter: result.externalSessionId ?? session.codexSessionId
      });
      const succeeded = this.context.jobs.getById(jobId);
      if (succeeded) this.context.conversationEvents?.publishJob("job_succeeded", succeeded);
      this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, {
        type: "bridge.job_succeeded",
        createdAt: Date.now()
      });
      await this.reply(event, jobId, session.id, result.externalSessionId ?? session.codexSessionId, result.outputText).catch(
        (replyError: unknown) => {
          this.context.jobs.markFailed(jobId, {
            errorText: `OpenIM success reply failed after Codex completed: ${replyError instanceof Error ? replyError.message : String(replyError)}`,
            failureReason: "openim_send_failed"
          });
          const failedReply = this.context.jobs.getById(jobId);
          if (failedReply) this.context.conversationEvents?.publishJob("job_failed", failedReply);
          throw replyError;
        }
      );
    } catch (error) {
      this.runningJobs.delete(jobId);
      if (this.context.jobs.getById(jobId)?.status === "cancelling") {
        this.context.jobs.markCancelled(jobId, { cancelMethod: "api", errorText: "Cancelled" });
        const cancelled = this.context.jobs.getById(jobId);
        if (cancelled) this.context.conversationEvents?.publishJob("job_cancelled", cancelled);
        await this.reply(event, jobId, session.id, session.codexSessionId, "Codex job was cancelled.").catch(
          (replyError: unknown) => {
            this.logger.error({ jobId, err: replyError }, "failed to send cancellation reply");
          }
        );
        return;
      }

      const errorText = error instanceof Error ? error.message : String(error);
      this.context.jobs.markFailed(jobId, { errorText, failureReason: "bridge_error" });
      const failed = this.context.jobs.getById(jobId);
      if (failed) this.context.conversationEvents?.publishJob("job_failed", failed);
      await this.reply(event, jobId, session.id, session.codexSessionId, `Bridge runtime failed: ${errorText}`).catch(
        (replyError: unknown) => {
          this.logger.error({ jobId, err: replyError }, "failed to send failure reply");
        }
      );
    }
  }

  private async reply(
    event: SemanticEvent,
    jobId: string,
    sessionRecordId: string,
    codexSessionId: string | null,
    text: string
  ): Promise<void> {
    const runtimeKind = this.context.jobs.getById(jobId)?.runtimeKind ?? this.context.runner?.kind ?? "codex_cli";
    this.recordRuntimeEvent(jobId, sessionRecordId, event.openimConversationId, {
      type: "openim.reply_started",
      textLength: text.length
    });
    try {
      await this.context.openimSender.sendBotText({
        operationId: jobId,
        recvId: event.senderUserId,
        groupId: event.groupId,
        text,
        metadata: { jobId, sessionRecordId, codexSessionId, runtimeKind }
      });
      this.context.semanticEvents.upsert({
        id: createId("evt"),
        conversationID: event.openimConversationId,
        conversationType: event.conversationType ?? (event.groupId ? "group" : "single"),
        source: "bridge_runtime",
        sourceMessageID: `bridge_reply:${jobId}`,
        actorID: "codex_bot",
        actorType: "codex_bot",
        actorDisplayName: "Codex",
        role: "assistant",
        openimMessageId: null,
        openimClientMsgId: null,
        openimConversationId: event.openimConversationId,
        senderUserId: this.context.config.OPENIM_BOT_USER_ID,
        receiverUserId: event.senderUserId,
        groupId: event.groupId,
        sendID: this.context.config.OPENIM_BOT_USER_ID,
        recvID: event.senderUserId,
        groupID: event.groupId,
        eventType: "agent.reply",
        contentType: 101,
        text,
        timestamp: Date.now(),
        metadata: { jobId, sessionRecordId, codexSessionId, runtimeKind },
        dedupKey: `bridge_reply:${jobId}`,
        ex: { agent: { generated_by: "codex", runtime: runtimeKind } },
        rawPayload: { jobId, sessionRecordId, codexSessionId, runtimeKind },
        createdAt: Date.now()
      });
      this.recordRuntimeEvent(jobId, sessionRecordId, event.openimConversationId, {
        type: "openim.reply_completed"
      });
      this.recordRuntimeEvent(jobId, sessionRecordId, event.openimConversationId, {
        type: "bridge.reply_sent"
      });
    } catch (error) {
      this.recordRuntimeEvent(jobId, sessionRecordId, event.openimConversationId, {
        type: "openim.reply_failed",
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  private recordRuntimeEvent(
    jobId: string,
    sessionRecordId: string,
    openimConversationId: string,
    codexEvent: Record<string, unknown>,
    runtimeKind: RuntimeKind = this.context.jobs.getById(jobId)?.runtimeKind ?? this.context.runner?.kind ?? "codex_cli"
  ): void {
    const normalized = normalizeRuntimeEvent(runtimeKind, codexEvent);
    const createdAt = typeof codexEvent.createdAt === "number" ? codexEvent.createdAt : undefined;
    const event = this.context.runtimeEvents.recordCodexJsonEvent({
      jobId,
      sessionRecordId,
      openimConversationId,
      eventType: normalized.eventType,
      title: normalized.title,
      summary: normalized.summary,
      rawEvent: normalized.rawEvent,
      createdAt
    });
    this.context.conversationEvents?.publishRuntimeEvent(event);

    // P4B: runtime-neutral event aliases (保留旧 codex.* 事件，同时写入 runtime.* 镜像事件)
    if (normalized.eventType.startsWith("codex.")) {
      const aliasedType = `runtime.${normalized.eventType.slice("codex.".length)}`;
      const aliasedTitle =
        normalized.title.startsWith("codex.") ? `runtime.${normalized.title.slice("codex.".length)}` : normalized.title;
      const aliased = this.context.runtimeEvents.recordCodexJsonEvent({
        jobId,
        sessionRecordId,
        openimConversationId,
        eventType: aliasedType,
        title: aliasedTitle,
        summary: normalized.summary,
        rawEvent: {
          ...normalized.rawEvent,
          type: aliasedType,
          aliasOf: normalized.eventType
        },
        createdAt
      });
      this.context.conversationEvents?.publishRuntimeEvent(aliased);
    }
  }

  private resolveRunner(runtimeKind: RuntimeKind): AgentRunner {
    const runner = this.context.runners?.[runtimeKind];
    if (runner) {
      return runner;
    }
    if (this.context.runner?.kind === runtimeKind) {
      return this.context.runner;
    }
    throw new Error(`Agent runner is not configured for runtime ${runtimeKind}.`);
  }
}

function isMissingCodexRolloutError(errorText: string | undefined): boolean {
  return Boolean(errorText?.includes("no rollout found for thread id"));
}

function sanitizeProviderId(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}

function runtimeLabel(runtimeKind: RuntimeKind): string {
  if (runtimeKind === "codex_cli") return "Codex CLI";
  if (runtimeKind === "openhands") return "OpenHands CLI";
  if (runtimeKind === "openai_compatible") return "OpenAI-compatible runtime";
  return "Template runtime";
}
