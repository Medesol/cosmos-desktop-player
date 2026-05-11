param(
  [string]$RepoPath = "",
  [string]$Server = "175.178.130.174",
  [string]$User = "ubuntu",
  [string]$IdentityFile = "$HOME\.ssh\cosmos_desktop_player",
  [string]$AppDir = "/opt/cosmos-desktop-player",
  [string]$PublicUrl = "http://175.178.130.174",
  [string]$SearchQuery = "",
  [string]$SearchQueryEncoded = "%E9%A9%AC%E5%88%BA%E8%BF%9B%E6%AD%A5%E6%8A%A5%E5%91%8A",
  [switch]$SkipTests,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

if (!$RepoPath) {
  $RepoPath = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..\..\..")).Path
}

function Run {
  param(
    [string]$File,
    [string[]]$Arguments,
    [string]$WorkingDirectory = $RepoPath
  )
  Write-Host "> $File $($Arguments -join ' ')"
  if ($DryRun) {
    return
  }
  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $File @Arguments
    if ($LASTEXITCODE -ne 0) {
      throw "$File exited with code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function RunCapture {
  param(
    [string]$File,
    [string[]]$Arguments,
    [string]$WorkingDirectory = $RepoPath
  )
  Write-Host "> $File $($Arguments -join ' ')"
  $output = & $File @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw ($output | Out-String)
  }
  return ($output | Out-String).Trim()
}

function RunHttpCheck {
  param(
    [string[]]$Arguments,
    [int]$Attempts = 10,
    [int]$DelaySeconds = 2
  )
  for ($attempt = 1; $attempt -le $Attempts; $attempt += 1) {
    Write-Host "> curl.exe $($Arguments -join ' ')"
    if ($DryRun) {
      return
    }
    & curl.exe @Arguments
    if ($LASTEXITCODE -eq 0) {
      return
    }
    if ($attempt -eq $Attempts) {
      throw "curl.exe failed after $Attempts attempts with code $LASTEXITCODE"
    }
    Start-Sleep -Seconds $DelaySeconds
  }
}

if (!(Test-Path -LiteralPath $RepoPath)) {
  throw "RepoPath not found: $RepoPath"
}
if (!(Test-Path -LiteralPath $IdentityFile)) {
  throw "SSH identity file not found: $IdentityFile"
}

$status = RunCapture -File git -Arguments @("-C", $RepoPath, "status", "--short")
if ($status) {
  throw "Working tree is not clean:`n$status"
}

$branch = RunCapture -File git -Arguments @("-C", $RepoPath, "branch", "--show-current")
if ($branch -ne "main") {
  throw "Deploy from main only. Current branch: $branch"
}

if (!$SkipTests) {
  Run -File npm -Arguments @("test")
  Run -File npm -Arguments @("run", "check")
  Run -File git -Arguments @("diff", "--check")
}

$head = RunCapture -File git -Arguments @("-C", $RepoPath, "rev-parse", "HEAD")
$archive = Join-Path $env:TEMP "cosmos-desktop-player-deploy.tar.gz"
if (Test-Path -LiteralPath $archive) {
  Remove-Item -LiteralPath $archive -Force
}

Run -File git -Arguments @("-C", $RepoPath, "archive", "--format=tar.gz", "-o", $archive, "HEAD")

$sshBase = @("-i", $IdentityFile, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", "$User@$Server")
Run -File ssh -Arguments ($sshBase + @("sudo -n true && echo sudo-ok"))
Run -File scp -Arguments @("-i", $IdentityFile, "-o", "BatchMode=yes", "-o", "IdentitiesOnly=yes", $archive, "$User@${Server}:/tmp/cosmos-desktop-player.tar.gz")

$remoteScript = @"
set -euo pipefail
APP_DIR="$AppDir"
TARBALL=/tmp/cosmos-desktop-player.tar.gz
STAMP=`$(date +%Y%m%d%H%M%S)
RELEASE="$AppDir.release-`$STAMP"
BACKUP="$AppDir.backup-`$STAMP"

sudo test -f "`$TARBALL"
sudo mkdir -p "`$RELEASE"
sudo tar -xzf "`$TARBALL" -C "`$RELEASE"

if [ -d "`$APP_DIR/data" ]; then
  sudo mkdir -p "`$RELEASE/data"
  sudo cp -a "`$APP_DIR/data/." "`$RELEASE/data/"
fi

sudo mv "`$APP_DIR" "`$BACKUP"
sudo mv "`$RELEASE" "`$APP_DIR"
sudo chown -R root:root "`$APP_DIR"
sudo docker compose -f "`$APP_DIR/deploy/docker-compose.yml" up -d --build
sudo docker ps --filter name=cosmos-desktop-player --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
sudo rm -f "`$TARBALL"
echo "DEPLOYED_HEAD=$head"
echo "BACKUP=`$BACKUP"
"@

Run -File ssh -Arguments ($sshBase + @($remoteScript))

if (Test-Path -LiteralPath $archive) {
  Remove-Item -LiteralPath $archive -Force
}

if ($SearchQuery) {
  $encodedQuery = [System.Uri]::EscapeDataString($SearchQuery)
} else {
  $encodedQuery = $SearchQueryEncoded
}
RunHttpCheck -Arguments @("-sS", "-f", "-I", "--connect-timeout", "10", "--max-time", "20", "$PublicUrl/")
RunHttpCheck -Arguments @("-sS", "-f", "-i", "--connect-timeout", "10", "--max-time", "20", "$PublicUrl/api/config")
RunHttpCheck -Arguments @("-sS", "-f", "--connect-timeout", "10", "--max-time", "30", "$PublicUrl/api/search?q=$encodedQuery")

Write-Host "Deployment complete. Validate by public IP for now: $PublicUrl"
Write-Host "Do not treat podcastdesk.cn DNSPod WebBlock/ICP redirects as app deployment failures."
