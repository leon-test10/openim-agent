import type { BridgeDatabase } from "../storage/db.js";
import type { ConversationSummary } from "./semantic-event.js";

interface ConversationSummaryRow {
  openim_conversation_id: string;
  summary_text: string;
  covered_event_ids_json: string;
  covered_event_until_timestamp: number | null;
  important_decisions_json: string;
  unresolved_tasks_json: string;
  updated_at: number;
}

export class ConversationSummaryRepository {
  constructor(private readonly db: BridgeDatabase) {}

  upsert(input: Omit<ConversationSummary, "updatedAt"> & { updatedAt?: number }): ConversationSummary {
    const updatedAt = input.updatedAt ?? Date.now();
    this.db
      .prepare(
        `
        INSERT INTO conversation_summaries (
          openim_conversation_id, summary_text, covered_event_ids_json,
          covered_event_until_timestamp, important_decisions_json,
          unresolved_tasks_json, updated_at
        ) VALUES (
          @conversationID, @summaryText, @coveredEventIDsJson,
          @coveredEventUntilTimestamp, @importantDecisionsJson,
          @unresolvedTasksJson, @updatedAt
        )
        ON CONFLICT(openim_conversation_id) DO UPDATE SET
          summary_text = excluded.summary_text,
          covered_event_ids_json = excluded.covered_event_ids_json,
          covered_event_until_timestamp = excluded.covered_event_until_timestamp,
          important_decisions_json = excluded.important_decisions_json,
          unresolved_tasks_json = excluded.unresolved_tasks_json,
          updated_at = excluded.updated_at
      `
      )
      .run({
        conversationID: input.conversationID,
        summaryText: input.summaryText,
        coveredEventIDsJson: JSON.stringify(input.coveredEventIDs),
        coveredEventUntilTimestamp: input.coveredEventUntilTimestamp ?? null,
        importantDecisionsJson: JSON.stringify(input.importantDecisions),
        unresolvedTasksJson: JSON.stringify(input.unresolvedTasks),
        updatedAt
      });
    return this.get(input.conversationID)!;
  }

  get(conversationID: string): ConversationSummary | null {
    const row = this.db
      .prepare("SELECT * FROM conversation_summaries WHERE openim_conversation_id = ?")
      .get(conversationID) as ConversationSummaryRow | undefined;
    return row ? mapRow(row) : null;
  }
}

function mapRow(row: ConversationSummaryRow): ConversationSummary {
  return {
    conversationID: row.openim_conversation_id,
    summaryText: row.summary_text,
    coveredEventIDs: parseStringArray(row.covered_event_ids_json),
    coveredEventUntilTimestamp: row.covered_event_until_timestamp,
    importantDecisions: parseStringArray(row.important_decisions_json),
    unresolvedTasks: parseStringArray(row.unresolved_tasks_json),
    updatedAt: row.updated_at
  };
}

function parseStringArray(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
