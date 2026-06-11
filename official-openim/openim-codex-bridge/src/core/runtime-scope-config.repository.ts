import type { BridgeDatabase } from "../storage/db.js";
import { createId } from "../utils/ids.js";
import type { RuntimeKind } from "../runtime/runner.js";

export type ScopeType = "shared" | "conversation" | "group";

export interface RuntimeScopeConfig {
  id: string;
  scopeType: ScopeType;
  scopeKey: string;
  runtimeKind: RuntimeKind;
  runtimeProfileId: string | null;
  createdAt: number;
  updatedAt: number;
}

interface ScopeConfigRow {
  id: string;
  scope_type: ScopeType;
  scope_key: string;
  runtime_kind: string;
  runtime_profile_id: string | null;
  created_at: number;
  updated_at: number;
}

function mapRow(row: ScopeConfigRow): RuntimeScopeConfig {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeKey: row.scope_key,
    runtimeKind: row.runtime_kind as RuntimeKind,
    runtimeProfileId: row.runtime_profile_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class RuntimeScopeConfigRepository {
  constructor(private readonly db: BridgeDatabase) {}

  getByScope(scopeType: ScopeType, scopeKey: string): RuntimeScopeConfig | null {
    const row = this.db
      .prepare(
        "SELECT * FROM codex_runtime_scope_configs WHERE scope_type = ? AND scope_key = ?"
      )
      .get(scopeType, scopeKey) as ScopeConfigRow | undefined;
    return row ? mapRow(row) : null;
  }

  upsert(
    scopeType: ScopeType,
    scopeKey: string,
    input: { runtimeKind: RuntimeKind; runtimeProfileId?: string | null }
  ): RuntimeScopeConfig {
    const now = Date.now();
    const existing = this.getByScope(scopeType, scopeKey);
    if (existing) {
      this.db
        .prepare(
          `UPDATE codex_runtime_scope_configs
           SET runtime_kind = @runtimeKind,
               runtime_profile_id = @runtimeProfileId,
               updated_at = @updatedAt
           WHERE scope_type = @scopeType AND scope_key = @scopeKey`
        )
        .run({
          ...input,
          runtimeProfileId: input.runtimeProfileId ?? null,
          scopeType,
          scopeKey,
          updatedAt: now,
        });
    } else {
      const id = createId("csc");
      this.db
        .prepare(
          `INSERT INTO codex_runtime_scope_configs
           (id, scope_type, scope_key, runtime_kind, runtime_profile_id, created_at, updated_at)
           VALUES (@id, @scopeType, @scopeKey, @runtimeKind, @runtimeProfileId, @createdAt, @updatedAt)`
        )
        .run({
          id,
          scopeType,
          scopeKey,
          runtimeKind: input.runtimeKind,
          runtimeProfileId: input.runtimeProfileId ?? null,
          createdAt: now,
          updatedAt: now,
        });
    }
    return this.getByScope(scopeType, scopeKey)!;
  }

  delete(scopeType: ScopeType, scopeKey: string): RuntimeScopeConfig | null {
    const existing = this.getByScope(scopeType, scopeKey);
    if (!existing) return null;
    this.db
      .prepare(
        "DELETE FROM codex_runtime_scope_configs WHERE scope_type = ? AND scope_key = ?"
      )
      .run(scopeType, scopeKey);
    return existing;
  }
}
