export interface RuntimeEvent {
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

export interface RecordRuntimeEventInput {
  jobId: string;
  sessionRecordId: string;
  openimConversationId: string;
  eventType: string;
  rawEvent: Record<string, unknown>;
  title?: string;
  summary?: string | null;
  createdAt?: number;
}
