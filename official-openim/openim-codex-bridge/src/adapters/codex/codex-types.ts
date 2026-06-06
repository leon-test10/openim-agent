export interface CodexRunInput {
  projectPath: string;
  prompt: string;
  model?: string;
  codexHomeDir?: string;
  sandboxMode?: string;
  approvalPolicy?: string;
  codexProfile?: string;
  baseUrl?: string;
  localProvider?: "lmstudio" | "ollama";
  useOss?: boolean;
  apiKey?: string;
  apiKeyEnvName?: string;
  modelProviderId?: string;
  modelProviderBaseUrl?: string;
  modelProviderWireApi?: string;
  onEvent?: (event: Record<string, unknown>) => void;
}

export interface CodexResumeInput {
  projectPath: string;
  sessionId: string;
  prompt: string;
  model?: string;
  codexHomeDir?: string;
  sandboxMode?: string;
  approvalPolicy?: string;
  codexProfile?: string;
  baseUrl?: string;
  localProvider?: "lmstudio" | "ollama";
  useOss?: boolean;
  apiKey?: string;
  apiKeyEnvName?: string;
  modelProviderId?: string;
  modelProviderBaseUrl?: string;
  modelProviderWireApi?: string;
  onEvent?: (event: Record<string, unknown>) => void;
}

export interface CodexRunResult {
  ok: boolean;
  sessionId?: string;
  outputText: string;
  rawOutput: string;
  errorText?: string;
  exitCode?: number | null;
  cancelled?: boolean;
  timedOut?: boolean;
}

export interface CodexRunHandle {
  pid: number | null;
  promise: Promise<CodexRunResult>;
  cancel(reason?: string): Promise<void>;
}

export interface CodexCliAdapter {
  runNewTask(input: CodexRunInput): Promise<CodexRunResult>;
  resumeTask(input: CodexResumeInput): Promise<CodexRunResult>;
  runNewTaskCancellable?(input: CodexRunInput): CodexRunHandle;
  resumeTaskCancellable?(input: CodexResumeInput): CodexRunHandle;
}
