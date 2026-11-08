# install-worker.ps1 - install Basis MCP worker scripts into the BASIS Scripts folder
$ErrorActionPreference = "Stop"

$repo = Split-Path -Parent $PSScriptRoot
$dirs = @()
$docs = Join-Path $env:USERPROFILE "Documents"
Get-ChildItem $docs -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -like "Bazis*" } | ForEach-Object {
    $scripts = Join-Path $_.FullName "Scripts"
    if (Test-Path $scripts) { $dirs += $scripts }
}

if ($dirs.Count -eq 0) {
    Write-Error "BASIS Scripts folder not found under $docs\Bazis*\Scripts"
    exit 1
}

foreach ($dir in $dirs) {
    Copy-Item (Join-Path $repo "bridge\basis_mcp_worker.js")      (Join-Path $dir "0_BasisMCP_worker.js") -Force
    Copy-Item (Join-Path $repo "bridge\basis_mcp_worker_stop.js") (Join-Path $dir "1_BasisMCP_stop.js")    -Force
    Copy-Item (Join-Path $repo "bridge\basis_mcp_probe.js")       (Join-Path $dir "basis_mcp_probe.js")    -Force
    Write-Output "Installed to $dir"
}

Write-Output "Done. In BASIS: menu Scripts -> 0_BasisMCP_worker"
