# 当前项目本地启动

当前唯一前端是仓库根目录的知乎 / Three.js / Vite 界面。旧 Next.js 前端 `apps/web/` 已移除。后端代码保留在 `apps/api/`，目前未与知乎前端接通。

## 启动知乎前端

需要 Node.js 20.19+（推荐 22）：

```bash
npm ci
npm run dev
```

打开终端输出的地址，默认 http://localhost:5173。前端不要求启动数据库或配置模型密钥。

```bash
npm run check
npm test
npm run build
npm run preview
```

## 单独启动后端（可选）

后端需要 Python 3.12+。Windows PowerShell：

```powershell
py -3.12 -m venv .venv
./.venv/Scripts/python.exe -m pip install -r apps/api/requirements.lock
./scripts/setup-local.ps1
```

配置脚本只生成 `apps/api/.env` 和 `infra/.env`，不覆盖已有配置，不再创建旧前端目录。按 `apps/api/.env.example` 配置后端；模型接入参考 [百炼教程](bailian-api-tutorial.md)。凭据只保留在后端文件中。不要将 API_TOKEN 或模型密钥写入前端。

需要 PostgreSQL / pgvector 时，安装并启动 Docker，然后在两个终端分别运行：

```powershell
./scripts/start-db.ps1
./scripts/start-api.ps1
```

后端默认监听 http://127.0.0.1:8000，数据库绑定本机 5432。数据库数据使用 Docker named volume 保存。

Linux / WSL 可使用：

```bash
python3.12 -m venv .venv
.venv/bin/python -m pip install -r apps/api/requirements.lock
.venv/bin/python scripts/setup_local.py
docker compose --env-file infra/.env -f infra/compose.yaml up -d
cd apps/api
../../.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --workers 1 --no-access-log
```

后端单元测试可在 `apps/api/` 下使用虚拟环境执行 `python -m pytest`。本次合并不代表数据库、云模型或前后端联调已验证；原有验证文档仅按其记录时间理解。

## 后续接口对接

当前知乎界面保留本地对话回执、知识检索与办公室动画。接入后端需要新增安全代理与接口适配，再连接真实任务、历史和知识接口；当前没有 Next.js `/api/agent` 代理。后端诊断在旧前端不存在时跳过旧前端令牌一致性检查，不将跳过当作联调成功。
