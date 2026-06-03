export interface RuntimeJob {
  id: string;
  sessionRecordId: string;
  semanticEventId: string;
  openimConversationId: string;
  status: "queued" | "running" | "cancelling" | "succeeded" | "failed" | "cancelled";
  inputText: string;
  codexSessionIdBefore: string | null;
  codexSessionIdAfter: string | null;
  outputText: string | null;
  errorText: string | null;
  failureReason: "codex_exit" | "timeout" | "bridge_error" | "openim_send_failed" | "missing_session" | null;
  retryOfJobId: string | null;
  cancelRequestedAt: number | null;
  cancelledAt: number | null;
  cancelMethod: string | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}
