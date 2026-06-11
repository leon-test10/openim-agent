export type RuntimeKind = "codex_cli" | "template" | "openai_compatible" | "openhands";

export interface RuntimeNormalizedEvent {
  eventType: string;
  title: string;
  summary: string | null;
  rawEvent: Record<string, unknown>;
}

export interface RuntimeRunInput {
  jobId: string;
  sessionRecordId: string;
  openimConversationId: string;
  inputText: string;
  prompt: string;
  projectPath: string;
  externalSessionId?: string | null;
  runtimeHomeDir?: string | null;
  sandboxMode?: string | null;
  model?: string | null;
  approvalPolicy?: string | null;
  codexProfile?: string | null;
  baseUrl?: string | null;
  localProvider?: "lmstudio" | "ollama" | null;
  useOss?: boolean | null;
  apiKey?: string | null;
  apiKeyEnvName?: string | null;
  modelProviderId?: string | null;
  modelProviderBaseUrl?: string | null;
  modelProviderWireApi?: string | null;
  onEvent?: (event: Record<string, unknown>) => void;
}

export interface RuntimeRunResult {
  ok: boolean;
  externalSessionId?: string | null;
  outputText: string;
  rawOutput?: string;
  errorText?: string;
  exitCode?: number | null;
  cancelled?: boolean;
  timedOut?: boolean;
}

export interface RuntimeRunHandle {
  pid: number | null;
  promise: Promise<RuntimeRunResult>;
  cancel(reason?: string): Promise<void>;
}

export interface AgentRunner {
  kind: RuntimeKind;
  run(input: RuntimeRunInput): RuntimeRunHandle;
}
