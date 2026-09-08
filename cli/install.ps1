# JEXI — laptop installer (Windows PowerShell).
#
#   irm https://raw.githubusercontent.com/lewiseinstein15-Tech/jexi-os-/main/cli/install.ps1 | iex
#
# Installs: %USERPROFILE%\.jexi\repo + backend deps + `jexi` on PATH.
# Then: jexi init
$ErrorActionPreference = "Stop"

$RepoUrl = if ($env:JEXI_REPO_URL) { $env:JEXI_REPO_URL } else { "https://github.com/lewiseinstein15-Tech/jexi-os-.git" }
$Dest = Join-Path $HOME ".jexi\repo"
$BinDir = Join-Path $HOME ".jexi\bin"

function Need($cmd, $hint) {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { throw "$cmd not found — $hint" }
}
Need node "install Node.js 20+ (https://nodejs.org), then re-run."
Need git "install git (https://git-scm.com), then re-run."
Need npm "install npm (ships with Node.js), then re-run."
$nodeMajor = [int]((node -p "process.versions.node.split('.')[0]"))
if ($nodeMajor -lt 20) { throw "node $(node --version) is too old — JEXI needs Node.js 20+." }

if (Test-Path (Join-Path $Dest ".git")) {
  Write-Host "Updating $Dest…"
  git -C $Dest pull --ff-only
} else {
  Write-Host "Cloning JEXI into $Dest…"
  New-Item -ItemType Directory -Force -Path (Split-Path $Dest) | Out-Null
  git clone --depth 1 $RepoUrl $Dest
}

Write-Host "Installing backend dependencies…"
Push-Location (Join-Path $Dest "server")
npm ci --no-audit --no-fund
Write-Host "Installing browser (best-effort)…"
try { $env:PLAYWRIGHT_BROWSERS_PATH = "0"; npx playwright install chromium } catch { Write-Host "(browser skipped — JEXI works degraded)" }
Pop-Location

New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
$shim = Join-Path $BinDir "jexi.cmd"
"@echo off`r`nnode `"$Dest\cli\jexi.js`" %*" | Out-File -Encoding ascii $shim

$path = [Environment]::GetEnvironmentVariable("Path", "User")
if ($path -notlike "*$BinDir*") {
  [Environment]::SetEnvironmentVariable("Path", "$path;$BinDir", "User")
  Write-Host "Added $BinDir to your user PATH (open a NEW terminal to use it)."
}

Write-Host ""
Write-Host "Installed. Next (in a NEW terminal):"
Write-Host "  1) jexi init        # provider + API key + model"
Write-Host "  2) jexi `"build …`"  # work in the current directory"
