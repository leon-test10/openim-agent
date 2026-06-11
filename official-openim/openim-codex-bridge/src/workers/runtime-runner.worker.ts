import type { Logger } from "pino";
import type { AppContext } from "../app-context.js";
import type { RuntimeJob } from "../core/runtime-job.js";
import type { SemanticEvent } from "../core/semantic-event.js";
import { CodexRunnerWorker } from "./codex-runner.worker.js";

/**
 * Runtime-first worker wrapper.
 *
 * 约束：
 * - 不改变现有 Codex CLI 垂直闭环的行为
 * - 新代码优先依赖 runtime 命名边界
 *
 * 当前实现先委托给 legacy 的 `CodexRunnerWorker`，后续再逐步抽取公共逻辑。
 */
export class RuntimeRunnerWorker {
  private readonly legacy: CodexRunnerWorker;

  constructor(context: AppContext, logger: Logger) {
    this.legacy = new CodexRunnerWorker(context, logger);
  }

  enqueue(job: RuntimeJob, event: SemanticEvent): void {
    this.legacy.enqueue(job, event);
  }

  cancelJob(jobId: string) {
    return this.legacy.cancelJob(jobId);
  }

  retryJob(jobId: string) {
    return this.legacy.retryJob(jobId);
  }
}

