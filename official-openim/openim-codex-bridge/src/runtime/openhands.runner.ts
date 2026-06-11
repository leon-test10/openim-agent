import { execFile, spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentRunner, RuntimeRunHandle, RuntimeRunInput, RuntimeRunResult } from "./runtime-types.js";

export interface OpenHandsRunnerOptions {
  openhandsBin: string;
  openhandsPythonBin?: string | null;
  baseUrl: string;
  apiKey?: string | null;
  timeoutMs: number;
  cancelGraceMs?: number;
  exitPollMs?: number;
  processAliveImpl?: (pid: number) => Promise<boolean>;
  spawnImpl?: (
    command: string,
    args: ReadonlyArray<string>,
    options: SpawnOptionsWithoutStdio
  ) => ChildProcessWithoutNullStreams;
}

export class OpenHandsRunner implements AgentRunner {
  readonly kind = "openhands" as const;
  private readonly spawnImpl: NonNullable<OpenHandsRunnerOptions["spawnImpl"]>;

  constructor(private readonly options: OpenHandsRunnerOptions) {
    this.spawnImpl = options.spawnImpl ?? spawn;
  }

  run(input: RuntimeRunInput): RuntimeRunHandle {
    const launch = resolveOpenHandsLaunch(this.options);
    const args = [...launch.argsPrefix, ...buildOpenHandsArgs(input)];
    const env = buildOpenHandsEnv(process.env, this.options, input);
    const child = this.spawnImpl(launch.command, args, {
      cwd: input.projectPath,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
      detached: process.platform !== "win32"
    });
    child.stdin.end();

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

    const promise = new Promise<RuntimeRunResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let stdoutLineBuffer = "";
      let lastAssistantText: string | null = null;
      let conversationId = normalizeConversationId(input.externalSessionId);
      let capturedError: string | null = null;
      let settled = false;
      let exitFallbackTimer: NodeJS.Timeout | null = null;
      let processProbeTimer: NodeJS.Timeout | null = null;

      const timer = setTimeout(() => {
        timedOut = true;
        void cancel("timeout");
      }, this.options.timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        stdoutLineBuffer = emitCompleteOpenHandsLines(stdoutLineBuffer + chunk, {
          onEvent: input.onEvent,
          onAssistantText: (text) => {
            lastAssistantText = text;
          },
          onConversationId: (value) => {
            conversationId = normalizeConversationId(value) ?? conversationId;
          },
          onError: (value) => {
            capturedError = value;
          }
        });
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (hardKillTimer) {
          clearTimeout(hardKillTimer);
        }
        if (processProbeTimer) {
          clearInterval(processProbeTimer);
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
      const finalize = (exitCode: number | null) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        if (hardKillTimer) {
          clearTimeout(hardKillTimer);
        }
        if (exitFallbackTimer) {
          clearTimeout(exitFallbackTimer);
        }
        if (processProbeTimer) {
          clearInterval(processProbeTimer);
        }
        if (stdoutLineBuffer.trim()) {
          processOpenHandsLine(stdoutLineBuffer, {
            onEvent: input.onEvent,
            onAssistantText: (text) => {
              lastAssistantText = text;
            },
            onConversationId: (value) => {
              conversationId = normalizeConversationId(value) ?? conversationId;
            },
            onError: (value) => {
              capturedError = value;
            }
          });
        }
        conversationId = normalizeConversationId(extractConversationId(stdout)) ?? conversationId;
        const stderrText = cleanupOpenHandsStderr(stderr);
        const errorText = timedOut
          ? `OpenHands CLI timed out after ${this.options.timeoutMs}ms`
          : cancelled
            ? `OpenHands CLI run cancelled (${cancelMethod ?? "cancelled"})`
            : capturedError
              ?? ((exitCode === 0 && lastAssistantText) ? undefined : stderrText)
              ?? (!lastAssistantText && exitCode === 0 ? "OpenHands CLI returned no assistant content." : undefined);
        resolve({
          ok: exitCode === 0 && !timedOut && !cancelled && !errorText && Boolean(lastAssistantText),
          externalSessionId: conversationId,
          outputText: lastAssistantText ?? "",
          rawOutput: stdout,
          errorText,
          exitCode,
          cancelled,
          timedOut
        });
      };
      child.on("exit", (exitCode) => {
        exitFallbackTimer = setTimeout(() => finalize(exitCode), 250);
      });
      child.on("close", finalize);
      let missingProcessPolls = 0;
      let processProbeInFlight = false;
      processProbeTimer = setInterval(async () => {
        if (settled || !child.pid || processProbeInFlight) {
          return;
        }
        processProbeInFlight = true;
        try {
          const alive = await (this.options.processAliveImpl ?? isProcessAlive)(child.pid);
          if (!alive) {
            missingProcessPolls += 1;
            if (missingProcessPolls >= 2) {
              finalize(child.exitCode ?? (lastAssistantText ? 0 : null));
            }
            return;
          }
          missingProcessPolls = 0;
        } catch {
          missingProcessPolls = 0;
        } finally {
          processProbeInFlight = false;
        }
      }, this.options.exitPollMs ?? 1000);
    });

    return {
      pid: child.pid ?? null,
      promise,
      cancel
    };
  }
}

function buildOpenHandsArgs(input: RuntimeRunInput): string[] {
  const args = ["--headless", "--json", "--override-with-envs"];
  const conversationId = normalizeConversationId(input.externalSessionId);
  if (conversationId) {
    args.push("--resume", conversationId);
  }
  args.push("-t", input.prompt || input.inputText);
  return args;
}

function buildOpenHandsEnv(
  baseEnv: NodeJS.ProcessEnv,
  options: OpenHandsRunnerOptions,
  input: RuntimeRunInput
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  const runtimeHomeDir = input.runtimeHomeDir?.trim();
  if (runtimeHomeDir) {
    mkdirSync(runtimeHomeDir, { recursive: true });
    mkdirSync(`${runtimeHomeDir}/.openhands`, { recursive: true });
    seedOpenHandsSessionHome(runtimeHomeDir);
    env.HOME = runtimeHomeDir;
    env.USERPROFILE = runtimeHomeDir;
    env.GIT_CONFIG_COUNT = "1";
    env.GIT_CONFIG_KEY_0 = "core.longpaths";
    env.GIT_CONFIG_VALUE_0 = "true";
    env.PYTHONIOENCODING = "utf-8";
    env.PYTHONUTF8 = "1";
  }
  env.PYTHONUNBUFFERED = "1";
  env.OPENHANDS_SUPPRESS_BANNER = "1";

  const baseUrl = input.baseUrl ?? options.baseUrl;
  if (baseUrl) {
    env.LLM_BASE_URL = baseUrl;
  }

  const apiKey = input.apiKey ?? options.apiKey ?? (baseUrl ? "dummy" : undefined);
  if (apiKey) {
    env.LLM_API_KEY = apiKey;
  }

  const model = normalizeOpenHandsModel(input.model ?? null, baseUrl);
  if (model) {
    env.LLM_MODEL = model;
  }

  return env;
}

function resolveOpenHandsLaunch(
  options: OpenHandsRunnerOptions
): { command: string; argsPrefix: string[] } {
  const pythonBin = options.openhandsPythonBin?.trim();
  if (process.platform === "win32" && pythonBin) {
    return {
      command: pythonBin,
      argsPrefix: ["-m", "openhands_cli.entrypoint"]
    };
  }

  return {
    command: options.openhandsBin,
    argsPrefix: []
  };
}

function normalizeOpenHandsModel(model: string | null, baseUrl?: string | null): string | undefined {
  if (!model) {
    return undefined;
  }
  const trimmed = model.trim();
  if (!trimmed) {
    return undefined;
  }
  if (trimmed.includes("/")) {
    return trimmed;
  }
  if (baseUrl) {
    return `openai/${trimmed}`;
  }
  return trimmed;
}

function emitCompleteOpenHandsLines(
  buffer: string,
  handlers: {
    onEvent?: (event: Record<string, unknown>) => void;
    onAssistantText: (text: string) => void;
    onConversationId: (conversationId: string) => void;
    onError: (errorText: string) => void;
  }
): string {
  const lines = buffer.split(/\r?\n/);
  const remainder = lines.pop() ?? "";
  for (const line of lines) {
    processOpenHandsLine(line, handlers);
  }
  return remainder;
}

function processOpenHandsLine(
  line: string,
  handlers: {
    onEvent?: (event: Record<string, unknown>) => void;
    onAssistantText: (text: string) => void;
    onConversationId: (conversationId: string) => void;
    onError: (errorText: string) => void;
  }
): void {
  const trimmed = line.trim();
  if (!trimmed) {
    return;
  }
  const parsed = tryParseJson(trimmed);
  if (parsed && typeof parsed === "object") {
    emitOpenHandsJsonEvent(parsed, handlers);
    return;
  }

  const conversationId = extractConversationId(trimmed);
  if (conversationId) {
    handlers.onConversationId(conversationId);
    handlers.onEvent?.({
      type: "openhands.conversation_id",
      title: "OpenHands conversation id",
      summary: conversationId,
      conversationId
    });
    return;
  }

  if (trimmed === "Initializing agent...") {
    handlers.onEvent?.({
      type: "openhands.initializing",
      title: "OpenHands initializing",
      summary: null
    });
    return;
  }
  if (trimmed === "Agent is working") {
    handlers.onEvent?.({
      type: "openhands.working",
      title: "OpenHands working",
      summary: null
    });
    return;
  }
  if (trimmed === "Agent finished") {
    handlers.onEvent?.({
      type: "openhands.finished",
      title: "OpenHands finished",
      summary: null
    });
  }
}

function emitOpenHandsJsonEvent(
  parsed: Record<string, unknown>,
  handlers: {
    onEvent?: (event: Record<string, unknown>) => void;
    onAssistantText: (text: string) => void;
    onConversationId: (conversationId: string) => void;
    onError: (errorText: string) => void;
  }
): void {
  const kind = typeof parsed.kind === "string" ? parsed.kind : "OpenHandsEvent";
  const source = typeof parsed.source === "string" ? parsed.source : "openhands";
  const summary = extractOpenHandsSummary(parsed);

  handlers.onEvent?.({
    type: `openhands.${toEventSegment(kind)}`,
    title: `${source}.${kind}`,
    summary,
    rawEvent: parsed
  });

  if (kind === "MessageEvent" && source === "agent") {
    const assistantText = extractAssistantText(parsed);
    if (assistantText) {
      handlers.onAssistantText(assistantText);
    }
  }

  if (kind === "ConversationErrorEvent") {
    const code = typeof parsed.code === "string" ? parsed.code : "ConversationErrorEvent";
    const detail = typeof parsed.detail === "string" ? parsed.detail : JSON.stringify(parsed);
    handlers.onError(`${code}: ${detail}`);
  }
}

function extractOpenHandsSummary(event: Record<string, unknown>): string | null {
  const message = extractAssistantText(event);
  if (message) {
    return message.length > 160 ? `${message.slice(0, 157)}...` : message;
  }
  if (typeof event.detail === "string" && event.detail.trim()) {
    return event.detail.trim();
  }
  if (typeof event.code === "string" && event.code.trim()) {
    return event.code.trim();
  }
  return null;
}

function extractAssistantText(event: Record<string, unknown>): string | null {
  const llmMessage = isRecord(event.llm_message) ? event.llm_message : null;
  if (!llmMessage) {
    return null;
  }
  const content = Array.isArray(llmMessage.content) ? llmMessage.content : [];
  const text = content
    .map((item) => (isRecord(item) && typeof item.text === "string" ? item.text : ""))
    .join("")
    .trim();
  return text || null;
}

function cleanupOpenHandsStderr(stderr: string): string | undefined {
  const cleaned = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) =>
      line
      && !line.startsWith("OpenHands CLI terminal UI may not work correctly")
      && !line.includes("AuthlibDeprecationWarning")
      && line !== "It will be compatible before version 2.0.0."
      && line !== "from authlib.jose import JsonWebKey, jwt"
    )
    .join("\n")
    .trim();
  return cleaned || undefined;
}

function extractConversationId(value: string): string | null {
  const match = value.match(/Conversation ID:\s*([0-9a-fA-F-]{32,36})/);
  return match ? match[1] : null;
}

function normalizeConversationId(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().toLowerCase();
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized)) {
    return normalized;
  }
  if (/^[0-9a-f]{32}$/.test(normalized)) {
    return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
  }
  return normalized.length ? normalized : null;
}

function tryParseJson(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toEventSegment(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .toLowerCase();
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

function isProcessAlive(pid: number): Promise<boolean> {
  if (process.platform === "win32") {
    return new Promise((resolve) => {
      execFile(
        "tasklist",
        ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"],
        { windowsHide: true },
        (error, stdout) => {
          if (error) {
            resolve(false);
            return;
          }
          resolve(stdout.includes(`"${pid}"`));
        }
      );
    });
  }
  try {
    process.kill(pid, 0);
    return Promise.resolve(true);
  } catch {
    return Promise.resolve(false);
  }
}

function seedOpenHandsSessionHome(runtimeHomeDir: string): void {
  const globalHome = homedir();
  if (!globalHome || globalHome === runtimeHomeDir) {
    return;
  }

  const sourceSkillsCache = join(globalHome, ".openhands", "cache", "skills", "public-skills");
  const targetSkillsCache = join(runtimeHomeDir, ".openhands", "cache", "skills", "public-skills");
  if (existsSync(sourceSkillsCache) && !existsSync(targetSkillsCache)) {
    mkdirSync(join(runtimeHomeDir, ".openhands", "cache", "skills"), { recursive: true });
    cpSync(sourceSkillsCache, targetSkillsCache, { recursive: true });
  }

  const filesToSeed = ["agent_settings.json", "cli_config.json", "mcp.json"];
  for (const fileName of filesToSeed) {
    const sourceFile = join(globalHome, ".openhands", fileName);
    const targetFile = join(runtimeHomeDir, ".openhands", fileName);
    if (existsSync(sourceFile) && !existsSync(targetFile)) {
      cpSync(sourceFile, targetFile);
    }
  }
}
