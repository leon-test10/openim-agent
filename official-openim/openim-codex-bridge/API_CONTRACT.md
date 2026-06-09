# openim-codex-bridge API Contract

This contract aligns the bridge HTTP API with `openim-electron-demo/src/api/codexBridge.ts`.
Electron must call the bridge only over HTTP/SSE. It must not spawn or invoke Codex CLI directly.

## Meta

`GET /healthz`

Returns `{ ok: true, ...meta }`.

`GET /api/meta`

Returns bridge name, version, `apiVersion`, active `runtimeKind`, capabilities, `runtimePolicy`, and
`projectPathPolicy.allowlist`.

Capabilities include Phase 4 `semanticContext` when the bridge supports semantic event import,
context preview, and manual summary endpoints. Phase 4C also exposes `runtimeApi` and
`codexLegacyApi`. Phase 4D exposes `openaiCompatibleRuntime`.

`GET /api/meta` also returns read-only `groupBotPolicy` diagnostics:

- `enabled`
- `autoReplyPolicy`
- `groupAllowlist`
- `senderAllowlist`
- `requireBinding`
- `boundGroups`

`boundGroups` lists group ids only; group binding project paths are not returned in metadata.

## OpenIM Webhooks

`POST /webhooks/openim/after-send-single-msg`

Consumes OpenIM `afterSendSingleMsg` callbacks. Accepted text messages are ingested into
`semantic_events` before agent decision/job creation. Existing loop guards remain in force:
non-bot receivers, bot sender messages, `ex.agent.generated_by=codex`, non-text messages, and empty
text do not create runtime jobs.

`POST /webhooks/openim/after-send-single-msg/:command`

Compatibility route for OpenIM deployments that append callback command paths to the configured
webhook URL. `callbackAfterSendGroupMsgCommand` is routed through the group handler.

`POST /webhooks/openim/after-send-group-msg`

Consumes OpenIM `afterSendGroupMsg` callbacks. Group semantic events preserve `groupID`, speaker
`sendID`, and the group conversation id. Group runtime jobs are disabled unless
`OPENIM_GROUP_BOT_ENABLED=true`.

When group bot execution is enabled, Phase 5A still only creates jobs for text messages addressed to
`OPENIM_BOT_USER_ID`, such as `@codex_bot ...`. Non-mentioned group messages return
`group_message_not_addressed_to_bot`; disabled group traffic returns `group_bot_disabled`.

Phase 5C also permits quote/reply triggers: if a group message has no textual mention but its
OpenIM quote/reply payload references a message sent by `OPENIM_BOT_USER_ID`, the bridge may create
a runtime job. This trigger is persisted as semantic event metadata
`{ "groupTrigger": "reply_to_bot" }`.

Phase 5B group permission policy is enforced server-side:

- `OPENIM_GROUP_ALLOWLIST` optionally restricts allowed `groupID` values.
- `OPENIM_GROUP_SENDER_ALLOWLIST` optionally restricts allowed speaker `sendID` values.
- Both settings accept comma or semicolon separated ids.
- Empty allowlists mean no extra allowlist restriction.

Denied group messages are still ingested into `semantic_events`, but do not create jobs. Rejection
reasons are `group_not_allowed` and `group_sender_not_allowed`.

Phase 5D group binding policy is enforced server-side:

- `OPENIM_GROUP_PROJECT_BINDINGS` maps `groupID` to project path with entries like
  `group_1=/workspace/project-a;group_2=/workspace/project-b`.
- `OPENIM_GROUP_REQUIRE_BINDING=true` rejects group runtime jobs without an explicit binding.
- Bound project paths must pass the backend `CODEX_WORKSPACE_ALLOWLIST` policy.

Messages rejected by required binding are still semantic events and return `group_binding_required`.

Phase 5E group auto-reply policy is enforced server-side with `OPENIM_GROUP_AUTO_REPLY_POLICY`:

- `mention_or_reply`: mentions and quote/replies can create jobs.
- `mention_only`: only textual bot mentions can create jobs.
- `reply_only`: only quote/replies to bot output can create jobs.
- `disabled`: group messages are ingested but do not create jobs.

Disabled policy returns `group_auto_reply_disabled`. Policies that exclude the observed trigger
return `group_message_not_addressed_to_bot`.

`POST /webhooks/openim/after-send-group-msg/:command`

Compatibility route for suffixed OpenIM group callback command paths.

## Group Policy Diagnostics

`POST /api/group-policy/preview`

Read-only diagnostic endpoint for a candidate OpenIM `afterSendGroupMsg` payload. The request body
may be the raw callback payload or `{ "payload": { ... } }`.

The endpoint reuses the production group parser, trigger policy, allowlist policy, group binding
policy, and project path allowlist validation, but it does not write `semantic_events`, create
runtime jobs, send OpenIM replies, or call any runtime.

Response fields:

- `wouldCreateJob`: whether the same payload would reach runtime job creation under current policy.
- `reason`: `would_create_job`, an agent decision reason such as `group_sender_not_allowed`, a
  binding reason such as `group_binding_required`, or `project_path_not_allowed`.
- `decision`: the direct `shouldCreateRuntimeJob` result.
- `event`: parsed group conversation, group, sender, content type, event type, and trigger metadata.
- `policy`: whether group bot, allowlists, auto-reply policy, and binding requirement are configured.
- `binding`: whether binding was evaluated, whether the group has a configured binding, and whether
  the default project would be used.
- `projectPathPolicy`: redacted allowlist validation result. It reports boolean diagnostics and
  reasons only; configured project paths are not returned.

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

`GET /api/conversations/:conversationId/runtime-status`

Runtime-named equivalent for new clients. Returns:

- `runtimeKind`: `codex_cli`, `template`, `openai_compatible`, or spike-only `openhands`
- `activeSession` as `RuntimeSessionView`
- `activeJob`, `latestJob`, and `recentJobs` as runtime job views
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

`GET /api/conversations/:conversationId/runtime-sessions?includeArchived=true&includeDeleted=false`

Lists session records as runtime views. Runtime view field mapping:

- `runtimeKind`: `codex_cli` by default, `template`, `openai_compatible`, or `openhands` when configured
- `externalSessionId`: legacy `codexSessionId` for `codex_cli`; `null` for stateless non-Codex runtimes
- `projectPath`: legacy `codexProjectPath`
- `runtimeHomeDir`: legacy `codexHomeDir`
- `legacyCodex`: original Codex-specific fields retained for migration/debugging

New session records persist their creation-time `runtimeKind` in `codex_session_records.runtime_kind`.
Runtime views normally report the active bridge runtime, while the stored field remains available on
legacy session objects for migration/debugging.

`POST /api/conversations/:conversationId/codex-sessions`

Creates and activates a new session record. Body accepts `openimDisplayUserId`, `codexProjectPath`,
`displayName`, and `runtimeProfileId`. `codexProjectPath` is backend allowlist validated.

`POST /api/conversations/:conversationId/runtime-sessions`

Creates and activates a new runtime session view. Body accepts `openimDisplayUserId`, `projectPath`
or `codexProjectPath`, `displayName`, and `runtimeProfileId`. The project path is backend allowlist
validated.

`POST /api/conversations/:conversationId/codex-sessions/:sessionRecordId/activate`

Activates an existing non-archived session.

`POST /api/conversations/:conversationId/runtime-sessions/:sessionRecordId/activate`

Runtime-named activation alias. Rejected with `409 active_job_exists` while active work exists.

`PATCH /api/conversations/:conversationId/codex-sessions/:sessionRecordId`

Renames a session. Body: `{ "displayName": "..." }`.

`PATCH /api/conversations/:conversationId/runtime-sessions/:sessionRecordId`

Runtime-named rename alias. Body: `{ "displayName": "..." }`.

`POST /api/conversations/:conversationId/codex-sessions/:sessionRecordId/archive`

Archives a session.

`POST /api/conversations/:conversationId/runtime-sessions/:sessionRecordId/archive`

Runtime-named archive alias. Rejected with `409 active_job_exists` while active work exists.

`POST /api/conversations/:conversationId/codex-sessions/:sessionRecordId/restore`

Restores an archived session as inactive.

`DELETE /api/conversations/:conversationId/codex-sessions/:sessionRecordId`

Soft-deletes a session.

`GET /api/conversations/:conversationId/codex-sessions/:sessionRecordId/diagnostics`

Returns resume diagnostics plus `projectPathValidation` diagnostics.

## Jobs

`GET /api/jobs/:jobId`

Returns one runtime job.

`GET /api/runtime/jobs/:jobId`

Returns one runtime job view. Adds `runtimeKind`, `externalSessionIdBefore`,
`externalSessionIdAfter`, and `legacyCodex`.

New runtime jobs persist their creation-time `runtimeKind` in `runtime_jobs.runtime_kind`, and retry
jobs copy the source job runtime kind. Runtime job views can therefore report historical job runtime
kind even after the bridge default runtime changes.

`GET /api/jobs/:jobId/events?after=0`

Returns persisted runtime events for one job.

`GET /api/runtime/jobs/:jobId/events?after=0`

Runtime-named equivalent with `runtimeKind` metadata.

`GET /api/jobs/:jobId/events/stream?after=0`

Legacy job-level SSE retained for compatibility. New Electron code should prefer conversation-level
SSE.

`GET /api/runtime/jobs/:jobId/events/stream?after=0`

Runtime-named job event SSE equivalent.

`POST /api/jobs/:jobId/cancel`

Cancels queued/running jobs. Terminal jobs are returned unchanged.

`POST /api/runtime/jobs/:jobId/cancel`

Runtime-named cancel alias.

`POST /api/jobs/:jobId/retry`

Creates a retry job from a terminal source job.

`POST /api/runtime/jobs/:jobId/retry`

Runtime-named retry alias.

## Runtime Profiles

`GET /api/runtime-profiles?includeDeleted=false`

Lists profiles. `apiKey` is never returned. `apiKeyMasked` may be returned. `codexHomeOverride` is
returned only when backend policy allows dev/admin visibility.

`GET /api/runtime/profiles?includeDeleted=false`

Read-only runtime-named profile alias. Mutations stay on `/api/runtime-profiles` in Phase 4C.

## Template Runtime

Set `RUNTIME_DEFAULT_KIND=template` to route bridge jobs through a deterministic local runner for
smoke diagnostics. This runner does not call Codex CLI, OpenAI-compatible APIs, OpenHands, or any
external process.

Environment:

```env
TEMPLATE_RUNTIME_RESPONSE_PREFIX=TEMPLATE_ACK
```

The runner emits `template.request_started`, `template.response_completed`, and
`template.request_cancelled` runtime events. Successful jobs return
`{prefix}: {normalized current input}` and have `externalSessionId=null`.

## OpenAI-Compatible Runtime

Set `RUNTIME_DEFAULT_KIND=openai_compatible` to route bridge jobs to an OpenAI-compatible
`/v1/chat/completions` endpoint instead of Codex CLI.

Environment:

```env
OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:8000/v1
OPENAI_COMPATIBLE_API_KEY=dummy
OPENAI_COMPATIBLE_MODEL=Qwen/Qwen2.5-Coder-32B-Instruct
OPENAI_COMPATIBLE_TIMEOUT_MS=120000
OPENAI_COMPATIBLE_TEMPERATURE=0.2
OPENAI_COMPATIBLE_MAX_TOKENS=2048
```

The first implementation is stateless: `externalSessionId`, `runtimeHomeDir`, and Codex resume
fields are not used by this runner.

## OpenHands Spike

`RUNTIME_DEFAULT_KIND=openhands` is recognized for Phase 4E spike work, but the current
`OpenHandsRunner` intentionally returns `ok: false` and does not submit remote tasks. See
`../docs/openhands-spike.md` for the required adapter contract before enabling real execution.

Environment:

```env
OPENHANDS_BASE_URL=http://127.0.0.1:3000
OPENHANDS_API_KEY=
OPENHANDS_TIMEOUT_MS=600000
```

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

Phase 4 semantic context is a supplement layer, not a replacement for Codex CLI runtime context.
Codex CLI remains the primary manager for session resume, transcript continuation, and internal
compaction. For a normal resumed Codex session, the bridge sends only the current user message.
The bridge includes OpenIM semantic context only when one of these supplement triggers applies:

- new Codex session without prior runtime context
- session switch, rebind, or resume gap
- user explicitly asks to use previous OpenIM chat history
- imported OpenIM history has not yet been delivered to the active session/job
- group speaker-aware context is needed
- diagnostics or prompt preview is requested

Each semantic event may carry delivery metadata:

- `deliveredJobId`
- `deliveredSessionRecordId`
- `deliveredCodexSessionId`
- `deliveredAt`
- `deliveryReason`

Imported history is considered undelivered until it is included in a semantic-context supplement
for the active session record.

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
- `semanticContextIncluded`
- `semanticContextReason`
- `promptPreview` when requested
- `promptRedacted`

`GET /api/conversations/:conversationId/context/summary`

Returns the current rolling summary, or `null`.

`POST /api/conversations/:conversationId/context/summarize?recentLimit=30`

Creates or updates a deterministic manual summary over events older than the recent window.
Automatic model-based rolling summary is not enabled by default and is intentionally separate from
Codex CLI's own session compaction.

When a supplement trigger applies, prompt input is built from conversation metadata,
binding/session metadata, rolling summary, recent semantic events, undelivered imported history,
and the current user message. API keys, tokens, and runtime profile secrets must not appear in
prompt previews.

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
