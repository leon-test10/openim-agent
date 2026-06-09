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

CREATE TABLE IF NOT EXISTS codex_runtime_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_type TEXT NOT NULL,
  model TEXT,
  sandbox_mode TEXT,
  approval_policy TEXT,
  codex_profile TEXT,
  base_url TEXT,
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


CREATE UNIQUE INDEX IF NOT EXISTS idx_codex_session_records_one_active
  ON codex_session_records(openim_conversation_id)
  WHERE is_active = 1;

CREATE INDEX IF NOT EXISTS idx_codex_session_records_conversation
  ON codex_session_records(openim_conversation_id);

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

CREATE UNIQUE INDEX IF NOT EXISTS idx_runtime_events_job_sequence
  ON runtime_events(job_id, sequence);

CREATE INDEX IF NOT EXISTS idx_runtime_events_conversation
  ON runtime_events(openim_conversation_id, created_at);
