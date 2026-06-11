import type { AgentRunner, RuntimeRunHandle, RuntimeRunInput, RuntimeRunResult } from "./runtime-types.js";

export interface OpenAiCompatibleRunnerOptions {
  baseUrl: string;
  apiKey?: string | null;
  model: string;
  timeoutMs: number;
  temperature: number;
  maxTokens: number;
  fetchImpl?: typeof fetch;
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    text?: string;
  }>;
  error?: {
    message?: string;
  };
}

export class OpenAiCompatibleRunner implements AgentRunner {
  readonly kind = "openai_compatible" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OpenAiCompatibleRunnerOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  run(input: RuntimeRunInput): RuntimeRunHandle {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error("openai_compatible_timeout")), this.options.timeoutMs);
    const promise = this.runChatCompletion(input, controller.signal)
      .finally(() => clearTimeout(timeout));

    return {
      pid: null,
      promise,
      cancel: async (reason?: string) => {
        controller.abort(new Error(reason ?? "cancelled"));
      }
    };
  }

  private async runChatCompletion(input: RuntimeRunInput, signal: AbortSignal): Promise<RuntimeRunResult> {
    const baseUrl = normalizeBaseUrl(this.options.baseUrl);
    const url = `${baseUrl}/chat/completions`;
    const model = input.model ?? this.options.model;
    const apiKey = input.apiKey ?? this.options.apiKey ?? "dummy";

    input.onEvent?.({
      type: "openai_compatible.request_started",
      title: "OpenAI-compatible request started",
      summary: model
    });

    try {
      const response = await this.fetchImpl(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are an assistant inside an OpenIM conversation." },
            { role: "user", content: input.prompt || input.inputText }
          ],
          temperature: this.options.temperature,
          max_tokens: this.options.maxTokens,
          stream: false
        }),
        signal
      });

      const rawOutput = await response.text();
      if (!response.ok) {
        const errorText = extractErrorMessage(rawOutput) ?? `OpenAI-compatible runtime failed: HTTP ${response.status}`;
        input.onEvent?.({
          type: "openai_compatible.request_failed",
          title: "OpenAI-compatible request failed",
          summary: `HTTP ${response.status}`
        });
        return {
          ok: false,
          outputText: "",
          rawOutput,
          errorText,
          exitCode: response.status
        };
      }

      const parsed = parseJson(rawOutput);
      if (!parsed.ok) {
        return {
          ok: false,
          outputText: "",
          rawOutput,
          errorText: "OpenAI-compatible runtime returned malformed JSON.",
          exitCode: null
        };
      }

      const outputText = extractAssistantContent(parsed.value);
      if (!outputText) {
        return {
          ok: false,
          outputText: "",
          rawOutput,
          errorText: "OpenAI-compatible runtime returned no assistant content.",
          exitCode: null
        };
      }

      input.onEvent?.({
        type: "openai_compatible.response_completed",
        title: "OpenAI-compatible response completed",
        summary: `${outputText.length} chars`
      });

      return {
        ok: true,
        externalSessionId: null,
        outputText,
        rawOutput,
        exitCode: 0
      };
    } catch (error) {
      const aborted = signal.aborted;
      const message = error instanceof Error ? error.message : String(error);
      input.onEvent?.({
        type: aborted ? "openai_compatible.request_cancelled" : "openai_compatible.request_error",
        title: aborted ? "OpenAI-compatible request cancelled" : "OpenAI-compatible request error",
        summary: message
      });
      return {
        ok: false,
        outputText: "",
        errorText: aborted ? `OpenAI-compatible runtime cancelled: ${message}` : message,
        exitCode: null,
        cancelled: aborted,
        timedOut: message === "openai_compatible_timeout"
      };
    }
  }
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "");
}

function parseJson(rawOutput: string): { ok: true; value: ChatCompletionResponse } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(rawOutput) as ChatCompletionResponse };
  } catch {
    return { ok: false };
  }
}

function extractAssistantContent(response: ChatCompletionResponse): string | null {
  const first = response.choices?.[0];
  const content = first?.message?.content;
  if (typeof content === "string") {
    return normalizeOutput(content);
  }
  if (Array.isArray(content)) {
    return normalizeOutput(content.map((part) => part.text ?? "").join(""));
  }
  if (typeof first?.text === "string") {
    return normalizeOutput(first.text);
  }
  return null;
}

function extractErrorMessage(rawOutput: string): string | null {
  const parsed = parseJson(rawOutput);
  if (!parsed.ok) {
    return null;
  }
  return parsed.value.error?.message ?? null;
}

function normalizeOutput(value: string): string | null {
  const normalized = value.trim();
  return normalized.length ? normalized : null;
}
