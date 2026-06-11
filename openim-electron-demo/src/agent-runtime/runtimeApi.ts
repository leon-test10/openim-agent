import {
  activateCodexSession,
  activateRuntimeSession,
  archiveCodexSession,
  archiveRuntimeSession,
  cancelCodexJob,
  cancelRuntimeJob,
  createCodexSession,
  createRuntimeSession,
  getCodexJobEvents,
  getCodexSessions,
  getCodexStatus,
  getRuntimeJobEvents,
  getRuntimeSessions,
  getRuntimeStatus,
  retryCodexJob,
  retryRuntimeJob,
  updateCodexSession,
  updateRuntimeSession,
} from "@/api/codexBridge";

import {
  runtimeJobToCodexJob,
  runtimeSessionToCodexSession,
  runtimeStatusToCodexStatus,
} from "./runtimeMappers";

export async function getConversationRuntimeStatus(conversationID: string) {
  return withLegacyFallback(
    () => getRuntimeStatus(conversationID).then(runtimeStatusToCodexStatus),
    () => getCodexStatus(conversationID),
  );
}

export async function getConversationRuntimeSessions(conversationID: string) {
  try {
    const response = await getRuntimeSessions(conversationID);
    return {
      conversationId: response.conversationId,
      runtimeKind: response.runtimeKind,
      sessions: response.sessions
        .map(runtimeSessionToCodexSession)
        .filter((session): session is NonNullable<typeof session> => Boolean(session)),
    };
  } catch {
    const response = await getCodexSessions(conversationID);
    return {
      conversationId: response.conversationId,
      runtimeKind: "codex_cli" as const,
      sessions: response.sessions,
    };
  }
}

export async function createConversationRuntimeSession(
  conversationID: string,
  payload: Parameters<typeof createRuntimeSession>[1],
) {
  return withLegacyFallback(
    () =>
      createRuntimeSession(conversationID, payload).then(runtimeSessionToCodexSession),
    () => createCodexSession(conversationID, payload),
  );
}

export async function activateConversationRuntimeSession(
  conversationID: string,
  sessionRecordID: string,
) {
  return withLegacyFallback(
    () =>
      activateRuntimeSession(conversationID, sessionRecordID).then(
        runtimeSessionToCodexSession,
      ),
    () => activateCodexSession(conversationID, sessionRecordID),
  );
}

export async function updateConversationRuntimeSession(
  conversationID: string,
  sessionRecordID: string,
  payload: Parameters<typeof updateRuntimeSession>[2],
) {
  return withLegacyFallback(
    () =>
      updateRuntimeSession(conversationID, sessionRecordID, payload).then(
        runtimeSessionToCodexSession,
      ),
    () => updateCodexSession(conversationID, sessionRecordID, payload),
  );
}

export async function archiveConversationRuntimeSession(
  conversationID: string,
  sessionRecordID: string,
) {
  return withLegacyFallback(
    () =>
      archiveRuntimeSession(conversationID, sessionRecordID).then(
        runtimeSessionToCodexSession,
      ),
    () => archiveCodexSession(conversationID, sessionRecordID),
  );
}

export function getConversationRuntimeJobEvents(jobID: string, afterSequence = 0) {
  return withLegacyFallback(
    () => getRuntimeJobEvents(jobID, afterSequence),
    () => getCodexJobEvents(jobID, afterSequence),
  );
}

export async function cancelConversationRuntimeJob(jobID: string) {
  return withLegacyFallback(
    () => cancelRuntimeJob(jobID).then(runtimeJobToCodexJob),
    () => cancelCodexJob(jobID),
  );
}

export async function retryConversationRuntimeJob(jobID: string) {
  return withLegacyFallback(
    () => retryRuntimeJob(jobID).then(runtimeJobToCodexJob),
    () => retryCodexJob(jobID),
  );
}

async function withLegacyFallback<T>(
  runtimeCall: () => Promise<T>,
  legacyCall: () => Promise<T>,
): Promise<T> {
  try {
    return await runtimeCall();
  } catch (error) {
    if (isRuntimeApiMissing(error)) {
      return legacyCall();
    }
    throw error;
  }
}

function isRuntimeApiMissing(error: unknown) {
  return error instanceof Error && error.message.includes("HTTP 404");
}
