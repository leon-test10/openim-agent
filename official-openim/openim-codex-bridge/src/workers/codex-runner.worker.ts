import type { Logger } from "pino";
import type { AppContext } from "../app-context.js";
import type { CodexResumeInput, CodexRunHandle, CodexRunInput } from "../adapters/codex/codex-types.js";
import type { RuntimeJob } from "../core/runtime-job.js";
import type { SemanticEvent } from "../core/semantic-event.js";
import { ensureCodexRuntimeHome } from "../core/codex-runtime-home.service.js";
import { buildCodexPrompt } from "../core/prompt-builder.service.js";
import { normalizeCodexJsonEvent } from "../adapters/codex/codex-output.parser.js";

export class CodexRunnerWorker {
  private readonly chains = new Map<string, Promise<void>>();
  private readonly runningJobs = new Map<string, CodexRunHandle>();

  constructor(
    private readonly context: AppContext,
    private readonly logger: Logger
  ) {}

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
      return this.context.jobs.cancelQueued(jobId, { cancelMethod: "api" });
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

    const session = this.context.sessions.ensureRuntimeFields(job.sessionRecordId);
    if (!session) {
      this.context.jobs.markFailed(jobId, {
        errorText: "Codex session record not found",
        failureReason: "missing_session"
      });
      return;
    }

    const prompt = buildCodexPrompt({
      openimConversationId: job.openimConversationId,
      codexProjectPath: session.codexProjectPath,
      codexSessionId: session.codexSessionId,
      userText: job.inputText
    });
    const codexHomeDir = ensureCodexRuntimeHome(session, this.context.config);

    try {
      const handle = session.codexSessionId
        ? this.resumeTask({
            projectPath: session.codexProjectPath,
            sessionId: session.codexSessionId,
            prompt,
            model: this.context.config.CODEX_DEFAULT_MODEL || undefined,
            codexHomeDir,
            sandboxMode: session.sandboxMode ?? undefined,
            onEvent: (codexEvent) => this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, codexEvent)
          })
        : this.runNewTask({
            projectPath: session.codexProjectPath,
            prompt,
            model: this.context.config.CODEX_DEFAULT_MODEL || undefined,
            codexHomeDir,
            sandboxMode: session.sandboxMode ?? undefined,
            onEvent: (codexEvent) => this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, codexEvent)
          });

      this.runningJobs.set(jobId, handle);
      this.context.jobs.markRunning(jobId);
      const startedJob = this.context.jobs.getById(jobId);
      if (startedJob?.status === "cancelled") {
        await handle.cancel("api");
        this.runningJobs.delete(jobId);
        return;
      }
      let result = await handle.promise;
      this.runningJobs.delete(jobId);

      if (!result.ok && session.codexSessionId && isMissingCodexRolloutError(result.errorText)) {
        this.logger.warn(
          { jobId, sessionRecordId: session.id, codexSessionId: session.codexSessionId, codexHomeDir },
          "Codex resume failed because the isolated home does not contain the old rollout; starting a new task"
        );
        const fallbackHandle = this.runNewTask({
          projectPath: session.codexProjectPath,
          prompt,
          model: this.context.config.CODEX_DEFAULT_MODEL || undefined,
          codexHomeDir,
          sandboxMode: session.sandboxMode ?? undefined,
          onEvent: (codexEvent) => this.recordRuntimeEvent(jobId, session.id, job.openimConversationId, codexEvent)
        });
        this.runningJobs.set(jobId, fallbackHandle);
        result = await fallbackHandle.promise;
        this.runningJobs.delete(jobId);
      }

      const latestJob = this.context.jobs.getById(jobId);
      if (result.cancelled || latestJob?.status === "cancelling" || latestJob?.status === "cancelled") {
        this.context.jobs.markCancelled(jobId, {
          cancelMethod: latestJob?.cancelMethod ?? "process",
          errorText: result.errorText ?? "Cancelled"
        });
        await this.reply(event, jobId, session.id, session.codexSessionId, "Codex job was cancelled.");
        return;
      }

      if (!result.ok) {
        const errorText = result.errorText ?? `Codex CLI exited with ${result.exitCode}`;
        this.context.jobs.markFailed(jobId, {
          errorText,
          failureReason: result.timedOut ? "timeout" : "codex_exit"
        });
        await this.reply(event, jobId, session.id, session.codexSessionId, `Codex CLI failed: ${errorText}`).catch(
          (replyError: unknown) => {
            this.context.jobs.markFailed(jobId, {
              errorText: `OpenIM failure reply failed after Codex error: ${replyError instanceof Error ? replyError.message : String(replyError)}`,
              failureReason: "openim_send_failed"
            });
            this.logger.error({ jobId, err: replyError }, "failed to send Codex failure reply");
          }
        );
        return;
      }

      if (result.sessionId) {
        this.context.sessions.updateCodexSessionId(session.id, result.sessionId);
      }
      this.context.sessions.updateAutoSummary(session.id, {
        displayName: job.inputText,
        lastSummary: result.outputText
      });
      this.context.jobs.markSucceeded(jobId, {
        outputText: result.outputText,
        codexSessionIdAfter: result.sessionId ?? session.codexSessionId
      });
      await this.reply(event, jobId, session.id, result.sessionId ?? session.codexSessionId, result.outputText).catch(
        (replyError: unknown) => {
          this.context.jobs.markFailed(jobId, {
            errorText: `OpenIM success reply failed after Codex completed: ${replyError instanceof Error ? replyError.message : String(replyError)}`,
            failureReason: "openim_send_failed"
          });
          throw replyError;
        }
      );
    } catch (error) {
      this.runningJobs.delete(jobId);
      if (this.context.jobs.getById(jobId)?.status === "cancelling") {
        this.context.jobs.markCancelled(jobId, { cancelMethod: "api", errorText: "Cancelled" });
        await this.reply(event, jobId, session.id, session.codexSessionId, "Codex job was cancelled.").catch(
          (replyError: unknown) => {
            this.logger.error({ jobId, err: replyError }, "failed to send cancellation reply");
          }
        );
        return;
      }

      const errorText = error instanceof Error ? error.message : String(error);
      this.context.jobs.markFailed(jobId, { errorText, failureReason: "bridge_error" });
      await this.reply(event, jobId, session.id, session.codexSessionId, `Bridge runtime failed: ${errorText}`).catch(
        (replyError: unknown) => {
          this.logger.error({ jobId, err: replyError }, "failed to send failure reply");
        }
      );
    }
  }

  private reply(
    event: SemanticEvent,
    jobId: string,
    sessionRecordId: string,
    codexSessionId: string | null,
    text: string
  ): Promise<void> {
    return this.context.openimSender.sendBotText({
      operationId: jobId,
      recvId: event.senderUserId,
      text,
      metadata: { jobId, sessionRecordId, codexSessionId }
    });
  }

  private recordRuntimeEvent(
    jobId: string,
    sessionRecordId: string,
    openimConversationId: string,
    codexEvent: Record<string, unknown>
  ): void {
    const normalized = normalizeCodexJsonEvent(codexEvent);
    this.context.runtimeEvents.recordCodexJsonEvent({
      jobId,
      sessionRecordId,
      openimConversationId,
      eventType: normalized.eventType,
      title: normalized.title,
      summary: normalized.summary,
      rawEvent: normalized.rawEvent
    });
  }

  private runNewTask(input: CodexRunInput): CodexRunHandle {
    if (this.context.codex.runNewTaskCancellable) {
      return this.context.codex.runNewTaskCancellable(input);
    }
    return {
      pid: null,
      promise: this.context.codex.runNewTask(input),
      cancel: async () => undefined
    };
  }

  private resumeTask(input: CodexResumeInput): CodexRunHandle {
    if (this.context.codex.resumeTaskCancellable) {
      return this.context.codex.resumeTaskCancellable(input);
    }
    return {
      pid: null,
      promise: this.context.codex.resumeTask(input),
      cancel: async () => undefined
    };
  }
}

function isMissingCodexRolloutError(errorText: string | undefined): boolean {
  return Boolean(errorText?.includes("no rollout found for thread id"));
}
