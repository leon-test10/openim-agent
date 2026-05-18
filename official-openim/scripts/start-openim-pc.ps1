param(
  [switch]$SkipDocker,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $PSScriptRoot
$ServerDir = Join-Path $Root "open-im-server"
$ChatDir = Join-Path $Root "openim-chat"
$ClientDir = Join-Path $Root "openim-electron-demo"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Test-Command($Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Wait-Port($Port, $Name, $TimeoutSeconds = 120) {
  $Deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $Deadline) {
    $Client = New-Object System.Net.Sockets.TcpClient
    try {
      $Async = $Client.BeginConnect("127.0.0.1", $Port, $null, $null)
      if ($Async.AsyncWaitHandle.WaitOne(1000, $false)) {
        $Client.EndConnect($Async)
        Write-Host "ready: $Name on 127.0.0.1:$Port" -ForegroundColor Green
        return
      }
    } catch {
      Start-Sleep -Seconds 1
    } finally {
      $Client.Close()
    }
  }
  throw "Timed out waiting for $Name on 127.0.0.1:$Port"
}

function Ensure-Mage($RepoDir) {
  if (Test-Command "mage") {
    return
  }
  Write-Step "Installing mage for $RepoDir"
  Push-Location $RepoDir
  try {
    & .\bootstrap.bat
  } finally {
    Pop-Location
  }
  if (-not (Test-Command "mage")) {
    throw "mage is not available after bootstrap. Add GOPATH\bin to PATH and retry."
  }
}

function Ensure-Binaries($RepoDir, $RequiredBinary) {
  $Exe = Join-Path $RepoDir "_output\bin\platforms\windows\amd64\$RequiredBinary.exe"
  if ((Test-Path $Exe) -or $SkipBuild) {
    return
  }
  Write-Step "Building $RepoDir"
  Push-Location $RepoDir
  try {
    & mage build
  } finally {
    Pop-Location
  }
}

function Start-MageServices($RepoDir, $Name, $ProbePorts) {
  Ensure-Mage $RepoDir
  Push-Location $RepoDir
  try {
    $AllReady = $true
    foreach ($Probe in $ProbePorts) {
      $Client = New-Object System.Net.Sockets.TcpClient
      try {
        $Async = $Client.BeginConnect("127.0.0.1", $Probe.Port, $null, $null)
        if (-not $Async.AsyncWaitHandle.WaitOne(500, $false)) {
          $AllReady = $false
        } else {
          $Client.EndConnect($Async)
        }
      } catch {
        $AllReady = $false
      } finally {
        $Client.Close()
      }
    }

    if (-not $AllReady) {
      Write-Step "Starting $Name services"
      & mage start
    } else {
      Write-Host "$Name services already look ready." -ForegroundColor Green
    }
  } finally {
    Pop-Location
  }

  foreach ($Probe in $ProbePorts) {
    Wait-Port $Probe.Port $Probe.Name $Probe.Timeout
  }
}

if (-not (Test-Path $ServerDir) -or -not (Test-Path $ChatDir) -or -not (Test-Path $ClientDir)) {
  throw "Run this script from the official-openim workspace root."
}

if (-not $SkipDocker) {
  if (-not (Test-Command "docker")) {
    throw "Docker is not available in PATH."
  }
  Write-Step "Starting Docker dependencies"
  Push-Location $ServerDir
  try {
    & docker compose up -d
  } finally {
    Pop-Location
  }
  Wait-Port 12379 "etcd" 120
  Wait-Port 16379 "redis" 120
  Wait-Port 37017 "mongo" 120
  Wait-Port 19094 "kafka" 180
  Wait-Port 10005 "minio" 120
}

Ensure-Binaries $ServerDir "openim-api"
Ensure-Binaries $ChatDir "chat-api"

Start-MageServices $ServerDir "OpenIM server" @(
  @{ Port = 10002; Name = "openim-api"; Timeout = 180 },
  @{ Port = 10001; Name = "openim-msg-gateway"; Timeout = 180 }
)

Start-MageServices $ChatDir "OpenIM chat" @(
  @{ Port = 10008; Name = "chat-api"; Timeout = 180 }
)

Write-Step "Starting Electron multi-client"
Push-Location $ClientDir
try {
  & npm run cleanup:test
  & npm run dev:multi
} finally {
  Pop-Location
}
