# Phase 5 Group Bot Baseline

Generated at: 2026-06-09T22:10:00+08:00

## Scope

Phase 5 prepares group chat bot execution on the bridge backend without changing Electron or the
OpenIM native send path.

This baseline verifies:

- Group callbacks are ingested as semantic events.
- Group runtime job creation is disabled by default.
- Mentions and quote/replies are the only supported triggers.
- Group and sender allowlists are enforced server-side.
- Group project bindings are enforced before runtime job creation.
- Project paths still pass `CODEX_WORKSPACE_ALLOWLIST`.
- Group policy diagnostics do not expose bound project paths.
- Electron still does not call Codex CLI directly.

This baseline does not verify:

- Production group rollout.
- Multi-agent behavior.
- New Electron group UI.
- OpenHands production runtime.
- vLLM/Ollama group-specific behavior.

## Relevant Configuration

Set these in the bridge environment only. Do not add Codex controls to OpenIM `SingleSetting`.

```env
OPENIM_GROUP_BOT_ENABLED=false
OPENIM_GROUP_ALLOWLIST=
OPENIM_GROUP_SENDER_ALLOWLIST=
OPENIM_GROUP_REQUIRE_BINDING=false
OPENIM_GROUP_PROJECT_BINDINGS=
OPENIM_GROUP_AUTO_REPLY_POLICY=mention_or_reply
CODEX_WORKSPACE_ALLOWLIST=/workspace/demo
```

Policy meanings:

- `OPENIM_GROUP_BOT_ENABLED=false`: ingest group semantic events but never create group runtime jobs.
- `OPENIM_GROUP_ALLOWLIST`: optional comma or semicolon separated group ids.
- `OPENIM_GROUP_SENDER_ALLOWLIST`: optional comma or semicolon separated speaker ids.
- `OPENIM_GROUP_REQUIRE_BINDING=true`: require an explicit group project binding.
- `OPENIM_GROUP_PROJECT_BINDINGS=group_1=/workspace/demo`: map group ids to backend workspaces.
- `OPENIM_GROUP_AUTO_REPLY_POLICY=mention_or_reply`: accept mentions and quote/replies.
- `OPENIM_GROUP_AUTO_REPLY_POLICY=mention_only`: accept only textual bot mentions.
- `OPENIM_GROUP_AUTO_REPLY_POLICY=reply_only`: accept only quote/replies to bot messages.
- `OPENIM_GROUP_AUTO_REPLY_POLICY=disabled`: ingest but never create group runtime jobs.

## Startup Baseline

From `official-openim/openim-docker`:

```powershell
docker compose ps
```

Expected:

- `openim-server` is `healthy`.
- `openim-chat` is `healthy`.

From `official-openim/openim-codex-bridge`:

```powershell
npm run build
npm test
```

Expected:

- TypeScript build passes.
- Vitest passes.

Check metadata:

```powershell
curl http://127.0.0.1:8787/healthz
curl http://127.0.0.1:8787/api/meta
```

Expected:

- `capabilities.groupPolicyPreview=true`
- `groupBotPolicy.enabled` matches `OPENIM_GROUP_BOT_ENABLED`.
- `groupBotPolicy.boundGroups` lists group ids only.
- The response does not contain configured workspace paths from `OPENIM_GROUP_PROJECT_BINDINGS`.

## Group Callback Routes

The bridge accepts:

```text
POST /webhooks/openim/after-send-group-msg
POST /webhooks/openim/after-send-group-msg/:command
POST /webhooks/openim/after-send-single-msg/:command
```

The single-message suffixed route is kept for OpenIM deployments that append group callback command
names to a base callback URL. Commands containing `group` are routed to the group handler.

## Policy Preview

Use the preview endpoint before enabling live group execution:

```powershell
$payload = @{
  sendID = "user_1"
  groupID = "group_1"
  serverMsgID = "preview_server_1"
  clientMsgID = "preview_client_1"
  contentType = 101
  content = (@{ content = "@codex_bot please inspect this" } | ConvertTo-Json -Compress)
} | ConvertTo-Json -Compress

curl -Method POST `
  -Uri http://127.0.0.1:8787/api/group-policy/preview `
  -ContentType "application/json" `
  -Body $payload
```

Expected:

- With group bot disabled: `wouldCreateJob=false`, `reason=group_bot_disabled`.
- With group bot enabled, allowlists matched, binding valid: `wouldCreateJob=true`.
- With sender not allowed: `reason=group_sender_not_allowed`.
- With group not allowed: `reason=group_not_allowed`.
- With required binding missing: `reason=group_binding_required`.
- With binding outside workspace allowlist: `reason=project_path_not_allowed`.
- Preview does not write `semantic_events`.
- Preview does not create runtime jobs.
- Preview does not return configured project paths.

## Live Webhook Smoke Matrix

Run these with a test group and fake or controlled payloads. Do not enable production group traffic
until all negative cases are verified.

### 1. Disabled By Default

Environment:

```env
OPENIM_GROUP_BOT_ENABLED=false
```

Send a group text message that mentions the bot:

```text
@codex_bot hello
```

Expected:

- Callback returns `ignored=true`.
- Reason is `group_bot_disabled`.
- A semantic event may be stored.
- No runtime job is created.
- No OpenIM bot reply is sent.

### 2. Mention Trigger

Environment:

```env
OPENIM_GROUP_BOT_ENABLED=true
OPENIM_GROUP_AUTO_REPLY_POLICY=mention_or_reply
OPENIM_GROUP_ALLOWLIST=group_1
OPENIM_GROUP_SENDER_ALLOWLIST=user_1
OPENIM_GROUP_REQUIRE_BINDING=true
OPENIM_GROUP_PROJECT_BINDINGS=group_1=/workspace/demo
CODEX_WORKSPACE_ALLOWLIST=/workspace/demo
```

Send:

```text
@codex_bot reply with GROUP_ACK
```

Expected:

- Callback returns `ignored=false`.
- A runtime job is queued.
- The session display user is the group id.
- Runtime events are recorded.
- OpenIM receives the bot reply if the configured runtime succeeds.

### 3. Ordinary Group Message

Send:

```text
hello everyone
```

Expected:

- Callback returns `ignored=true`.
- Reason is `group_message_not_addressed_to_bot`.
- Message remains available as group semantic context.
- No runtime job is created.

### 4. Quote Or Reply Trigger

Reply to a previous bot message in the group without mentioning the bot.

Expected:

- If `OPENIM_GROUP_AUTO_REPLY_POLICY=mention_or_reply` or `reply_only`, a runtime job may be queued.
- Semantic event metadata includes `groupTrigger=reply_to_bot`.
- If policy is `mention_only`, reason is `group_message_not_addressed_to_bot`.

### 5. Bot Self-Message Guard

Send or replay a group callback where `sendID=codex_bot`, or where `ex.agent.generated_by=codex`.

Expected:

- Reason is `sender_is_bot` or `generated_by_codex`.
- No runtime job is created.
- This prevents group reply loops.

### 6. Unsupported Content Type

Send image/file/custom content that is not text `101` or quote/reply `114`.

Expected:

- Reason is `unsupported_content_type`.
- No runtime job is created.

### 7. Project Binding Rejection

Use:

```env
OPENIM_GROUP_REQUIRE_BINDING=true
OPENIM_GROUP_PROJECT_BINDINGS=group_1=/outside/workspace
CODEX_WORKSPACE_ALLOWLIST=/workspace/demo
```

Expected:

- Callback or preview rejects with `project_path_not_allowed`.
- Diagnostics explain the allowlist reason.
- Bound project path is not returned by metadata or preview.

## Non-Regression Checklist

- `SingleSetting` remains OpenIM-native only.
- `ChatHeader` / `CodexStatusBadge` remains the Codex status entry.
- `CodexActivityDrawer` remains the detailed Codex/runtime entry.
- `ChatFooter` only shows lightweight queued/running/cancel status.
- Electron does not call Codex CLI.
- OpenIM original `sendMessage` path is unchanged.
- Bridge still sends bot replies through OpenIM `/msg/send_msg`.
- Legacy Codex APIs remain available.
- Runtime API aliases remain available.

## Current Automated Evidence

As of 2026-06-09 after Phase 5G and runtime metadata persistence:

- `npm run build`: passed.
- `npm test`: passed, 93 tests across 19 files.
- Integration coverage includes group mention, disabled policy, allowlists, quote/reply trigger,
  group project binding, group auto-reply policy, metadata diagnostics, and group policy preview.

## Final Backend Audit

Phase 5 backend scope is implemented as a bridge-only change:

- Group bot execution is disabled by default through `OPENIM_GROUP_BOT_ENABLED=false`.
- Group webhook routes ingest semantic events before runtime job decisions.
- Group allowlists, sender allowlists, reply/mention policy, and required binding checks are enforced
  server-side.
- Group project bindings are resolved through the existing workspace allowlist validation.
- Group policy diagnostics and preview responses redact bound project paths.
- Runtime kind now persists on session records and runtime jobs, and OpenIM bot reply metadata uses the
  active runtime kind.
- Electron was not changed for Phase 5, and no Electron path calls Codex CLI.
- OpenIM client `sendMessage` remains outside the bridge changes; bot replies still go through the
  bridge OpenIM sender.

## Remaining Operational Evidence

Full production-style signoff still requires an authenticated runtime and a real OpenIM group client
run:

- OpenIM group created with a controlled test user.
- Group webhook configured in OpenIM.
- Codex CLI or configured runtime authenticated.
- Mention trigger produces a bot reply in the OpenIM client.
- Quote/reply trigger produces a bot reply when policy allows it.
- Negative policy cases do not create jobs.
