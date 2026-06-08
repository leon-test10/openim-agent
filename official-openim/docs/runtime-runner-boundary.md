# Runtime Runner Boundary

Phase 4B keeps the bridge Codex-first while preventing new Codex-only coupling from spreading through the job worker.

## Boundary

`CodexRunnerWorker` remains the job lifecycle owner:

- per-conversation queueing
- cancellation/retry coordination
- session record updates
- runtime event persistence
- OpenIM reply writing

Runtime execution is delegated through `AgentRunner`:

```ts
export interface AgentRunner {
  kind: RuntimeKind;
  run(input: RuntimeRunInput): RuntimeRunHandle;
}
```

The only production runner in Phase 4B is `CodexCliRunner`, which wraps the existing `CodexCliAdapter`.

## Codex CLI Mapping

- `RuntimeRunInput.externalSessionId` maps to `CodexResumeInput.sessionId`.
- Missing `externalSessionId` starts a new Codex CLI task.
- `RuntimeRunResult.externalSessionId` maps back to the existing `codex_session_id` fields.
- `runtimeHomeDir` maps to Codex `CODEX_HOME` isolation through the existing adapter.
- Codex JSON events are normalized through `runtime-event-mapper`, which currently delegates `codex_cli` events to the existing Codex parser.

## Compatibility

Phase 4B intentionally does not rename tables or public API fields:

- `codex_session_records` remains the session table.
- `codex_session_id_before` and `codex_session_id_after` remain in `runtime_jobs`.
- `/api/conversations/:conversationId/codex-sessions` remains supported.
- `/api/jobs/:jobId/*` remains supported.

`AppContext.codex` is retained as a legacy test/compatibility seam. Production construction now creates a `CodexCliRunner` from the existing `SpawnCodexCliAdapter`.

## Future Runtime Implementations

Future runners should implement `AgentRunner` without modifying OpenIM webhook ingestion, job repositories, or OpenIM reply writing:

- `openai_compatible`: call `/v1/chat/completions`, return final assistant text, no external session in v1.
- `openhands`: submit a task to OpenHands REST/API layer and map its events to `runtime_events`.
- `template`: deterministic test/runtime stub for diagnostics.

Runtime API naming, new runtime session tables, and Electron Runtime UI migration belong to later phases.
