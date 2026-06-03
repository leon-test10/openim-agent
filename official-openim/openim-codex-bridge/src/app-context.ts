import type { AppConfig } from "./config/env.js";
import type { BridgeDatabase } from "./storage/db.js";
import { SemanticEventRepository } from "./core/semantic-event.repository.js";
import { SessionBindingRepository } from "./core/session-binding.repository.js";
import { RuntimeJobRepository } from "./core/runtime-job.repository.js";
import type { CodexCliAdapter } from "./adapters/codex/codex-types.js";
import type { OpenImMessageSender } from "./adapters/openim/openim-message.sender.js";

export interface AppContext {
  config: AppConfig;
  db: BridgeDatabase;
  semanticEvents: SemanticEventRepository;
  sessions: SessionBindingRepository;
  jobs: RuntimeJobRepository;
  codex: CodexCliAdapter;
  openimSender: OpenImMessageSender;
}

