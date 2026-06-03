param(
  [string]$BridgeDir = (Resolve-Path "$PSScriptRoot\..\..\openim-codex-bridge").Path,
  [int]$Port = 8787,
  [int]$ProcessId = 0
)

$ErrorActionPreference = "Stop"

$pidFile = Join-Path $BridgeDir "data\bridge.pid"
$stopped = $false

if ($ProcessId -gt 0) {
  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $process.Id -Force
    $stopped = $true
    Write-Host "Stopped bridge PID $($process.Id)."
  }
}

if (Test-Path $pidFile) {
  $pidText = (Get-Content $pidFile -ErrorAction SilentlyContinue | Select-Object -First 1)
  if ($pidText -and ($pidText -match '^\d+$')) {
    $process = Get-Process -Id ([int]$pidText) -ErrorAction SilentlyContinue
    if ($process) {
      Stop-Process -Id $process.Id -Force
      $stopped = $true
      Write-Host "Stopped bridge PID $($process.Id)."
    }
  }
  Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
}

if (-not $stopped) {
  $listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  foreach ($listener in $listeners) {
    $process = Get-Process -Id $listener.OwningProcess -ErrorAction SilentlyContinue
    if ($process -and $process.ProcessName -eq "node") {
      Stop-Process -Id $process.Id -Force
      $stopped = $true
      Write-Host "Stopped bridge PID $($process.Id) listening on port $Port."
    }
  }
}

if (-not $stopped) {
  try {
    $matches = Get-CimInstance Win32_Process -ErrorAction Stop |
      Where-Object {
        $_.Name -eq "node.exe" -and
        $_.CommandLine -like "*dist/main.js*" -and
        $_.CommandLine -like "*openim-codex-bridge*"
      }

    foreach ($match in $matches) {
      Stop-Process -Id $match.ProcessId -Force
      $stopped = $true
      Write-Host "Stopped bridge PID $($match.ProcessId)."
    }
  } catch {
    Write-Host "Process command-line lookup is unavailable in this shell. Pass -Pid or use the PID file from start-bridge.ps1."
  }
}

Start-Sleep -Seconds 1
$connection = Test-NetConnection -ComputerName 127.0.0.1 -Port $Port -WarningAction SilentlyContinue
if ($connection.TcpTestSucceeded) {
  Write-Host "Port $Port is still open."
  exit 1
}

if (-not $stopped) {
  Write-Host "No bridge process found."
}
