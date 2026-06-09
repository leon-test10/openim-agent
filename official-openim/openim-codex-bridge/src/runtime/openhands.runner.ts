import type { AgentRunner, RuntimeRunHandle, RuntimeRunInput, RuntimeRunResult } from "./runtime-types.js";

export interface OpenHandsRunnerOptions {
  baseUrl: string;
  apiKey?: string | null;
  timeoutMs: number;
}

export class OpenHandsRunner implements AgentRunner {
  readonly kind = "openhands" as const;

  constructor(private readonly options: OpenHandsRunnerOptions) {}

  run(input: RuntimeRunInput): RuntimeRunHandle {
    const promise = Promise.resolve(this.unsupportedResult(input));
    return {
      pid: null,
      promise,
      cancel: async () => undefined
    };
  }

  private unsupportedResult(input: RuntimeRunInput): RuntimeRunResult {
    input.onEvent?.({
      type: "openhands.spike.not_implemented",
      title: "OpenHands runtime spike not implemented",
      summary: "OpenHands requires an adapter-specific submit/poll/cancel contract before production use.",
      baseUrl: this.options.baseUrl,
      timeoutMs: this.options.timeoutMs,
      apiKeyConfigured: Boolean(this.options.apiKey)
    });
    return {
      ok: false,
      outputText: "",
      errorText:
        "OpenHands runtime spike is configured but not executable yet. See docs/openhands-spike.md for the required adapter contract.",
      exitCode: null
    };
  }
}
