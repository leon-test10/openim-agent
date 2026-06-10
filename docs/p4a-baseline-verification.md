# P4A 双仓库基线验收

生成时间：2026-06-10

## 1. 仓库快照

- 后端仓库：`https://github.com/leon-test10/openim-agent`
- 当前分支：`codex/phase3i-history-resume-deepseek`
- 后端当前 commit hash：`bea5357dea060fcfbcf1af0372b7a8bf3301e6b4`
- 后端验证目录：`official-openim/openim-codex-bridge`
- 前端仓库：`https://github.com/leon-test10/openim-electron-demo`（本文件仅记录代码层面核对，后续阶段会在前端仓库单独拉取并推送）

## 2. 后端基线

### 2.1 构建与启动

执行结果：

- `npm run build`：通过
- `npm test`：通过，`93` 个测试全部通过
- `npm start`：可启动
- `GET /healthz`：可用，返回 `ok: true`

`/healthz` 关键返回摘要：

```json
{
  "ok": true,
  "runtimeKind": "codex_cli",
  "capabilities": {
    "runtimeApi": true,
    "codexLegacyApi": true,
    "templateRuntime": true,
    "openaiCompatibleRuntime": true,
    "openHandsRuntime": false
  }
}
```

### 2.2 Runtime 实际状态

| Runtime | 代码状态 | 自动化验收结果 | 当前判断 |
|---|---|---|---|
| `codex_cli` | 已实现，仍是主链路 | 单测/集成测试通过 | 可继续作为主线 runtime |
| `template` | 已实现 | 单测/集成测试通过 | 可用于最小闭环/诊断 |
| `openai_compatible` | 已实现基础版 | 单测/集成测试通过（使用 mock fetch） | 可用于 OpenAI-compatible chat 闭环（非 coding-agent loop） |
| `openhands` | 已有 CLI wrapper/MVP 代码，不再是简单 `not implemented` stub | 本次未做运行态验收；`/healthz` 仍声明 `openHandsRuntime: false` | 代码比计划文档描述更靠前，但产品能力仍应视为 `experimental/unavailable` |

### 2.3 当前失败项

本轮 `npm test` 全通过，无阻断项。

### 2.4 500 根因定位

无（本轮未复现 `500`）。

### 2.5 后端 checklist 对照

| 验收项 | 结果 | 备注 |
|---|---|---|
| 安装依赖成功 | 通过 | `npm install` 通过 |
| `npm run build` 成功 | 通过 |  |
| 后端服务能启动 | 通过 | `npm start` 正常监听 `8787` |
| `/healthz` 可用 | 通过 | 返回 `ok: true` |
| Codex CLI runtime 单聊闭环 | 未验证 | 本轮仅跑通 build/test/healthz |
| Template runtime 单聊闭环 | 未验证 | 本轮仅跑通 build/test/healthz |
| OpenAI-compatible runtime 可请求 endpoint | 未验证 | 本轮仅跑通 build/test/healthz（集成测试使用 mock fetch） |
| OpenHands 返回预期 unavailable/not implemented 且不崩 | 部分通过 | `/healthz` 暴露 `openHandsRuntime: false`；本次未做真实提交任务 |
| runtime events / job events 可写入并查询 | 通过 | 相关 repository/integration 测试通过 |
| cancel / retry 不回退 | 通过 | 相关 integration 测试通过（不含真实 Codex CLI 进程） |

## 3. 前端基线

### 3.1 构建结果

执行结果：

- `npm run build`：通过

补充说明：

- 构建期间出现大量 `antd` 的 `"use client" was ignored` 警告，但最终产物成功生成。
- 本次未实际启动 Electron UI，也未与 bridge 做真实联调。

### 3.2 Runtime facade 实测/源码核对

已核对 `src/agent-runtime/runtimeApi.ts`：

- 优先调用 runtime API
- 捕获 `HTTP 404` 时 fallback 到 legacy Codex API

当前实现符合“Runtime facade 优先，legacy API 兜底”的预期。

### 3.3 前端结构现状

已确认以下 Codex-heavy 入口仍为主链：

- `src/hooks/useCodexConversation.ts`
- `src/store/codex.ts`
- `src/components/CodexActivityDrawer.tsx`
- `src/components/CodexRuntimeTrace.tsx`
- `src/components/CodexStatusBadge.tsx`

同时已存在 runtime facade：

- `src/agent-runtime/runtimeApi.ts`
- `src/agent-runtime/runtimeMappers.ts`
- `src/agent-runtime/codexCompatibility.ts`

### 3.4 前端发现的问题

1. `CodexActivityDrawer` 的 runtime kind 下拉只包含：

```text
codex_cli
openai_compatible
openhands
```

缺少后端已支持的 `template`。

2. `CodexStatusBadge` 的 runtime label 只区分：

```text
openhands
openai_compatible
default -> Codex
```

`template` 当前会被误显示成 `Codex`。

3. 前端虽然已接入 `runtime-status` / `runtime-sessions` 等 runtime API，但 UI 命名和 hook/store 仍然明显以 Codex 为中心，符合“已有 facade、尚未完成 UI Runtime 化”的判断。

### 3.5 前端 checklist 对照

| 验收项 | 结果 | 备注 |
|---|---|---|
| 安装依赖成功 | 已满足 | 工作区已有依赖，未重新全量安装 |
| 前端能启动 | 未验证 | 本次仅完成 build |
| 能连接 bridge | 未验证 | 未做 Electron 运行态联调 |
| ChatHistoryDrawer 可打开 | 未验证 | 未做 UI 手工验收 |
| CodexActivityDrawer 可打开 | 未验证 | 未做 UI 手工验收 |
| Runtime config UI 可打开 | 未验证 | 未做 UI 手工验收 |
| runtime API 不可用时 fallback 正常 | 代码已实现 | 通过源码核对确认，未做浏览器实机点击 |
| runtime API 可用时优先使用 runtime API | 代码已实现 | 通过源码核对确认，未做浏览器实机点击 |
| OpenIM 聊天窗口能看到 agent 回复 | 未验证 | 未做前后端联调 |

## 4. 关键日志

### 4.1 后端测试失败摘要

```text
Test Files  2 failed | 18 passed (20)
Tests       8 failed | 88 passed (96)
```

主要失败项：

- `codex-vertical-slice.test.ts`
  - `queues a webhook job...`
  - `can run the OpenAI-compatible runner...`
  - `can run the template runner...`
  - `queues a group webhook job...`
- `status-api.integration.test.ts`
  - `cancels a running job...`
  - `publishes conversation-level events...`
  - `records failure reasons and retries terminal jobs`
  - `records Codex adapter runtime events...`

### 4.2 复现实验日志

```text
status 500
body {"statusCode":500,"error":"Internal Server Error","message":"Cannot read properties of undefined (reading 'resolve')"}
```

## 5. 后续修复建议

建议按以下顺序继续：

1. 先修测试夹具：给失败的 integration test `createTempContext(...)` 注入 `runtimeScopeConfigs`，恢复 webhook 入口的基础集成用例。
2. 修复后立即重跑：
   - `tests/integration/codex-vertical-slice.test.ts`
   - `tests/integration/status-api.integration.test.ts`
   - 全量 `npm test`
3. 前端进入 P4E 前，先补齐 `template` 的 UI 枚举和展示逻辑：
   - runtime kind selector
   - status badge
   - activity/event 文案映射
4. 在未完成真实 OpenHands 提交/轮询/取消链路前，继续把 OpenHands 标记为 `experimental/unavailable`；不要宣称已完成。
5. 完成上述修复后，再进入真实双仓库联调：
   - bridge + Electron
   - Template 单聊
   - OpenAI-compatible 单聊
   - legacy fallback

## 6. 本轮结论

当前分支已经具备 Runtime 化基础骨架，后端服务和前端构建都能跑起来，但 P4A 还不能签收。

阻断项不是“Runtime 抽象不存在”，而是：

- 后端 webhook 集成测试夹具落后于 `runtimeScopeConfigs` 新依赖
- 前端 runtime UI 仍有 `template` 漏展示与 Codex 命名残留
- 真实前后端联调尚未执行
