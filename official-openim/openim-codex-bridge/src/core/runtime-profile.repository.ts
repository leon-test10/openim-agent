import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { BridgeDatabase } from "../storage/db.js";
import { createId } from "../utils/ids.js";
import type { RuntimeProfile, RuntimeProfileInput, RuntimeProfileSecret, RuntimeProfileUpdate } from "./runtime-profile.js";

interface RuntimeProfileRow {
  id: string;
  name: string;
  provider_type: RuntimeProfile["providerType"];
  model: string | null;
  sandbox_mode: string | null;
  approval_policy: string | null;
  codex_profile: string | null;
  base_url: string | null;
  local_provider: RuntimeProfile["localProvider"];
  use_oss: number;
  api_key_encrypted: string | null;
  api_key_iv: string | null;
  api_key_tag: string | null;
  api_key_masked: string | null;
  status: RuntimeProfile["status"];
  created_at: number;
  updated_at: number;
}

export class RuntimeProfileRepository {
  constructor(
    private readonly db: BridgeDatabase,
    private readonly secretKey: string
  ) {}

  list(options: { includeDeleted?: boolean } = {}): RuntimeProfile[] {
    const rows = this.db
      .prepare(
        `
        SELECT * FROM codex_runtime_profiles
        ${options.includeDeleted ? "" : "WHERE status != 'deleted'"}
        ORDER BY updated_at DESC
      `
      )
      .all() as RuntimeProfileRow[];
    return rows.map(mapRuntimeProfileRow);
  }

  getById(id: string, options: { includeDeleted?: boolean } = {}): RuntimeProfile | null {
    const row = this.db.prepare("SELECT * FROM codex_runtime_profiles WHERE id = ?").get(id) as RuntimeProfileRow | undefined;
    if (!row || (!options.includeDeleted && row.status === "deleted")) {
      return null;
    }
    return mapRuntimeProfileRow(row);
  }

  getWithSecret(id: string): RuntimeProfileSecret | null {
    const row = this.db.prepare("SELECT * FROM codex_runtime_profiles WHERE id = ? AND status != 'deleted'").get(id) as
      | RuntimeProfileRow
      | undefined;
    if (!row) {
      return null;
    }
    return {
      ...mapRuntimeProfileRow(row),
      apiKey: decryptApiKey(row, this.secretKey)
    } as RuntimeProfileSecret;
  }

  getSecret(id: string): string | null {
    const row = this.db.prepare("SELECT * FROM codex_runtime_profiles WHERE id = ?").get(id) as RuntimeProfileRow | undefined;
    return row ? decryptApiKey(row, this.secretKey) : null;
  }

  create(input: RuntimeProfileInput): RuntimeProfile {
    const now = Date.now();
    const id = createId("crp");
    const encrypted = encryptApiKey(input.apiKey ?? null, this.secretKey);
    this.db
      .prepare(
        `
        INSERT INTO codex_runtime_profiles (
          id, name, provider_type, model, sandbox_mode, approval_policy,
          codex_profile, base_url, local_provider, use_oss,
          api_key_encrypted, api_key_iv, api_key_tag, api_key_masked,
          status, created_at, updated_at
        ) VALUES (
          @id, @name, @providerType, @model, @sandboxMode, @approvalPolicy,
          @codexProfile, @baseUrl, @localProvider, @useOss,
          @apiKeyEncrypted, @apiKeyIv, @apiKeyTag, @apiKeyMasked,
          'active', @createdAt, @updatedAt
        )
      `
      )
      .run({
        id,
        ...normalizeInput(input),
        ...encrypted,
        createdAt: now,
        updatedAt: now
      });
    return this.getById(id)!;
  }

  update(id: string, input: RuntimeProfileUpdate): RuntimeProfile | null {
    const existing = this.getById(id);
    if (!existing) {
      return null;
    }
    const currentSecret = this.getSecret(id);
    const nextSecret = Object.prototype.hasOwnProperty.call(input, "apiKey") ? input.apiKey ?? null : currentSecret;
    const encrypted = encryptApiKey(nextSecret, this.secretKey);
    const normalized = normalizeInput({
      name: input.name ?? existing.name,
      providerType: input.providerType ?? existing.providerType,
      model: input.model ?? existing.model,
      sandboxMode: input.sandboxMode ?? existing.sandboxMode,
      approvalPolicy: input.approvalPolicy ?? existing.approvalPolicy,
      codexProfile: input.codexProfile ?? existing.codexProfile,
      baseUrl: input.baseUrl ?? existing.baseUrl,
      localProvider: input.localProvider ?? existing.localProvider,
      useOss: input.useOss ?? existing.useOss
    });
    this.db
      .prepare(
        `
        UPDATE codex_runtime_profiles
        SET name = @name,
            provider_type = @providerType,
            model = @model,
            sandbox_mode = @sandboxMode,
            approval_policy = @approvalPolicy,
            codex_profile = @codexProfile,
            base_url = @baseUrl,
            local_provider = @localProvider,
            use_oss = @useOss,
            api_key_encrypted = @apiKeyEncrypted,
            api_key_iv = @apiKeyIv,
            api_key_tag = @apiKeyTag,
            api_key_masked = @apiKeyMasked,
            updated_at = @updatedAt
        WHERE id = @id AND status != 'deleted'
      `
      )
      .run({
        id,
        ...normalized,
        ...encrypted,
        updatedAt: Date.now()
      });
    return this.getById(id);
  }

  delete(id: string): RuntimeProfile | null {
    const existing = this.getById(id);
    if (!existing) {
      return null;
    }
    this.db
      .prepare("UPDATE codex_runtime_profiles SET status = 'deleted', updated_at = ? WHERE id = ?")
      .run(Date.now(), id);
    return this.getById(id, { includeDeleted: true });
  }
}

function normalizeInput(input: RuntimeProfileInput) {
  return {
    name: normalizeRequired(input.name, "name"),
    providerType: input.providerType ?? "openai",
    model: normalizeOptional(input.model),
    sandboxMode: normalizeOptional(input.sandboxMode),
    approvalPolicy: normalizeOptional(input.approvalPolicy),
    codexProfile: normalizeOptional(input.codexProfile),
    baseUrl: normalizeOptional(input.baseUrl),
    localProvider: normalizeOptional(input.localProvider) as RuntimeProfile["localProvider"],
    useOss: input.useOss ? 1 : 0
  };
}

function encryptApiKey(apiKey: string | null, secretKey: string) {
  const normalized = normalizeOptional(apiKey);
  if (!normalized) {
    return {
      apiKeyEncrypted: null,
      apiKeyIv: null,
      apiKeyTag: null,
      apiKeyMasked: null
    };
  }
  if (!secretKey) {
    throw new Error("BRIDGE_SECRET_KEY is required to store runtime profile API keys");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secretKey), iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    apiKeyEncrypted: encrypted.toString("base64"),
    apiKeyIv: iv.toString("base64"),
    apiKeyTag: tag.toString("base64"),
    apiKeyMasked: maskSecret(normalized)
  };
}

function decryptApiKey(row: RuntimeProfileRow, secretKey: string): string | null {
  if (!row.api_key_encrypted || !row.api_key_iv || !row.api_key_tag) {
    return null;
  }
  if (!secretKey) {
    throw new Error("BRIDGE_SECRET_KEY is required to decrypt runtime profile API keys");
  }
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secretKey), Buffer.from(row.api_key_iv, "base64"));
  decipher.setAuthTag(Buffer.from(row.api_key_tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(row.api_key_encrypted, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function deriveKey(secretKey: string): Buffer {
  return createHash("sha256").update(secretKey).digest();
}

function maskSecret(value: string): string {
  if (value.length <= 8) {
    return "****";
  }
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function mapRuntimeProfileRow(row: RuntimeProfileRow): RuntimeProfile {
  return {
    id: row.id,
    name: row.name,
    providerType: row.provider_type,
    model: row.model,
    sandboxMode: row.sandbox_mode,
    approvalPolicy: row.approval_policy,
    codexProfile: row.codex_profile,
    baseUrl: row.base_url,
    localProvider: row.local_provider,
    useOss: row.use_oss === 1,
    apiKeyMasked: row.api_key_masked,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function normalizeRequired(value: string | undefined, fieldName: string): string {
  const normalized = normalizeOptional(value);
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

function normalizeOptional(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}
