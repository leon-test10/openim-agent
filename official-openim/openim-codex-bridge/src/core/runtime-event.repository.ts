import type { BridgeDatabase } from "../storage/db.js";
import { createId } from "../utils/ids.js";
import type { RecordRuntimeEventInput, RuntimeEvent } from "./runtime-event.js";

interface RuntimeEventRow {
  id: string;
  job_id: string;
  session_record_id: string;
  openim_conversation_id: string;
  sequence: number;
  event_type: string;
  title: string;
  summary: string | null;
  raw_event_json: string;
  created_at: number;
}

export class RuntimeEventRepository {
  constructor(private readonly db: BridgeDatabase) {}

  recordCodexJsonEvent(input: RecordRuntimeEventInput): RuntimeEvent {
    const sequence = this.nextSequence(input.jobId);
    const event = {
      id: createId("rte"),
      jobId: input.jobId,
      sessionRecordId: input.sessionRecordId,
      openimConversationId: input.openimConversationId,
      sequence,
      eventType: input.eventType,
      title: input.title ?? input.eventType,
      summary: input.summary ?? null,
      rawEventJson: JSON.stringify(input.rawEvent),
      createdAt: input.createdAt ?? Date.now()
    };
    this.db
      .prepare(
        `
        INSERT INTO runtime_events (
          id, job_id, session_record_id, openim_conversation_id,
          sequence, event_type, title, summary, raw_event_json, created_at
        ) VALUES (
          @id, @jobId, @sessionRecordId, @openimConversationId,
          @sequence, @eventType, @title, @summary, @rawEventJson, @createdAt
        )
      `
      )
      .run(event);
    return this.getById(event.id)!;
  }

  listByJobId(jobId: string, limit = 200): RuntimeEvent[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM runtime_events
        WHERE job_id = ?
        ORDER BY sequence ASC
        LIMIT ?
      `
      )
      .all(jobId, limit) as RuntimeEventRow[];
    return rows.map(mapRuntimeEventRow);
  }

  listByJobIdAfter(jobId: string, afterSequence: number, limit = 200): RuntimeEvent[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM runtime_events
        WHERE job_id = ? AND sequence > ?
        ORDER BY sequence ASC
        LIMIT ?
      `
      )
      .all(jobId, afterSequence, limit) as RuntimeEventRow[];
    return rows.map(mapRuntimeEventRow);
  }

  private getById(id: string): RuntimeEvent | null {
    const row = this.db.prepare("SELECT * FROM runtime_events WHERE id = ?").get(id) as RuntimeEventRow | undefined;
    return row ? mapRuntimeEventRow(row) : null;
  }

  private nextSequence(jobId: string): number {
    const row = this.db
      .prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM runtime_events WHERE job_id = ?")
      .get(jobId) as { next_sequence: number };
    return row.next_sequence;
  }
}

function mapRuntimeEventRow(row: RuntimeEventRow): RuntimeEvent {
  return {
    id: row.id,
    jobId: row.job_id,
    sessionRecordId: row.session_record_id,
    openimConversationId: row.openim_conversation_id,
    sequence: row.sequence,
    eventType: row.event_type,
    title: row.title,
    summary: row.summary,
    rawEvent: JSON.parse(row.raw_event_json) as Record<string, unknown>,
    createdAt: row.created_at
  };
}
