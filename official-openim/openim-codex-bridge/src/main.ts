import { loadEnv } from "./config/env.js";
import { createLogger } from "./utils/logger.js";
import { openDatabase } from "./storage/db.js";
import { SemanticEventRepository } from "./core/semantic-event.repository.js";
import { SessionBindingRepository } from "./core/session-binding.repository.js";
import { RuntimeJobRepository } from "./core/runtime-job.repository.js";
import { RuntimeEventRepository } from "./core/runtime-event.repository.js";
import { RuntimeProfileRepository } from "./core/runtime-profile.repository.js";
import { SpawnCodexCliAdapter } from "./adapters/codex/codex-cli.adapter.js";
import { OpenImAuthClient } from "./adapters/openim/openim-auth.client.js";
import { OpenImMessageSender } from "./adapters/openim/openim-message.sender.js";
import { createServer } from "./server.js";

const config = loadEnv();
const logger = createLogger(config.LOG_LEVEL);
const db = openDatabase(config.DATABASE_URL);
const authClient = new OpenImAuthClient(config);

const context = {
  config,
  db,
  semanticEvents: new SemanticEventRepository(db),
  sessions: new SessionBindingRepository(db, {
    codexSessionHomeMode: config.CODEX_SESSION_HOME_MODE,
    codexSessionHomeRoot: config.CODEX_SESSION_HOME_ROOT,
    codexHomeSeedMode: config.CODEX_SESSION_HOME_SEED_MODE,
    sandboxMode: config.CODEX_SANDBOX_MODE
  }),
  jobs: new RuntimeJobRepository(db),
  runtimeEvents: new RuntimeEventRepository(db),
  runtimeProfiles: new RuntimeProfileRepository(db, config.BRIDGE_SECRET_KEY),
  codex: new SpawnCodexCliAdapter({
    codexBin: config.CODEX_BIN,
    timeoutMs: config.CODEX_EXEC_TIMEOUT_MS
  }),
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
