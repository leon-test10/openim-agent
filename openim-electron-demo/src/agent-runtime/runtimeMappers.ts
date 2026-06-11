import {
  CodexConversationStatus,
  CodexRuntimeJob,
  CodexSessionRecord,
  RuntimeConversationStatus,
  RuntimeJobView,
  RuntimeSessionView,
} from "@/types/codex";

export function runtimeStatusToCodexStatus(
  status: RuntimeConversationStatus,
): CodexConversationStatus {
  const recentJobs = status.recentJobs
    .map(runtimeJobToCodexJob)
    .filter((job): job is CodexRuntimeJob => Boolean(job));
  return {
    ...status,
    activeSession: runtimeSessionToCodexSession(status.activeSession),
    activeJob: runtimeJobToCodexJob(status.activeJob),
    latestJob: runtimeJobToCodexJob(status.latestJob),
    recentJobs,
  };
}

export function runtimeSessionToCodexSession(
  session: RuntimeSessionView | null,
): CodexSessionRecord | null {
  if (!session) return null;
  return {
    id: session.id,
    openimConversationId: session.openimConversationId,
    openimDisplayUserId: session.openimDisplayUserId,
    runtimeKind: session.runtimeKind,
    codexSessionId: session.legacyCodex?.codexSessionId ?? session.externalSessionId,
    codexProjectPath:
      session.legacyCodex?.codexProjectPath ?? session.projectPath ?? "",
    codexHomeDir: session.legacyCodex?.codexHomeDir ?? session.runtimeHomeDir,
    codexHomeSeedMode: session.legacyCodex?.codexHomeSeedMode ?? null,
    sandboxMode: session.sandboxMode,
    runtimeProfileId: session.runtimeProfileId,
    displayName: session.displayName,
    displayNameSource: null,
    lastSummary: session.lastSummary,
    isActive: session.isActive,
    status: session.status,
    parentSessionRecordId: null,
    forkedFromCodexSessionId: null,
    createdReason: "runtime_view",
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

export function runtimeJobToCodexJob(
  job: RuntimeJobView | null,
): CodexRuntimeJob | null {
  if (!job) return null;
  return {
    ...job,
    runtimeKind: job.runtimeKind,
    codexSessionIdBefore:
      job.legacyCodex?.codexSessionIdBefore ?? job.codexSessionIdBefore ?? null,
    codexSessionIdAfter:
      job.legacyCodex?.codexSessionIdAfter ?? job.codexSessionIdAfter ?? null,
  };
}
