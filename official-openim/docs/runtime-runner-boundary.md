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

Phase 4B introduced `CodexCliRunner`, which wraps the existing `CodexCliAdapter`. Phase 4D adds
`OpenAiCompatibleRunner` for OpenAI-compatible `/v1/chat/completions` endpoints. Phase 4D0 adds
`TemplateRunner` as a deterministic local diagnostics runtime.

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

## Phase 4C Runtime API Compatibility

Phase 4C adds runtime-named API aliases without removing legacy Codex API fields:

- `GET /api/conversations/:conversationId/runtime-status`
- `GET /api/conversations/:conversationId/runtime-sessions`
- `POST /api/conversations/:conversationId/runtime-sessions`
- `POST /api/conversations/:conversationId/runtime-sessions/:sessionRecordId/activate`
- `PATCH /api/conversations/:conversationId/runtime-sessions/:sessionRecordId`
- `POST /api/conversations/:conversationId/runtime-sessions/:sessionRecordId/archive`
- `GET /api/runtime/jobs/:jobId`
- `GET /api/runtime/jobs/:jobId/events`
- `GET /api/runtime/jobs/:jobId/events/stream`
- `POST /api/runtime/jobs/:jobId/cancel`
- `POST /api/runtime/jobs/:jobId/retry`
- `GET /api/runtime/profiles`

The compatibility view maps current Codex-backed fields into runtime names:

- `codex_session_id` -> `externalSessionId`
- `codex_project_path` -> `projectPath`
- `codex_home_dir` -> `runtimeHomeDir`
- `codex_session_id_before/after` -> `externalSessionIdBefore/After`

The database keeps `codex_session_records` as the source table and adds compatibility columns for later migration: `runtime_kind`, `external_session_id`, `runtime_home_dir`, and `runtime_config_json`.

## Runtime Implementations

Runtime runners should implement `AgentRunner` without modifying OpenIM webhook ingestion, job repositories, or OpenIM reply writing:

- `codex_cli`: call Codex CLI through `SpawnCodexCliAdapter`, maintain external session id.
- `openai_compatible`: call `/v1/chat/completions`, return final assistant text, no external session in v1.
- `openhands`: Phase 4E spike stub; recognized by config but returns unsupported until a real REST/API adapter is implemented.
- `template`: deterministic local smoke/runtime stub for diagnostics.

New runtime session tables and Electron Runtime UI migration belong to later phases.
