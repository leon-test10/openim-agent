param(
  [string]$BridgeDir = (Resolve-Path "$PSScriptRoot\..\..\openim-codex-bridge").Path,
  [string]$OpenImApiBaseUrl = "http://127.0.0.1:10002",
  [string]$AdminUserId = "imAdmin",
  [string]$AdminSecret = "openIM123",
  [string]$BotUserId = "codex_bot",
  [string]$TestUserId = "bridge_user_1",
  [string]$ProjectPath = (Resolve-Path "$PSScriptRoot\..\..").Path,
  [string]$DeepSeekBaseUrl = "https://api.deepseek.com/v1",
  [string]$Model = "deepseek-chat",
  [int]$TimeoutSeconds = 600,
  [switch]$SkipBuild,
  [switch]$SelfTest
)

$ErrorActionPreference = "Stop"
$script:SecretValues = @()

function Assert-Condition {
  param([bool]$Condition, [string]$Message)
  if (-not $Condition) { throw $Message }
}

function Protect-Text {
  param([AllowNull()][string]$Text)
  if ($null -eq $Text) { return "" }
  $protected = $Text
  foreach ($secret in $script:SecretValues) {
    if (-not [string]::IsNullOrWhiteSpace($secret)) {
      $protected = $protected.Replace($secret, "[REDACTED]")
    }
  }
  return $protected
}

function Resolve-Node24Directory {
  $candidates = @()
  $currentNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($currentNode) { $candidates += $currentNode.Source }
  $candidates += (Join-Path $HOME ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")
  foreach ($candidate in $candidates | Select-Object -Unique) {
    if (-not (Test-Path $candidate)) { continue }
    $version = & $candidate --version
    if ($version -match '^v24\.') { return (Split-Path -Parent $candidate) }
  }
  throw "Node 24 is required. Install Node 24 or make the Codex bundled Node runtime available."
}

function Get-OpenHandsVersion {
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    $output = @(& openhands --version 2>&1 | ForEach-Object { $_.ToString() })
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  Assert-Condition ($exitCode -eq 0) "OpenHands CLI version check failed."
  $versionLine = $output | Where-Object { $_ -match 'OpenHands SDK v[0-9]+' } | Select-Object -First 1
  if ($versionLine) { return $versionLine.Trim(' ', '|') }
  return "OpenHands CLI (version output unavailable)"
}

function Resolve-OpenHandsPythonBinary {
  $command = Get-Command openhands -ErrorAction Stop
  $scriptsDir = Split-Path -Parent $command.Source
  $pythonBin = Join-Path (Split-Path -Parent $scriptsDir) "python.exe"
  if (Test-Path $pythonBin) {
    return $pythonBin
  }
  return $null
}

function Ensure-BridgeNativeDependencies {
  Push-Location $BridgeDir
  $helperDir = Join-Path $BridgeDir "data"
  New-Item -ItemType Directory -Force $helperDir | Out-Null
  $probePath = Join-Path $helperDir "openim-bridge-native-probe.cjs"
  try {
    Set-Content -LiteralPath $probePath -Encoding ASCII -Value "const Database=require('better-sqlite3');const db=new Database(':memory:');db.close();"
    $previousPreference = $ErrorActionPreference
    try {
      $ErrorActionPreference = "Continue"
      & node $probePath *> $null
      $nativeCheckExitCode = $LASTEXITCODE
    } finally {
      $ErrorActionPreference = $previousPreference
    }
    if ($nativeCheckExitCode -eq 0) { return }
    Write-Host "Rebuilding better-sqlite3 for Node 24..."
    & npm.cmd rebuild better-sqlite3
    Assert-Condition ($LASTEXITCODE -eq 0) "Could not rebuild better-sqlite3 for Node 24."
    & node $probePath
    Assert-Condition ($LASTEXITCODE -eq 0) "better-sqlite3 is still incompatible after rebuild."
  } finally {
    Remove-Item $probePath -Force -ErrorAction SilentlyContinue
    Pop-Location
  }
}

function Get-OpenHandsEnvironment {
  param([string]$ApiKey, [string]$GroupId, [string]$DatabaseUrl, [AllowNull()][string]$OpenHandsPythonBin)
  $envMap = [ordered]@{
    RUNTIME_DEFAULT_KIND = "openhands"
    OPENHANDS_BIN = "openhands"
    OPENHANDS_BASE_URL = $DeepSeekBaseUrl
    OPENHANDS_API_KEY = $ApiKey
    CODEX_DEFAULT_MODEL = $Model
    CODEX_DEFAULT_PROJECT_PATH = $ProjectPath
    CODEX_WORKSPACE_ALLOWLIST = $ProjectPath
    OPENIM_API_BASE_URL = $OpenImApiBaseUrl
    OPENIM_ADMIN_USER_ID = $AdminUserId
    OPENIM_ADMIN_SECRET = $AdminSecret
    OPENIM_BOT_USER_ID = $BotUserId
    OPENIM_GROUP_BOT_ENABLED = "true"
    OPENIM_GROUP_ALLOWLIST = $GroupId
    OPENIM_GROUP_SENDER_ALLOWLIST = $TestUserId
    OPENIM_GROUP_REQUIRE_BINDING = "true"
    OPENIM_GROUP_PROJECT_BINDINGS = "$GroupId=$ProjectPath"
    OPENIM_GROUP_AUTO_REPLY_POLICY = "mention_only"
    OPENHANDS_TIMEOUT_MS = [string]($TimeoutSeconds * 1000)
    DATABASE_URL = $DatabaseUrl
  }
  if (-not [string]::IsNullOrWhiteSpace($OpenHandsPythonBin)) {
    $envMap.OPENHANDS_PYTHON_BIN = $OpenHandsPythonBin
  }
  return $envMap
}

function Enable-GroupWebhookConfig {
  param([string]$SourcePath, [string]$TargetPath)
  $content = Get-Content -Raw -Encoding UTF8 $SourcePath
  if ($content -match '(?ms)afterSendGroupMsg:\s*\r?\n\s*enable:\s*true') {
    Set-Content -LiteralPath $TargetPath -Value $content -Encoding UTF8
    return
  }
  $pattern = '(?ms)(afterSendGroupMsg:\s*\r?\n\s*enable:)\s*false'
  $updated = [regex]::Replace($content, $pattern, '$1 true', 1)
  Assert-Condition ($updated -ne $content) "Could not enable afterSendGroupMsg in webhook config."
  Set-Content -LiteralPath $TargetPath -Value $updated -Encoding UTF8
}

function Invoke-OpenImApi {
  param(
    [string]$Path,
    [hashtable]$Body,
    [string]$OperationId,
    [AllowNull()][string]$Token
  )
  $headers = @{ operationID = $OperationId }
  if ($Token) { $headers.token = $Token }
  $response = Invoke-RestMethod -Uri "$OpenImApiBaseUrl$Path" -Method POST -Headers $headers `
    -ContentType "application/json" -Body ($Body | ConvertTo-Json -Depth 12 -Compress)
  if ($null -ne $response.errCode -and $response.errCode -ne 0) {
    throw "OpenIM $Path failed: $(Protect-Text ($response | ConvertTo-Json -Depth 12 -Compress))"
  }
  return $response
}

function Get-AdminToken {
  param([string]$OperationId)
  $response = Invoke-OpenImApi -Path "/auth/get_admin_token" -OperationId $OperationId -Token $null -Body @{
    secret = $AdminSecret
    userID = $AdminUserId
  }
  Assert-Condition ([bool]$response.data.token) "OpenIM admin token response did not include data.token."
  return [string]$response.data.token
}

function Ensure-TestAccounts {
  param([string]$Token, [string]$RunId)
  $existing = Invoke-OpenImApi -Path "/user/get_users_info" -OperationId "$RunId-users" -Token $Token -Body @{
    userIDs = @($BotUserId, $TestUserId)
  }
  $existingIds = @($existing.data.usersInfo | ForEach-Object { $_.userID })
  if ($existingIds -notcontains $BotUserId) {
    Invoke-OpenImApi -Path "/user/add_notification_account" -OperationId "$RunId-bot" -Token $Token -Body @{
      userID = $BotUserId; nickName = "OpenHands Bot"; faceURL = ""; appMangerLevel = 3
    } | Out-Null
  }
  if ($existingIds -notcontains $TestUserId) {
    Invoke-OpenImApi -Path "/user/user_register" -OperationId "$RunId-user" -Token $Token -Body @{
      users = @(@{ userID = $TestUserId; nickname = "Bridge User 1"; faceURL = "" })
    } | Out-Null
  }
}

function New-TestGroup {
  param([string]$Token, [string]$RunId)
  $response = Invoke-OpenImApi -Path "/group/create_group" -OperationId "$RunId-group" -Token $Token -Body @{
    groupInfo = @{ groupName = "OpenHands E2E $RunId"; groupType = 2 }
    ownerUserID = $TestUserId
    memberUserIDs = @($BotUserId)
    adminUserIDs = @()
  }
  $groupId = [string]$response.data.groupInfo.groupID
  if (-not $groupId) { $groupId = [string]$response.data.groupID }
  Assert-Condition (-not [string]::IsNullOrWhiteSpace($groupId)) "OpenIM create_group response did not include groupID."
  return $groupId
}

function Send-OpenImText {
  param([string]$Token, [string]$RunId, [string]$Text, [AllowNull()][string]$GroupId)
  $body = @{ sendID = $TestUserId; contentType = 101; content = @{ content = $Text } }
  if ($GroupId) { $body.groupID = $GroupId; $body.sessionType = 3 }
  else { $body.recvID = $BotUserId; $body.sessionType = 1 }
  Invoke-OpenImApi -Path "/msg/send_msg" -OperationId "$RunId-send-$([guid]::NewGuid().ToString('N'))" -Token $Token -Body $body | Out-Null
}

function Invoke-DatabaseQuery {
  param([string]$DatabasePath, [string]$Sql, [object[]]$Arguments = @())
  $query = @'
const Database = require("better-sqlite3");
const db = new Database(process.argv[2]);
const sql = Buffer.from(process.argv[3], "base64").toString("utf8");
const args = JSON.parse(Buffer.from(process.argv[4], "base64").toString("utf8"));
const rows = db.prepare(sql).all(...args);
console.log(JSON.stringify(rows));
db.close();
'@
  $encodedSql = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($Sql))
  Push-Location $BridgeDir
  $argumentJson = ConvertTo-Json -InputObject $Arguments -Compress
  $encodedArguments = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($argumentJson))
  $queryPath = Join-Path $BridgeDir "data\openim-bridge-query-$([guid]::NewGuid().ToString('N')).cjs"
  try {
    Set-Content -LiteralPath $queryPath -Value $query -Encoding ASCII
    return @(node $queryPath $DatabasePath $encodedSql $encodedArguments | ConvertFrom-Json)
  } finally {
    Remove-Item $queryPath -Force -ErrorAction SilentlyContinue
    Pop-Location
  }
}

function Wait-RuntimeJob {
  param([string]$DatabasePath, [string]$InputText)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    $rows = Invoke-DatabaseQuery $DatabasePath @'
SELECT id, runtime_kind, openim_conversation_id, session_record_id, status, input_text,
       codex_session_id_before, codex_session_id_after, output_text, error_text,
       created_at, started_at, finished_at
FROM runtime_jobs WHERE input_text = ? ORDER BY rowid DESC LIMIT 1
'@ @($InputText)
    $job = $rows | Select-Object -First 1
    if ($job -and $job.status -notin @("queued", "running", "cancelling")) { return $job }
    Start-Sleep -Seconds 2
  } while ((Get-Date) -lt $deadline)
  throw "Timed out waiting for runtime job for input: $InputText"
}

function Get-JobEvents {
  param([string]$DatabasePath, [string]$JobId)
  return Invoke-DatabaseQuery $DatabasePath `
    "SELECT event_type, title, summary, created_at FROM runtime_events WHERE job_id = ? ORDER BY rowid" @($JobId)
}

function Assert-SucceededJob {
  param($Job, [string]$ExpectedText, [string]$ConversationId)
  Assert-Condition ($Job.status -eq "succeeded") "Job $($Job.id) failed: $($Job.error_text)"
  Assert-Condition ($Job.runtime_kind -eq "openhands") "Job $($Job.id) did not use OpenHands."
  Assert-Condition ($Job.openim_conversation_id -eq $ConversationId) "Unexpected conversation id for job $($Job.id)."
  Assert-Condition ($Job.output_text -like "*$ExpectedText*") "Job $($Job.id) output did not include $ExpectedText."
  Assert-Condition ([bool]$Job.codex_session_id_after) "Job $($Job.id) did not persist an external session id."
}

function Invoke-SelfTest {
  $script:SecretValues = @("self-test-secret")
  $envMap = Get-OpenHandsEnvironment "self-test-secret" "group_self_test" "file:./data/self-test.sqlite" "C:\Python312\python.exe"
  Assert-Condition ($envMap.RUNTIME_DEFAULT_KIND -eq "openhands") "Runtime kind self-test failed."
  Assert-Condition ($envMap.OPENHANDS_BASE_URL -eq "https://api.deepseek.com/v1") "Base URL self-test failed."
  Assert-Condition ($envMap.CODEX_DEFAULT_MODEL -eq "deepseek-chat") "Model self-test failed."
  Assert-Condition ($envMap.OPENIM_GROUP_ALLOWLIST -eq "group_self_test") "Group policy self-test failed."
  Assert-Condition ($envMap.OPENHANDS_PYTHON_BIN -eq "C:\Python312\python.exe") "Python launcher self-test failed."
  $source = [IO.Path]::GetTempFileName(); $target = [IO.Path]::GetTempFileName()
  try {
    Set-Content $source "afterSendGroupMsg:`n  enable: false`n  timeout: 5" -Encoding UTF8
    Enable-GroupWebhookConfig $source $target
    Assert-Condition ((Get-Content -Raw $target) -match 'enable:\s*true') "Webhook self-test failed."
    Assert-Condition ((Protect-Text "token=self-test-secret") -eq "token=[REDACTED]") "Redaction self-test failed."
  } finally { Remove-Item $source, $target -Force -ErrorAction SilentlyContinue }
  Write-Host "OpenHands E2E self-test passed."
}

if ($SelfTest) { Invoke-SelfTest; exit 0 }

Assert-Condition (-not [string]::IsNullOrWhiteSpace($env:DEEPSEEK_API_KEY)) "Set DEEPSEEK_API_KEY in the current process before running this script."
$script:SecretValues = @($env:DEEPSEEK_API_KEY, $AdminSecret)

$runId = "oh-e2e-$((Get-Date).ToUniversalTime().ToString('yyyyMMddHHmmss'))-$([guid]::NewGuid().ToString('N').Substring(0, 6))"
$databaseRelative = "./data/openhands-e2e-$runId.sqlite"
$databasePath = Join-Path $BridgeDir "data\openhands-e2e-$runId.sqlite"
$reportDir = Join-Path $BridgeDir "data\validation"
$reportPath = Join-Path $reportDir "$runId.md"
$webhookSource = (Resolve-Path "$PSScriptRoot\..\openim\webhooks.yml").Path
$webhookTemp = Join-Path $env:TEMP "$runId-webhooks.yml"
$webhookBackup = Join-Path $env:TEMP "$runId-webhooks-backup.yml"
$startScript = Join-Path $PSScriptRoot "start-bridge.ps1"
$stopScript = Join-Path $PSScriptRoot "stop-bridge.ps1"
$bridgeWasRunning = (Test-NetConnection 127.0.0.1 -Port 8787 -WarningAction SilentlyContinue).TcpTestSucceeded
$originalPath = $env:PATH
$originalEnvironment = @{}
$testEnvironment = $null
$groupId = $null
$token = $null
$jobs = @()
$validationError = $null

try {
  $nodeDirectory = Resolve-Node24Directory
  $env:PATH = "$nodeDirectory;$originalPath"
  Ensure-BridgeNativeDependencies
  docker version --format '{{.Server.Version}}' | Out-Null
  foreach ($name in @("openim-server", "openim-chat")) {
    $health = docker inspect $name --format '{{.State.Health.Status}}' 2>$null
    Assert-Condition ($health -eq "healthy") "$name is not healthy."
  }
  node --version | Out-Null
  $openHandsVersion = Get-OpenHandsVersion
  $openHandsPythonBin = Resolve-OpenHandsPythonBinary

  $token = Get-AdminToken "$runId-token"
  Ensure-TestAccounts $token $runId
  $groupId = New-TestGroup $token $runId

  docker cp "openim-server:/openim-server/config/webhooks.yml" $webhookBackup | Out-Null
  Enable-GroupWebhookConfig $webhookBackup $webhookTemp
  docker cp $webhookTemp "openim-server:/openim-server/config/webhooks.yml" | Out-Null
  docker restart openim-server | Out-Null
  for ($i = 0; $i -lt 45; $i++) {
    if ((docker inspect openim-server --format '{{.State.Health.Status}}' 2>$null) -eq "healthy") { break }
    Start-Sleep -Seconds 2
  }
  Assert-Condition ((docker inspect openim-server --format '{{.State.Health.Status}}') -eq "healthy") "openim-server did not recover after enabling group webhook."

  if (-not $SkipBuild) { Push-Location $BridgeDir; try { npm.cmd run build } finally { Pop-Location } }
  if ($bridgeWasRunning) { & $stopScript }
  Remove-Item (Join-Path $BridgeDir "data\bridge.stdout.log"), (Join-Path $BridgeDir "data\bridge.stderr.log") -Force -ErrorAction SilentlyContinue

  $testEnvironment = Get-OpenHandsEnvironment $env:DEEPSEEK_API_KEY $groupId $databaseRelative $openHandsPythonBin
  foreach ($entry in $testEnvironment.GetEnumerator()) {
    $originalEnvironment[$entry.Key] = [Environment]::GetEnvironmentVariable($entry.Key, "Process")
    [Environment]::SetEnvironmentVariable($entry.Key, [string]$entry.Value, "Process")
  }
  & $startScript
  Assert-Condition ((Invoke-RestMethod http://127.0.0.1:8787/healthz).ok) "Bridge health check failed."

  $singleConversation = "single:$BotUserId`:$TestUserId"
  $singleOneExpected = "SINGLE_NEW_$runId"
  $singleOneText = "Reply with exactly $singleOneExpected. Do not edit files."
  Send-OpenImText $token $runId $singleOneText $null
  $singleOne = Wait-RuntimeJob $databasePath $singleOneText
  Assert-SucceededJob $singleOne $singleOneExpected $singleConversation
  $jobs += $singleOne

  $singleTwoExpected = "SINGLE_RESUME_$runId"
  $singleTwoText = "Reply with exactly $singleTwoExpected. Do not edit files."
  Send-OpenImText $token $runId $singleTwoText $null
  $singleTwo = Wait-RuntimeJob $databasePath $singleTwoText
  Assert-SucceededJob $singleTwo $singleTwoExpected $singleConversation
  Assert-Condition ($singleTwo.codex_session_id_before -eq $singleOne.codex_session_id_after) "Single-chat resume did not reuse the OpenHands session."
  Assert-Condition ($singleTwo.codex_session_id_after -eq $singleOne.codex_session_id_after) "Single-chat resume changed the OpenHands session."
  $jobs += $singleTwo

  $groupConversation = "group:$groupId"
  $groupOneExpected = "GROUP_NEW_$runId"
  $groupOneText = "@$BotUserId reply with exactly $groupOneExpected. Do not edit files."
  Send-OpenImText $token $runId $groupOneText $groupId
  $groupOne = Wait-RuntimeJob $databasePath $groupOneText
  Assert-SucceededJob $groupOne $groupOneExpected $groupConversation
  $jobs += $groupOne

  $groupTwoExpected = "GROUP_RESUME_$runId"
  $groupTwoText = "@$BotUserId reply with exactly $groupTwoExpected. Do not edit files."
  Send-OpenImText $token $runId $groupTwoText $groupId
  $groupTwo = Wait-RuntimeJob $databasePath $groupTwoText
  Assert-SucceededJob $groupTwo $groupTwoExpected $groupConversation
  Assert-Condition ($groupTwo.codex_session_id_before -eq $groupOne.codex_session_id_after) "Group-chat resume did not reuse the OpenHands session."
  Assert-Condition ($groupTwo.codex_session_id_after -eq $groupOne.codex_session_id_after) "Group-chat resume changed the OpenHands session."
  $jobs += $groupTwo

  $ignoredText = "ordinary group chatter $runId"
  $beforeCount = (Invoke-DatabaseQuery $databasePath "SELECT id FROM runtime_jobs").Count
  Send-OpenImText $token $runId $ignoredText $groupId
  Start-Sleep -Seconds 5
  $afterCount = (Invoke-DatabaseQuery $databasePath "SELECT id FROM runtime_jobs").Count
  Assert-Condition ($afterCount -eq $beforeCount) "Non-mentioned group message created a runtime job."
  $ignoredEvents = Invoke-DatabaseQuery $databasePath "SELECT id FROM semantic_events WHERE openim_conversation_id = ? AND text = ?" @($groupConversation, $ignoredText)
  Assert-Condition ($ignoredEvents.Count -eq 1) "Non-mentioned group message was not persisted as semantic context."

  Start-Sleep -Seconds 5
  Assert-Condition ((Invoke-DatabaseQuery $databasePath "SELECT id FROM runtime_jobs").Count -eq 4) "Bot reply loop created an unexpected runtime job."

  $requiredEvents = @("bridge.job_queued", "bridge.job_running", "openhands.message_event", "bridge.job_succeeded", "bridge.reply_sent")
  $eventRows = @{}
  foreach ($job in $jobs) {
    $events = @(Get-JobEvents $databasePath $job.id)
    $eventRows[$job.id] = $events
    $types = @($events | ForEach-Object { $_.event_type })
    foreach ($required in $requiredEvents) {
      Assert-Condition ($types -contains $required) "Job $($job.id) is missing runtime event $required."
    }
  }

  New-Item -ItemType Directory -Force $reportDir | Out-Null
  $lines = @(
    "# OpenHands E2E validation $runId", "", "- Timestamp (UTC): $((Get-Date).ToUniversalTime().ToString('o'))",
    "- OpenHands: $(Protect-Text $openHandsVersion)", "- Model: $Model", "- Base URL: $DeepSeekBaseUrl",
    "- Group ID: $groupId", "- Result: PASS", "", "| Conversation | Job | Session before | Session after | Duration ms | Events |",
    "|---|---|---|---|---:|---|"
  )
  foreach ($job in $jobs) {
    $duration = if ($job.finished_at -and $job.started_at) { [long]$job.finished_at - [long]$job.started_at } else { "" }
    $types = ($eventRows[$job.id] | ForEach-Object { $_.event_type }) -join ", "
    $lines += "| $($job.openim_conversation_id) | $($job.id) | $($job.codex_session_id_before) | $($job.codex_session_id_after) | $duration | $types |"
  }
  Set-Content -LiteralPath $reportPath -Value (Protect-Text ($lines -join "`n")) -Encoding UTF8
  Write-Host "OpenHands single/group E2E succeeded."
  Write-Host "Group ID: $groupId"
  Write-Host "Report: $reportPath"
} catch {
  $validationError = Protect-Text $_.Exception.Message
} finally {
  try { & $stopScript | Out-Null } catch {}
  if ($testEnvironment) {
    foreach ($entry in $testEnvironment.GetEnumerator()) {
      [Environment]::SetEnvironmentVariable($entry.Key, $originalEnvironment[$entry.Key], "Process")
    }
  }
  $env:PATH = $originalPath
  if (Test-Path $webhookBackup) {
    try {
      docker cp $webhookBackup "openim-server:/openim-server/config/webhooks.yml" | Out-Null
      docker restart openim-server | Out-Null
    } catch {}
  }
  Remove-Item $webhookTemp, $webhookBackup -Force -ErrorAction SilentlyContinue
  if ($bridgeWasRunning) {
    try { & $startScript | Out-Null } catch { Write-Warning "Could not restore the previously running bridge: $(Protect-Text $_.Exception.Message)" }
  }
}

if ($validationError) {
  Write-Error $validationError
  exit 1
}
