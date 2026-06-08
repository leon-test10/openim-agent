# openim-codex-bridge API Contract

This contract aligns the bridge HTTP API with `openim-electron-demo/src/api/codexBridge.ts`.
Electron must call the bridge only over HTTP/SSE. It must not spawn or invoke Codex CLI directly.

## Meta

`GET /healthz`

Returns `{ ok: true, ...meta }`.

`GET /api/meta`

Returns bridge name, version, `apiVersion`, capabilities, `runtimePolicy`, and
`projectPathPolicy.allowlist`.

Capabilities include Phase 4 `semanticContext` when the bridge supports semantic event import,
context preview, and manual summary endpoints.

## Conversations

`GET /api/conversations/:conversationId/status`

Returns UI state for one OpenIM conversation:

- `state`
- `activeSession`
- `activeJob`
- `latestJob`
- `recentJobs`
- `queuedJobCount`
- `pendingHistoryImport`

`GET /api/conversations/:conversationId/events/stream`

Conversation-level Server-Sent Events. Electron should prefer this stream and use 2s polling only
after stream setup/error fallback.

Events:

- `job_created`
- `job_queued`
- `job_started`
- `runtime_event`
- `job_succeeded`
- `job_failed`
- `job_cancelled`
- `session_changed`
- `binding_changed`
- `history_import_requested`

Event data shape:

```json
{
  "id": 1,
  "conversationId": "single:codex_bot:user_1",
  "type": "runtime_event",
  "createdAt": 1780900000000,
  "payload": {}
}
```

## Bindings

`GET /api/bindings`

Lists active bindings.

`GET /api/bindings/:conversationId`

Returns one binding detail with active session, all sessions, active/latest job, and recent jobs.

`POST /api/bindings/:conversationId/rebind`

Creates a new active binding. Body:

```json
{
  "openimDisplayUserId": "user_1",
  "codexProjectPath": "/workspace/openim-demo",
  "codexSessionId": "optional-existing-session-id",
  "runtimeProfileId": "optional-profile-id"
}
```

Rejected with `409 active_job_exists` while a job is queued, running, or cancelling. `codexProjectPath`
must pass the backend allowlist policy.

`POST /api/bindings/:conversationId/archive`

Archives the active binding. Rejected with `409 active_job_exists` while active work exists.

## Sessions

`GET /api/conversations/:conversationId/codex-sessions?includeArchived=true&includeDeleted=false`

Lists session records.

`POST /api/conversations/:conversationId/codex-sessions`

Creates and activates a new session record. Body accepts `openimDisplayUserId`, `codexProjectPath`,
`displayName`, and `runtimeProfileId`. `codexProjectPath` is backend allowlist validated.

`POST /api/conversations/:conversationId/codex-sessions/:sessionRecordId/activate`

Activates an existing non-archived session.

`PATCH /api/conversations/:conversationId/codex-sessions/:sessionRecordId`

Renames a session. Body: `{ "displayName": "..." }`.

`POST /api/conversations/:conversationId/codex-sessions/:sessionRecordId/archive`

Archives a session.

`POST /api/conversations/:conversationId/codex-sessions/:sessionRecordId/restore`

Restores an archived session as inactive.

`DELETE /api/conversations/:conversationId/codex-sessions/:sessionRecordId`

Soft-deletes a session.

`GET /api/conversations/:conversationId/codex-sessions/:sessionRecordId/diagnostics`

Returns resume diagnostics plus `projectPathValidation` diagnostics.

## Jobs

`GET /api/jobs/:jobId`

Returns one runtime job.

`GET /api/jobs/:jobId/events?after=0`

Returns persisted runtime events for one job.

`GET /api/jobs/:jobId/events/stream?after=0`

Legacy job-level SSE retained for compatibility. New Electron code should prefer conversation-level
SSE.

`POST /api/jobs/:jobId/cancel`

Cancels queued/running jobs. Terminal jobs are returned unchanged.

`POST /api/jobs/:jobId/retry`

Creates a retry job from a terminal source job.

## Runtime Profiles

`GET /api/runtime-profiles?includeDeleted=false`

Lists profiles. `apiKey` is never returned. `apiKeyMasked` may be returned. `codexHomeOverride` is
returned only when backend policy allows dev/admin visibility.

`POST /api/runtime-profiles`

Creates a profile. Backend policy validates mutation rights and unsafe fields.

`PATCH /api/runtime-profiles/:profileId`

Updates a profile. Backend policy validates mutation rights and unsafe fields.

`DELETE /api/runtime-profiles/:profileId`

Soft-deletes a profile. Backend policy validates mutation rights.

`POST /api/runtime-profiles/:profileId/test`

Runs optional upstream/Codex probes. Backend policy validates mutation/test rights. Returned probe
environment redacts keys and tokens.

Production policy:

- `danger-full-access` is disabled unless the request is backend-admin authorized.
- `codexHomeOverride` is hidden unless dev/admin.
- Runtime profile mutation is rejected when production admin authorization is configured and missing.
- API keys are encrypted at rest and never returned to Electron.

Admin authorization header:

```http
x-codex-admin-token: <CODEX_RUNTIME_ADMIN_TOKEN>
```

## OpenIM History

`POST /api/conversations/:conversationId/openim-history-snapshots`

Uploads an Electron SDK history snapshot after a bridge `history_import_requested` event/status.
The raw snapshot is retained, and supported text messages are imported into `semantic_events`.

Response:

```json
{
  "conversationID": "single:codex_bot:user_1",
  "receivedCount": 3,
  "importedCount": 2,
  "skippedDuplicateCount": 1,
  "skippedUnsupportedCount": 0,
  "earliestTimestamp": 1780900000000,
  "latestTimestamp": 1780900010000,
  "importedEventIDs": ["evt_..."],
  "messageCount": 3,
  "snapshotId": "hist_...",
  "requestId": "hist_req_..."
}
```

Only text content type `101` is imported into prompt context in Phase 4. Unsupported messages are
counted but skipped.

## Semantic Context

`GET /api/conversations/:conversationId/semantic-events?limit=200&includeRuntime=false`

Returns normalized semantic events for a conversation. OpenIM webhook messages, imported history
messages, bridge runtime notices, and Codex bot replies share this model.

`GET /api/conversations/:conversationId/context/preview?includePrompt=true&recentLimit=30`

Returns the context builder diagnostics used to explain prompt construction:

- `summaryIncluded`
- `recentEventCount`
- `includedEventIDs`
- `skippedReasons`
- `roleCounts`
- `actorCounts`
- `promptPreview` when requested
- `promptRedacted`

`GET /api/conversations/:conversationId/context/summary`

Returns the current rolling summary, or `null`.

`POST /api/conversations/:conversationId/context/summarize?recentLimit=30`

Creates or updates a deterministic rolling summary over events older than the recent window.
Automatic summary is disabled by default.

Prompt input is built from conversation metadata, binding/session metadata, rolling summary, recent
semantic events, and the current user message. API keys, tokens, and runtime profile secrets must
not appear in prompt previews.

## Project Path Policy

All session creation/rebind paths are validated server-side:

- allow only workspaces in `CODEX_WORKSPACE_ALLOWLIST`
- reject paths containing `..`
- reject paths outside the allowlist
- return/write validation diagnostics through API errors and session diagnostics

## Electron UI Boundaries

- `SingleSetting` remains OpenIM-native only.
- `ChatHeader` owns `CodexStatusBadge` and the activity drawer entry.
- `CodexActivityDrawer` owns Codex detailed operations.
- `ChatFooter` shows only lightweight running/queued/cancel status.
- Electron never calls Codex CLI directly.

## Manual Smoke Checklist

- Open the `codex_bot` conversation.
- Send a normal OpenIM message.
- Confirm bridge creates a job.
- Confirm Electron shows queued/running.
- Cancel the job.
- Retry the job.
- Create a session.
- Activate a session.
- Upload a history snapshot.
- Run runtime profile test.
- Confirm `SingleSetting` has no Codex binding/profile/session controls.
- Confirm Electron has no direct Codex CLI invocation.
- Open context preview and confirm imported history, assistant bot replies, role counts, and
  redacted prompt preview.
