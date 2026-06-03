import type { RuntimeJob } from "./runtime-job.js";
import type { CodexSessionRecord } from "./session-binding.js";

export type ConversationRuntimeState = "unknown" | "idle" | "queued" | "running" | "cancelling" | "failed" | "completed";

export interface BindingSummary {
  openimConversationId: string;
  openimDisplayUserId: string;
  activeSessionRecordId: string;
  codexSessionId: string | null;
  codexProjectPath: string;
  sessionStatus: CodexSessionRecord["status"];
  latestJobId: string | null;
  latestJobStatus: RuntimeJob["status"] | null;
  updatedAt: number;
}

export interface ConversationStatus {
  openimConversationId: string;
  state: ConversationRuntimeState;
  activeSession: CodexSessionRecord | null;
  activeJob: RuntimeJob | null;
  latestJob: RuntimeJob | null;
  recentJobs: RuntimeJob[];
}

export function deriveConversationState(input: {
  activeSession: CodexSessionRecord | null;
  activeJob: RuntimeJob | null;
  latestJob: RuntimeJob | null;
}): ConversationRuntimeState {
  if (!input.activeSession) {
    return "unknown";
  }

  if (input.activeJob?.status === "running") {
    return "running";
  }

  if (input.activeJob?.status === "cancelling") {
    return "cancelling";
  }

  if (input.activeJob?.status === "queued") {
    return "queued";
  }

  if (!input.latestJob) {
    return "idle";
  }

  if (input.latestJob.status === "failed") {
    return "failed";
  }

  if (input.latestJob.status === "cancelled") {
    return "idle";
  }

  if (input.latestJob.status === "succeeded") {
    return "completed";
  }

  return input.latestJob.status === "running" ? "running" : input.latestJob.status === "cancelling" ? "cancelling" : "queued";
}
