param(
  [string]$BridgeDir = (Resolve-Path "$PSScriptRoot\..\..\openim-codex-bridge").Path,
  [int]$Port = 8787
)

$ErrorActionPreference = "Stop"

function Resolve-BridgeNodeBinary {
  $candidates = @()
  $candidates += (Join-Path $HOME ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe")
  $candidates += "C:\Program Files\nodejs\node.exe"
  $currentNode = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($currentNode) { $candidates += $currentNode.Source }

  foreach ($candidate in $candidates | Select-Object -Unique) {
    if (-not (Test-Path $candidate)) { continue }
    try {
      & $candidate --version *> $null
      if ($LASTEXITCODE -eq 0) {
        return $candidate
      }
    } catch {
      continue
    }
  }

  throw "Could not find a usable node.exe for bridge startup."
}

function Test-PortOpen {
  param([int]$TargetPort)
  $connection = Test-NetConnection -ComputerName 127.0.0.1 -Port $TargetPort -WarningAction SilentlyContinue
  return [bool]$connection.TcpTestSucceeded
}

if (Test-PortOpen -TargetPort $Port) {
  Write-Host "Bridge already responds on port $Port."
  exit 0
}

$node = Resolve-BridgeNodeBinary
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

flags = subprocess.CREATE_NEW_PROCESS_GROUP | subprocess.CREATE_NO_WINDOW
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
