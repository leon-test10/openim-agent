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

export function toRuntimeSessionView(session: CodexSessionRecord | null): RuntimeSessionView | null {
  if (!session) {
    return null;
  }
  return {
    id: session.id,
    openimConversationId: session.openimConversationId,
    openimDisplayUserId: session.openimDisplayUserId,
    runtimeKind: "codex_cli",
    externalSessionId: session.codexSessionId,
    projectPath: session.codexProjectPath,
    runtimeHomeDir: session.codexHomeDir,
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

export function toRuntimeJobApiView(job: RuntimeJobView | null): RuntimeJobApiView | null {
  if (!job) {
    return null;
  }
  return {
    ...job,
    runtimeKind: "codex_cli",
    externalSessionIdBefore: job.codexSessionIdBefore,
    externalSessionIdAfter: job.codexSessionIdAfter,
    legacyCodex: {
      codexSessionIdBefore: job.codexSessionIdBefore,
      codexSessionIdAfter: job.codexSessionIdAfter
    }
  };
}
