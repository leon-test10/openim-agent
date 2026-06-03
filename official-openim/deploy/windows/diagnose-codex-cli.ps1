param(
  [string]$CodexBin = "codex",
  [string]$ProjectPath = (Resolve-Path "$PSScriptRoot\..\..").Path,
  [string]$OutputDir = (Resolve-Path "$PSScriptRoot\..\..").Path + "\diagnostics\codex-cli",
  [string[]]$SandboxModes = @("read-only", "workspace-write")
)

$ErrorActionPreference = "Continue"

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

function Write-CommandOutput {
  param(
    [string]$Name,
    [string[]]$Command
  )

  $stdout = Join-Path $OutputDir "$Name.stdout.txt"
  $stderr = Join-Path $OutputDir "$Name.stderr.txt"
  $exitFile = Join-Path $OutputDir "$Name.exit.txt"

  & $Command[0] $Command[1..($Command.Length - 1)] > $stdout 2> $stderr
  Set-Content -Path $exitFile -Value $LASTEXITCODE -Encoding ascii
}

Write-CommandOutput -Name "codex-version" -Command @($CodexBin, "--version")
Write-CommandOutput -Name "codex-exec-help" -Command @($CodexBin, "exec", "--help")
Write-CommandOutput -Name "codex-resume-help" -Command @($CodexBin, "exec", "resume", "--help")
Write-CommandOutput -Name "codex-sandbox-help" -Command @($CodexBin, "sandbox", "windows", "--help")

$envReport = [ordered]@{
  timestamp = (Get-Date).ToString("o")
  codexBin = $CodexBin
  projectPath = $ProjectPath
  outputDir = $OutputDir
  CODEX_HOME = $env:CODEX_HOME
  USERPROFILE = $env:USERPROFILE
  PATH = $env:PATH
}
$envReport | ConvertTo-Json -Depth 4 | Set-Content -Path (Join-Path $OutputDir "environment.json") -Encoding utf8

foreach ($mode in $SandboxModes) {
  $safeName = $mode -replace "[^A-Za-z0-9_-]", "_"
  $stdout = Join-Path $OutputDir "exec-$safeName.stdout.jsonl"
  $stderr = Join-Path $OutputDir "exec-$safeName.stderr.txt"
  $exitFile = Join-Path $OutputDir "exec-$safeName.exit.txt"
  $prompt = @"
You are diagnosing Codex CLI execution from openim-codex-bridge.
Do not modify files.
Please report:
1. current working directory
2. whether you can list the current directory
3. whether you can run a simple shell command
"@

  $prompt | & $CodexBin exec --cd $ProjectPath --sandbox $mode --json - > $stdout 2> $stderr
  Set-Content -Path $exitFile -Value $LASTEXITCODE -Encoding ascii
}

Write-Host "Codex CLI diagnostics written to $OutputDir"
