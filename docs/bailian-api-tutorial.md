# Personal Agent：百炼 API 零基础接入教程

核对日期：2026-10-27。适用于本项目现有 QwenProvider，保留百炼 + PostgreSQL + pgvector 方案。本教程不代表账号已开通或真实调用已通过。

## 1. 先弄清楚需要准备什么

你需要一个已开通百炼的阿里云账号、一个选定的地域和业务空间、一个有对应模型权限的 API Key，以及本机项目。

百炼负责运行模型；本项目后端负责调用它们；PostgreSQL 保存你的记忆。你不需要下载这些云端模型，也不需要在百炼重新搭建一个智能体、工作流或知识库。项目已经实现了这些调用和记忆逻辑。

下面是本项目的配置，不是要求你分别注册四个账号：

| 本项目用途                   | 模型 ID             | `.env` 配置项     | 什么时候调用                             |
| ---------------------------- | ------------------- | ----------------- | ---------------------------------------- |
| 对话与选择工具               | `qwen-plus`         | `CHAT_MODEL`      | 提问时；工具返回后可能继续调用           |
| 提取记忆、关系判断、压缩摘要 | `qwen-flash`        | `EXTRACT_MODEL`   | 记录处理、符合策略的普通聊天、长对话压缩 |
| 生成语义向量                 | `text-embedding-v4` | `EMBEDDING_MODEL` | 事实提交后建索引、语义检索时编码问题     |
| 给召回结果重新排序           | `qwen3-rerank`      | `RERANK_MODEL`    | 当前实现中候选超过四条时                 |
| 联网搜索并返回来源           | `qwen-plus`         | `SEARCH_MODEL`    | Agent 决定调用联网工具时                 |

这是四个不同模型、五项用途。联网复用了 `qwen-plus`，只是请求接口和参数不同。通常一个同地域、同业务空间且有对应权限的 Key 即可；创建 Key 时不用为每个模型创建一份密钥，请求中的 `model` 决定调用哪个模型。[官方首次调用说明](https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen)

## 2. 登录并开通百炼

1. 打开 [阿里云百炼控制台](https://bailian.console.aliyun.com/)，用自己的阿里云账号登录；没有账号就先注册。
2. 首次进入如出现开通协议，按页面提示完成开通；若提示实名认证，先完成认证。
3. 本教程以 **华北 2（北京）** 为例。若你实际选择新加坡或其他地域，后续 Key 和全部地址都要取自那个地域。
4. 在业务空间管理中确认使用哪个空间，初次可以用默认业务空间，记录它的 **WorkspaceId**。

控制台入口名称可能调整，找不到时可从 [官方首次调用教程](https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen) 中的“API Key”“业务空间管理”链接进入。

本项目使用普通模型 API。请从普通 API Key 管理入口创建 Key，不要把 Coding Plan 的专属 Key 和地址填进来；Coding Plan 面向指定编程工具，与这里的自建应用后端接入不同。[官方 Coding Plan 说明](https://help.aliyun.com/zh/model-studio/coding-plan-faq)

## 3. 创建一个供项目使用的 API Key

1. 进入控制台的 **API Key** 页面，确认右上角地域。
2. 点击“创建 API Key”，选择自己的归属账号和刚才的业务空间。
3. 若选择自定义模型权限，允许 `qwen-plus`、`qwen-flash`、`text-embedding-v4`、`qwen3-rerank`。若默认空间已有相应访问权限，也可使用现有 Key。
4. 复制完整 Key，下一步只粘贴到本机 `apps/api/.env`。

Key 的地域、权限及业务空间由控制台管理。若某个模型提示无权访问，检查该 Key 与空间的授权，而不是不断重新生成 Key。[官方获取 API Key 步骤](https://help.aliyun.com/zh/model-studio/get-api-key)

在模型列表或模型详情里确认上述四个 **模型 ID** 可调用。显示名称可能带中文，配置时使用 API 调用示例中的英文 ID。控制台推荐的新型号不一定等于项目当前选定的型号，先按本教程跑通；模型列表和价格会变化，以账号页面为准。[官方模型选择](https://help.aliyun.com/zh/model-studio/models)

## 4. 填入本机配置：只编辑模型相关字段

打开 PowerShell，进入项目目录：

```powershell
Set-Location 'E:\2026CityU\Personal Agent'
./scripts/setup-local.ps1
```

如果显示“已有本机配置，未覆盖”，这是正常的：本项目此前已生成配置。不要删除现有文件重新生成。

用编辑器打开 `E:\2026CityU\Personal Agent\apps\api\.env`。注意是 `.env`，不是 `.env.example`，也不要保存成 `.env.txt`。下面是需要核对的模型字段；**不要用这段内容覆盖整个文件**，原来的 `DATABASE_URL`、`API_TOKEN` 等字段必须保留。

### 北京地域、带业务空间的配置示例

将 `YOUR_WORKSPACE_ID` 替换为控制台显示的真实业务空间 ID；将 `YOUR_BAILIAN_API_KEY` 替换为复制的 Key。替换后不应残留这两个占位符。

```dotenv
DASHSCOPE_API_KEY=YOUR_BAILIAN_API_KEY
QWEN_BASE_URL=https://YOUR_WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/compatible-mode/v1
CHAT_MODEL=qwen-plus
EXTRACT_MODEL=qwen-flash
EMBEDDING_MODEL=text-embedding-v4
EMBEDDING_DIMENSIONS=1024
RERANK_MODEL=qwen3-rerank
RERANK_URL=https://YOUR_WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank
SEARCH_MODEL=qwen-plus
SEARCH_URL=https://YOUR_WORKSPACE_ID.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/text-generation/generation
```

当前官方首次调用及向量、重排示例使用带 WorkspaceId 的域名；项目模板和部分官方 Key 文档仍有 `dashscope.aliyuncs.com` 公共域名示例。请以所选地域、业务空间的控制台调用示例为准，不能保证旧模板地址适用于每个新空间。本文采用带空间的北京地址，三个地址使用同一个空间和地域。[官方地址示例](https://help.aliyun.com/zh/model-studio/first-api-call-to-qwen) · [向量接口](https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api) · [重排接口](https://help.aliyun.com/zh/model-studio/text-rerank-api)

三个地址的填法不同：

| 字段            | 填到哪里结束                                       | 代码会做什么                                  |
| --------------- | -------------------------------------------------- | --------------------------------------------- |
| `QWEN_BASE_URL` | `/compatible-mode/v1`                              | 自动追加 `/chat/completions` 或 `/embeddings` |
| `SEARCH_URL`    | `/api/v1/services/aigc/text-generation/generation` | 直接使用完整 URL                              |
| `RERANK_URL`    | `/api/v1/services/rerank/text-rerank/text-rerank`  | 直接使用完整 URL                              |

因此，不能把完整聊天 URL 填进 `QWEN_BASE_URL`，也不能把聊天地址原样复制到重排地址。

还有两个名字相似但用途不同的凭据：`DASHSCOPE_API_KEY` 是百炼 Key；`API_TOKEN` 是项目自己生成的本机后端凭据，和前端 `AGENT_API_TOKEN` 配对。不要用百炼 Key 替换后二者。现有三个 `.env` 文件都已被 Git 忽略，不要把内容贴到聊天或提交到仓库。

本项目通过 Python 设置模块读取 `.env`，无需额外安装 OpenAI SDK，也无需再把 Key 写进代码。若你之前在系统环境变量中设置过同名字段，进程环境值会优先于 `.env`；遇到“改了仍用旧值”时核对这一点。修改后重启后端，配置才会重新加载。

## 5. 每个模型究竟怎么接

以下 JSON 是现有适配器的简化请求示例，用来解释各模型的职责。你不用复制这些 JSON 去写程序，下一节的诊断命令会实际测试它们。

### A. qwen-plus：回答与 Tool Calling

配置 `CHAT_MODEL=qwen-plus`，通过 `QWEN_BASE_URL + /chat/completions` 调用。

```json
{
  "model": "qwen-plus",
  "messages": [{ "role": "user", "content": "请用一句话介绍你自己。" }],
  "enable_thinking": false,
  "max_tokens": 100
}
```

普通回答从 `choices[0].message.content` 读取。需要工具时，后端还会传入 `tools`，模型返回 `tool_calls`，本机执行工具，再把结果传回模型。配置 Key 后，无需在百炼控制台逐个注册本项目的记忆或文件工具；这些工具由项目后端声明和执行。[官方 Function Calling](https://help.aliyun.com/en/model-studio/qwen-function-calling)

诊断对应 `tool_calling`。它会检查“模型选择工具 → 回传工具结果 → 模型继续回答”，不是仅测试能否说“你好”。

### B. qwen-flash：提取、判断和摘要

配置 `EXTRACT_MODEL=qwen-flash`，仍通过同一个 `/chat/completions` 接口。

```json
{
  "model": "qwen-flash",
  "messages": [
    {
      "role": "system",
      "content": "返回 JSON 对象，用 preference 字段记录用户明确说出的回答偏好。"
    },
    { "role": "user", "content": "我喜欢简洁回答。" }
  ],
  "response_format": { "type": "json_object" },
  "enable_thinking": false
}
```

这里预期得到可解析的 JSON。项目真正使用的提取结构比示例完整，会包含证据、事实/事件、计划状态等，并由后端检查后决定保存或待确认。上下文压缩也使用这个模型，但输出为摘要，不把摘要当作新事实保存。[官方 JSON 输出说明](https://help.aliyun.cn/zh/model-studio/qwen-structured-output)

诊断对应 `structured_extraction`。摘要本身由后面的完整真实验收验证。

### C. text-embedding-v4：把文本变成可检索向量

配置 `EMBEDDING_MODEL=text-embedding-v4`、`EMBEDDING_DIMENSIONS=1024`，通过 `QWEN_BASE_URL + /embeddings` 调用。

```json
{
  "model": "text-embedding-v4",
  "input": ["我喜欢简洁且有条理的回答。"],
  "dimensions": 1024
}
```

预期 `data[0].embedding` 是 1024 个数字，不是自然语言回答。项目把向量和对应事实版本存入数据库，查询时再给问题生成向量并比较。该模型支持 1024 维，当前项目也按此配置。[官方向量接口](https://help.aliyun.com/zh/model-studio/text-embedding-synchronous-api)

诊断对应 `embedding`，会检查维度和有效数值。以后已有记忆时，更换向量模型或维度需要重建索引；不能把不同模型的向量直接放在一起比较。

### D. qwen3-rerank：把更相关的候选排前面

配置 `RERANK_MODEL=qwen3-rerank`，请求发往完整的 `RERANK_URL`。

```json
{
  "model": "qwen3-rerank",
  "input": {
    "query": "用户喜欢怎样的回答？",
    "documents": ["用户喜欢简洁回答。", "用户昨天阅读数据库文档。"]
  },
  "parameters": { "top_n": 2, "return_documents": false }
}
```

预期 `output.results` 包含排序结果，其中 `index` 指向输入候选的原始位置。它不生成记忆、不修改事实，也不直接写最终答案。[官方重排接口](https://help.aliyun.com/zh/model-studio/text-rerank-api)

诊断对应 `rerank`。正常使用中不是每个问题都调用；当前实现候选超过四条才启用，失败会保留原检索顺序并提示降级。

### E. qwen-plus：联网及可回查来源

配置 `SEARCH_MODEL=qwen-plus`，请求发往完整的 `SEARCH_URL`，不是聊天兼容地址。

```json
{
  "model": "qwen-plus",
  "input": {
    "messages": [{ "role": "user", "content": "查找 PostgreSQL 官方文档。" }]
  },
  "parameters": {
    "enable_search": true,
    "search_options": { "forced_search": true, "enable_source": true },
    "enable_thinking": false,
    "result_format": "message"
  }
}
```

这里除了回答，还需要搜索来源元数据 `search_info.search_results`；项目兼容它位于响应顶层或 `output` 内。模型正文里写了网址不等于拿到了搜索证据。联网由原生接口的搜索参数启用，本项目不需要你另建一个百炼搜索应用。[官方联网搜索](https://help.aliyun.com/zh/model-studio/web-search)

诊断对应 `web_search`。只看到普通对话成功，还不能判断联网已接通。

## 6. 先验证云端，再验证整个 Agent

在项目根目录执行：

```powershell
./scripts/check-local.ps1
```

这是只读检查，不调用模型、不产生云端模型费用。`cloud_key=passed` 只说明 Key 已填写，`provider_endpoints=passed` 只说明地址格式符合检查，均不等于真实可用。

确认 Key 与地址填写好后，执行：

```powershell
./scripts/check-local.ps1 -Live
```

**这一步开始实际调用百炼，会使用账户额度或产生费用。** 使用的是固定合成资料，不是你的聊天记录。检查依次覆盖工具调用、JSON 提取、向量、重排和联网。每项有独立结果；一项失败仍继续检查后面的项目，便于排查。

| 输出项                  | 期望结果                        | 说明                                   |
| ----------------------- | ------------------------------- | -------------------------------------- |
| `tool_calling`          | `passed`                        | Plus 能调用工具并接收结果              |
| `structured_extraction` | `passed`                        | Flash 能输出要求的 JSON                |
| `embedding`             | `passed`，`dimensions=1024`     | 向量接口可用且维度正确                 |
| `rerank`                | `passed`                        | 重排接口返回合法索引                   |
| `web_search`            | `passed`，`source_count` 大于 0 | 联网接口返回可验证来源                 |
| `cloud_verified`        | `true`                          | 以上云端能力均通过，不代表数据库已就绪 |

若本机数据库尚未安装，`database=failed`、总结果 `ok=false` 和脚本非零退出是预期的；仍可以单独查看上述五个云端结果。成功结果中会记录 `provider_request_id`，它是排查调用的编号，不是 Key。不要把整份 `.env` 当作错误报告发送。

## 7. 接上数据库，体验“记住你”

百炼提供推理服务，持久记忆仍需要本机 PostgreSQL。按 [本机配置与启动说明](local-setup.md) 安装并启动 Docker Desktop，使用 Linux containers；或准备自己的 PostgreSQL + pgvector。

终端 A，进入项目根目录后：

```powershell
./scripts/start-db.ps1
./scripts/start-api.ps1
```

后端运行时保持终端 A 打开。另开终端 B，进入项目根目录：

```powershell
npm run dev
```

打开终端实际显示的地址，默认 `http://127.0.0.1:3000`。如果端口已被占用，先确认已有进程属于谁，不要直接结束未知进程。原来的 3002 预览属于另一次启动，不能据此判断新服务已经加载了新配置。

再开终端 C，进入项目根目录执行：

```powershell
./scripts/verify-live.ps1
```

这会再次实际调用模型，并在独立验收 owner 下写入合成数据，检查记忆提取、向量、跨会话召回、文件/网页工具及摘要，最后启动新进程核对数据库记录。它比能力探测调用更多；不必反复运行来试错，先处理前一步失败的项目。

然后在网页中体验：开启智能记忆 → 发送“我喜欢简洁且有条理的回答” → 等待记忆回执 → 查看保存的事实及来源 → 新建会话问“我喜欢什么样的回答”。重要变更应先出现确认卡片。数据库重启复核的方法见 [持久化验收步骤](local-setup.md#测试与真实验收)。

## 8. 常见问题按现象排查

| 现象                         | 优先检查                                                                   |
| ---------------------------- | -------------------------------------------------------------------------- |
| `MODEL_NOT_CONFIGURED`       | `.env` 中是否填写 `DASHSCOPE_API_KEY`；修改后是否重启                      |
| HTTP 401 / 鉴权失败          | Key 是否完整、地域是否相同、是否混用了专属套餐 Key                         |
| HTTP 403 / 无权限            | Key 的模型授权、业务空间授权及服务开通情况                                 |
| HTTP 400 / 404               | 模型 ID、完整路径、WorkspaceId；是否错误重复追加 `/chat/completions`       |
| 额度或余额不足               | 在百炼控制台查看额度、账单和服务状态，不要反复发送同一请求                 |
| HTTP 429                     | 请求过快或限额；稍后重试并查看控制台配额                                   |
| 对话成功，embedding 失败     | 向量模型权限、`/embeddings` 地址、1024 维设置                              |
| `SEARCH_SOURCES_UNAVAILABLE` | 搜索模型及原生搜索 URL；没有来源不能当作联网成功                           |
| `database=failed`            | PostgreSQL/Docker 是否启动、`DATABASE_URL` 是否正确，与云端 Key 是不同问题 |
| `frontend_token=failed`      | 后端 `API_TOKEN` 与前端 `AGENT_API_TOKEN` 是否一致                         |
| 改了配置仍不生效             | 文件是否误存为 `.env.txt`、是否重启、是否有同名系统环境变量覆盖            |

项目会屏蔽上游可能包含敏感内容的错误详情，部分问题只显示 HTTP 状态。排查时记录失败项、错误码、所选地域和模型 ID 即可。

## 9. 费用怎么理解

模型调用通常按实际用量计费，输入和输出的价格可能不同；账户活动、免费额度和有效期以控制台为准，不假定注册后所有模型都能永久免费使用。[官方模型价格](https://help.aliyun.com/zh/model-studio/model-pricing)

一次聊天不一定只调用一次模型：Agent 可能经历工具循环，后台可能提取记忆并生成向量。项目已经按需触发重排和压缩，但预算仍应按完整流程观察。先用短的合成记录验证，在控制台查看实际用量，再持续使用。

你现在可以先只完成第 2–4 节：开通普通百炼 API、确认地域和业务空间、把一个 Key 与三个地址填好。无需改项目接口代码。
