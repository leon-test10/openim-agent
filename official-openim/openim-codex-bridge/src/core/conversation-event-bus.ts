import { EventEmitter } from "node:events";
import type { RuntimeEvent } from "./runtime-event.js";
import type { RuntimeJob } from "./runtime-job.js";
import type { CodexSessionRecord } from "./session-binding.js";
import type { OpenImHistoryImportRequest } from "./openim-history.repository.js";

export type ConversationStreamEventType =
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

export interface ConversationStreamEvent {
  id: number;
  conversationId: string;
  type: ConversationStreamEventType;
  createdAt: number;
  payload: Record<string, unknown>;
}

export class ConversationEventBus {
  private readonly emitter = new EventEmitter();
  private sequence = 0;

  publish(type: ConversationStreamEventType, conversationId: string, payload: Record<string, unknown>): ConversationStreamEvent {
    const event = {
      id: ++this.sequence,
      conversationId,
      type,
      createdAt: Date.now(),
      payload
    };
    this.emitter.emit(conversationId, event);
    return event;
  }

  subscribe(conversationId: string, listener: (event: ConversationStreamEvent) => void): () => void {
    this.emitter.on(conversationId, listener);
    return () => this.emitter.off(conversationId, listener);
  }

  publishJob(type: Extract<ConversationStreamEventType, `job_${string}`>, job: RuntimeJob): ConversationStreamEvent {
    return this.publish(type, job.openimConversationId, { job });
  }

  publishRuntimeEvent(event: RuntimeEvent): ConversationStreamEvent {
    return this.publish("runtime_event", event.openimConversationId, { runtimeEvent: event, jobId: event.jobId });
  }

  publishSessionChanged(conversationId: string, session: CodexSessionRecord | null, reason: string): ConversationStreamEvent {
    return this.publish("session_changed", conversationId, { session, reason });
  }

  publishBindingChanged(conversationId: string, payload: Record<string, unknown>): ConversationStreamEvent {
    return this.publish("binding_changed", conversationId, payload);
  }

  publishHistoryImportRequested(request: OpenImHistoryImportRequest): ConversationStreamEvent {
    return this.publish("history_import_requested", request.openimConversationId, { importRequest: request });
  }
}
