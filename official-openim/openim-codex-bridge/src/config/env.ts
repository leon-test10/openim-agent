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
  DATABASE_URL: z.string().default("file:./data/openim-codex-bridge.sqlite"),
  LOG_LEVEL: z.string().default("info")
});

export type AppConfig = z.infer<typeof EnvSchema>;

export function loadEnv(): AppConfig {
  return EnvSchema.parse(process.env);
}

