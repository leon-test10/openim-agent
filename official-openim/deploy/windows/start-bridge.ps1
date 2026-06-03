param(
  [string]$BridgeDir = (Resolve-Path "$PSScriptRoot\..\..\openim-codex-bridge").Path,
  [int]$Port = 8787
)

$ErrorActionPreference = "Stop"

function Test-PortOpen {
  param([int]$TargetPort)
  $connection = Test-NetConnection -ComputerName 127.0.0.1 -Port $TargetPort -WarningAction SilentlyContinue
  return [bool]$connection.TcpTestSucceeded
}

if (Test-PortOpen -TargetPort $Port) {
  Write-Host "Bridge already responds on port $Port."
  exit 0
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$pidFile = Join-Path $BridgeDir "data\bridge.pid"
$stdout = Join-Path $BridgeDir "data\bridge.stdout.log"
$stderr = Join-Path $BridgeDir "data\bridge.stderr.log"
$launcherPath = Join-Path $BridgeDir "data\start-bridge-launcher.py"
New-Item -ItemType Directory -Force -Path (Join-Path $BridgeDir "data") | Out-Null

$launcher = @"
import os
import pathlib
import subprocess

cwd = pathlib.Path(r'''$BridgeDir''')
env = {}
seen = set()
for key, value in os.environ.items():
    lowered = key.lower()
    if lowered in seen:
        continue
    seen.add(lowered)
    env[key] = value

flags = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP | 0x01000000
out = open(cwd / "data" / "bridge.stdout.log", "ab", buffering=0)
err = open(cwd / "data" / "bridge.stderr.log", "ab", buffering=0)
process = subprocess.Popen(
    [r'''$node''', "dist/main.js"],
    cwd=str(cwd),
    env=env,
    stdin=subprocess.DEVNULL,
    stdout=out,
    stderr=err,
    creationflags=flags,
)
print(process.pid)
"@

Set-Content -Path $launcherPath -Value $launcher -Encoding utf8
$pidText = python $launcherPath
Remove-Item -LiteralPath $launcherPath -Force -ErrorAction SilentlyContinue
$bridgePid = [int]$pidText.Trim()
Set-Content -Path $pidFile -Value $bridgePid -Encoding ascii

Start-Sleep -Seconds 2
if (-not (Test-PortOpen -TargetPort $Port)) {
  Write-Host "Bridge failed to start. stderr:"
  if (Test-Path $stderr) {
    Get-Content $stderr | Select-Object -Last 40
  }
  exit 1
}

Write-Host "Bridge started on port $Port with PID $bridgePid."
