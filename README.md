# Personal Agent

基于 Next.js、FastAPI 和 PostgreSQL / pgvector 的本地个人记忆助手。

代码包含对话与工具调用、记忆审核与版本管理、个人画像、知识库、检索与上下文管理。当前面向本机单用户使用。

## 快速开始

准备 Python 3.12+、Node.js 22+ 和 Docker Desktop，在根目录 PowerShell 中执行：

```powershell
py -3.12 -m venv .venv
./.venv/Scripts/python.exe -m pip install -r apps/api/requirements.lock
npm ci
./scripts/setup-local.ps1
```

在生成的 apps/api/.env 中填写自己的百炼配置，再执行：

```powershell
./scripts/start-db.ps1
./scripts/start-api.ps1
# 另一个终端
npm run dev
```

访问 http://127.0.0.1:3000 。详细说明见 [启动文档](docs/local-setup.md)。

## 代码与文档

- apps/web：前端、代理接口和测试。
- apps/api：后端、依赖及测试；兼容模块也需要保留。
- infra、scripts：数据库配置、启动与验证脚本。
- tests：文档契约测试。
- mermaid：流程图源文件。
- [文档导航](docs/README.md)：重要文档入口。

## 验证

```powershell
npm run typecheck
npm run lint
npm test
./.venv/Scripts/python.exe -m pytest apps/api/tests
node --test tests/*.test.mjs
```

本目录是工作区当前代码的整理快照，包含未提交功能。本次未重新执行完整业务测试，历史验收结果不代表该快照已重新验收。真实模型验收需要自己的凭据并产生调用费用。
