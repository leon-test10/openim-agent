param(
  [string]$BridgeDir = (Resolve-Path "$PSScriptRoot\..\..\openim-codex-bridge").Path,
  [string]$OpenImApiBaseUrl = "http://127.0.0.1:10002",
  [string]$AdminUserId = "imAdmin",
  [string]$AdminSecret = "openIM123",
  [string]$BotUserId = "codex_bot",
  [string]$TestUserId = "bridge_user_1",
  [string]$ExpectedText = "SMOKE_ACK"
)

$ErrorActionPreference = "Stop"

function Get-AdminToken {
  param([string]$OperationId)
  $body = @{
    secret = $AdminSecret
    userID = $AdminUserId
  } | ConvertTo-Json -Compress

  $response = Invoke-RestMethod `
    -Uri "$OpenImApiBaseUrl/auth/get_admin_token" `
    -Method POST `
    -Headers @{ operationID = $OperationId } `
    -ContentType "application/json" `
    -Body $body

  if (-not $response.data.token) {
    throw "OpenIM admin token response did not include data.token."
  }
  return $response.data.token
}

$containers = docker ps --format "{{.Names}} {{.Status}}"
foreach ($name in @("openim-server", "openim-chat")) {
  $line = $containers | Where-Object { $_ -like "$name *" }
  if (-not $line -or $line -notlike "*healthy*") {
    throw "$name is not healthy. Current line: $line"
  }
}

$health = Invoke-RestMethod -Uri "http://127.0.0.1:8787/healthz" -Method GET
if (-not $health.ok) {
  throw "Bridge /healthz did not return ok=true."
}

$token = Get-AdminToken -OperationId "bridge-smoke-token"
$content = "Please reply exactly: $ExpectedText. Do not edit files."
$sendBody = @{
  sendID = $TestUserId
  recvID = $BotUserId
  contentType = 101
  sessionType = 1
  content = @{ content = $content }
} | ConvertTo-Json -Depth 5 -Compress

$sendResponse = Invoke-RestMethod `
  -Uri "$OpenImApiBaseUrl/msg/send_msg" `
  -Method POST `
  -Headers @{ operationID = "bridge-smoke-send"; token = $token } `
  -ContentType "application/json" `
  -Body $sendBody

if ($sendResponse.errCode -ne 0) {
  throw "OpenIM send_msg failed: $($sendResponse | ConvertTo-Json -Depth 8 -Compress)"
}

$dbPath = Join-Path $BridgeDir "data\openim-codex-bridge.sqlite"
$deadline = (Get-Date).AddSeconds(90)
$latest = $null
while ((Get-Date) -lt $deadline) {
  $query = @"
const Database=require('better-sqlite3');
const db=new Database(process.argv[1]);
const row=db.prepare('select id,status,input_text,codex_session_id_before,codex_session_id_after,output_text,error_text from runtime_jobs order by rowid desc limit 1').get();
console.log(JSON.stringify(row || null));
db.close();
"@
  Push-Location $BridgeDir
  try {
    $json = node -e $query $dbPath
  } finally {
    Pop-Location
  }
  $latest = $json | ConvertFrom-Json
  if ($latest -and $latest.input_text -eq $content -and $latest.status -ne "queued" -and $latest.status -ne "running") {
    break
  }
  Start-Sleep -Seconds 3
}

if (-not $latest) {
  throw "No runtime job found after smoke send."
}
if ($latest.status -ne "succeeded") {
  throw "Latest smoke job did not succeed: $($latest | ConvertTo-Json -Depth 8 -Compress)"
}
if ($latest.output_text -notlike "*$ExpectedText*") {
  throw "Latest smoke job output did not include $ExpectedText`: $($latest.output_text)"
}

Write-Host "Smoke E2E succeeded."
Write-Host ($latest | ConvertTo-Json -Depth 8)
