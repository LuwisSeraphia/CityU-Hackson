# 当前项目本地启动

当前唯一前端是仓库根目录的知乎 / Three.js / Vite 界面。旧 Next.js 前端 `apps/web/` 已移除。后端位于 `apps/api/`，聊天与技能的最小链路已接通。建议先按 [最小框架说明](minimal-chat-framework.md) 使用 `python scripts/dev_local.py --demo` 启动完整联调。下面的 `npm run dev` 仅启动前端。

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

聊天、技能表单、历史、运行状态、停止、重试与来源已通过 Vite 服务端代理接通。知识墙仍本地保存，可选择将命中节选作为会话附件发送后端。定时任务仍是本地演示。参见 [最小框架说明](minimal-chat-framework.md)。旧 Next.js 代理仍不存在，凭据不下发浏览器。

## 知识书墙双模式与 AI 分区

知识书墙现在在侧栏右侧展开为独立页面，可通过图标切换灵感泡泡与图书馆卡片。分区、标签、编辑内容与最近阅读记录保存在当前浏览器，兼容原有知识资料。最近阅读 / 新增 / 修改的资料优先浮现，最多显示 12 个泡泡；14 秒轮换，鼠标停在泡泡区或键盘正在操作泡泡时暂停轮换；其他泡泡仍独立游动。泡泡采用随机位置、尺寸、方向和轻微避让，灵感搜索固定在页面底部。工作概览右上角可收起，选择会保存在本浏览器。

“本地分类建议”使用关键词，不调用模型。“AI 识别分区”会发送标题与前 6000 字正文到后端配置的模型；返回的分区只是建议，保存知识后才新增或应用。分类接口不依赖数据库，但需要配置后端模型密钥和 API_TOKEN。

在 Conda `hackson-cityu` 环境中，从仓库根目录执行：

```bash
python scripts/setup_local.py
# 在 apps/api/.env 中配置 DASHSCOPE_API_KEY；不要将密钥写入 VITE_* 变量
python -m uvicorn app.main:app --app-dir apps/api --host 127.0.0.1 --port 8000
```

另开终端，激活同一环境，在仓库根目录运行 `npm run dev`。Vite 启动时读取后端 `.env` 中的 API_TOKEN，并仅在服务端代理 `/api/knowledge/classify`，浏览器不接收该凭据。修改凭据后需要重启 Vite。后端未运行或未配置时，页面显示错误提示，可继续使用本地建议和手动分区。

该代理目前用于本地开发；部署 `dist/` 时，需要由部署服务器为同一路径提供认证代理。聊天和任务仍是本地演示，此次 AI 接入仅用于知识分区。
