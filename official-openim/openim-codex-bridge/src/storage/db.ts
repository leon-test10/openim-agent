import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

export type BridgeDatabase = Database.Database;

export function openDatabase(databaseUrl: string): BridgeDatabase {
  const filename = normalizeDatabaseUrl(databaseUrl);
  mkdirSync(dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  return db;
}

function normalizeDatabaseUrl(databaseUrl: string): string {
  if (databaseUrl.startsWith("file:")) {
    return resolve(databaseUrl.slice("file:".length));
  }
  return resolve(databaseUrl);
}

function migrate(db: BridgeDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS semantic_events (
      id TEXT PRIMARY KEY,
      openim_message_id TEXT,
      openim_client_msg_id TEXT,
      openim_conversation_id TEXT NOT NULL,
      sender_user_id TEXT NOT NULL,
      receiver_user_id TEXT,
      group_id TEXT,
      event_type TEXT NOT NULL,
      content_type INTEGER,
      text TEXT,
      ex_json TEXT,
      raw_payload_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS openim_conversations (
      id TEXT PRIMARY KEY,
      openim_conversation_id TEXT NOT NULL UNIQUE,
      openim_display_user_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS codex_session_records (
      id TEXT PRIMARY KEY,
      openim_conversation_id TEXT NOT NULL,
      openim_display_user_id TEXT NOT NULL,
      codex_session_id TEXT,
      codex_project_path TEXT NOT NULL,
      codex_home_dir TEXT,
      codex_home_seed_mode TEXT,
      sandbox_mode TEXT,
      is_active INTEGER NOT NULL,
      status TEXT NOT NULL,
      parent_session_record_id TEXT,
      forked_from_codex_session_id TEXT,
      created_reason TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_codex_session_records_one_active
      ON codex_session_records(openim_conversation_id)
      WHERE is_active = 1;

    CREATE INDEX IF NOT EXISTS idx_codex_session_records_conversation
      ON codex_session_records(openim_conversation_id);

    CREATE TABLE IF NOT EXISTS runtime_jobs (
      id TEXT PRIMARY KEY,
      session_record_id TEXT NOT NULL,
      semantic_event_id TEXT NOT NULL,
      openim_conversation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      input_text TEXT NOT NULL,
      codex_session_id_before TEXT,
      codex_session_id_after TEXT,
      output_text TEXT,
      error_text TEXT,
      failure_reason TEXT,
      retry_of_job_id TEXT,
      cancel_requested_at INTEGER,
      cancelled_at INTEGER,
      cancel_method TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_runtime_jobs_conversation
      ON runtime_jobs(openim_conversation_id, created_at);

    CREATE TABLE IF NOT EXISTS runtime_events (
      id TEXT PRIMARY KEY,
      job_id TEXT NOT NULL,
      session_record_id TEXT NOT NULL,
      openim_conversation_id TEXT NOT NULL,
      sequence INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      title TEXT NOT NULL,
      summary TEXT,
      raw_event_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_events_job_sequence
      ON runtime_events(job_id, sequence);

    CREATE INDEX IF NOT EXISTS idx_runtime_events_conversation
      ON runtime_events(openim_conversation_id, created_at);
  `);
  ensureColumn(db, "runtime_jobs", "cancel_requested_at", "INTEGER");
  ensureColumn(db, "runtime_jobs", "cancelled_at", "INTEGER");
  ensureColumn(db, "runtime_jobs", "cancel_method", "TEXT");
  ensureColumn(db, "runtime_jobs", "failure_reason", "TEXT");
  ensureColumn(db, "runtime_jobs", "retry_of_job_id", "TEXT");
  ensureColumn(db, "codex_session_records", "codex_home_dir", "TEXT");
  ensureColumn(db, "codex_session_records", "codex_home_seed_mode", "TEXT");
  ensureColumn(db, "codex_session_records", "sandbox_mode", "TEXT");
}

function ensureColumn(db: BridgeDatabase, tableName: string, columnName: string, columnType: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }
}
