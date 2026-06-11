import type { RuntimeKind } from "../runtime/runtime-types.js";
import type { ConversationRuntimeState, RuntimeJobView } from "./conversation-status.js";
import type { RuntimeJob } from "./runtime-job.js";
import type { CodexSessionRecord } from "./session-binding.js";

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
  legacyCodex: {
    codexSessionId: string | null;
    codexProjectPath: string;
    codexHomeDir: string | null;
    codexHomeSeedMode: CodexSessionRecord["codexHomeSeedMode"];
  };
}

export interface RuntimeJobApiView extends RuntimeJobView {
  runtimeKind: RuntimeKind;
  externalSessionIdBefore: string | null;
  externalSessionIdAfter: string | null;
  legacyCodex: {
    codexSessionIdBefore: string | null;
    codexSessionIdAfter: string | null;
  };
}

export interface RuntimeConversationStatusView {
  openimConversationId: string;
  runtimeKind: RuntimeKind;
  state: ConversationRuntimeState;
  activeSession: RuntimeSessionView | null;
  activeJob: RuntimeJobApiView | null;
  latestJob: RuntimeJobApiView | null;
  recentJobs: RuntimeJobApiView[];
  queuedJobCount: number;
  pendingHistoryImport?: unknown;
}

export function toRuntimeSessionView(
  session: CodexSessionRecord | null,
  runtimeKind?: RuntimeKind
): RuntimeSessionView | null {
  if (!session) {
    return null;
  }
  const viewRuntimeKind = runtimeKind ?? session.runtimeKind;
  return {
    id: session.id,
    openimConversationId: session.openimConversationId,
    openimDisplayUserId: session.openimDisplayUserId,
    runtimeKind: viewRuntimeKind,
    externalSessionId: viewRuntimeKind === "codex_cli" ? session.codexSessionId : null,
    projectPath: session.codexProjectPath,
    runtimeHomeDir: viewRuntimeKind === "codex_cli" ? session.codexHomeDir : null,
    displayName: session.displayName,
    lastSummary: session.lastSummary,
    isActive: session.isActive,
    status: session.status,
    runtimeProfileId: session.runtimeProfileId,
    sandboxMode: session.sandboxMode,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    legacyCodex: {
      codexSessionId: session.codexSessionId,
      codexProjectPath: session.codexProjectPath,
      codexHomeDir: session.codexHomeDir,
      codexHomeSeedMode: session.codexHomeSeedMode
    }
  };
}

export function toRuntimeJobApiView(
  job: RuntimeJobView | null,
  runtimeKind?: RuntimeKind
): RuntimeJobApiView | null {
  if (!job) {
    return null;
  }
  const viewRuntimeKind = runtimeKind ?? job.runtimeKind;
  return {
    ...job,
    runtimeKind: viewRuntimeKind,
    externalSessionIdBefore: viewRuntimeKind === "codex_cli" ? job.codexSessionIdBefore : null,
    externalSessionIdAfter: viewRuntimeKind === "codex_cli" ? job.codexSessionIdAfter : null,
    legacyCodex: {
      codexSessionIdBefore: job.codexSessionIdBefore,
      codexSessionIdAfter: job.codexSessionIdAfter
    }
  };
}
