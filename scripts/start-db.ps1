$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $projectRoot 'infra/.env'
if (-not (Test-Path -LiteralPath $configPath)) { throw '先运行 ./scripts/setup-local.ps1。' }
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { throw '请先安装并启动 Docker Desktop（Linux containers），详见 docs/local-setup.md。' }
& docker compose --env-file $configPath -f (Join-Path $projectRoot 'infra/compose.yaml') up -d --wait
if ($LASTEXITCODE -ne 0) { throw '数据库启动失败，请检查 Docker 服务和 5432 端口。' }
