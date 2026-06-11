<#
.SYNOPSIS
  One-command start for the entire OpenIM + Bridge + Frontend stack.
  Run after rebooting the machine.
#>

param(
  [switch]$NoFrontend
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path "$PSScriptRoot\..\.."
$bridgeDir = Join-Path $root "openim-codex-bridge"
$frontendDir = Join-Path $root "..\openim-electron-demo"

Write-Host "=== OpenIM Stack Startup ===" -ForegroundColor Cyan

# ── 1. Docker containers ──────────────────────────────────────────
Write-Host "[1/4] Starting Docker containers..."
docker compose -f "$root\docker-compose.yml" up -d 2>&1 | Out-Null
Write-Host "  Waiting for openim-server healthy..."
$tries = 0
while ($tries -lt 60) {
  $health = docker inspect openim-server --format '{{.State.Health.Status}}' 2>$null
  if ($health -eq "healthy") { break }
  Start-Sleep -Seconds 2
  $tries++
}
if ($tries -ge 60) { throw "openim-server did not become healthy within 120s" }
Write-Host "  Docker containers ready." -ForegroundColor Green

# ── 2. Enable group webhook ───────────────────────────────────────
Write-Host "[2/4] Enabling group webhook..."
$webhookTemp = Join-Path $env:TEMP "webhooks-fix.yml"
docker cp 'openim-server:/openim-server/config/webhooks.yml' $webhookTemp 2>$null
$content = Get-Content -Raw -Encoding UTF8 $webhookTemp
if ($content -match '(?ms)afterSendGroupMsg:\s*\r?\n\s*enable:\s*false') {
  $updated = [regex]::Replace($content, '(?ms)(afterSendGroupMsg:\s*\r?\n\s*enable:)\s*false', '$1 true', 1)
  Set-Content -LiteralPath $webhookTemp -Value $updated -Encoding UTF8 -NoNewline
  docker cp $webhookTemp 'openim-server:/openim-server/config/webhooks.yml' 2>$null
  docker restart openim-server 2>&1 | Out-Null
  Write-Host "  Group webhook enabled, openim-server restarting..."
  Start-Sleep -Seconds 8
  $health = docker inspect openim-server --format '{{.State.Health.Status}}'
  if ($health -ne "healthy") { Write-Warning "openim-server health: $health" }
} else {
  Write-Host "  Group webhook already enabled."
}
Remove-Item $webhookTemp -Force -ErrorAction SilentlyContinue

# ── 3. Bridge ─────────────────────────────────────────────────────
Write-Host "[3/4] Starting bridge..."
& "$PSScriptRoot\stop-bridge.ps1" 2>$null
Start-Sleep -Seconds 1
& "$PSScriptRoot\start-bridge.ps1"
Write-Host "  Bridge ready." -ForegroundColor Green

# ── 4. Frontend (Vite) ────────────────────────────────────────────
if (-not $NoFrontend) {
  Write-Host "[4/4] Starting frontend dev server..."
  $nodeBin = Join-Path $HOME ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
  if (-not (Test-Path $nodeBin)) {
    $nodeBin = (Get-Command node.exe -ErrorAction SilentlyContinue).Source
  }
  if (-not $nodeBin) { throw "Could not find node.exe" }

  $npm = Join-Path (Split-Path $nodeBin -Parent) "npm.cmd"
  Start-Process -FilePath $npm -ArgumentList "run", "dev" -WorkingDirectory $frontendDir -WindowStyle Hidden

  Write-Host "  Frontend starting (may take ~20s)..."
  Start-Sleep -Seconds 5
}

Write-Host "=== All services started ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Frontend : http://localhost:5173/"
Write-Host "  Bridge   : http://127.0.0.1:8787/healthz"
Write-Host "  Chat API : http://127.0.0.1:10008"
Write-Host "  IM API   : http://127.0.0.1:10002"
Write-Host ""
Write-Host "  Login    : 13900000001 / 123456"
Write-Host ""
