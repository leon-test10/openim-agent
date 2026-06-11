import type { CodexCliAdapter, CodexResumeInput, CodexRunHandle, CodexRunInput, CodexRunResult } from "../adapters/codex/codex-types.js";
import type { AgentRunner, RuntimeRunHandle, RuntimeRunInput, RuntimeRunResult } from "./runtime-types.js";

export class CodexCliRunner implements AgentRunner {
  readonly kind = "codex_cli" as const;

  constructor(private readonly adapter: CodexCliAdapter) {}

  run(input: RuntimeRunInput): RuntimeRunHandle {
    const handle = input.externalSessionId
      ? this.resumeTask(input, input.externalSessionId)
      : this.runNewTask(input);

    return {
      pid: handle.pid,
      promise: handle.promise.then(toRuntimeResult),
      cancel: (reason?: string) => handle.cancel(reason)
    };
  }

  private runNewTask(input: RuntimeRunInput): CodexRunHandle {
    const codexInput = toCodexRunInput(input);
    if (this.adapter.runNewTaskCancellable) {
      return this.adapter.runNewTaskCancellable(codexInput);
    }
    return {
      pid: null,
      promise: this.adapter.runNewTask(codexInput),
      cancel: async () => undefined
    };
  }

  private resumeTask(input: RuntimeRunInput, externalSessionId: string): CodexRunHandle {
    const codexInput: CodexResumeInput = {
      ...toCodexRunInput(input),
      sessionId: externalSessionId
    };
    if (this.adapter.resumeTaskCancellable) {
      return this.adapter.resumeTaskCancellable(codexInput);
    }
    return {
      pid: null,
      promise: this.adapter.resumeTask(codexInput),
      cancel: async () => undefined
    };
  }
}

function toCodexRunInput(input: RuntimeRunInput): CodexRunInput {
  return {
    projectPath: input.projectPath,
    prompt: input.prompt,
    model: input.model ?? undefined,
    codexHomeDir: input.runtimeHomeDir ?? undefined,
    sandboxMode: input.sandboxMode ?? undefined,
    approvalPolicy: input.approvalPolicy ?? undefined,
    codexProfile: input.codexProfile ?? undefined,
    baseUrl: input.baseUrl ?? undefined,
    localProvider: input.localProvider ?? undefined,
    useOss: input.useOss ?? undefined,
    apiKey: input.apiKey ?? undefined,
    apiKeyEnvName: input.apiKeyEnvName ?? undefined,
    modelProviderId: input.modelProviderId ?? undefined,
    modelProviderBaseUrl: input.modelProviderBaseUrl ?? undefined,
    modelProviderWireApi: input.modelProviderWireApi ?? undefined,
    onEvent: input.onEvent
  };
}

function toRuntimeResult(result: CodexRunResult): RuntimeRunResult {
  return {
    ok: result.ok,
    externalSessionId: result.sessionId ?? null,
    outputText: result.outputText,
    rawOutput: result.rawOutput,
    errorText: result.errorText,
    exitCode: result.exitCode,
    cancelled: result.cancelled,
    timedOut: result.timedOut
  };
}
