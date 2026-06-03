import { execFile, spawn } from "node:child_process";
import { parseCodexJsonlOutput } from "./codex-output.parser.js";
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
    if (input.model) {
      args.push("--model", input.model);
    }
    args.push("-");
    return this.run(args, input.prompt);
  }

  resumeTask(input: CodexResumeInput): Promise<CodexRunResult> {
    return this.resumeTaskCancellable(input).promise;
  }

  resumeTaskCancellable(input: CodexResumeInput): CodexRunHandle {
    const args = ["exec", "--cd", input.projectPath, "resume", "--json"];
    if (input.model) {
      args.push("--model", input.model);
    }
    args.push(input.sessionId, "-");
    return this.run(args, input.prompt);
  }

  private run(args: string[], prompt: string): CodexRunHandle {
    const child = spawn(this.options.codexBin, args, {
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

      const timer = setTimeout(() => {
        timedOut = true;
        void cancel("timeout");
      }, this.options.timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
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
