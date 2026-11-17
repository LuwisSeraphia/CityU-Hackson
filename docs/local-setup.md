# 本机启动 Personal Agent

本版本默认连接真实 FastAPI，不会在失败时切回模拟回答。`/demo` 单独保留前端演示用于回归测试。

## 当前机器的准备情况

项目 Python 虚拟环境、前端依赖和 Docker 已安装。本机已配置百炼及 PostgreSQL，并通过真实基础闭环与独立进程持久化验收，见 [验证记录](verification.md)。以下步骤用于理解配置和在其他环境重新安装；不要覆盖本机已有 `.env`。单元测试仍使用独立 SQLite 与替身模型，与真实验收分别记录。

## 1. 生成配置

在项目根目录 PowerShell 执行：

```powershell
./scripts/setup-local.ps1
```

脚本生成 `apps/api/.env`、`apps/web/.env.local`、`infra/.env`。它会随机生成并匹配数据库密码和本地 API_TOKEN，不打印密码、不覆盖现有文件。三个文件均被 Git 忽略。若已存在配置，请人工核对 `API_TOKEN` 与 `AGENT_API_TOKEN` 相同，数据库 URL 密码与 `POSTGRES_PASSWORD` 相同。

首次在其他机器安装：先安装 Python 3.12+ 和 Node.js 22+，然后：

```powershell
py -3.12 -m venv .venv
./.venv/Scripts/python.exe -m pip install -r apps/api/requirements.lock
npm ci
./scripts/setup-local.ps1
```

## 2. 开通百炼并填入本机文件

首次使用平台，请先按 [百炼 API 零基础接入教程](bailian-api-tutorial.md) 操作，包含业务空间地址、每个模型的请求示例和诊断结果说明。

登录 [阿里云百炼控制台](https://bailian.console.aliyun.com/)，在你选择的地域和工作空间开通模型并创建 API Key。此步骤需要你本人操作账户。不要把 Key 发在聊天里。

在 `apps/api/.env` 填入 `DASHSCOPE_API_KEY`，核对以下字段：

| 字段未提供 embedding 接口
| 用途 |
| -------------------------------------- | -------------------------------------------------------------- |
| QWEN_BASE_URL | 控制台提供的 OpenAI 兼容地址，用于对话、提取、压缩与 embedding |
| SEARCH_URL | 同地域原生 text-generation/generation 地址，联网并返回搜索来源 |
| RERANK_URL | 同地域原生 text-rerank 地址 |
| CHAT_MODEL / SEARCH_MODEL | 默认 qwen-plus，请确认当前账户可用 |
| EXTRACT_MODEL | 默认 qwen-flash，用于结构化提取、关系判定、摘要 |
| EMBEDDING_MODEL / EMBEDDING_DIMENSIONS | 默认 text-embedding-v4 / 1024 |
| RERANK_MODEL | 默认 qwen3-rerank |

模板使用北京公共地址作为起点。若你的控制台给出带工作空间 ID 的地址，请替换全部三个地址；新加坡等地域不能只换 Key 而沿用北京地址。以控制台实际可用模型和地域为准。更换 embedding 模型或维度后需要重建现有向量，不能混用。

联网来源使用百炼原生接口 `enable_search + enable_source`；不能以生成文本里的 URL 冒充搜索结果。参考 [百炼联网搜索](https://help.aliyun.com/en/model-studio/web-search) 和 [排序 API](https://help.aliyun.com/en/model-studio/text-rerank-api)。调用会消耗账户额度。

## 3. 启动 PostgreSQL + pgvector

安装并启动 [Docker Desktop for Windows](https://docs.docker.com/desktop/setup/install/windows-install/)，使用 Linux containers。然后：

```powershell
./scripts/start-db.ps1
```

使用 `pgvector/pgvector:pg17`，只绑定 `127.0.0.1:5432`。数据保存在 Docker named volume `personal_agent_db`，重启容器不会清空。不要执行 `docker compose down -v`，它会删除数据卷。

也可以使用已有 PostgreSQL 17 + pgvector：创建数据库及账号，将 `DATABASE_URL` 改为对应的 `postgresql+psycopg://...` 地址。首次初始化账号需要创建扩展权限，或由管理员先执行 `CREATE EXTENSION vector`。启动自动执行受版本控制的 schema 初始化/升级。

## 4. 启动后端和前端

两个 PowerShell 终端，均在项目根目录：

```powershell
# 终端 A（保持运行）
./scripts/start-api.ps1

# 终端 B
npm run dev
```

打开 http://127.0.0.1:3000 。首次未连接时会展示配置状态。更改 `.env` 后重启后端；更改 `.env.local` 后重启前端。

后端只监听本机，前端服务端代理注入 API_TOKEN；浏览器不会拿到百炼密钥或数据库密码。当前是本机单用户版本，不应直接公开到公网。只支持一个后端 worker，数据库 advisory lock 防止后台任务并行重复领取。

### 逐项检查环境

```powershell
./scripts/check-local.ps1
```

默认检查 API_TOKEN、前后端配置文件中的凭据是否匹配、云端地址格式、模型名称，以及真实 PostgreSQL 连接、pgvector 距离运算和 schema revision。数据库检查使用只读事务，不创建扩展、不迁移表、不读取个人记忆；配置中的模型名称或 Key 已填写只表示配置存在，不表示已经调用成功。任何检查失败返回非零退出码。修改环境文件后仍需重启服务；该命令不读取正在运行的 Next.js 进程环境。

配置补齐后，显式运行以下命令检查云端能力（会消耗百炼额度）：

```powershell
./scripts/check-local.ps1 -Live
```

它使用固定合成资料，分别检查对话模型的工具调用及结果回传、提取模型的 JSON、embedding 维度、rerank、带来源元数据的联网搜索。成功项记录 provider request ID；单项失败后仍检查其余能力，方便定位模型权限或地域配置问题。不读取个人聊天、不写入长期记忆，也不把能力检查当作业务闭环验收。数据库不可用时仍可独立检查云端能力。

## 5. 体验闭环

1. 开启智能记忆，告诉 Agent：“我喜欢简洁且有条理的回答。”等待记忆处理回执。
2. 查看“记忆与上下文”和“我的记忆”，确认事实与来源。新建会话后询问自己的回答偏好。
3. 描述一个重要变化，确认候选。修改候选后必须重新审核，再确认生效。
4. 关闭智能记忆或勾选“提问不记入长期记忆”，验证普通聊天不新增事实。显式“记录到记忆”仍可用。
5. 上传 TXT/MD/文本 PDF/DOCX，要求先检索文件，再联网查找相关最新资料。来源抽屉区分文件与网页。
6. 长对话超过配置的 `CONTEXT_CHARS`（默认 24000 字符）会压缩较早消息，保留最近六条及摘要原文指针。
7. 删除事实后，全部版本和向量清空，原文保留；旧事实不再自动召回。为防止复活，遗忘之前的会话上下文也不再送给模型；可以显式查看保留的原始记录。
8. 临时对话只留在当前打开的面板，关闭后清空，不读取个人记忆、不持久化消息/文件/摘要。仍然调用云端模型，不保证云端零保留。

## 测试与真实验收

```powershell
./.venv/Scripts/python.exe -m pytest apps/api/tests -q -c apps/api/pyproject.toml
./.venv/Scripts/python.exe -m ruff check apps/api
npm test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

单元与浏览器契约测试使用明确的替身，不能作为真实大模型/数据库验收。真实验收还必须完成上面的跨会话记忆、服务重启持久化、百炼返回 request_id、真实网页和文件三类证据场景。没有云端密钥和数据库时，应将这些项目标为“未执行”，不得标成通过。

配置好后运行 `./scripts/verify-live.ps1`，会实际消耗百炼额度，并使用独立 `verification-*` owner 检查真实提取/向量、数据库重新连接、跨会话检索、三类工具与引用、真实摘要。失败返回非零状态，不回退 Mock。验收数据保留在该隔离 owner，便于定位。

完整模型验收成功后，脚本将报告写入 `apps/api/.data/verification/live-<随机编号>.json`，随后等待首个 Python 进程退出，再启动独立进程读取数据库。报告仅含隔离 owner、调用编号、表行数及内容校验摘要，不含 Key、数据库密码、记忆正文、文件内容或向量；该目录已被 Git 忽略。核对覆盖会话、来源、事实与版本、向量、任务、工具记录、文件片段和上下文摘要；行数相同但内容改变也会失败。空数据库、缺少验收数据或错误 owner 不会通过。

独立进程核对不等于 PostgreSQL 容器/操作系统重启测试。需要验证数据库重启时，先正常重启自己的数据库服务（Docker 使用 `docker compose --env-file infra/.env -f infra/compose.yaml restart postgres`，不要删除卷），再运行：

```powershell
./scripts/verify-persistence.ps1 -ReportPath '上一步输出的完整报告路径'
```

此命令只读数据库和验收报告，不调用云端，不需要再次消耗模型额度。不要修改隔离 owner 的验收数据，否则校验会报告差异。报告用于本机回归核对，不是签名证明或数据备份。真实浏览器交互和 API 进程重启后的可用性，仍需执行前面的“体验闭环”。

## 已知边界

本轮实现按状态轮询展示工具活动，并提供 SSE 状态事件接口；模型回答完成后一次显示全文，尚无逐 token 输出。文件检索先采用中文二元词/英文词的关键词匹配，记录在文档片段中，文件向量检索与 OCR 未启用。个人记忆使用 pgvector + 关键词混合检索和条件重排。初版关键词候选限制最近 2000 条，关系比对限制最近 100 条事实；更大数据量需补全文检索索引与分层召回。取消无法撤销已发送的云端请求或已提交的记忆事务，界面会保留处理回执。
