# openim-codex-bridge

Service-side bridge that connects an OpenIM single chat with a Codex CLI runtime session.

```text
OpenIM conversation -> openim-codex-bridge -> Codex CLI session
Codex CLI output -> openim-codex-bridge -> OpenIM /msg/send_msg
```

The MVP intentionally does not modify the OpenIM Electron client and does not implement its own agent runtime. Codex CLI remains responsible for coding-agent behavior, tool use, session resume, and future agent features. The bridge owns only OpenIM webhook ingestion, filtering, queueing, session-record selection, Codex CLI invocation, and OpenIM reply writing.

## Requirements

- Node.js 24+
- OpenIMServer with `/msg/send_msg` reachable from this service
- An OpenIM bot or notification account, for example `codex_bot`
- Codex CLI installed and logged in on the bridge host
- A project path accessible to Codex CLI, configured as `CODEX_DEFAULT_PROJECT_PATH`

The local Codex CLI checked during implementation was `codex-cli 0.134.0`. Its non-interactive commands support:

```bash
codex exec --cd <projectPath> --json -
codex exec --cd <projectPath> resume --json <sessionId> -
```

The prompt is sent on stdin. If your Codex CLI version differs, check:

```bash
codex exec --help
codex exec resume --help
```

`codex exec` does not currently expose a stable command such as `codex exec cancel <jobId>`.
Bridge job cancellation is therefore implemented as a local process-level best-effort interrupt:
the bridge first tries to interrupt the active `codex exec` process, then force-kills the process
tree after a short grace period. This cancels a bridge runtime job, not an OpenIM conversation and
not a Codex Cloud task.

## Setup

```bash
cd openim-codex-bridge
cp .env.example .env
npm install
npm run dev
```

Check the service:

```bash
curl http://localhost:8787/healthz
```

Expected response:

```json
{"ok":true}
```

## Repeatable Local Deployment On Windows

This repository includes deployment helpers for the tested local layout:

```text
Windows host: openim-codex-bridge + Codex CLI
Docker: OpenIMServer and OpenIM dependencies
```

Use the local OpenIM defaults:

```powershell
cd openim-codex-bridge
Copy-Item .env.local.example .env
npm install
npm run build
```

Start OpenIM from the checked-out `openim-docker` directory:

```powershell
cd ..\openim-docker
docker compose up -d
```

Bootstrap the OpenIM side from the repo root:

```powershell
.\deploy\windows\bootstrap-openim-bridge.ps1
```

The bootstrap script:

- fetches an OpenIM admin token with `imAdmin/openIM123`
- creates or confirms `codex_bot`
- creates or confirms `bridge_user_1`
- copies `deploy/openim/webhooks.yml` into `openim-server`
- restarts `openim-server` and waits for health

Start and stop the bridge:

```powershell
.\deploy\windows\start-bridge.ps1
.\deploy\windows\stop-bridge.ps1
```

Run the repeatable smoke test:

```powershell
.\deploy\windows\smoke-e2e.ps1
```

The smoke test sends an OpenIM single-chat message from `bridge_user_1` to `codex_bot`, waits for the runtime job, and verifies the Codex output text.

## Environment

```dotenv
PORT=8787

OPENIM_API_BASE_URL=http://127.0.0.1:10002
OPENIM_ADMIN_USER_ID=imAdmin
OPENIM_ADMIN_SECRET=
OPENIM_ADMIN_TOKEN=
OPENIM_BOT_USER_ID=codex_bot

CODEX_BIN=codex
CODEX_DEFAULT_PROJECT_PATH=/workspace/openim-demo
CODEX_DEFAULT_MODEL=
CODEX_EXEC_TIMEOUT_MS=600000
CODEX_SESSION_HOME_ROOT=./data/codex-homes
CODEX_SESSION_HOME_MODE=per-session
CODEX_SESSION_HOME_SEED_MODE=copy-auth-only
CODEX_BASE_HOME=
CODEX_SANDBOX_MODE=

DATABASE_URL=file:./data/openim-codex-bridge.sqlite
LOG_LEVEL=info
```

Set either `OPENIM_ADMIN_TOKEN` or `OPENIM_ADMIN_SECRET`. If `OPENIM_ADMIN_TOKEN` is present, the bridge uses it directly. Otherwise it attempts to fetch an admin token from `/auth/get_admin_token`.

## OpenIM Webhook

Configure OpenIM `afterSendSingleMsg` callback URL:

```text
http://<bridge-host>:8787/webhooks/openim/after-send-single-msg
```

When OpenIM is running in Docker and the bridge is running on the Windows host, use:

```text
http://host.docker.internal:8787/webhooks/openim/after-send-single-msg
```

OpenIM v3.8 appends the callback command path, for example
`/callbackAfterSendSingleMsgCommand`, to the configured callback URL. The bridge accepts both the
base path and the suffixed command path.

The persistent callback template for this local deployment is tracked at:

```text
deploy/openim/webhooks.yml
```

If the `openim-server` container is recreated, run `deploy/windows/bootstrap-openim-bridge.ps1`
again to reapply this config.

The webhook handler returns immediately after writing a semantic event and queueing a runtime job. Codex execution runs outside the callback request.

MVP filtering rules:

- ignore when `recvID` is not `OPENIM_BOT_USER_ID`
- ignore when `sendID` is `OPENIM_BOT_USER_ID`
- ignore when `ex.agent.generated_by` is `codex`
- ignore non-text messages; text content type is `101`

## Session Model

The bridge supports one OpenIM conversation with multiple Codex session records. Only one record is active at a time.

On the first accepted message, the bridge creates an active session record with no `codex_session_id`. After the first Codex run returns a session id, the record is updated. Later messages resume that active Codex session.

Fork/rebind is only modeled for future use with reserved source fields. MVP does not expose IM-triggered fork and does not share one Codex session across OpenIM conversations.

Each session record can also own an isolated Codex runtime home. With the default
`CODEX_SESSION_HOME_MODE=per-session`, new records get a stable `codexHomeDir`
under `CODEX_SESSION_HOME_ROOT`; the worker sets `CODEX_HOME` to that directory
when spawning `codex exec`. The default seed mode copies only auth seed files
from `CODEX_BASE_HOME` or the user's global `.codex` directory, and does not copy
global logs, history, caches, or plugin runtime output.

Set `CODEX_SANDBOX_MODE=read-only` or `CODEX_SANDBOX_MODE=workspace-write` to
pass an explicit `--sandbox` value to `codex exec`. Leave it blank to use the
Codex CLI default.

Cancelling a job does not archive or clear the active session record. If the bridge has already
saved a `codex_session_id`, the next accepted message resumes that session. If a first run is
cancelled before Codex emits a session id, the next accepted message starts a new session.

## API

```http
GET /healthz
GET /api/bindings
GET /api/bindings/:conversationId
POST /api/bindings/:conversationId/rebind
POST /api/bindings/:conversationId/archive
GET /api/jobs/:jobId
GET /api/jobs/:jobId/events
GET /api/jobs/:jobId/events/stream
POST /api/jobs/:jobId/cancel
POST /api/jobs/:jobId/retry
GET /api/conversations/:conversationId/status
GET /api/conversations/:conversationId/codex-sessions
POST /api/conversations/:conversationId/codex-sessions
POST /api/conversations/:conversationId/codex-sessions/:sessionRecordId/activate
```

List active OpenIM conversation bindings:

```bash
curl http://localhost:8787/api/bindings
```

Get one conversation binding with all session records and recent jobs:

```bash
curl "http://localhost:8787/api/bindings/single%3Acodex_bot%3Auser_1"
```

Rebind a conversation to a new active Codex session record:

```bash
curl -X POST "http://localhost:8787/api/bindings/single%3Acodex_bot%3Auser_1/rebind" \
  -H "content-type: application/json" \
  -d '{"codexProjectPath":"/workspace/openim-demo","codexSessionId":"optional-existing-session-id"}'
```

Archive the active binding:

```bash
curl -X POST "http://localhost:8787/api/bindings/single%3Acodex_bot%3Auser_1/archive"
```

Rebind and archive are rejected with HTTP 409 while a job for that conversation is queued,
running, or cancelling. Archiving clears the active binding but keeps historical session records.
The next accepted OpenIM message will auto-create a fresh active session record.

Get UI-friendly conversation runtime status:

```bash
curl "http://localhost:8787/api/conversations/single%3Acodex_bot%3Auser_1/status"
```

Status responses include `queuedJobCount`, so Electron can explain that messages sent while Codex
is running will be queued and executed serially after the active job finishes.

Get visible Codex runtime events for a job:

```bash
curl "http://localhost:8787/api/jobs/<jobId>/events"
curl "http://localhost:8787/api/jobs/<jobId>/events?after=3"
```

Subscribe to runtime events with Server-Sent Events:

```bash
curl -N "http://localhost:8787/api/jobs/<jobId>/events/stream"
```

The bridge records Codex CLI `--json` JSONL events as `runtime_events`. These are intended for
status, tool-call, command, stderr/stdout-summary, and final-message UI. They are not hidden model
reasoning.

Cancel a queued or running runtime job:

```bash
curl -X POST http://localhost:8787/api/jobs/<jobId>/cancel
```

Cancellation semantics:

- `queued` jobs become `cancelled` and are skipped by the worker
- `running` jobs become `cancelling`, then `cancelled` after the Codex process exits
- terminal jobs (`succeeded`, `failed`, `cancelled`) are returned unchanged
- timeouts use the same process termination path but are recorded as failures, not user cancels

Retry a terminal runtime job:

```bash
curl -X POST http://localhost:8787/api/jobs/<jobId>/retry
```

Retry semantics:

- only terminal jobs can be retried
- the original job is kept as history
- the new job copies the original `semanticEventId` and `inputText`
- the new job uses the current active session for the conversation
- the new job records `retryOfJobId`

Failed jobs record `failureReason`:

- `codex_exit`: Codex CLI returned a non-zero or unsuccessful result
- `timeout`: Codex CLI exceeded `CODEX_EXEC_TIMEOUT_MS`
- `bridge_error`: bridge worker threw an internal runtime error
- `openim_send_failed`: Codex completed or failed, but OpenIM reply writing failed
- `missing_session`: the job's session record was missing

Status state is derived as:

- `unknown`: no active session record exists for this conversation
- `idle`: an active session exists but no jobs exist yet
- `queued`: a queued job exists for the conversation
- `running`: a running job exists for the conversation
- `cancelling`: a running job is being interrupted
- `completed`: latest terminal job succeeded
- `failed`: latest terminal job failed

When the latest job was cancelled and no job is active, the conversation state is `idle`; clients
should inspect `latestJob.status == "cancelled"` to display the last cancellation.

Job objects returned from binding/status APIs include UI helper fields:

- `runningForMs`
- `totalDurationMs`
- `canCancel`
- `canRetry`

Create an additional inactive session record:

```bash
curl -X POST http://localhost:8787/api/conversations/single:codex_bot:user_1/codex-sessions \
  -H "content-type: application/json" \
  -d '{"openimDisplayUserId":"user_1","codexProjectPath":"/workspace/openim-demo"}'
```

Activate one session record:

```bash
curl -X POST http://localhost:8787/api/conversations/single:codex_bot:user_1/codex-sessions/<sessionRecordId>/activate
```

## Codex CLI sandbox diagnostics

The bridge should not change global Codex configuration while diagnosing Windows sandbox behavior.
Use the diagnostic script to capture CLI version/help, environment, raw JSONL, stderr, and exit
codes for read-only and workspace-write modes:

```powershell
..\deploy\windows\diagnose-codex-cli.ps1 `
  -ProjectPath D:\agent_trial\claude_code\official-openim `
  -OutputDir D:\agent_trial\claude_code\official-openim\diagnostics\codex-cli `
  -CodexHomeDir D:\agent_trial\claude_code\official-openim\diagnostics\codex-home-isolated `
  -SeedMode copy-auth-only
```

The script writes diagnostics under `diagnostics/codex-cli`, optionally runs with
an isolated `CODEX_HOME`, and restores the original process environment when it
finishes. It does not edit the global Codex home.

## Development

```bash
npm test
npm run build
```

The tests cover message filtering, prompt construction, Codex JSONL parsing, runtime event persistence, OpenIM callback parsing, job cancellation, and SQLite persistence for semantic events, session records, and runtime jobs.
