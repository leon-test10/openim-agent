param(
  [string]$OpenImApiBaseUrl = "http://127.0.0.1:10002",
  [string]$AdminUserId = "imAdmin",
  [string]$AdminSecret = "openIM123",
  [string]$BotUserId = "codex_bot",
  [string]$BotNickname = "Codex Bot",
  [string]$TestUserId = "bridge_user_1",
  [string]$TestUserNickname = "Bridge User 1",
  [string]$WebhookConfigPath = (Resolve-Path "$PSScriptRoot\..\openim\webhooks.yml").Path,
  [string]$OpenImContainer = "openim-server"
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

$token = Get-AdminToken -OperationId "bridge-bootstrap-token"

$botBody = @{
  userID = $BotUserId
  nickName = $BotNickname
  faceURL = ""
  appMangerLevel = 3
} | ConvertTo-Json -Compress

$botResponse = Invoke-RestMethod `
  -Uri "$OpenImApiBaseUrl/user/add_notification_account" `
  -Method POST `
  -Headers @{ operationID = "bridge-bootstrap-bot"; token = $token } `
  -ContentType "application/json" `
  -Body $botBody
Write-Host "Bot account response errCode=$($botResponse.errCode)."

$userBody = @{
  users = @(
    @{
      userID = $TestUserId
      nickname = $TestUserNickname
      faceURL = ""
    }
  )
} | ConvertTo-Json -Depth 5 -Compress

$userResponse = Invoke-RestMethod `
  -Uri "$OpenImApiBaseUrl/user/user_register" `
  -Method POST `
  -Headers @{ operationID = "bridge-bootstrap-test-user"; token = $token } `
  -ContentType "application/json" `
  -Body $userBody
Write-Host "Test user registration errCode=$($userResponse.errCode)."

docker cp $WebhookConfigPath "$OpenImContainer`:/openim-server/config/webhooks.yml"
docker restart $OpenImContainer | Out-Null

Write-Host "Waiting for $OpenImContainer to become healthy..."
for ($i = 0; $i -lt 30; $i++) {
  $status = docker inspect $OpenImContainer --format "{{.State.Health.Status}}" 2>$null
  if ($status -eq "healthy") {
    Write-Host "$OpenImContainer is healthy."
    exit 0
  }
  Start-Sleep -Seconds 2
}

Write-Host "$OpenImContainer did not become healthy in time."
exit 1

