# OpenHands Runtime Spike

Generated at: 2026-06-09T20:10:00+08:00

## Goal

Evaluate OpenHands as a future `AgentRunner` implementation without disturbing the stable bridge paths:

- `codex_cli`
- `openai_compatible`
- OpenIM webhook ingestion
- runtime job queueing/cancel/retry
- OpenIM reply writing

Phase 4E adds an `OpenHandsRunner` stub so `RUNTIME_DEFAULT_KIND=openhands` is a recognized kind, but the runner returns a clear unsupported result until a concrete adapter contract is implemented.

## Current Official Integration Surfaces

Official docs reviewed:

- https://docs.openhands.dev/sdk/guides/agent-server/local-server
- https://docs.openhands.dev/openhands/usage/api/v1

Observed viable paths:

- OpenHands SDK Agent Server: start a local agent server and drive it over HTTP/WebSocket.
- OpenHands App/API V1: use the OpenHands server API if it is deployed and authenticated.
- CLI wrapper: possible fallback, but lower priority because process/event/cancel semantics would be less stable.

## Adapter Contract Needed

Before enabling production execution, the bridge needs a concrete adapter that can answer these questions with tests:

1. Startup mode
   - Preferred: OpenHands SDK Agent Server or OpenHands REST/API.
   - Required config: `OPENHANDS_BASE_URL`, optional `OPENHANDS_API_KEY`, timeout.

2. Workspace
   - Must map bridge `projectPath` to an OpenHands workspace.
   - Must preserve the existing backend allowlist policy.
   - Must not allow arbitrary absolute path escape.

3. LLM provider
   - Must configure OpenHands provider/model without exposing API keys back to Electron.
   - Should reuse runtime profile policy once OpenHands-specific profiles exist.

4. Task submission
   - Input should come from `RuntimeRunInput.prompt` and `RuntimeRunInput.inputText`.
   - The adapter must return a provider task/conversation id as `externalSessionId` only when resume semantics are real.

5. Results
   - Adapter must produce a final assistant text for OpenIM reply.
   - Empty or non-text terminal results should be a failed `RuntimeRunResult`.

6. Events
   - OpenHands events should map to `runtime_events` through `runtime-event-mapper`.
   - Minimum event categories: task submitted, agent message, tool/action event, error, completed.

7. Cancellation
   - `RuntimeRunHandle.cancel()` must call the OpenHands cancel endpoint if available.
   - If no cancel endpoint is available, the runner must document best-effort semantics and mark jobs accordingly.

8. Session/resume
   - Do not pretend OpenHands resume exists unless an external conversation/task id can be resumed reliably.
   - Until verified, return `externalSessionId: null`.

## Current Implementation

Files:

- `openim-codex-bridge/src/runtime/openhands.runner.ts`
- `openim-codex-bridge/tests/unit/runtime/openhands-runner.test.ts`

Behavior:

- `RUNTIME_DEFAULT_KIND=openhands` constructs `OpenHandsRunner`.
- The runner emits `openhands.spike.not_implemented`.
- The runner returns `ok: false` with a clear message pointing to this document.
- It does not submit tasks, read events, or cancel remote work yet.

This is intentional. It keeps the bridge runtime boundary honest while avoiding a half-working OpenHands integration that could corrupt job/session semantics.

## Acceptance State

- OpenHands endpoint config exists.
- OpenHands runner kind exists.
- Worker can hold an OpenHands `AgentRunner` without Codex-specific spawn coupling.
- Production execution remains disabled by behavior, not by hidden frontend state.
- Codex CLI and OpenAI-compatible paths are unaffected.

## Next Implementation Step

Implement a real adapter after choosing one official surface:

1. Prefer SDK Agent Server if it provides stable task submit, event stream, final result, and cancel semantics.
2. Use App/API V1 if authentication and workspace mapping are clearer in deployment.
3. Only use CLI wrapper if REST/API surfaces cannot support required cancellation/events.
