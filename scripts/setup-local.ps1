param([string]$Python = "")
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Python) { $Python = Join-Path $projectRoot '.venv/Scripts/python.exe' }
if (-not (Test-Path -LiteralPath $Python)) { throw '请先安装 Python 3.12+，创建 .venv 并安装 apps/api/requirements.lock，详见 docs/local-setup.md。' }
& $Python (Join-Path $PSScriptRoot 'setup_local.py') --root $projectRoot
if ($LASTEXITCODE -ne 0) { throw '本机配置失败。' }
