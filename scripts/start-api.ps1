$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonPath = Join-Path $projectRoot '.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $pythonPath)) { throw '缺少项目 Python 环境，请先按 docs/local-setup.md 安装依赖。' }
Push-Location (Join-Path $projectRoot 'apps/api')
try { & $pythonPath -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log }
finally { Pop-Location }
