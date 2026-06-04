import { resolve } from "node:path";
import type { BridgeDatabase } from "../storage/db.js";
import { createId } from "../utils/ids.js";
import type { BindingSummary } from "./conversation-status.js";
import type { CodexSessionRecord } from "./session-binding.js";

interface SessionRow {
  id: string;
  openim_conversation_id: string;
  openim_display_user_id: string;
  codex_session_id: string | null;
  codex_project_path: string;
  codex_home_dir: string | null;
  codex_home_seed_mode: CodexSessionRecord["codexHomeSeedMode"];
  sandbox_mode: string | null;
  is_active: number;
  status: "active" | "paused" | "archived" | "error";
  parent_session_record_id: string | null;
  forked_from_codex_session_id: string | null;
  created_reason: string;
  created_at: number;
  updated_at: number;
}

export interface GetOrCreateActiveSessionInput {
  openimConversationId: string;
  openimDisplayUserId: string;
  codexProjectPath: string;
}

export interface RebindConversationInput extends GetOrCreateActiveSessionInput {
  codexSessionId?: string | null;
}

export interface SessionRuntimeOptions {
  codexSessionHomeMode?: "per-session" | "disabled";
  codexSessionHomeRoot?: string;
  codexHomeSeedMode?: NonNullable<CodexSessionRecord["codexHomeSeedMode"]>;
  sandboxMode?: string;
}

export class SessionBindingRepository {
  constructor(
    private readonly db: BridgeDatabase,
    private readonly runtimeOptions: SessionRuntimeOptions = {}
  ) {}

  getOrCreateActiveSession(input: GetOrCreateActiveSessionInput): CodexSessionRecord {
    const existing = this.getActiveByConversationId(input.openimConversationId);
    if (existing) {
      return existing;
    }

    const now = Date.now();
    const id = createId("csr");
    const runtime = this.createRuntimeFields(id);
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `
          INSERT OR IGNORE INTO openim_conversations (
            id, openim_conversation_id, openim_display_user_id, created_at, updated_at
          ) VALUES (
            @id, @openimConversationId, @openimDisplayUserId, @createdAt, @updatedAt
          )
        `
        )
        .run({
          id: createId("conv"),
          openimConversationId: input.openimConversationId,
          openimDisplayUserId: input.openimDisplayUserId,
          createdAt: now,
          updatedAt: now
        });

      this.db
        .prepare(
          `
          INSERT INTO codex_session_records (
            id, openim_conversation_id, openim_display_user_id, codex_session_id,
            codex_project_path, codex_home_dir, codex_home_seed_mode, sandbox_mode,
            is_active, status, parent_session_record_id,
            forked_from_codex_session_id, created_reason, created_at, updated_at
          ) VALUES (
            @id, @openimConversationId, @openimDisplayUserId, NULL,
            @codexProjectPath, @codexHomeDir, @codexHomeSeedMode, @sandboxMode,
            1, 'active', NULL,
            NULL, 'auto_created_from_openim_message', @createdAt, @updatedAt
          )
        `
        )
        .run({
          id,
          openimConversationId: input.openimConversationId,
          openimDisplayUserId: input.openimDisplayUserId,
          codexProjectPath: input.codexProjectPath,
          ...runtime,
          createdAt: now,
          updatedAt: now
        });
    });

    transaction();
    const created = this.getById(id);
    if (!created) {
      throw new Error(`Failed to create Codex session record ${id}`);
    }
    return created;
  }

  getActiveByConversationId(openimConversationId: string): CodexSessionRecord | null {
    const row = this.db
      .prepare(
        `
        SELECT * FROM codex_session_records
        WHERE openim_conversation_id = ? AND is_active = 1
      `
      )
      .get(openimConversationId) as SessionRow | undefined;
    return row ? mapSessionRow(row) : null;
  }

  listActiveBindings(): Omit<BindingSummary, "latestJobId" | "latestJobStatus">[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM codex_session_records
        WHERE is_active = 1
        ORDER BY updated_at DESC
      `
      )
      .all() as SessionRow[];

    return rows.map((row) => ({
      openimConversationId: row.openim_conversation_id,
      openimDisplayUserId: row.openim_display_user_id,
      activeSessionRecordId: row.id,
      codexSessionId: row.codex_session_id,
      codexProjectPath: row.codex_project_path,
      codexHomeDir: row.codex_home_dir,
      codexHomeSeedMode: row.codex_home_seed_mode,
      sandboxMode: row.sandbox_mode,
      sessionStatus: row.status,
      updatedAt: row.updated_at
    }));
  }

  listByConversationId(openimConversationId: string): CodexSessionRecord[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM codex_session_records
        WHERE openim_conversation_id = ?
        ORDER BY is_active DESC, updated_at DESC
      `
      )
      .all(openimConversationId) as SessionRow[];
    return rows.map(mapSessionRow);
  }

  getById(id: string): CodexSessionRecord | null {
    const row = this.db.prepare("SELECT * FROM codex_session_records WHERE id = ?").get(id) as
      | SessionRow
      | undefined;
    return row ? mapSessionRow(row) : null;
  }

  createAdditionalSession(input: GetOrCreateActiveSessionInput): CodexSessionRecord {
    const now = Date.now();
    const id = createId("csr");
    const runtime = this.createRuntimeFields(id);
    this.db
      .prepare(
        `
        INSERT INTO codex_session_records (
          id, openim_conversation_id, openim_display_user_id, codex_session_id,
          codex_project_path, codex_home_dir, codex_home_seed_mode, sandbox_mode,
          is_active, status, parent_session_record_id,
          forked_from_codex_session_id, created_reason, created_at, updated_at
        ) VALUES (
          @id, @openimConversationId, @openimDisplayUserId, NULL,
          @codexProjectPath, @codexHomeDir, @codexHomeSeedMode, @sandboxMode,
          0, 'active', NULL,
          NULL, 'manual_new_session', @createdAt, @updatedAt
        )
      `
      )
      .run({
        id,
        openimConversationId: input.openimConversationId,
        openimDisplayUserId: input.openimDisplayUserId,
        codexProjectPath: input.codexProjectPath,
        ...runtime,
        createdAt: now,
        updatedAt: now
      });
    return this.getById(id)!;
  }

  rebindConversation(input: RebindConversationInput): CodexSessionRecord {
    const now = Date.now();
    const id = createId("csr");
    const runtime = this.createRuntimeFields(id);
    const previous = this.getActiveByConversationId(input.openimConversationId);
    const transaction = this.db.transaction(() => {
      this.ensureConversation(input, now);
      this.db
        .prepare(
          `
          UPDATE codex_session_records
          SET is_active = 0, updated_at = ?
          WHERE openim_conversation_id = ?
        `
        )
        .run(now, input.openimConversationId);
      this.db
        .prepare(
          `
          INSERT INTO codex_session_records (
            id, openim_conversation_id, openim_display_user_id, codex_session_id,
            codex_project_path, codex_home_dir, codex_home_seed_mode, sandbox_mode,
            is_active, status, parent_session_record_id,
            forked_from_codex_session_id, created_reason, created_at, updated_at
          ) VALUES (
            @id, @openimConversationId, @openimDisplayUserId, @codexSessionId,
            @codexProjectPath, @codexHomeDir, @codexHomeSeedMode, @sandboxMode,
            1, 'active', @parentSessionRecordId,
            @forkedFromCodexSessionId, 'manual_rebind', @createdAt, @updatedAt
          )
        `
        )
        .run({
          id,
          openimConversationId: input.openimConversationId,
          openimDisplayUserId: input.openimDisplayUserId,
          codexSessionId: input.codexSessionId ?? null,
          codexProjectPath: input.codexProjectPath,
          ...runtime,
          parentSessionRecordId: previous?.id ?? null,
          forkedFromCodexSessionId: previous?.codexSessionId ?? null,
          createdAt: now,
          updatedAt: now
        });
    });
    transaction();
    return this.getById(id)!;
  }

  archiveActiveBinding(openimConversationId: string): CodexSessionRecord | null {
    const active = this.getActiveByConversationId(openimConversationId);
    if (!active) {
      return null;
    }
    const now = Date.now();
    this.db
      .prepare(
        `
        UPDATE codex_session_records
        SET is_active = 0, status = 'archived', updated_at = ?
        WHERE id = ?
      `
      )
      .run(now, active.id);
    return this.getById(active.id);
  }

  activateSession(openimConversationId: string, sessionRecordId: string): CodexSessionRecord {
    const target = this.getById(sessionRecordId);
    if (!target || target.openimConversationId !== openimConversationId || target.status === "archived") {
      throw new Error(`Cannot activate session record ${sessionRecordId}`);
    }
    const now = Date.now();
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `
          UPDATE codex_session_records
          SET is_active = 0, updated_at = ?
          WHERE openim_conversation_id = ?
        `
        )
        .run(now, openimConversationId);
      this.db
        .prepare(
          `
          UPDATE codex_session_records
          SET is_active = 1, updated_at = ?
          WHERE openim_conversation_id = ? AND id = ? AND status != 'archived'
        `
        )
        .run(now, openimConversationId, sessionRecordId);
    });
    transaction();
    const active = this.getActiveByConversationId(openimConversationId);
    if (!active || active.id !== sessionRecordId) {
      throw new Error(`Cannot activate session record ${sessionRecordId}`);
    }
    return active;
  }

  updateCodexSessionId(sessionRecordId: string, codexSessionId: string): void {
    this.db
      .prepare(
        `
        UPDATE codex_session_records
        SET codex_session_id = ?, updated_at = ?
        WHERE id = ?
      `
      )
      .run(codexSessionId, Date.now(), sessionRecordId);
  }

  ensureRuntimeFields(sessionRecordId: string): CodexSessionRecord | null {
    const session = this.getById(sessionRecordId);
    if (!session || session.codexHomeDir) {
      return session;
    }

    const runtime = this.createRuntimeFields(sessionRecordId);
    this.db
      .prepare(
        `
        UPDATE codex_session_records
        SET codex_home_dir = @codexHomeDir,
            codex_home_seed_mode = @codexHomeSeedMode,
            sandbox_mode = @sandboxMode,
            updated_at = @updatedAt
        WHERE id = @id
      `
      )
      .run({
        id: sessionRecordId,
        ...runtime,
        updatedAt: Date.now()
      });
    return this.getById(sessionRecordId);
  }

  private ensureConversation(input: GetOrCreateActiveSessionInput, now: number): void {
    this.db
      .prepare(
        `
        INSERT OR IGNORE INTO openim_conversations (
          id, openim_conversation_id, openim_display_user_id, created_at, updated_at
        ) VALUES (
          @id, @openimConversationId, @openimDisplayUserId, @createdAt, @updatedAt
        )
      `
      )
      .run({
        id: createId("conv"),
        openimConversationId: input.openimConversationId,
        openimDisplayUserId: input.openimDisplayUserId,
        createdAt: now,
        updatedAt: now
      });
  }

  private createRuntimeFields(sessionRecordId: string): {
    codexHomeDir: string | null;
    codexHomeSeedMode: string | null;
    sandboxMode: string | null;
  } {
    if (this.runtimeOptions.codexSessionHomeMode === "disabled") {
      return {
        codexHomeDir: null,
        codexHomeSeedMode: null,
        sandboxMode: normalizeBlank(this.runtimeOptions.sandboxMode)
      };
    }

    const root = resolve(this.runtimeOptions.codexSessionHomeRoot ?? "./data/codex-homes");
    return {
      codexHomeDir: resolve(root, sanitizePathSegment(sessionRecordId)),
      codexHomeSeedMode: this.runtimeOptions.codexHomeSeedMode ?? "copy-auth-only",
      sandboxMode: normalizeBlank(this.runtimeOptions.sandboxMode)
    };
  }
}

function mapSessionRow(row: SessionRow): CodexSessionRecord {
  return {
    id: row.id,
    openimConversationId: row.openim_conversation_id,
    openimDisplayUserId: row.openim_display_user_id,
    codexSessionId: row.codex_session_id,
    codexProjectPath: row.codex_project_path,
    codexHomeDir: row.codex_home_dir,
    codexHomeSeedMode: row.codex_home_seed_mode,
    sandboxMode: row.sandbox_mode,
    isActive: row.is_active === 1,
    status: row.status,
    parentSessionRecordId: row.parent_session_record_id,
    forkedFromCodexSessionId: row.forked_from_codex_session_id,
    createdReason: row.created_reason,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function normalizeBlank(value: string | undefined): string | null {
  return value && value.trim().length > 0 ? value.trim() : null;
}
