import { Button, Tag, Tooltip } from "antd";

import { useCodexConversation } from "@/hooks/useCodexConversation";
import { CodexConversationState, CodexFailureReason } from "@/types/codex";

const stateColors: Record<CodexConversationState, string> = {
  unknown: "default",
  idle: "default",
  queued: "processing",
  running: "processing",
  cancelling: "warning",
  completed: "success",
  failed: "error",
};

const failureText: Record<CodexFailureReason, string> = {
  timeout: "Codex timed out",
  codex_exit: "Runtime failed",
  openim_send_failed: "OpenIM reply failed",
  bridge_error: "Bridge runtime error",
  missing_session: "Session missing",
};

export default function CodexStatusBadge() {
  const {
    isCodexConversation,
    status,
    loading,
    error,
    activeJob,
    latestJob,
    queuedJobCount,
    cancel,
  } = useCodexConversation();

  if (!isCodexConversation) {
    return null;
  }

  const state = status?.state ?? "unknown";
  const runtimeKind = status?.activeSession?.runtimeKind ?? "codex_cli";
  const failureReason = latestJob?.failureReason;
  const detail =
    error ||
    (failureReason ? failureText[failureReason] : undefined) ||
    latestJob?.errorText ||
    activeJob?.status;

  const runtimeLabel =
    runtimeKind === "openhands"
      ? "OpenHands"
      : runtimeKind === "openai_compatible"
        ? "OpenAI-compatible"
        : runtimeKind === "template"
          ? "Template"
        : "Codex";

  return (
    <div className="mt-1 flex items-center gap-2 text-xs">
      <Tooltip title={detail}>
        <Tag className="m-0" color={stateColors[state]}>
          {runtimeLabel} {loading && state === "unknown" ? "loading" : state}
          {queuedJobCount > 0 ? ` +${queuedJobCount} queued` : ""}
        </Tag>
      </Tooltip>
      {activeJob?.canCancel && (
        <Button size="small" danger onClick={() => void cancel()}>
          Cancel
        </Button>
      )}
    </div>
  );
}
