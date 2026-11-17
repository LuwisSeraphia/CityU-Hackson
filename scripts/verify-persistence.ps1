param([Parameter(Mandatory = $true)][string]$ReportPath)
$ErrorActionPreference = 'Stop'
$resolvedReport = (Resolve-Path -LiteralPath $ReportPath).Path
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv/Scripts/python.exe'
Push-Location (Join-Path $projectRoot 'apps/api')
try {
    & $pythonPath -X utf8 -m app.persistence --report $resolvedReport
    if ($LASTEXITCODE -ne 0) { throw '持久化核对未通过，请根据输出检查。' }
} finally { Pop-Location }
