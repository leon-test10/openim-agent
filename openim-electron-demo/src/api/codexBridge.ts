import {
  CodexBindingDetail,
  CodexBridgeMeta,
  CodexContextPreview,
  CodexConversationStatus,
  CodexRuntimeEvent,
  CodexRuntimeJob,
  CodexRuntimeProfile,
  CodexRuntimeProfileInput,
  CodexSessionDiagnostics,
  CodexSessionRecord,
  CreateCodexSessionInput,
  OpenImHistoryImportResult,
  OpenImHistorySnapshotInput,
  RebindCodexInput,
  RuntimeConversationStatus,
  RuntimeJobView,
  ResolvedRuntimeScopeConfig,
  RuntimeProfileTestResult,
  RuntimeScopeConfig,
  RuntimeScopeType,
  RuntimeSessionView,
} from "@/types/codex";
import { getViteEnv } from "@/utils/env";

const bridgeBaseUrl = getViteEnv(
  "VITE_CODEX_BRIDGE_URL",
  "http://127.0.0.1:8787",
).replace(/\/$/, "");

interface BridgeErrorBody {
  error?: string;
  message?: string;
  statusCode?: number;
}

const emptyJsonBody = JSON.stringify({});

async function requestBridge<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${bridgeBaseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init?.headers,
    },
  });

  if (!response.ok) {
    const rawBody = await response.text().catch(() => "");
    const parsed = parseBridgeErrorBody(rawBody);
    const message = parsed?.message || rawBody || response.statusText;
    const legacyHint =
      response.status === 404 && message.toLowerCase().includes("route")
        ? " Bridge may be running an older version; restart openim-codex-bridge."
        : "";
    throw new Error(
      `Codex bridge request failed: HTTP ${response.status} ${message}${legacyHint}`,
    );
  }

  return response.json() as Promise<T>;
}

function parseBridgeErrorBody(rawBody: string): BridgeErrorBody | null {
  try {
    return JSON.parse(rawBody) as BridgeErrorBody;
  } catch {
    return null;
  }
}

export function getCodexBridgeMeta() {
  return requestBridge<CodexBridgeMeta>("/api/meta");
}

export function getCodexStatus(conversationID: string) {
  return requestBridge<CodexConversationStatus>(
    `/api/conversations/${encodeURIComponent(conversationID)}/status`,
  );
}

export function getRuntimeStatus(conversationID: string) {
  return requestBridge<RuntimeConversationStatus>(
    `/api/conversations/${encodeURIComponent(conversationID)}/runtime-status`,
  );
}

export function getCodexBinding(conversationID: string) {
  return requestBridge<CodexBindingDetail>(
    `/api/bindings/${encodeURIComponent(conversationID)}`,
  );
}

export function getCodexSessions(conversationID: string) {
  return requestBridge<{ conversationId: string; sessions: CodexSessionRecord[] }>(
    `/api/conversations/${encodeURIComponent(
      conversationID,
    )}/codex-sessions?includeArchived=true`,
  );
}

export function getRuntimeSessions(conversationID: string) {
  return requestBridge<{
    conversationId: string;
    runtimeKind: RuntimeConversationStatus["runtimeKind"];
    sessions: RuntimeSessionView[];
  }>(
    `/api/conversations/${encodeURIComponent(
      conversationID,
    )}/runtime-sessions?includeArchived=true`,
  );
}

export function createCodexSession(
  conversationID: string,
  payload: CreateCodexSessionInput,
) {
  return requestBridge<CodexSessionRecord>(
    `/api/conversations/${encodeURIComponent(conversationID)}/codex-sessions`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function createRuntimeSession(
  conversationID: string,
  payload: CreateCodexSessionInput,
) {
  return requestBridge<RuntimeSessionView>(
    `/api/conversations/${encodeURIComponent(conversationID)}/runtime-sessions`,
    {
      method: "POST",
      body: JSON.stringify({
        ...payload,
        projectPath: payload.codexProjectPath,
      }),
    },
  );
}

export function activateCodexSession(conversationID: string, sessionRecordID: string) {
  return requestBridge<CodexSessionRecord>(
    `/api/conversations/${encodeURIComponent(
      conversationID,
    )}/codex-sessions/${encodeURIComponent(sessionRecordID)}/activate`,
    { method: "POST", body: emptyJsonBody },
  );
}

export function activateRuntimeSession(
  conversationID: string,
  sessionRecordID: string,
) {
  return requestBridge<RuntimeSessionView>(
    `/api/conversations/${encodeURIComponent(
      conversationID,
    )}/runtime-sessions/${encodeURIComponent(sessionRecordID)}/activate`,
    { method: "POST", body: emptyJsonBody },
  );
}

export function updateCodexSession(
  conversationID: string,
  sessionRecordID: string,
  payload: { displayName: string },
) {
  return requestBridge<CodexSessionRecord>(
    `/api/conversations/${encodeURIComponent(
      conversationID,
    )}/codex-sessions/${encodeURIComponent(sessionRecordID)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function updateRuntimeSession(
  conversationID: string,
  sessionRecordID: string,
  payload: { displayName: string },
) {
  return requestBridge<RuntimeSessionView>(
    `/api/conversations/${encodeURIComponent(
      conversationID,
    )}/runtime-sessions/${encodeURIComponent(sessionRecordID)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function archiveCodexSession(conversationID: string, sessionRecordID: string) {
  return requestBridge<CodexSessionRecord>(
    `/api/conversations/${encodeURIComponent(
      conversationID,
    )}/codex-sessions/${encodeURIComponent(sessionRecordID)}/archive`,
    { method: "POST", body: emptyJsonBody },
  );
}

export function archiveRuntimeSession(conversationID: string, sessionRecordID: string) {
  return requestBridge<RuntimeSessionView>(
    `/api/conversations/${encodeURIComponent(
      conversationID,
    )}/runtime-sessions/${encodeURIComponent(sessionRecordID)}/archive`,
    { method: "POST", body: emptyJsonBody },
  );
}

export function restoreCodexSession(conversationID: string, sessionRecordID: string) {
  return requestBridge<CodexSessionRecord>(
    `/api/conversations/${encodeURIComponent(
      conversationID,
    )}/codex-sessions/${encodeURIComponent(sessionRecordID)}/restore`,
    { method: "POST", body: emptyJsonBody },
  );
}

export function deleteCodexSession(conversationID: string, sessionRecordID: string) {
  return requestBridge<CodexSessionRecord>(
    `/api/conversations/${encodeURIComponent(
      conversationID,
    )}/codex-sessions/${encodeURIComponent(sessionRecordID)}`,
    { method: "DELETE", body: emptyJsonBody },
  );
}

export function listRuntimeProfiles() {
  return requestBridge<{ profiles: CodexRuntimeProfile[] }>("/api/runtime-profiles");
}

export function createRuntimeProfile(payload: CodexRuntimeProfileInput) {
  return requestBridge<CodexRuntimeProfile>("/api/runtime-profiles", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateRuntimeProfile(
  profileID: string,
  payload: Partial<CodexRuntimeProfileInput>,
) {
  return requestBridge<CodexRuntimeProfile>(
    `/api/runtime-profiles/${encodeURIComponent(profileID)}`,
    {
      method: "PATCH",
      body: JSON.stringify(payload),
    },
  );
}

export function deleteRuntimeProfile(profileID: string) {
  return requestBridge<CodexRuntimeProfile>(
    `/api/runtime-profiles/${encodeURIComponent(profileID)}`,
    { method: "DELETE", body: emptyJsonBody },
  );
}

export function testRuntimeProfile(profileID: string) {
  return requestBridge<RuntimeProfileTestResult>(
    `/api/runtime-profiles/${encodeURIComponent(profileID)}/test`,
    {
      method: "POST",
      body: emptyJsonBody,
    },
  );
}

export function getResolvedRuntimeScopeConfig(
  conversationID?: string,
  groupID?: string,
) {
  const query = new URLSearchParams();
  if (conversationID) query.set("conversationId", conversationID);
  if (groupID) query.set("groupId", groupID);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return requestBridge<ResolvedRuntimeScopeConfig>(
    `/api/runtime-scope-configs/resolve${suffix}`,
  );
}

export function upsertRuntimeScopeConfig(
  scopeType: RuntimeScopeType,
  scopeKey: string,
  payload: { runtimeKind: RuntimeSessionView["runtimeKind"]; runtimeProfileId?: string | null },
) {
  return requestBridge<{
    config: RuntimeScopeConfig;
    profile: ResolvedRuntimeScopeConfig["profile"];
  }>(
    `/api/runtime-scope-configs/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeKey)}`,
    {
      method: "PUT",
      body: JSON.stringify(payload),
    },
  );
}

export function deleteRuntimeScopeConfig(
  scopeType: RuntimeScopeType,
  scopeKey: string,
) {
  return requestBridge<{ deleted: RuntimeScopeConfig }>(
    `/api/runtime-scope-configs/${encodeURIComponent(scopeType)}/${encodeURIComponent(scopeKey)}`,
    {
      method: "DELETE",
      body: emptyJsonBody,
    },
  );
}

export function getCodexSessionDiagnostics(
  conversationID: string,
  sessionRecordID: string,
) {
  return requestBridge<CodexSessionDiagnostics>(
    `/api/conversations/${encodeURIComponent(
      conversationID,
    )}/codex-sessions/${encodeURIComponent(sessionRecordID)}/diagnostics`,
  );
}

export function postOpenImHistorySnapshot(
  conversationID: string,
  payload: OpenImHistorySnapshotInput,
) {
  return requestBridge<OpenImHistoryImportResult>(
    `/api/conversations/${encodeURIComponent(conversationID)}/openim-history-snapshots`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function getCodexContextPreview(conversationID: string, includePrompt = false) {
  const query = includePrompt ? "?includePrompt=true" : "";
  return requestBridge<CodexContextPreview>(
    `/api/conversations/${encodeURIComponent(conversationID)}/context/preview${query}`,
  );
}

export function getCodexJobEvents(jobID: string, afterSequence = 0) {
  const query = afterSequence > 0 ? `?after=${afterSequence}` : "";
  return requestBridge<{ jobId: string; events: CodexRuntimeEvent[] }>(
    `/api/jobs/${encodeURIComponent(jobID)}/events${query}`,
  );
}

export function getRuntimeJobEvents(jobID: string, afterSequence = 0) {
  const query = afterSequence > 0 ? `?after=${afterSequence}` : "";
  return requestBridge<{ jobId: string; events: CodexRuntimeEvent[] }>(
    `/api/runtime/jobs/${encodeURIComponent(jobID)}/events${query}`,
  );
}

export function getCodexJobEventsStreamUrl(jobID: string, afterSequence = 0) {
  const query = afterSequence > 0 ? `?after=${afterSequence}` : "";
  return `${bridgeBaseUrl}/api/jobs/${encodeURIComponent(jobID)}/events/stream${query}`;
}

export function getCodexConversationEventsStreamUrl(conversationID: string) {
  return `${bridgeBaseUrl}/api/conversations/${encodeURIComponent(
    conversationID,
  )}/events/stream`;
}

export function cancelCodexJob(jobID: string) {
  return requestBridge<CodexRuntimeJob>(
    `/api/jobs/${encodeURIComponent(jobID)}/cancel`,
    { method: "POST", body: emptyJsonBody },
  );
}

export function cancelRuntimeJob(jobID: string) {
  return requestBridge<RuntimeJobView>(
    `/api/runtime/jobs/${encodeURIComponent(jobID)}/cancel`,
    { method: "POST", body: emptyJsonBody },
  );
}

export function retryCodexJob(jobID: string) {
  return requestBridge<CodexRuntimeJob>(
    `/api/jobs/${encodeURIComponent(jobID)}/retry`,
    { method: "POST", body: emptyJsonBody },
  );
}

export function retryRuntimeJob(jobID: string) {
  return requestBridge<RuntimeJobView>(
    `/api/runtime/jobs/${encodeURIComponent(jobID)}/retry`,
    { method: "POST", body: emptyJsonBody },
  );
}

export function rebindCodexConversation(
  conversationID: string,
  payload: RebindCodexInput,
) {
  return requestBridge<CodexBindingDetail>(
    `/api/bindings/${encodeURIComponent(conversationID)}/rebind`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

export function archiveCodexConversation(conversationID: string) {
  return requestBridge<{
    openimConversationId: string;
    archivedSession: CodexBindingDetail["activeSession"];
    activeSession: null;
    sessions: CodexBindingDetail["sessions"];
    latestJob: CodexRuntimeJob | null;
    recentJobs: CodexRuntimeJob[];
  }>(`/api/bindings/${encodeURIComponent(conversationID)}/archive`, {
    method: "POST",
    body: emptyJsonBody,
  });
}
