import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  OPENIM_API_BASE_URL: z.string().url().default("http://127.0.0.1:10002"),
  OPENIM_ADMIN_USER_ID: z.string().default("imAdmin"),
  OPENIM_ADMIN_SECRET: z.string().optional().default(""),
  OPENIM_ADMIN_TOKEN: z.string().optional().default(""),
  OPENIM_BOT_USER_ID: z.string().default("codex_bot"),
  OPENIM_GROUP_BOT_ENABLED: z.coerce.boolean().default(false),
  OPENIM_GROUP_ALLOWLIST: z.string().optional().default(""),
  OPENIM_GROUP_SENDER_ALLOWLIST: z.string().optional().default(""),
  OPENIM_GROUP_REQUIRE_BINDING: z.coerce.boolean().default(false),
  OPENIM_GROUP_PROJECT_BINDINGS: z.string().optional().default(""),
  OPENIM_GROUP_AUTO_REPLY_POLICY: z.enum(["mention_or_reply", "mention_only", "reply_only", "disabled"]).default("mention_or_reply"),
  RUNTIME_DEFAULT_KIND: z.enum(["codex_cli", "template", "openai_compatible", "openhands"]).default("codex_cli"),
  TEMPLATE_RUNTIME_RESPONSE_PREFIX: z.string().optional().default("TEMPLATE_ACK"),
  CODEX_BIN: z.string().default("codex"),
  CODEX_DEFAULT_PROJECT_PATH: z.string().default("/workspace/openim-demo"),
  CODEX_DEFAULT_MODEL: z.string().optional().default(""),
  CODEX_EXEC_TIMEOUT_MS: z.coerce.number().int().positive().default(600000),
  CODEX_SESSION_HOME_ROOT: z.string().default("./data/codex-homes"),
  CODEX_SESSION_HOME_MODE: z.enum(["per-session", "disabled"]).default("per-session"),
  CODEX_SESSION_HOME_SEED_MODE: z.enum(["copy-auth-only", "copy-auth-and-config", "none"]).default("copy-auth-only"),
  CODEX_BASE_HOME: z.string().optional().default(""),
  CODEX_SANDBOX_MODE: z.string().optional().default(""),
  CODEX_WORKSPACE_ALLOWLIST: z.string().optional().default(""),
  CODEX_RUNTIME_ADMIN_TOKEN: z.string().optional().default(""),
  OPENAI_COMPATIBLE_BASE_URL: z.string().url().default("http://127.0.0.1:8000/v1"),
  OPENAI_COMPATIBLE_API_KEY: z.string().optional().default("dummy"),
  OPENAI_COMPATIBLE_MODEL: z.string().default("Qwen/Qwen2.5-Coder-32B-Instruct"),
  OPENAI_COMPATIBLE_TIMEOUT_MS: z.coerce.number().int().positive().default(120000),
  OPENAI_COMPATIBLE_TEMPERATURE: z.coerce.number().default(0.2),
  OPENAI_COMPATIBLE_MAX_TOKENS: z.coerce.number().int().positive().default(2048),
  OPENHANDS_BASE_URL: z.string().url().default("http://127.0.0.1:3000"),
  OPENHANDS_API_KEY: z.string().optional().default(""),
  OPENHANDS_TIMEOUT_MS: z.coerce.number().int().positive().default(600000),
  CONTEXT_RECENT_EVENT_LIMIT: z.coerce.number().int().positive().default(30),
  CONTEXT_AUTO_SUMMARY_ENABLED: z.coerce.boolean().default(false),
  CONTEXT_SUMMARY_EVENT_THRESHOLD: z.coerce.number().int().positive().default(120),
  BRIDGE_SECRET_KEY: z.string().optional().default(""),
  DATABASE_URL: z.string().default("file:./data/openim-codex-bridge.sqlite"),
  LOG_LEVEL: z.string().default("info"),
  NODE_ENV: z.string().optional().default("development")
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadEnv(): AppConfig {
  return EnvSchema.parse(process.env);
}
