$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv/Scripts/python.exe'
$reportDirectory = Join-Path $projectRoot 'apps/api/.data/verification'
[void](New-Item -ItemType Directory -Path $reportDirectory -Force)
$reportPath = Join-Path $reportDirectory ('live-' + [guid]::NewGuid().ToString() + '.json')
Push-Location (Join-Path $projectRoot 'apps/api')
try {
    & $pythonPath -X utf8 -m app.smoke --live --report $reportPath
    if ($LASTEXITCODE -ne 0) { throw '真实集成验收未通过；请按输出检查配置或服务能力。' }
    # The first Python process has exited; this process creates a new DB engine and connection.
    & $pythonPath -X utf8 -m app.persistence --report $reportPath
    if ($LASTEXITCODE -ne 0) { throw '模型验收完成，但新进程持久化核对未通过。' }
    Write-Output "验收报告：$reportPath"
} finally { Pop-Location }
