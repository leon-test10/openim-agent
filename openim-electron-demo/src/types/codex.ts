export type CodexConversationState =
  | "unknown"
  | "idle"
  | "queued"
  | "running"
  | "cancelling"
  | "failed"
  | "completed";

export type CodexJobStatus =
  | "queued"
  | "running"
  | "cancelling"
  | "succeeded"
  | "failed"
  | "cancelled";

export type CodexFailureReason =
  | "codex_exit"
  | "timeout"
  | "bridge_error"
  | "openim_send_failed"
  | "missing_session";

export interface CodexSessionRecord {
  id: string;
  openimConversationId: string;
  openimDisplayUserId: string;
  runtimeKind?: RuntimeKind;
  codexSessionId: string | null;
  codexProjectPath: string;
  codexHomeDir: string | null;
  codexHomeSeedMode: "copy-auth-only" | "copy-auth-and-config" | "none" | null;
  sandboxMode: string | null;
  runtimeProfileId: string | null;
  displayName: string | null;
  displayNameSource: "auto" | "manual" | null;
  lastSummary: string | null;
  isActive: boolean;
  status: "active" | "paused" | "archived" | "error" | "deleted";
  parentSessionRecordId: string | null;
  forkedFromCodexSessionId: string | null;
  createdReason: string;
  createdAt: number;
  updatedAt: number;
}

export interface CodexBridgeMeta {
  name: string;
  version: string;
  apiVersion: string;
  capabilities: {
    sessionMetadata?: boolean;
    sessionActivate?: boolean;
    sessionRename?: boolean;
    sessionArchive?: boolean;
    sessionRestore?: boolean;
    sessionDelete?: boolean;
    runtimeEvents?: boolean;
    jobCancel?: boolean;
    jobRetry?: boolean;
    runtimeProfiles?: boolean;
    conversationEvents?: boolean;
    sessionResumeDiagnostics?: boolean;
    openimHistoryImport?: boolean;
    semanticContext?: boolean;
    runtimeApi?: boolean;
    codexLegacyApi?: boolean;
    openaiCompatibleRuntime?: boolean;
    openHandsRuntime?: boolean;
  };
  runtimePolicy?: {
    environment: string;
    isAdmin: boolean;
    canModify: boolean;
    canUseDangerFullAccess: boolean;
    canUseCodexHomeOverride: boolean;
  };
  projectPathPolicy?: {
    allowlist: string[];
  };
}

export interface CodexRuntimeJob {
  id: string;
  sessionRecordId: string;
  semanticEventId: string;
  openimConversationId: string;
  runtimeKind?: RuntimeKind;
  status: CodexJobStatus;
  inputText: string;
  codexSessionIdBefore: string | null;
  codexSessionIdAfter: string | null;
  outputText: string | null;
  errorText: string | null;
  failureReason: CodexFailureReason | null;
  retryOfJobId: string | null;
  cancelRequestedAt: number | null;
  cancelledAt: number | null;
  cancelMethod: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
  queuedMs?: number | null;
  runningMs?: number | null;
  totalMs?: number | null;
  runningForMs?: number | null;
  totalDurationMs?: number | null;
  canCancel?: boolean;
  canRetry?: boolean;
}

export type RuntimeKind = "codex_cli" | "openai_compatible" | "openhands" | "template";

export interface RuntimeSessionView {
  id: string;
  openimConversationId: string;
  openimDisplayUserId: string;
  runtimeKind: RuntimeKind;
  externalSessionId: string | null;
  projectPath: string | null;
  runtimeHomeDir: string | null;
  displayName: string | null;
  lastSummary: string | null;
  isActive: boolean;
  status: CodexSessionRecord["status"];
  runtimeProfileId: string | null;
  sandboxMode: string | null;
  createdAt: number;
  updatedAt: number;
  legacyCodex?: {
    codexSessionId: string | null;
    codexProjectPath: string;
    codexHomeDir: string | null;
    codexHomeSeedMode: CodexSessionRecord["codexHomeSeedMode"];
  };
}

export interface RuntimeJobView extends CodexRuntimeJob {
  runtimeKind: RuntimeKind;
  externalSessionIdBefore: string | null;
  externalSessionIdAfter: string | null;
  legacyCodex?: {
    codexSessionIdBefore: string | null;
    codexSessionIdAfter: string | null;
  };
}

export interface RuntimeConversationStatus {
  openimConversationId: string;
  runtimeKind: RuntimeKind;
  state: CodexConversationState;
  activeSession: RuntimeSessionView | null;
  activeJob: RuntimeJobView | null;
  latestJob: RuntimeJobView | null;
  recentJobs: RuntimeJobView[];
  queuedJobCount: number;
  pendingHistoryImport: OpenImHistoryImportRequest | null;
}

export interface CodexRuntimeEvent {
  id: string;
  jobId: string;
  sessionRecordId: string;
  openimConversationId: string;
  sequence: number;
  eventType: string;
  title: string;
  summary: string | null;
  rawEvent: Record<string, unknown>;
  createdAt: number;
}

export type CodexConversationStreamEventType =
  | "job_created"
  | "job_queued"
  | "job_started"
  | "runtime_event"
  | "job_succeeded"
  | "job_failed"
  | "job_cancelled"
  | "session_changed"
  | "binding_changed"
  | "history_import_requested";

export interface CodexConversationStreamEvent {
  id: number;
  conversationId: string;
  type: CodexConversationStreamEventType;
  createdAt: number;
  payload: {
    job?: CodexRuntimeJob;
    runtimeEvent?: CodexRuntimeEvent;
    session?: CodexSessionRecord | null;
    [key: string]: unknown;
  };
}

export interface CodexConversationStatus {
  openimConversationId: string;
  state: CodexConversationState;
  activeSession: CodexSessionRecord | null;
  activeJob: CodexRuntimeJob | null;
  latestJob: CodexRuntimeJob | null;
  recentJobs: CodexRuntimeJob[];
  queuedJobCount: number;
  pendingHistoryImport: OpenImHistoryImportRequest | null;
}

export interface CodexBindingDetail {
  openimConversationId: string;
  activeSession: CodexSessionRecord;
  sessions: CodexSessionRecord[];
  activeJob: CodexRuntimeJob | null;
  latestJob: CodexRuntimeJob | null;
  recentJobs: CodexRuntimeJob[];
}

export interface RebindCodexInput {
  openimDisplayUserId?: string;
  userId?: string;
  codexProjectPath?: string;
  codexSessionId?: string;
  runtimeKind?: RuntimeKind;
  runtimeProfileId?: string | null;
}

export interface CreateCodexSessionInput {
  openimDisplayUserId?: string;
  userId?: string;
  codexProjectPath?: string;
  displayName?: string;
  runtimeKind?: RuntimeKind;
  runtimeProfileId?: string | null;
}

export type RuntimeScopeType = "shared" | "conversation" | "group";

export interface RuntimeScopeConfig {
  id: string;
  scopeType: RuntimeScopeType;
  scopeKey: string;
  runtimeKind: RuntimeKind;
  runtimeProfileId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ResolvedRuntimeScopeConfig {
  source: RuntimeScopeType | "env";
  runtimeKind: RuntimeKind;
  runtimeProfileId: string | null;
  config: RuntimeScopeConfig | null;
  profile: CodexRuntimeProfile | null;
}

export interface CodexRuntimeProfile {
  id: string;
  name: string;
  runtimeKind: RuntimeKind;
  providerType: "openai" | "openai-compatible" | "oss-local";
  providerMode:
    | "openai-responses"
    | "deepseek-via-responses-bridge"
    | "openai-chat-probe-only"
    | null;
  model: string | null;
  sandboxMode: string | null;
  approvalPolicy: string | null;
  codexProfile: string | null;
  baseUrl: string | null;
  bridgeBaseUrl: string | null;
  wireApi: string | null;
  authEnvKey: string | null;
  codexHomeOverride: string | null;
  localProvider: "lmstudio" | "ollama" | null;
  useOss: boolean;
  apiKeyMasked: string | null;
  status: "active" | "deleted";
  createdAt: number;
  updatedAt: number;
}

export interface CodexRuntimeProfileInput {
  name: string;
  runtimeKind?: RuntimeKind;
  providerType?: CodexRuntimeProfile["providerType"];
  providerMode?: CodexRuntimeProfile["providerMode"];
  model?: string | null;
  sandboxMode?: string | null;
  approvalPolicy?: string | null;
  codexProfile?: string | null;
  baseUrl?: string | null;
  bridgeBaseUrl?: string | null;
  wireApi?: string | null;
  authEnvKey?: string | null;
  codexHomeOverride?: string | null;
  localProvider?: CodexRuntimeProfile["localProvider"];
  useOss?: boolean;
  apiKey?: string | null;
}

export interface CodexSessionDiagnostics {
  conversationId: string;
  sessionRecordId: string;
  codexSessionId: string | null;
  codexHomeDir: string | null;
  homeExists: boolean;
  rolloutExists: boolean;
  resumeReady: boolean;
  lastJobId: string | null;
  lastResumeFailure: string | null;
}

export interface OpenImHistoryImportRequest {
  id: string;
  openimConversationId: string;
  requestedCount: number;
  status: "pending" | "fulfilled" | "failed";
  createdAt: number;
  fulfilledAt: number | null;
}

export interface OpenImHistorySnapshotInput {
  requestId?: string;
  source?: string;
  messages: Array<{
    clientMsgID?: string;
    serverMsgID?: string;
    sendID?: string;
    recvID?: string;
    groupID?: string;
    senderNickname?: string;
    contentType?: number;
    sendTime?: number;
    text?: string;
    preview?: string;
    ex?: Record<string, unknown>;
  }>;
}

export interface OpenImHistoryImportResult {
  conversationID: string;
  receivedCount: number;
  importedCount: number;
  skippedDuplicateCount: number;
  skippedUnsupportedCount: number;
  earliestTimestamp?: number;
  latestTimestamp?: number;
  importedEventIDs: string[];
  errors?: Array<{ index: number; reason: string }>;
  messageCount: number;
  snapshotId: string;
  requestId: string | null;
}

export interface CodexContextPreview {
  conversationID: string;
  conversationType: string;
  projectPath?: string;
  activeCodexSessionID?: string;
  summaryIncluded: boolean;
  summaryUpdatedAt?: number;
  summaryEventCount?: number;
  recentEventCount: number;
  includedEventIDs: string[];
  skippedEventCount: number;
  skippedReasons: Record<string, number>;
  roleCounts: Record<string, number>;
  actorCounts: Record<string, number>;
  semanticContextIncluded?: boolean;
  semanticContextReason?: string;
  promptPreview?: string;
  promptRedacted: boolean;
}

export interface RuntimeProfileTestResult {
  ok: boolean;
  runtimeKind?: RuntimeKind;
  profile: CodexRuntimeProfile;
  upstreamProbe: {
    ok: boolean;
    skipped: boolean;
    status?: number;
    errorText?: string;
  };
  codexProbe: {
    ok: boolean;
    skipped: boolean;
    codexArgs?: string[];
    env?: Record<string, string>;
    exitCode?: number | null;
    outputPreview?: string;
    errorText?: string;
  };
}
