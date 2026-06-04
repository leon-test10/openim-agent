import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8787),
  OPENIM_API_BASE_URL: z.string().url().default("http://127.0.0.1:10002"),
  OPENIM_ADMIN_USER_ID: z.string().default("imAdmin"),
  OPENIM_ADMIN_SECRET: z.string().optional().default(""),
  OPENIM_ADMIN_TOKEN: z.string().optional().default(""),
  OPENIM_BOT_USER_ID: z.string().default("codex_bot"),
  CODEX_BIN: z.string().default("codex"),
  CODEX_DEFAULT_PROJECT_PATH: z.string().default("/workspace/openim-demo"),
  CODEX_DEFAULT_MODEL: z.string().optional().default(""),
  CODEX_EXEC_TIMEOUT_MS: z.coerce.number().int().positive().default(600000),
  CODEX_SESSION_HOME_ROOT: z.string().default("./data/codex-homes"),
  CODEX_SESSION_HOME_MODE: z.enum(["per-session", "disabled"]).default("per-session"),
  CODEX_SESSION_HOME_SEED_MODE: z.enum(["copy-auth-only", "copy-auth-and-config", "none"]).default("copy-auth-only"),
  CODEX_BASE_HOME: z.string().optional().default(""),
  CODEX_SANDBOX_MODE: z.string().optional().default(""),
  DATABASE_URL: z.string().default("file:./data/openim-codex-bridge.sqlite"),
  LOG_LEVEL: z.string().default("info")
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadEnv(): AppConfig {
  return EnvSchema.parse(process.env);
}
