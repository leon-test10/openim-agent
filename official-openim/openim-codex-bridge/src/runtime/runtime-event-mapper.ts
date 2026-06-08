import { normalizeCodexJsonEvent } from "../adapters/codex/codex-output.parser.js";
import type { RuntimeKind, RuntimeNormalizedEvent } from "./runtime-types.js";

export function normalizeRuntimeEvent(kind: RuntimeKind, event: Record<string, unknown>): RuntimeNormalizedEvent {
  if (kind === "codex_cli") {
    return normalizeCodexJsonEvent(event);
  }

  const eventType = typeof event.type === "string" && event.type.trim() ? event.type : `${kind}.event`;
  const title = typeof event.title === "string" && event.title.trim() ? event.title : eventType;
  const summary = typeof event.summary === "string" && event.summary.trim() ? event.summary : null;

  return {
    eventType,
    title,
    summary,
    rawEvent: event
  };
}
