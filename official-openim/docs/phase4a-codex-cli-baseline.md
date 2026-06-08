# Phase 4A Codex CLI Baseline

Generated at: 2026-06-08T18:05:20+08:00
Updated at: 2026-06-08T18:48:45+08:00

## Environment

- Repository: `leon-test10/openim-agent`
- Bridge directory: `official-openim/openim-codex-bridge`
- Host layout: Windows host for `openim-codex-bridge` and Codex CLI; Docker for OpenIM.
- Codex CLI: `codex-cli 0.134.0`
- Bridge package: `openim-codex-bridge@0.1.0`

## Commands Verified

From `official-openim/openim-codex-bridge`:

```powershell
npm run build
npm test
```

Latest fresh results:

- `npm run build`: passed.
- `npm test`: passed, 67 tests across 15 test files after Phase 4B edits.

## OpenIM Docker / Bootstrap Status

Baseline commands:

```powershell
cd D:\agent_trial\claude_code\official-openim\openim-docker
docker compose up -d

cd D:\agent_trial\claude_code\official-openim
.\deploy\windows\bootstrap-openim-bridge.ps1
.\deploy\windows\stop-bridge.ps1
.\deploy\windows\start-bridge.ps1
curl http://127.0.0.1:8787/healthz
.\deploy\windows\smoke-e2e.ps1
```

Current run status after Docker recovery:

- Docker Desktop recovered after `wsl --shutdown` and restarting `D:\Docker\Docker Desktop.exe`.
- Kafka was not listening on `9092/9094`; `openim-server` was failing readiness because it could not connect to Kafka.
- The local Kafka data directory was moved to `openim-docker/components/kafka.backup.20260608-184123`, then Kafka was reinitialized.
- `docker compose ps`: returned successfully.
- `openim-server`: healthy.
- `openim-chat`: healthy.
- `bootstrap-openim-bridge.ps1`: completed; bot/test-user registration returned expected existing-account style codes.
- Bridge `/healthz`: returned `ok: true`.
- `smoke-e2e.ps1`: reached bridge job creation, but the runtime job failed inside Codex CLI authentication.

Latest smoke failure:

- Job id: `job_93b8e3ea-37cd-444d-a797-76b0cc33f816`
- Job status: `failed`
- Root cause: Codex CLI auth expired, with `401 Unauthorized`, `token_expired`, and `refresh_token_reused`.
- Required action before full Phase 4A signoff: refresh Codex CLI login state with `codex logout` / `codex login` for the base home used to seed bridge session homes, then rerun `.\deploy\windows\smoke-e2e.ps1`.

## Automated Regression Coverage

The bridge test suite covers the non-Docker baseline paths:

- OpenIM webhook parsing and filtering.
- Semantic event ingestion.
- Runtime job queue/status/cancel/retry behavior.
- Session rebind/archive lifecycle constraints.
- Runtime event persistence.
- Prompt/context construction.
- OpenIM reply sender invocation via fake sender.

Phase 4B adds a dedicated vertical-slice integration test for:

- webhook -> semantic event -> queued job -> injected runtime runner -> runtime events -> OpenIM reply.
- bot self-message, `ex.agent.generated_by=codex`, and non-text messages do not invoke the runner or create jobs.

## Known Gaps Before Full Phase 4A Signoff

- `smoke-e2e.ps1` is blocked by Codex CLI authentication, not by OpenIM container health or bridge ingestion.
- Manual OpenIM client message `请回复：HELLO_OPENIM_CODEX` has not been completed after auth recovery.
- Cancel/retry/rebind/archive manual regression still needs to be run against a successfully authenticated Codex CLI.

## Phase 4B Entry Condition

The code-level bridge baseline is sufficient for Phase 4B implementation because build and tests pass and existing integration tests exercise the worker/job/API paths. Full operational Phase 4A signoff still requires a successful Docker/OpenIM smoke run after Codex CLI authentication is refreshed.
