import { execFile, spawn } from "node:child_process";
import { parseCodexJsonLine, parseCodexJsonlOutput } from "./codex-output.parser.js";
import type { CodexCliAdapter, CodexResumeInput, CodexRunHandle, CodexRunInput, CodexRunResult } from "./codex-types.js";

export interface SpawnCodexCliAdapterOptions {
  codexBin: string;
  timeoutMs: number;
  cancelGraceMs?: number;
}

export class SpawnCodexCliAdapter implements CodexCliAdapter {
  constructor(private readonly options: SpawnCodexCliAdapterOptions) {}

  runNewTask(input: CodexRunInput): Promise<CodexRunResult> {
    return this.runNewTaskCancellable(input).promise;
  }

  runNewTaskCancellable(input: CodexRunInput): CodexRunHandle {
    const args = ["exec", "--cd", input.projectPath, "--json"];
    args.push(...buildCodexRuntimeArgs(input));
    args.push("-");
    return this.run(args, input.prompt, input.onEvent, {
      codexHomeDir: input.codexHomeDir,
      apiKey: input.apiKey,
      apiKeyEnvName: input.apiKeyEnvName,
      baseUrl: input.baseUrl
    });
  }

  resumeTask(input: CodexResumeInput): Promise<CodexRunResult> {
    return this.resumeTaskCancellable(input).promise;
  }

  resumeTaskCancellable(input: CodexResumeInput): CodexRunHandle {
    const args = ["exec", "--cd", input.projectPath, "resume", "--json"];
    args.push(...buildCodexRuntimeArgs(input));
    args.push(input.sessionId, "-");
    return this.run(args, input.prompt, input.onEvent, {
      codexHomeDir: input.codexHomeDir,
      apiKey: input.apiKey,
      apiKeyEnvName: input.apiKeyEnvName,
      baseUrl: input.baseUrl
    });
  }

  private run(
    args: string[],
    prompt: string,
    onEvent?: (event: Record<string, unknown>) => void,
    runtimeEnv?: { codexHomeDir?: string; apiKey?: string; apiKeyEnvName?: string; baseUrl?: string }
  ): CodexRunHandle {
    const child = spawn(this.options.codexBin, args, {
      env: buildCodexRuntimeEnv(process.env, runtimeEnv ?? {}),
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: process.platform === "win32",
      detached: process.platform !== "win32"
    });
    let timedOut = false;
    let cancelled = false;
    let cancelMethod: string | undefined;
    let hardKillTimer: NodeJS.Timeout | null = null;

    const cancel = async (reason = "cancelled"): Promise<void> => {
      if (cancelled) {
        return;
      }
      cancelled = true;
      cancelMethod = reason;
      child.kill("SIGINT");
      hardKillTimer = setTimeout(() => {
        void killProcessTree(child.pid);
      }, this.options.cancelGraceMs ?? 3000);
    };

    const promise = new Promise<CodexRunResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let stdoutLineBuffer = "";

      const timer = setTimeout(() => {
        timedOut = true;
        void cancel("timeout");
      }, this.options.timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        stdoutLineBuffer = emitCompleteJsonLines(stdoutLineBuffer + chunk, onEvent);
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        if (hardKillTimer) {
          clearTimeout(hardKillTimer);
        }
        resolve({
          ok: false,
          outputText: "",
          rawOutput: stdout,
          errorText: error.message,
          exitCode: null,
          cancelled,
          timedOut
        });
      });
      child.on("close", (exitCode) => {
        clearTimeout(timer);
        if (hardKillTimer) {
          clearTimeout(hardKillTimer);
        }
        const parsed = parseCodexJsonlOutput(stdout);
        const errorText = timedOut
          ? `Codex CLI timed out after ${this.options.timeoutMs}ms`
          : cancelled
            ? `Codex CLI run cancelled (${cancelMethod ?? "cancelled"})`
          : stderr.trim() || undefined;
        resolve({
          ok: exitCode === 0 && !timedOut && !cancelled,
          sessionId: parsed.sessionId,
          outputText: parsed.outputText,
          rawOutput: stdout,
          errorText,
          exitCode,
          cancelled,
          timedOut
        });
      });
      child.stdin.end(prompt);
    });

    return {
      pid: child.pid ?? null,
      promise,
      cancel
    };
  }
}

export function buildCodexRuntimeArgs(
  input: Pick<
    CodexRunInput,
    | "model"
    | "sandboxMode"
    | "approvalPolicy"
    | "codexProfile"
    | "useOss"
    | "localProvider"
    | "modelProviderId"
    | "modelProviderBaseUrl"
    | "modelProviderWireApi"
    | "apiKeyEnvName"
  >
): string[] {
  const args: string[] = [];
  if (input.modelProviderId && input.modelProviderBaseUrl) {
    args.push("-c", `model_provider=${tomlString(input.modelProviderId)}`);
    args.push("-c", `model_providers.${input.modelProviderId}.base_url=${tomlString(input.modelProviderBaseUrl)}`);
    args.push("-c", `model_providers.${input.modelProviderId}.wire_api=${tomlString(input.modelProviderWireApi ?? "responses")}`);
    if (input.apiKeyEnvName) {
      args.push("-c", `model_providers.${input.modelProviderId}.env_key=${tomlString(input.apiKeyEnvName)}`);
    }
  }
  if (input.sandboxMode) {
    args.push("--sandbox", input.sandboxMode);
  }
  if (input.model) {
    args.push("--model", input.model);
  }
  if (input.approvalPolicy) {
    args.push("--ask-for-approval", input.approvalPolicy);
  }
  if (input.codexProfile) {
    args.push("--profile", input.codexProfile);
  }
  if (input.useOss) {
    args.push("--oss");
  }
  if (input.localProvider) {
    args.push("--local-provider", input.localProvider);
  }
  return args;
}

export function buildCodexRuntimeEnv(
  baseEnv: NodeJS.ProcessEnv,
  input: { codexHomeDir?: string; apiKey?: string; apiKeyEnvName?: string; baseUrl?: string }
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  if (input.codexHomeDir) {
    env.CODEX_HOME = input.codexHomeDir;
  }
  if (input.apiKey) {
    env.OPENAI_API_KEY = input.apiKey;
    if (input.apiKeyEnvName) {
      env[input.apiKeyEnvName] = input.apiKey;
    }
  }
  if (input.baseUrl) {
    env.OPENAI_BASE_URL = input.baseUrl;
    env.OPENAI_API_BASE_URL = input.baseUrl;
  }
  return env;
}

function tomlString(value: string): string {
  return JSON.stringify(value);
}

function killProcessTree(pid: number | undefined): Promise<void> {
  if (!pid) {
    return Promise.resolve();
  }

  if (process.platform === "win32") {
    return new Promise((resolve) => {
      execFile("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    });
  }

  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Process has already exited.
    }
  }
  return Promise.resolve();
}

function emitCompleteJsonLines(buffer: string, onEvent?: (event: Record<string, unknown>) => void): string {
  if (!onEvent) {
    return buffer;
  }

  const lines = buffer.split(/\r?\n/);
  const remainder = lines.pop() ?? "";
  for (const line of lines) {
    const event = parseCodexJsonLine(line);
    if (event) {
      onEvent(event);
    }
  }
  return remainder;
}
