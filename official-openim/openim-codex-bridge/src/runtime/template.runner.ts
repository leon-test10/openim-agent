import type { AgentRunner, RuntimeRunHandle, RuntimeRunInput, RuntimeRunResult } from "./runtime-types.js";

export interface TemplateRunnerOptions {
  responsePrefix?: string;
}

export class TemplateRunner implements AgentRunner {
  readonly kind = "template" as const;

  constructor(private readonly options: TemplateRunnerOptions = {}) {}

  run(input: RuntimeRunInput): RuntimeRunHandle {
    let cancelled = false;
    let cancelReason = "cancelled";
    const promise = Promise.resolve().then<RuntimeRunResult>(() => {
      input.onEvent?.({
        type: "template.request_started",
        title: "Template runtime request started",
        summary: input.openimConversationId
      });

      if (cancelled) {
        input.onEvent?.({
          type: "template.request_cancelled",
          title: "Template runtime request cancelled",
          summary: cancelReason
        });
        return {
          ok: false,
          outputText: "",
          errorText: `Template runtime cancelled: ${cancelReason}`,
          exitCode: null,
          cancelled: true
        };
      }

      const outputText = buildTemplateOutput(input.inputText, this.options.responsePrefix);
      input.onEvent?.({
        type: "template.response_completed",
        title: "Template runtime response completed",
        summary: `${outputText.length} chars`
      });

      return {
        ok: true,
        externalSessionId: null,
        outputText,
        rawOutput: outputText,
        exitCode: 0
      };
    });

    return {
      pid: null,
      promise,
      cancel: async (reason?: string) => {
        cancelled = true;
        cancelReason = reason ?? cancelReason;
      }
    };
  }
}

function buildTemplateOutput(inputText: string, prefix = "TEMPLATE_ACK"): string {
  const normalized = inputText.replace(/\s+/g, " ").trim();
  return normalized ? `${prefix}: ${normalized}` : prefix;
}
