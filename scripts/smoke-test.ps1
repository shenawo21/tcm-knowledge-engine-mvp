$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$SrcTauri = Join-Path $Root "src-tauri"
$TauriConfigPath = Join-Path $SrcTauri "tauri.conf.json"
$SmokeLogDir = Join-Path $Root "target\smoke-test"
$StdoutLog = Join-Path $SmokeLogDir "tauri-dev.stdout.log"
$StderrLog = Join-Path $SmokeLogDir "tauri-dev.stderr.log"
$TauriProcess = $null

function Write-Step {
  param([string]$Message)
  Write-Host ""
  Write-Host "==> $Message"
}

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory
  )

  Push-Location $WorkingDirectory
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
  } finally {
    Pop-Location
  }
}

function Stop-DevProcessTree {
  if ($null -ne $script:TauriProcess -and -not $script:TauriProcess.HasExited) {
    Write-Host "Stopping tauri dev process tree (PID $($script:TauriProcess.Id))..."
    & taskkill.exe /PID $script:TauriProcess.Id /T /F | Out-Null
    $script:TauriProcess = $null
  }
}

function Get-LogText {
  $parts = @()
  if (Test-Path $StdoutLog) {
    $parts += Get-Content $StdoutLog -Raw
  }
  if (Test-Path $StderrLog) {
    $parts += Get-Content $StderrLog -Raw
  }
  return ($parts -join "`n")
}

function Remove-AnsiSequences {
  param([string]$Text)

  # Cargo/Vite emit ANSI CSI and OSC escape sequences. Remove them so readiness
  # checks are not coupled to terminal color support or PowerShell encoding.
  $withoutOsc = $Text -replace "`e\][^\a]*(\a|`e\\)", ""
  return ($withoutOsc -replace "`e\[[0-?]*[ -/]*[@-~]", "")
}

function Show-DevLogs {
  if (Test-Path $StdoutLog) {
    Write-Host "--- tauri dev stdout ---"
    Get-Content $StdoutLog
  }
  if (Test-Path $StderrLog) {
    Write-Host "--- tauri dev stderr ---"
    Get-Content $StderrLog
  }
}

function Assert-Port-Free {
  param([int]$Port)

  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if ($connections) {
    $pids = ($connections | Select-Object -ExpandProperty OwningProcess -Unique) -join ", "
    throw "Port $Port is already in use by PID(s): $pids. Stop the existing dev server/app and rerun smoke:test."
  }
}

function Get-ExpectedDbPath {
  if (-not (Test-Path $TauriConfigPath)) {
    throw "Tauri config not found: $TauriConfigPath"
  }
  if ([string]::IsNullOrWhiteSpace($env:APPDATA)) {
    throw "APPDATA is not set; cannot resolve Windows app_data_dir."
  }

  $config = Get-Content $TauriConfigPath -Raw | ConvertFrom-Json
  $identifier = [string]$config.identifier
  if ([string]::IsNullOrWhiteSpace($identifier)) {
    throw "identifier is missing in $TauriConfigPath"
  }

  $appDataDir = Join-Path $env:APPDATA $identifier
  return Join-Path $appDataDir "tcm-knowledge-engine.sqlite"
}

function Test-TablesWithSqliteCli {
  param(
    [string]$SqlitePath,
    [string]$DbPath,
    [string[]]$Tables
  )

  foreach ($table in $Tables) {
    $sql = "SELECT name FROM sqlite_master WHERE type='table' AND name='$table';"
    $result = & $SqlitePath $DbPath $sql
    if ($LASTEXITCODE -ne 0) {
      throw "sqlite CLI failed while checking table '$table' with exit code $LASTEXITCODE."
    }
    if (($result | Select-Object -First 1) -ne $table) {
      throw "Missing required table: $table"
    }
  }
}

function Test-TablesWithRustFallback {
  param(
    [string]$DbPath,
    [string[]]$Tables
  )

  Write-Warning "SQLite CLI not found (sqlite3/sqlite). Falling back to a temporary Rust checker using rusqlite."

  $checkerDir = Join-Path $SrcTauri "target\smoke-db-check"
  $checkerSrc = Join-Path $checkerDir "src"
  New-Item -ItemType Directory -Force -Path $checkerSrc | Out-Null

  @"
[package]
name = "smoke-db-check"
version = "0.1.0"
edition = "2021"

[dependencies]
rusqlite = { version = "0.31", features = ["bundled"] }
"@ | Set-Content -Path (Join-Path $checkerDir "Cargo.toml") -Encoding UTF8

  @"
use rusqlite::{params, Connection};
use std::env;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let db_path = args.next().ok_or("missing db path")?;
    let tables: Vec<String> = args.collect();
    if tables.is_empty() {
        return Err("missing table names".into());
    }

    let conn = Connection::open(&db_path)?;
    for table in tables {
        let exists: i64 = conn.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name=?1",
            params![table],
            |row| row.get(0),
        )?;
        if exists != 1 {
            return Err(format!("missing required table: {}", table).into());
        }
    }

    Ok(())
}
"@ | Set-Content -Path (Join-Path $checkerSrc "main.rs") -Encoding UTF8

  Invoke-Checked -FilePath "cargo" -Arguments (@("run", "--quiet", "--") + @($DbPath) + $Tables) -WorkingDirectory $checkerDir
}

try {
  New-Item -ItemType Directory -Force -Path $SmokeLogDir | Out-Null
  Remove-Item -LiteralPath $StdoutLog, $StderrLog -Force -ErrorAction SilentlyContinue

  $dbPath = Get-ExpectedDbPath
  $dbExistedBefore = Test-Path $dbPath
  $requiredTables = @(
    "source",
    "ingestion_task",
    "entity",
    "relation",
    "review_item",
    "flashcard"
  )

  Write-Step "1. Running npm run build"
  Invoke-Checked -FilePath "npm.cmd" -Arguments @("run", "build") -WorkingDirectory $Root

  Write-Step "2. Running cargo check in src-tauri"
  Invoke-Checked -FilePath "cargo" -Arguments @("check") -WorkingDirectory $SrcTauri

  Write-Step "3-4. Starting npm run tauri dev briefly"
  Assert-Port-Free -Port 1420
  $script:TauriProcess = Start-Process `
    -FilePath "npm.cmd" `
    -ArgumentList @("run", "tauri", "dev") `
    -WorkingDirectory $Root `
    -RedirectStandardOutput $StdoutLog `
    -RedirectStandardError $StderrLog `
    -PassThru `
    -WindowStyle Hidden

  $deadline = (Get-Date).AddSeconds(240)
  $viteStarted = $false
  $tauriStarted = $false
  $dbExists = $false

  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 2
    $logText = Remove-AnsiSequences -Text (Get-LogText)
    $viteStarted = $logText -match "VITE" -and $logText -match "ready" -and $logText -match "1420"
    $tauriStarted = $logText -match "Running" -and $logText -match "tcm-knowledge-engine\.exe"
    $dbExists = Test-Path $dbPath

    if ($viteStarted -and $tauriStarted -and $dbExists) {
      break
    }

    if ($script:TauriProcess.HasExited) {
      Show-DevLogs
      throw "npm run tauri dev exited before Vite, Tauri, and the SQLite database were ready. Exit code: $($script:TauriProcess.ExitCode)"
    }
  }

  if (-not ($viteStarted -and $tauriStarted -and $dbExists)) {
    Show-DevLogs
    throw "Timed out waiting for tauri dev readiness. viteStarted=$viteStarted tauriStarted=$tauriStarted dbExists=$dbExists dbPath=$dbPath"
  }

  Write-Host "Vite started: $viteStarted"
  Write-Host "Tauri started: $tauriStarted"

  Write-Step "5. Checking SQLite database in app_data_dir"
  Write-Host "Database path: $dbPath"
  if ($dbExistedBefore) {
    Write-Host "Database existed before this run and is present after startup."
  } else {
    Write-Host "Database was generated by this run."
  }

  Stop-DevProcessTree

  Write-Step "6. Checking required SQLite tables"
  $sqliteCmd = Get-Command "sqlite3" -ErrorAction SilentlyContinue
  if (-not $sqliteCmd) {
    $sqliteCmd = Get-Command "sqlite" -ErrorAction SilentlyContinue
  }

  if ($sqliteCmd) {
    Write-Host "Using SQLite CLI: $($sqliteCmd.Source)"
    Test-TablesWithSqliteCli -SqlitePath $sqliteCmd.Source -DbPath $dbPath -Tables $requiredTables
  } else {
    Test-TablesWithRustFallback -DbPath $dbPath -Tables $requiredTables
  }

  Write-Host ""
  Write-Host "Smoke test passed."
  exit 0
} catch {
  Write-Error $_
  exit 1
} finally {
  Stop-DevProcessTree
}
