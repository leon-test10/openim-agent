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

    CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_events_openim_message
      ON semantic_events(openim_conversation_id, openim_message_id)
      WHERE openim_message_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_events_openim_client
      ON semantic_events(openim_conversation_id, openim_client_msg_id)
      WHERE openim_client_msg_id IS NOT NULL;

    CREATE TABLE IF NOT EXISTS conversation_summaries (
      openim_conversation_id TEXT PRIMARY KEY,
      summary_text TEXT NOT NULL,
      covered_event_ids_json TEXT NOT NULL,
      covered_event_until_timestamp INTEGER,
      important_decisions_json TEXT NOT NULL,
      unresolved_tasks_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
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
      runtime_kind TEXT NOT NULL DEFAULT 'codex_cli',
      external_session_id TEXT,
      codex_project_path TEXT NOT NULL,
      codex_home_dir TEXT,
      runtime_home_dir TEXT,
      runtime_config_json TEXT,
      codex_home_seed_mode TEXT,
      sandbox_mode TEXT,
      runtime_profile_id TEXT,
      display_name TEXT,
      display_name_source TEXT,
      last_summary TEXT,
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

    CREATE TABLE IF NOT EXISTS codex_runtime_profiles (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      provider_type TEXT NOT NULL,
      provider_mode TEXT,
      model TEXT,
      sandbox_mode TEXT,
      approval_policy TEXT,
      codex_profile TEXT,
      base_url TEXT,
      bridge_base_url TEXT,
      wire_api TEXT,
      auth_env_key TEXT,
      codex_home_override TEXT,
      local_provider TEXT,
      use_oss INTEGER NOT NULL DEFAULT 0,
      api_key_encrypted TEXT,
      api_key_iv TEXT,
      api_key_tag TEXT,
      api_key_masked TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_codex_runtime_profiles_updated
      ON codex_runtime_profiles(updated_at);

    CREATE TABLE IF NOT EXISTS runtime_jobs (
      id TEXT PRIMARY KEY,
      runtime_kind TEXT NOT NULL DEFAULT 'codex_cli',
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

    CREATE TABLE IF NOT EXISTS openim_history_import_requests (
      id TEXT PRIMARY KEY,
      openim_conversation_id TEXT NOT NULL,
      requested_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      fulfilled_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS openim_history_snapshots (
      id TEXT PRIMARY KEY,
      request_id TEXT,
      openim_conversation_id TEXT NOT NULL,
      source TEXT NOT NULL,
      message_count INTEGER NOT NULL,
      messages_json TEXT NOT NULL,
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
  ensureColumn(db, "runtime_jobs", "runtime_kind", "TEXT NOT NULL DEFAULT 'codex_cli'");
  ensureColumn(db, "codex_session_records", "codex_home_dir", "TEXT");
  ensureColumn(db, "codex_session_records", "codex_home_seed_mode", "TEXT");
  ensureColumn(db, "codex_session_records", "sandbox_mode", "TEXT");
  ensureColumn(db, "codex_session_records", "runtime_profile_id", "TEXT");
  ensureColumn(db, "codex_session_records", "runtime_kind", "TEXT NOT NULL DEFAULT 'codex_cli'");
  ensureColumn(db, "codex_session_records", "external_session_id", "TEXT");
  ensureColumn(db, "codex_session_records", "runtime_home_dir", "TEXT");
  ensureColumn(db, "codex_session_records", "runtime_config_json", "TEXT");
  ensureColumn(db, "codex_session_records", "display_name", "TEXT");
  ensureColumn(db, "codex_session_records", "display_name_source", "TEXT");
  ensureColumn(db, "codex_session_records", "last_summary", "TEXT");
  ensureColumn(db, "codex_runtime_profiles", "provider_mode", "TEXT");
  ensureColumn(db, "codex_runtime_profiles", "bridge_base_url", "TEXT");
  ensureColumn(db, "codex_runtime_profiles", "wire_api", "TEXT");
  ensureColumn(db, "codex_runtime_profiles", "auth_env_key", "TEXT");
  ensureColumn(db, "codex_runtime_profiles", "codex_home_override", "TEXT");
  ensureColumn(db, "semantic_events", "conversation_type", "TEXT");
  ensureColumn(db, "semantic_events", "source", "TEXT");
  ensureColumn(db, "semantic_events", "source_message_id", "TEXT");
  ensureColumn(db, "semantic_events", "actor_id", "TEXT");
  ensureColumn(db, "semantic_events", "actor_type", "TEXT");
  ensureColumn(db, "semantic_events", "actor_display_name", "TEXT");
  ensureColumn(db, "semantic_events", "role", "TEXT");
  ensureColumn(db, "semantic_events", "timestamp", "INTEGER");
  ensureColumn(db, "semantic_events", "metadata_json", "TEXT");
  ensureColumn(db, "semantic_events", "dedup_key", "TEXT");
  ensureColumn(db, "semantic_events", "delivered_job_id", "TEXT");
  ensureColumn(db, "semantic_events", "delivered_session_record_id", "TEXT");
  ensureColumn(db, "semantic_events", "delivered_codex_session_id", "TEXT");
  ensureColumn(db, "semantic_events", "delivered_at", "INTEGER");
  ensureColumn(db, "semantic_events", "delivery_reason", "TEXT");
  ensureColumn(db, "semantic_events", "updated_at", "INTEGER");
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_events_source_message
      ON semantic_events(openim_conversation_id, source_message_id)
      WHERE source_message_id IS NOT NULL;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_semantic_events_dedup_key
      ON semantic_events(openim_conversation_id, dedup_key)
      WHERE dedup_key IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_semantic_events_conversation_timestamp
      ON semantic_events(openim_conversation_id, timestamp, created_at);
  `);
}

function ensureColumn(db: BridgeDatabase, tableName: string, columnName: string, columnType: string): void {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === columnName)) {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnType}`);
  }
}
