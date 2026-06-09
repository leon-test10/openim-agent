import { loadEnv } from "./config/env.js";
import { createLogger } from "./utils/logger.js";
import { openDatabase } from "./storage/db.js";
import { SemanticEventRepository } from "./core/semantic-event.repository.js";
import { ConversationSummaryRepository } from "./core/conversation-summary.repository.js";
import { SessionBindingRepository } from "./core/session-binding.repository.js";
import { RuntimeJobRepository } from "./core/runtime-job.repository.js";
import { RuntimeEventRepository } from "./core/runtime-event.repository.js";
import { RuntimeProfileRepository } from "./core/runtime-profile.repository.js";
import { OpenImHistoryRepository } from "./core/openim-history.repository.js";
import { ConversationEventBus } from "./core/conversation-event-bus.js";
import { SpawnCodexCliAdapter } from "./adapters/codex/codex-cli.adapter.js";
import { CodexCliRunner } from "./runtime/codex-cli.runner.js";
import { OpenAiCompatibleRunner } from "./runtime/openai-compatible.runner.js";
import { OpenHandsRunner } from "./runtime/openhands.runner.js";
import { TemplateRunner } from "./runtime/template.runner.js";
import type { AgentRunner } from "./runtime/runner.js";
import { OpenImAuthClient } from "./adapters/openim/openim-auth.client.js";
import { OpenImMessageSender } from "./adapters/openim/openim-message.sender.js";
import { createServer } from "./server.js";

const config = loadEnv();
const logger = createLogger(config.LOG_LEVEL);
const db = openDatabase(config.DATABASE_URL);
const authClient = new OpenImAuthClient(config);
const codexAdapter = new SpawnCodexCliAdapter({
  codexBin: config.CODEX_BIN,
  timeoutMs: config.CODEX_EXEC_TIMEOUT_MS
});
const runner = createRunner();

const context = {
  config,
  db,
  semanticEvents: new SemanticEventRepository(db),
  conversationSummaries: new ConversationSummaryRepository(db),
  sessions: new SessionBindingRepository(db, {
    codexSessionHomeMode: config.CODEX_SESSION_HOME_MODE,
    codexSessionHomeRoot: config.CODEX_SESSION_HOME_ROOT,
    codexHomeSeedMode: config.CODEX_SESSION_HOME_SEED_MODE,
    sandboxMode: config.CODEX_SANDBOX_MODE
  }),
  jobs: new RuntimeJobRepository(db),
  runtimeEvents: new RuntimeEventRepository(db),
  runtimeProfiles: new RuntimeProfileRepository(db, config.BRIDGE_SECRET_KEY),
  openimHistory: new OpenImHistoryRepository(db),
  conversationEvents: new ConversationEventBus(),
  runner,
  codex: codexAdapter,
  openimSender: new OpenImMessageSender(config, authClient)
};

const app = await createServer(context, logger);

const close = async () => {
  await app.close();
  db.close();
};

process.on("SIGINT", () => {
  close()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      logger.error({ err: error }, "failed to shut down cleanly");
      process.exit(1);
    });
});

process.on("SIGTERM", () => {
  close()
    .then(() => process.exit(0))
    .catch((error: unknown) => {
      logger.error({ err: error }, "failed to shut down cleanly");
      process.exit(1);
    });
});

await app.listen({ port: config.PORT, host: "0.0.0.0" });

function createRunner(): AgentRunner {
  if (config.RUNTIME_DEFAULT_KIND === "template") {
    return new TemplateRunner({
      responsePrefix: config.TEMPLATE_RUNTIME_RESPONSE_PREFIX
    });
  }
  if (config.RUNTIME_DEFAULT_KIND === "openai_compatible") {
    return new OpenAiCompatibleRunner({
      baseUrl: config.OPENAI_COMPATIBLE_BASE_URL,
      apiKey: config.OPENAI_COMPATIBLE_API_KEY,
      model: config.OPENAI_COMPATIBLE_MODEL,
      timeoutMs: config.OPENAI_COMPATIBLE_TIMEOUT_MS,
      temperature: config.OPENAI_COMPATIBLE_TEMPERATURE,
      maxTokens: config.OPENAI_COMPATIBLE_MAX_TOKENS
    });
  }
  if (config.RUNTIME_DEFAULT_KIND === "openhands") {
    return new OpenHandsRunner({
      baseUrl: config.OPENHANDS_BASE_URL,
      apiKey: config.OPENHANDS_API_KEY,
      timeoutMs: config.OPENHANDS_TIMEOUT_MS
    });
  }
  return new CodexCliRunner(codexAdapter);
}
