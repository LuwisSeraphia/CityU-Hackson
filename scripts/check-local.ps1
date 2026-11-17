param([switch]$Live)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw '请先按 docs/local-setup.md 创建 Python 虚拟环境并安装依赖。' }
Push-Location (Join-Path $projectRoot 'apps/api')
try {
    $arguments = @('-X', 'utf8', '-m', 'app.diagnostics')
    if ($Live) { $arguments += '--live' }
    & $pythonPath @arguments
    if ($LASTEXITCODE -ne 0) { throw '诊断发现未就绪项目，请根据输出逐项处理。' }
} finally { Pop-Location }
