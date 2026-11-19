param(
  [string]$Dest = "$env:USERPROFILE\Documents\Bazis\Scripts\0_BasisMCP_worker.js",
  [switch]$NoDeploy
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$src = Join-Path $root 'bridge\basis_mcp_worker.js'
Write-Host "source: $src"
if (!(Test-Path $src)) { throw "source not found" }

# 1) syntax check
$check = & node --check $src 2>&1
if ($LASTEXITCODE -ne 0) { throw "node --check failed:`n$check" }
Write-Host "syntax: OK"

# 2) non-ASCII guard (engine is CP1251; source must be pure ASCII)
$bytes = [System.IO.File]::ReadAllBytes($src)
$bad = 0
foreach ($b in $bytes) { if ($b -gt 127) { $bad++ } }
if ($bad -ne 0) { throw "non-ASCII bytes: $bad - fix before deploy" }
Write-Host "ascii: OK (0 non-ascii)"

# 3) version constant
$text = [System.IO.File]::ReadAllText($src)
if ($text -notmatch 'BASIS_MCP_VERSION = "([^"]+)"') { throw "version constant not found" }
$ver = $Matches[1]
Write-Host "version: $ver"

if ($NoDeploy) { Write-Host "NoDeploy: checks only, done"; exit 0 }

# 4) deploy + verify
Copy-Item -LiteralPath $src -Destination $Dest -Force
$srcMd5 = (Get-FileHash -Algorithm MD5 $src).Hash
$dstMd5 = (Get-FileHash -Algorithm MD5 $Dest).Hash
if ($srcMd5 -ne $dstMd5) { throw "md5 mismatch after copy" }
Write-Host "deployed: $Dest"
Write-Host "md5: $dstMd5"
Write-Host "NEXT: ask user to restart worker ('Scripts' -> 0_BasisMCP_worker); expected ping version: $ver"
