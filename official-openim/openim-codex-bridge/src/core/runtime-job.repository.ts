import type { BridgeDatabase } from "../storage/db.js";
import { createId } from "../utils/ids.js";
import type { RuntimeJob } from "./runtime-job.js";

interface RuntimeJobRow {
  id: string;
  session_record_id: string;
  semantic_event_id: string;
  openim_conversation_id: string;
  status: RuntimeJob["status"];
  input_text: string;
  codex_session_id_before: string | null;
  codex_session_id_after: string | null;
  output_text: string | null;
  error_text: string | null;
  cancel_requested_at: number | null;
  cancelled_at: number | null;
  cancel_method: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface CreateQueuedJobInput {
  sessionRecordId: string;
  semanticEventId: string;
  openimConversationId: string;
  inputText: string;
  codexSessionIdBefore: string | null;
}

export class RuntimeJobRepository {
  constructor(private readonly db: BridgeDatabase) {}

  createQueuedJob(input: CreateQueuedJobInput): RuntimeJob {
    const id = createId("job");
    this.db
      .prepare(
        `
        INSERT INTO runtime_jobs (
          id, session_record_id, semantic_event_id, openim_conversation_id,
          status, input_text, codex_session_id_before, created_at
        ) VALUES (
          @id, @sessionRecordId, @semanticEventId, @openimConversationId,
          'queued', @inputText, @codexSessionIdBefore, @createdAt
        )
      `
      )
      .run({ ...input, id, createdAt: Date.now() });
    return this.getById(id)!;
  }

  getById(id: string): RuntimeJob | null {
    const row = this.db.prepare("SELECT * FROM runtime_jobs WHERE id = ?").get(id) as
      | RuntimeJobRow
      | undefined;
    return row ? mapRuntimeJobRow(row) : null;
  }

  getLatestByConversationId(openimConversationId: string): RuntimeJob | null {
    const row = this.db
      .prepare(
        `
        SELECT * FROM runtime_jobs
        WHERE openim_conversation_id = ?
        ORDER BY rowid DESC
        LIMIT 1
      `
      )
      .get(openimConversationId) as RuntimeJobRow | undefined;
    return row ? mapRuntimeJobRow(row) : null;
  }

  getActiveByConversationId(openimConversationId: string): RuntimeJob | null {
    const row = this.db
      .prepare(
        `
        SELECT * FROM runtime_jobs
        WHERE openim_conversation_id = ? AND status IN ('running', 'queued', 'cancelling')
        ORDER BY
          CASE status WHEN 'running' THEN 0 WHEN 'cancelling' THEN 1 ELSE 2 END,
          rowid DESC
        LIMIT 1
      `
      )
      .get(openimConversationId) as RuntimeJobRow | undefined;
    return row ? mapRuntimeJobRow(row) : null;
  }

  listRecentByConversationId(openimConversationId: string, limit = 10): RuntimeJob[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM runtime_jobs
        WHERE openim_conversation_id = ?
        ORDER BY rowid DESC
        LIMIT ?
      `
      )
      .all(openimConversationId, limit) as RuntimeJobRow[];
    return rows.map(mapRuntimeJobRow);
  }

  markRunning(id: string, startedAt = Date.now()): void {
    this.db
      .prepare("UPDATE runtime_jobs SET status = 'running', started_at = ? WHERE id = ? AND status = 'queued'")
      .run(startedAt, id);
  }

  markCancelling(id: string, input: { cancelRequestedAt?: number; cancelMethod?: string }): RuntimeJob | null {
    this.db
      .prepare(
        `
        UPDATE runtime_jobs
        SET status = 'cancelling', cancel_requested_at = ?, cancel_method = ?
        WHERE id = ? AND status = 'running'
      `
      )
      .run(input.cancelRequestedAt ?? Date.now(), input.cancelMethod ?? "process", id);
    return this.getById(id);
  }

  cancelQueued(id: string, input: { cancelledAt?: number; cancelMethod?: string }): RuntimeJob | null {
    const now = input.cancelledAt ?? Date.now();
    this.db
      .prepare(
        `
        UPDATE runtime_jobs
        SET status = 'cancelled',
            cancel_requested_at = COALESCE(cancel_requested_at, ?),
            cancelled_at = ?,
            cancel_method = ?,
            finished_at = ?,
            error_text = 'Cancelled before start'
        WHERE id = ? AND status = 'queued'
      `
      )
      .run(now, now, input.cancelMethod ?? "api", now, id);
    return this.getById(id);
  }

  markCancelled(
    id: string,
    input: { cancelledAt?: number; cancelMethod?: string; errorText?: string }
  ): RuntimeJob | null {
    const now = input.cancelledAt ?? Date.now();
    this.db
      .prepare(
        `
        UPDATE runtime_jobs
        SET status = 'cancelled',
            cancel_requested_at = COALESCE(cancel_requested_at, ?),
            cancelled_at = ?,
            cancel_method = COALESCE(?, cancel_method),
            finished_at = ?,
            error_text = ?
        WHERE id = ? AND status IN ('running', 'cancelling', 'queued')
      `
      )
      .run(now, now, input.cancelMethod ?? null, now, input.errorText ?? "Cancelled", id);
    return this.getById(id);
  }

  markSucceeded(
    id: string,
    input: { finishedAt?: number; outputText: string; codexSessionIdAfter: string | null }
  ): void {
    this.db
      .prepare(
        `
        UPDATE runtime_jobs
        SET status = 'succeeded', finished_at = ?, output_text = ?, codex_session_id_after = ?
        WHERE id = ?
      `
      )
      .run(input.finishedAt ?? Date.now(), input.outputText, input.codexSessionIdAfter, id);
  }

  markFailed(id: string, input: { finishedAt?: number; errorText: string }): void {
    this.db
      .prepare(
        `
        UPDATE runtime_jobs
        SET status = 'failed', finished_at = ?, error_text = ?
        WHERE id = ?
      `
      )
      .run(input.finishedAt ?? Date.now(), input.errorText, id);
  }
}

function mapRuntimeJobRow(row: RuntimeJobRow): RuntimeJob {
  return {
    id: row.id,
    sessionRecordId: row.session_record_id,
    semanticEventId: row.semantic_event_id,
    openimConversationId: row.openim_conversation_id,
    status: row.status,
    inputText: row.input_text,
    codexSessionIdBefore: row.codex_session_id_before,
    codexSessionIdAfter: row.codex_session_id_after,
    outputText: row.output_text,
    errorText: row.error_text,
    cancelRequestedAt: row.cancel_requested_at,
    cancelledAt: row.cancelled_at,
    cancelMethod: row.cancel_method,
    createdAt: row.created_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at
  };
}
