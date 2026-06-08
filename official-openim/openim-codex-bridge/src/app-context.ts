import type { AppConfig } from "./config/env.js";
import type { BridgeDatabase } from "./storage/db.js";
import { SemanticEventRepository } from "./core/semantic-event.repository.js";
import { ConversationSummaryRepository } from "./core/conversation-summary.repository.js";
import { SessionBindingRepository } from "./core/session-binding.repository.js";
import { RuntimeJobRepository } from "./core/runtime-job.repository.js";
import { RuntimeEventRepository } from "./core/runtime-event.repository.js";
import { RuntimeProfileRepository } from "./core/runtime-profile.repository.js";
import { OpenImHistoryRepository } from "./core/openim-history.repository.js";
import { ConversationEventBus } from "./core/conversation-event-bus.js";
import type { CodexCliAdapter } from "./adapters/codex/codex-types.js";
import type { OpenImMessageSender } from "./adapters/openim/openim-message.sender.js";
import type { AgentRunner } from "./runtime/runner.js";

export interface AppContext {
  config: AppConfig;
  db: BridgeDatabase;
  semanticEvents: SemanticEventRepository;
  conversationSummaries: ConversationSummaryRepository;
  sessions: SessionBindingRepository;
  jobs: RuntimeJobRepository;
  runtimeEvents: RuntimeEventRepository;
  runtimeProfiles: RuntimeProfileRepository;
  openimHistory: OpenImHistoryRepository;
  conversationEvents?: ConversationEventBus;
  runner?: AgentRunner;
  codex?: CodexCliAdapter;
  openimSender: OpenImMessageSender;
}
