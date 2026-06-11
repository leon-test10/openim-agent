# OpenHands runtime plan

## 2026-06-11 实施状态

- 已新增 `deploy/windows/smoke-openhands-e2e.ps1`，用于真实验证单聊新会话、单聊 resume、群聊 mention、群聊 resume、非 mention 消息、防回环和 runtime events。
- 脚本自动创建唯一临时群，临时启用 OpenIM 群 webhook，并在结束时恢复原 webhook 配置和 bridge 运行状态。
- DeepSeek key 仅从当前进程的 `DEEPSEEK_API_KEY` 读取；脚本、日志摘要和验证报告不会写入明文 key。
- 已增加通用 runtime events：`bridge.job_queued`、`bridge.job_running`、`bridge.job_succeeded`、`bridge.reply_sent`。
- 脚本 `-SelfTest` 已通过；真实 OpenIM E2E 尚未在当前机器完成，因为 Docker Desktop daemon 未运行。
- 当前系统 Node.js 为 `v26.3.0`，现有 `better-sqlite3` 原生模块使用旧 ABI，且本机缺少 Visual Studio C++ workload，导致 SQLite 集成测试和 bridge 启动暂时受阻。建议使用项目支持且存在预编译依赖的 Node 24 LTS 后再执行真实验收。

## 目标

把 `openhands` 从当前“已经能真实执行、但仍带有若干兼容边角”的状态，推进到可以稳定作为 `openim-codex-bridge` 的正式 runtime 选项使用。重点不是继续证明单点能力，而是把链路稳定性、命名一致性和真实 webhook 场景补齐。

## 当前状态

- `OpenHandsRunner` 已经实现为真实 CLI 调用，不再是 stub。
- `OpenHandsRunner` 当前通过 `openhands --headless --json --override-with-envs` 执行任务。
- DeepSeek 官方 API 已完成真实联调，新会话和 `--resume` 都已经成功跑通。
- `stderr` 中的非致命日志误判为失败的问题已经修正。
- `RuntimeRunnerWorker` 已引入，但目前仍只是对 `CodexRunnerWorker` 的薄包装。
- 后端测试当前全量通过，说明现有改动没有破坏已有 Codex CLI 链路。

## 已确认事实

### 运行链路

当前实际链路如下：

1. OpenIM 客户端消息进入 webhook。
2. bridge 创建 semantic event、session、job。
3. worker 串行调度并构造 prompt 与上下文。
4. worker 调用当前 runtime 对应的 runner。
5. `OpenHandsRunner` 拉起 `openhands` CLI。
6. CLI 调用上游模型。
7. runner 解析输出、提取 conversation id 和最终文本。
8. worker 统一把结果回发到 OpenIM。

### 已验证能力

- OpenHands 新会话执行可用。
- OpenHands `--resume` 可用。
- DeepSeek 作为 OpenAI-compatible 上游可用。
- session home 固定后，复现实验更加稳定。

## 主要问题

### 命名和职责仍偏向 Codex

- worker 主实现仍叫 `CodexRunnerWorker`。
- session / job / reply 元数据里仍有较多 `codex*` 字段名。
- 当前虽然功能上支持多 runtime，但实现边界还不够清晰。

### 真实业务验证还不够完整

- 目前已做 CLI 级联调和 runner 级联调。
- 还缺一条完整的“OpenIM webhook -> OpenHands -> OpenIM reply”垂直切片验证。
- 还缺针对网络抖动、skills 仓库拉取失败、resume 波动的回归测试。

### OpenHands 环境兼容仍需收口

- OpenHands 在隔离 home 下会访问 `.openhands` 缓存与 skills 目录。
- 当前已经通过 session home 预热和固定目录方式降低波动，但策略还没有被文档化和测试固化。

## 实施顺序

## 阶段一

目标：把当前“实验成功”升级为“可重复成功”。

- 补一条集成测试，模拟 OpenIM webhook 进入后实际走到 `OpenHandsRunner`。
- 在测试里验证 job 状态变化、runtime events、OpenIM sender 输出文本。
- 固定一个 DeepSeek 联调配置模板，作为手工验证标准输入。

完成标准：

- 本地可重复跑通单轮消息闭环。
- 失败时能明确区分 runner 超时、CLI 错误、上游模型错误、OpenIM 回发错误。

## 阶段二

目标：把 runtime 抽象和 Codex 专属命名进一步拆开。

- 把 `CodexRunnerWorker` 中与 runtime 无关的调度逻辑抽到真正通用的 worker。
- 逐步把 `codexSessionId` 等通用字段改造成更中性的 runtime/session 命名。
- 保留兼容层，避免一次性大改破坏当前已通的 Codex CLI 链路。

完成标准：

- worker 主体不再以 Codex 命名承载 OpenHands 行为。
- OpenHands 和 Codex CLI 都通过同一套 runtime-first 边界进入执行层。

## 阶段三

目标：把 OpenHands 作为正式可配置 runtime 暴露给运行环境。

- 明确 `OPENHANDS_BIN`、base URL、API key、model 的配置规范。
- 补充 README 或运维说明，给出 DeepSeek 示例配置。
- 明确默认值与本地开发建议，减少联调时的隐性环境差异。

完成标准：

- 新接入者可按文档完成本地启动与联调。
- 运行时配置不依赖口头说明或临时脚本。

## 阶段四

目标：完善异常路径和稳定性策略。

- 明确 skills 缓存不可更新时是否继续执行。
- 判断是否需要在 `resume` 失败时增加 fallback 行为。
- 视情况为网络抖动增加更清晰的诊断信息或有限重试。

完成标准：

- 遇到网络抖动或 OpenHands 外围噪音日志时，不会把成功任务误判成失败。
- `resume` 出问题时有明确错误分类和可操作排查路径。

## 验收标准

- OpenHands 新会话在 bridge 内稳定成功。
- OpenHands `resume` 在 bridge 内稳定成功。
- 从 OpenIM webhook 到 OpenIM reply 的完整闭环可重复通过。
- 后端全量测试继续保持通过。
- Codex CLI 原有功能无回退。

## 建议的下一步

最优先要做的是阶段一：补完整 webhook 垂直切片验证。当前 CLI 与 runner 层都已经证明 OpenHands 可跑，最缺的是把这条能力真正固化到 bridge 的集成验证里。
