# Personal Agent V1.0｜长期记忆对话模块

**产品需求文档（PRD）+ 技术设计规范（TDD）+ PoC 执行与排障手册**  
**文档版本：** 1.0（设计冻结候选稿）  
**文档日期：** 2026-10-24  
**状态：** 可进入分阶段开发；模型 API 与少量部署参数需在 P0 现场验证  
**目标读者：** 产品负责人、前端工程师、后端工程师、AI/检索工程师、测试工程师（初期可以是同一开发者）

> **一句话定义：** 第一版只做一个可以“主动记录 + 跨会话记住 + 正确更新 + 有证据地回答”的记忆对话窗口。它是未来 Personal Agent 的核心记忆引擎原型，不是普通套壳聊天，也不是完整的多工具 Agent。

## 0. 执行摘要与确认决策

### 0.1 本版必须实现的闭环

用户进入唯一的记忆对话窗口，选择“记录”模式，输入日常经历、个人偏好、项目进展或计划。后端保存原始来源、提取事件与原子事实、判断新旧关系、执行无需确认的新增或生成变更确认提案、持久化事实与历史版本、异步生成两类 Embedding。之后，即使开始新的对话会话，用户在“提问”模式询问过往事项，系统也能通过双轨混合检索找到正确证据，调用 Qwen 生成带来源的回答。用户可点击来源查看记忆卡片；不确定则明确说明不知道。

### 0.2 决策登记（已确认，不在实现中自行变更）

| 编号 | 决策 | 约束说明 |
|---|---|---|
| ADR-001 | 第一版只有一个**记忆对话窗口** | “记录 / 提问”是同一个窗口里的输入模式，不做独立页面 |
| ADR-002 | 只有“记录”操作自动触发长期记忆写入 | “提问”只读取；聊天消息可以作为会话消息保存，但不得被自动转成长期记忆 |
| ADR-003 | 自研 Hybrid Memory Engine | Extractor / Resolver / Controller / Retriever 职责分离 |
| ADR-004 | Source + Episode + Atomic Fact 双轨 | 一份输入可有 0..N 事件和 0..N 事实；关联有来源证据 |
| ADR-005 | PostgreSQL + pgvector 单数据库 | 事实、版本、关系、任务、向量统一维护；无 Neo4j |
| ADR-006 | Qwen / 阿里云百炼为 PoC 模型服务 | Flash / Plus / Text Embedding / Rerank，最终可用模型 ID 由 P0 核查 |
| ADR-007 | 双轨混合检索 | Dense Vector + 关键词 + 结构化时间/实体约束；轨道内 RRF、跨轨证据分组 |
| ADR-008 | 自适应 Reranking | 简单问题 RRF+规则；复杂问题调用 Qwen Rerank API；失败回退 |
| ADR-009 | 低风险新增自动保存、重要变化请求确认 | 未批准的事实不得作为已确认的长期记忆参与检索 |
| ADR-010 | MVP 不开发复杂敏感记忆管理 | 仍需基础凭据拦截、数据隔离、访问控制与删除 |

### 0.3 第一版明确不做

不开发独立“新聊天”页面、知识图谱编辑页面、联网搜索页面、文件/图片/视频解析、多模态输入、自动操作日历/邮件、主动后台规划与提醒、多 Agent 协作、微服务、Neo4j、独立敏感 Vault、复杂 RAG 多路外部数据源。只预留模块接口，不开发空功能或假的按钮。

### 0.4 成功定义（四个可演示场景）

1. 用户第一次记录“我正在开发 Personal Agent，后端考虑用 FastAPI”，关闭或新开会话后问“我现在做什么项目”，能准确回答并引用来源。
2. 用户随后记录“我最终决定后端采用 FastAPI，数据库使用 PostgreSQL”，系统不增加重复画像；对已有计划做版本判断，必要时展示确认卡片。
3. 用户问“我之前考虑什么，现在决定什么，为什么”，回答能区分历史、当前和讨论理由；未记录过原因时不得虚构。
4. 用户问从未记录过的个人信息，Agent 表示“当前记忆中没有相关记录”，不猜测、不伪造引用。

## 1. 用户与交互范围

### 1.1 目标用户与任务

**MVP 用户：** 一名研发者本人，本地测试多次会话；架构要求所有数据具备 `owner_id`，为将来的多用户做好基础隔离。**目标任务：** 记录经历、随时提问、修正记忆、追溯出处、感受“越用越懂我”。

### 1.2 唯一窗口的信息架构

本版只实现一个桌面优先的 Memory Chat 页面，布局包含：顶部项目标识和当前会话；中部对话消息流（用户消息、AI 回复、系统记忆反馈卡片）；底部固定输入区（`记录到长期记忆` / `向二脑提问` 显式切换）；可折叠的内联证据详情抽屉（不是新页面）；少量会话控制。对话内容可以滚动，记忆卡片可在消息流中展开。

**模式区分：**

| 模式 | 用户输入 | 默认后端行为 | 是否永久更新长期记忆 |
|---|---|---|---|
| 记录 | “今天想到了一个关于 AI Agent 的点子” | POST record → 提取、去重、写入/待审 → 回显结果 | 是，仅经策略批准的候选 |
| 提问 | “我上周思考过哪些点子？” | POST chat → Retriever → Qwen 回复 | 否，永不隐式写入 |
| 记录后查看 | 点开记忆处理结果 | GET 来源、已入库事实、待审提案 | 否 |
| 重要变更确认 | 点“确认更新” | 服务端版本检查 → 提交新事实版本 | 是，批准后才生效 |

**避免歧义的设计：** 用户在“提问”模式说“我现在改用 PostgreSQL 了”，这只是聊天消息，不自动写入；界面提供明确的“将本条转为记录”操作，需要用户主动触发记录流程。

### 1.3 建议窗口线框（开发参考，不要求像素级实现）

```text
┌───────────────────────────────────────────────────────────────────────┐
│  ◉ Personal Agent / Memory                                     ⚙︎   │
│  当前会话：记忆对话                                     新建会话     │
├───────────────────────────────────────────────────────────────────────┤
│ 用户 [记录] 昨天研究了 Memory Retriever...                            │
│ 系统 [处理结果] 新增事件 1 / 新增事实 2 / 待确认 1   [展开]             │
│ AI   我已记录你昨天的研究...                                           │
│                                                                      │
│ 用户 [提问] 我目前项目的技术路线是什么？                               │
│ AI   根据你之前的记录，你正在开发 ... [来源 1] [来源 2]                │
│                                                                      │
│ [记忆变更确认卡片] 原方案 → 新方案    [确认] [修改] [忽略]             │
├───────────────────────────────────────────────────────────────────────┤
│  [● 记录到长期记忆] [○ 向二脑提问]                                      │
│  输入框：记录你的经历，或向自己的长期记忆提问...                      │
│  [发送]                                                        ⏎     │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.4 前端组件与具体要求

| 组件 | 职责 | 核心状态 | 错误/空态 |
|---|---|---|---|
| `MemoryChatPage` | 唯一页面容器、模式和会话管理 | `record` / `ask` | API 不可用提示 |
| `MessageList` | 按会话显示消息与卡片 | loading、streaming、done | 空会话引导 |
| `MessageComposer` | 输入、模式、发送和重复提交保护 | idle、submitting、disabled | 输入过长、网络失败 |
| `MemoryWriteReceipt` | 显示写入和提案统计、链接来源 | processing、partial、ready | 提取失败、索引待同步 |
| `MemoryChangeCard` | 重要变更确认，显示 Before/After | pending、approved、rejected、stale | 版本冲突重新加载 |
| `EvidenceDrawer` | 展开来源、事件和事实版本 | collapsed、loading、loaded | 来源无法取得 |
| `CitationChip` | AI 回复指向 memory/version/source | 可访问、已删除 | 失效引用提示 |
| `SystemStatus` | 当前服务及索引同步健康 | ready、degraded、unavailable | 不伪称已保存 |

**界面文案规则：** `已收到` ≠ `已提取` ≠ `已保存` ≠ `已索引`。任何阶段失败，都要显示准确状态和可重试路径。未经实际 DB 提交不得出现“成功记住”。

### 1.5 必须落地的产品需求（FR）

| 编号 | 产品需求 | 优先级 | 验收要点 |
|---|---|---|---|
| FR-01 | 同一窗口可切换“记录/提问” | P0 | 模式清晰、无隐式写入 |
| FR-02 | 个人记录创建原始来源 | P0 | 记录有 owner、source_id、时间、状态 |
| FR-03 | Extractor 提取 0..N 事件与 0..N 事实 | P0 | JSON Schema、原文证据、时间模态 |
| FR-04 | Resolver 进行去重与事实变更判断 | P0 | EQUIVALENT/ENRICHMENT/STATE_CHANGE/CONTRADICTION/UNRELATED |
| FR-05 | 低风险自动写入；重要变更确认 | P0 | Pending 不出现在已确认检索中 |
| FR-06 | 保留事实版本、来源和事件关联 | P0 | 可查看“当前/曾经”和依据 |
| FR-07 | Fact 与 Episode 各自创建向量 | P0 | 1024维、绑定版本和任务状态 |
| FR-08 | 普通提问召回双轨证据并回答 | P0 | 支持跨会话读取、有引用 |
| FR-09 | 简单查询快速检索，复杂查询按需重排 | P1 | 回退策略可测量 |
| FR-10 | 明确无证据时可拒答 | P0 | 无个人事实幻觉 |
| FR-11 | 记忆查看、修改、删除及重试 | P1 | 修改留版本，删除清派生索引 |
| FR-12 | 事件处理和检索可观测 | P0 | 每次请求有 trace_id 和阶段日志 |

## 2. 全链路技术流程图

### 2.1 总体技术架构

```mermaid
flowchart TD
  UI[单一 Memory Chat 窗口：记录 / 提问] --> API[FastAPI：Auth / API / SSE / Trace]
  API --> W[写入引擎：Extractor → Resolver → Controller]
  API --> R[检索引擎：Plan → Dual Retrieval → RRF → Rerank]
  W --> DB[(PostgreSQL + pgvector：Source / Episode / Fact / Version)]
  R --> DB
  DB --> O[Outbox / Worker]
  O --> EMB[Embedding API]
  W --> Q[Qwen Flash]
  R --> QR[Qwen Rerank / Plus]
  EMB --> DB
```

### 2.2 用户主动记录：写入时序与状态边界

```mermaid
flowchart TD
  A[用户显式选择记录模式并提交] --> B{认证 / 参数 / 幂等校验}
  B -->|通过| C[事务创建 Source + Job；返回 202]
  C --> D[Extractor 生成 Episode / Fact 候选]
  D --> E{Schema / 证据 / 时间校验}
  E -->|失败| ERR[任务标记失败，保留 trace_id，可安全重试]
  E -->|通过| F[Resolver 对比已有记忆]
  F --> G{Policy / 变更风险}
  G -->|普通新增| H[Controller 事务提交事实和 Outbox]
  G -->|重要变更或冲突| P[Proposal PENDING_REVIEW 等待用户]
  H --> I[后台 Worker 生成双轨 Embedding]
  I --> J[索引状态 READY / FAILED]
  P --> K[前端变更卡片]
  J --> L[前端记忆回执]
```

**要点：** 用户提交时只保证 Source 创建；Extractor 不能直接写事实；Resolver 根据旧事实提出动作；Controller 在同一事务内提交事实版本、证据链接、操作日志和 Outbox；Embedding 是提交后的异步任务；若 R1 待确认，新候选保持 `PENDING_REVIEW`，不提前更新当前事实。

### 2.3 用户提问：读取、证据分组和自适应重排

```mermaid
flowchart TD
  A[用户显式选择提问模式] --> AUTH[可信 RequestContext / 所有权约束]
  AUTH --> Q[Query Analyzer / Retrieval Plan]
  Q --> FV[Fact 向量与关键词]
  Q --> EV[Episode 向量与关键词]
  FV --> F[RRF / 候选融合]
  EV --> F
  F --> G[Evidence Grouper：来源去重]
  G --> T[Temporal Validator：当前/历史/计划]
  T --> D{Adaptive Rerank 路由}
  D -->|Fast| RULE[RRF + 规则排序]
  D -->|Deep| API[Qwen Rerank API]
  API -->|失败| RULE
  API --> C[Context Builder：引用与证据充分性]
  RULE --> C
  C --> LLM[Qwen Plus 生成有证据回答]
  LLM --> UI[流式消息与来源引用]
```

**要点：** 检索与生成解耦。先进行用户身份/用途校验，再分别执行 Fact、Episode 向量和关键词检索；按时间模式处理历史版本；通过证据组消除重复来源；Rerank 失败时回退到规则排序；只有被验证的证据进入 Prompt。

### 2.4 事实更新、重要变更确认与撤销

```mermaid
flowchart TD
  A[新候选触及已有重要事实] --> B[Resolver：关系类型 / base_version]
  B --> P[生成待审 Proposal]
  P --> UI[用户查看 Before / After / 来源]
  UI -->|忽略| REJ[REJECTED：不改事实]
  UI -->|确认| CHECK{当前版本仍匹配 base_version 吗}
  CHECK -->|否| STALE[409 STALE：重查并提示]
  CHECK -->|是| TX[Controller 原子提交新版本、操作日志、Outbox]
  TX --> IDX[异步向量索引刷新]
  IDX --> READY[更新时间线内联反馈]
```

**要点：** 同一状态主张只存在一个当前版本；旧版本不可覆盖性修改；批准必须带 `base_version_id`，防止两个标签页同时提交旧方案；撤销普通修改采用补偿版本，彻底删除是独立流程。

### 2.5 故障定位和恢复机制

```mermaid
flowchart TD
  A[任一阶段报错：trace_id + stage + code] --> B{失败位置}
  B -->|提取与校验| EX[只重试 Extractor，不提交无证据候选]
  B -->|事实事务| DB[回滚事务；源与任务显示失败]
  B -->|向量阶段| IDX[保留已提交事实；只重试 Embedding]
  B -->|Rerank| RRF[退回 RRF+规则并标注 PARTIAL]
  B -->|权限/DB读取| STOP[拒绝请求或报告 UNAVAILABLE]
  EX --> REG[保存脱敏故障样本与单模块回归]
  DB --> REG
  IDX --> REG
  RRF --> REG
  STOP --> REG
```

**要点：** 输入接收、提取、事实提交、向量索引、检索排序、聊天生成分别拥有状态与错误码；必要时只重跑失败阶段，不重复整条流水线。

### 2.6 核心实体关系（逻辑 ER 图）

```mermaid
erDiagram
  USERS ||--o{ CONVERSATIONS : owns
  USERS ||--o{ SOURCE_RECORDS : owns
  CONVERSATIONS ||--o{ CHAT_MESSAGES : contains
  SOURCE_RECORDS ||--o{ EPISODES : yields
  SOURCE_RECORDS ||--o{ FACT_EVIDENCE_LINKS : supports
  ATOMIC_FACTS ||--o{ FACT_VERSIONS : has
  EPISODES ||--o{ EPISODE_FACT_LINKS : connects
  ATOMIC_FACTS ||--o{ EPISODE_FACT_LINKS : connects
  FACT_VERSIONS ||--o{ FACT_EVIDENCE_LINKS : evidence
  FACT_VERSIONS ||--o{ MEMORY_EMBEDDINGS : indexes
  EPISODES ||--o{ MEMORY_EMBEDDINGS : indexes
  SOURCE_RECORDS ||--o{ MEMORY_PROPOSALS : suggests
  SOURCE_RECORDS ||--o{ PROCESSING_JOBS : processed_by
  PROCESSING_JOBS ||--o{ OUTBOX_EVENTS : emits
```

## 3. 记忆模型与数据库详细设计

### 3.1 三层结构与不变量

**原始层 Source：** 原始输入与提交上下文，供追溯与重处理。**事件层 Episode：** 按发生时间组织一段经历、事件或未来计划。**事实层 Atomic Fact：** 可以独立判断、检索、修订的用户画像/状态/事件事实。Source 与 Episode、Fact 分别关联，Episode ↔ Fact 多对多。事实版本采用追加式变更，不直接覆盖旧正文。

**核心不变量：**

1. 所有用户数据必须具有可信的 `owner_id`，由服务端确定；跨表关联还需校验 owner 一致。
2. 事实正文及原始证据不可由未经核验的 LLM 输出直接覆盖。
3. `source_record` 可以产生零条候选；不强制制造记忆。
4. `atomic_fact` 代表同一逻辑主张的身份；`fact_version` 是该主张某时刻的表述及有效性。
5. `event_time`（事实发生/计划发生）与 `recorded_at`（系统记录）不混淆。
6. 待确认、已删除、被撤销的记忆不得参与“当前已确认事实”检索。
7. 数据库事务成功与向量同步成功分开记录；检索必须可识别过时索引。
8. 一个来源支持多条事实，但不代表多份独立证据；跨轨证据聚合时按来源去重。

### 3.2 建议核心表（MVP）

| 表 | 主键及关键字段 | 索引与一致性约束 | 用途 |
|---|---|---|---|
| `users` | id, created_at, status | id 唯一 | 本地单用户 PoC 也不省略归属 |
| `conversations` | id, owner_id, created_at, title | owner_id + created_at | 会话容器，不等同长期记忆 |
| `chat_messages` | id, conversation_id, role, mode, content, created_at, trace_id | conversation_id + created_at | 展示聊天与记录交互；问答默认不提取 |
| `source_records` | id, owner_id, raw_text, timezone, recorded_at, status, idempotency_key | (owner_id,idempotency_key) 唯一 | 用户主动记录来源 |
| `episodes` | id, owner_id, source_id, title, summary, event_kind, occurrence_status, event_start/end, time_precision, status | owner_id + event_start | 事件轨 |
| `atomic_facts` | id, owner_id, subject_key, predicate_key, object_key, fact_type, current_version_id, status | owner_id + subject_key + predicate_key 的候选匹配索引（非简单强唯一） | 逻辑事实身份 |
| `fact_versions` | id, fact_id, version_no, content, modality, attribution, valid_from/to, recorded_at, superseded_at, review_state | (fact_id,version_no) 唯一；每 Fact 最多一个有效当前版本 | 追加式事实版本 |
| `episode_fact_links` | episode_id, fact_id, relation_type, source_id | 复合唯一 + owner 一致校验 | 双轨事件↔事实 |
| `fact_evidence_links` | version_id, source_id, evidence_text, span_start/end | 外键 + 来源一致性校验 | 原文证据溯源 |
| `memory_embeddings` | id, owner_id, target_type, target_version_id, model_id, dimension, embedding, embedding_text_hash, index_status | target_type + target_version_id + model_id + text_hash 唯一 | Fact/Episode 双轨向量 |
| `memory_proposals` | id, owner_id, source_id, candidate_payload, proposed_action, risk_level, base_version_id, status, expires_at | 状态与版本条件 | 待审重要变更 |
| `memory_operations` | id, owner_id, operation, target_id, before_version_id, after_version_id, actor, trace_id, created_at | owner_id + created_at | 审计与可撤销普通修改 |
| `outbox_events` | id, aggregate_type/id, event_type, payload, status, attempt_count, available_at | status + available_at | 事务内写入、异步可靠派发 |
| `processing_jobs` | id, owner_id, source_id, stage, status, attempts, last_error_code, trace_id, updated_at | stage + status + updated_at | 分阶段重试与可观测 |

**特别提示：** `memory_embeddings.target_type + target_version_id` 是跨两类目标的多态引用，普通 SQL 外键无法直接保证它同时引用两张目标表。MVP 应通过服务层一致性检查并在删除路径严格级联；如果希望数据库层强约束，实施时应改为分别 nullable 的 `fact_version_id` / `episode_id` 并以 CHECK 保证恰有一项非空，或拆分目标表。此处推荐**明确双外键 + CHECK**，在实施 Schema 时冻结此细节。对 `atomic_facts` 的逻辑主张不能用 `(subject,predicate)` 作为全局唯一，因为相同属性可能在不同项目与时间多次出现。

### 3.3 必需枚举/状态字段

| 对象 | 允许状态 | 说明 |
|---|---|---|
| Source | RECEIVED, EXTRACTING, RESOLVING, PARTIAL, COMMITTED, FAILED | Source 的流程态，不等于向量完成 |
| Candidate Action | ADD, EQUIVALENT, ENRICH, REVISE, SUPERSEDE, CONFLICT, NOOP | Resolver 建议，非最终 DB 动作 |
| Proposal | PENDING_REVIEW, APPROVED, REJECTED, EXPIRED, STALE | 两个标签页并发须有 STALE |
| Fact Version | CURRENT, HISTORICAL, PLANNED, RETRACTED | 状态语义与审核状态分开 |
| Embedding | PENDING, RUNNING, READY, FAILED, STALE, DELETED | 对应内容版本，查询时检查 |
| Retrieval | COMPLETE, PARTIAL, INSUFFICIENT_EVIDENCE, UNAVAILABLE, ACCESS_DENIED | 执行状态与证据充足性分开 |
| Evidence | SUPPORTED, CONFLICTED, INSUFFICIENT | 供 Chat Engine 作真实性约束 |

### 3.4 时间建模

至少保存 `recorded_at`（带时区绝对时刻）、`timezone_name`（如 Asia/Shanghai）、`event_start`/`event_end`、`time_precision`（INSTANT/DAY/MONTH/YEAR/RANGE/UNKNOWN）、`time_expression`（如“上周三”）、`valid_from`/`valid_to`。相对日期基于**提交时的用户时区与时间**解析，不能在未来查询时重新解释。“下周开始”存为计划目标日期，不能当作实际发生事件。

### 3.5 索引设计

Fact 与 Episode 分别构造自包含 `embedding_text`；首选 `qwen3.7-text-embedding` 的 1024 维，实际区域与 ID P0 校验。初期精确近邻查询 + B-tree 用户及时间索引 + 技术名词关键词匹配；中文全文检索分词质量不足时评估 PGroonga，不把它作为 P0 阻塞项。初期无需强行建立 HNSW；切换向量模型时影子索引重建，不混用不同模型向量。`pgvector` 的 ANN 过滤可能影响召回，跨用户隔离不依赖 ANN 排名后过滤。

### 3.6 数据删除与恢复（最低限度）

单条事实删除需要使当前版本不可检索、禁止新索引任务、清理向量与引用；是否保留来源日记由用户选择的删除范围决定。删除和普通撤销是不同接口。若来源含凭据等明显秘密，输入前置拦截，避免持久化原文。备份保留和更高敏感数据生命周期管理是后续版本项目，MVP 不能宣称任何第三方或备份副本立即完全消失。

## 4. Memory Extractor：输入输出与提示词契约

### 4.1 职责与输入

Extractor 只把输入转成**候选**，不访问/修改历史事实版本。输入为原始 Source、提交时区、记录时间、允许使用的少量指代上下文、`extractor_prompt_version`。不把整个历史记忆库注入本次提取，避免旧记忆污染证据归属。对于模糊代词，可以返回歧义，交给 Resolver。

### 4.2 结构化候选输出示例（协议示意，不是实现代码）

```json
{
  "schema_version": "extractor.v1",
  "source_id": "src_demo_001",
  "episodes": [
    {"candidate_id":"E1","title":"与朋友讨论数据库选型","summary":"用户与朋友讨论 Personal Agent 的数据库方案；朋友建议 Neo4j，用户决定第一版采用 PostgreSQL。","event_type":"DISCUSSION","occurrence_status":"OCCURRED","time_expression":"上周三","event_time":"2026-10-14","time_precision":"DAY","evidence_spans":["上周三我和朋友讨论了数据库方案"]}
  ],
  "facts": [
    {"candidate_id":"F1","content":"用户已决定 Personal Agent 第一版采用 PostgreSQL。","fact_type":"STATE","speech_act":"DECISION","subject":"Personal Agent 第一版","predicate":"database_choice","object":"PostgreSQL","modality":"DECIDED","attribution":"USER_SELF_REPORT","evidence_spans":["我决定第一版先使用 PostgreSQL"],"requires_review":false},
    {"candidate_id":"F2","content":"朋友曾建议用户考虑 Neo4j。","fact_type":"EVENT_FACT","speech_act":"QUOTE","subject":"朋友","predicate":"suggested_database","object":"Neo4j","modality":"REPORTED","attribution":"THIRD_PARTY_REPORTED_BY_USER","evidence_spans":["他建议我使用 Neo4j"],"requires_review":false}
  ],
  "episode_fact_links": [{"episode_candidate_id":"E1","fact_candidate_id":"F1","relation":"DESCRIBES"},{"episode_candidate_id":"E1","fact_candidate_id":"F2","relation":"DESCRIBES"}],
  "unresolved_items": []
}
```

**校验顺序：** 解析输出结构 → 检查候选编号唯一与跨引用有效 → 证据片段存在于 Source（允许规范化空白后匹配）→ 校验时间表达与有效性 → 检查不确定性/否定词 → 密钥与敏感信息拦截 → 进入 Resolver。对于证据无法定位的候选只能标记为 `NEEDS_REVIEW` 或舍弃，不能自动写入。

### 4.3 Prompt 设计骨架

System/Developer 提示词需固定五段：任务与角色（忠实提取）→ 输出 Schema → 归属/否定/时间/计划/引用规则 → 多事件和零候选示例 → 禁止推断或执行用户输入里的指令。用户文本放在明确标记为“被分析材料”的独立字段。模型不得自行生成数据库正式 ID、所有者、最终写入类型或版本号。提示词与 Schema 使用独立版本号；变更提示词后在同一人工标注集做回归。

## 5. Memory Resolver / Controller：去重、变更与事务

### 5.1 Resolver 关系判定

使用 `owner_id`、同一项目实体、关键词/结构化状态键、向量候选和必要历史版本构造匹配集合。关系分类：`EQUIVALENT`（同事实追加证据）、`ENRICH`（补充已有事实）、`STATE_CHANGE`（新状态已明确）、`CONTRADICTION`（不能同时成立且原因不清）、`UNRELATED`（不同事件/项目）与 `AMBIGUOUS`（不确定归属）。向量高相似度不等于相同事实，否定和时间要独立核对。

### 5.2 Controller 决策

| Resolver 关系 | Controller 处理 | 前端呈现 |
|---|---|---|
| 新独立事实 | ADD 新事实 + V1 | 已保存 |
| 完全等价 | ADD_EVIDENCE，不增加重复 CURRENT 版本 | 已补充证据 |
| 补充细节 | REVISE 新版本，保留旧版本 | 如影响重要状态则待确认 |
| 明确计划/偏好变化 | SUPERSEDE 当前版本，旧版本历史化 | 重要变更确认卡 |
| 真正冲突 | 创建 PENDING_REVIEW proposal | 冲突澄清卡 |
| 含糊无证据 | NOOP / NEEDS_REVIEW | 未形成长期事实 |

**版本事务边界：** 只有 Controller 可以开事实提交事务；在同一事务中写入正式事实或新版本、事实来源链接、事件事实链接、审计操作、Outbox 事件。事务成功后才返回 `COMMITTED`。Outbox Worker 异步生成向量、缓存同步、事件更新；重试不得导致重复事实。

### 5.3 重要变更确认卡接口约束

卡片必须展示类型、旧内容、新内容、证据来源、时间、受影响事实、解释、审批动作。`APPROVE` 必须传 `proposal_id` 与 `base_version_id`；若当前事实版本已变化，返回 `409 MEMORY_VERSION_CONFLICT`，刷新提案，不许默默覆盖。忽略提案不删除原始 Source；不更新当前事实。批次部分成功时应展示自动保存数、待确认数、失败数。

## 6. Memory Retriever：自适应双轨检索

### 6.1 关键数据对象

| 对象 | 最少字段 | 来源 |
|---|---|---|
| `RequestContext` | user_id、conversation_id、request_time、timezone、allowed_scope | Auth/API，**不由 LLM 决定** |
| `QueryAnalysis` | intent、entities、temporal_mode、subqueries、ambiguities | Query Analyzer |
| `RetrievalPlan` | query、fact_k、episode_k、lexical_k、time_scope、rerank_policy、budget_ms、plan_version | Planner |
| `Candidate` | memory_id、version_id、type、content、source_ids、retrieval_channel、rank、score、temporal_status | 各 Retriever |
| `EvidenceGroup` | group_id、facts、episodes、source_ids、supported_claims、contradictions | Grouper |
| `RetrievalResult` | status、evidence_status、context_blocks、citations、warnings、trace_id | Context Builder |

### 6.2 示例 RetrievalPlan

```json
{
  "plan_version":"retrieval.v1",
  "query":"我之前为什么考虑 MySQL，现在决定什么？",
  "intents":["HISTORICAL_COMPARE","RELATION_REASONING","CURRENT_STATE"],
  "entities":["Personal Agent","MySQL"],
  "temporal_mode":"TIMELINE",
  "subqueries":["历史数据库方案","最新有效数据库方案","变更原因的事件证据"],
  "retrieval":{"fact_vector_k":15,"episode_vector_k":15,"fact_lexical_k":10,"episode_lexical_k":10},
  "reranking":{"policy":"ADAPTIVE","max_groups":20,"final_groups":6},
  "require_citations":true
}
```

`owner_id` 不包含在模型生成的 JSON 里；后端从 `RequestContext` 和数据库层权限确定。上述 K 值是可调 PoC 起点，不是实测最优。

### 6.3 精确检索与混合排序

1. 基于可信用户范围和时间条件检索，第一阶段以 pgvector 精确检索为基线。
2. Fact Semantic、Episode Semantic、Fact Lexical、Episode Lexical 分开召回；精确实体与时间查找是补充路径。
3. 各轨内部 RRF 合并排名，不直接相加不同来源原始相似度。
4. 跨轨通过 `source_id`、事实主张和 `episode_fact_links` 聚合 Evidence Groups；同一来源产生的 Episode/Fact 不是多份独立证据。
5. Temporal Validator 确认 CURRENT/HISTORICAL/PLANNED/AS_OF；硬性状态约束不能被高语义分覆盖。
6. Query 简单时 RRF + 规则；复杂跨轨、因果比较或多候选时调用 Qwen Rerank API（Deep Path）。
7. Reranker 失败或超时回退规则排序；若一级召回不足则有限改写/补召回，不能靠 Reranker 凭空补证据。
8. 以 Token 预算选 5–8 个相关证据组，输出来源、时间、状态和不确定性给 Chat Engine。

### 6.4 查询路由（建议）

| 用户查询 | intent | 路径 | 特别规则 |
|---|---|---|---|
| 我的专业是什么？ | FACT_LOOKUP | Fast | 画像事实优先 |
| 我现在做什么项目？ | CURRENT_STATE | Fast | 只引用当前有效事实 |
| 上周我做过什么？ | EPISODIC_RECALL | Deep | 按 event_time，不按录入时间 |
| 我之前和现在的技术方案有什么不同？ | HISTORICAL_COMPARE | Deep | 历史版本与当前版本均召回 |
| 我为什么选择 PostgreSQL？ | RELATION_REASONING | Deep | 找不到理由就明说 |
| 根据你的了解建议下一步？ | PERSONAL_SYNTHESIS | Deep | 先证据、后建议，区分推断与事实 |

### 6.5 RetrievalResult 示例

```json
{
  "status":"COMPLETE",
  "evidence_status":"SUPPORTED",
  "trace_id":"tr_demo_001",
  "context_blocks":[
    {"kind":"CURRENT_FACT","text":"用户当前决定 Personal Agent 第一版使用 PostgreSQL。","memory_id":"fact_demo_01","version_id":"v2","source_ids":["src_demo_02"]},
    {"kind":"HISTORICAL_FACT","text":"用户此前考虑过 MySQL。","memory_id":"fact_demo_01","version_id":"v1","source_ids":["src_demo_01"]}
  ],
  "citations":[{"memory_id":"fact_demo_01","source_id":"src_demo_02","display_label":"数据库决策记录"}],
  "warnings":[]
}
```

**严禁：** 在回答里把 `HISTORICAL_FACT` 描述为当前事实；返回未提交/待确认候选；将未命中的空证据伪装成已查询到个人信息。

## 7. API 合同与前后端时序

### 7.1 REST / SSE 接口清单（版本统一 /api/v1）

| 方法 | 路径 | 用途 | 结果/备注 |
|---|---|---|---|
| POST | `/memory/records` | 主动写入原始记录，启动处理 | 202 + source_id / job_id / trace_id；支持 Idempotency-Key |
| GET | `/memory/records/{id}` | 获取一次记录的处理结果 | 200 + Source/Fact/Episode/提案统计 |
| GET | `/memory/jobs/{id}` | 获取阶段/失败原因 | 200，状态可轮询；后续可 SSE |
| GET | `/memory/proposals` | 当前会话所需待审提案 | 200，owner 范围过滤 |
| POST | `/memory/proposals/{id}/approve` | 审核并提交重要变更 | 200，需 base_version_id；409 冲突 |
| POST | `/memory/proposals/{id}/reject` | 拒绝提案 | 200，不改变事实当前版本 |
| GET | `/memory/facts/{id}` | 取事实及版本、来源 | 200 / 404 / 403 |
| PATCH | `/memory/facts/{id}` | 用户主动修订事实 | 200，`If-Match` 或 base_version；新版本 |
| DELETE | `/memory/facts/{id}` | 用户主动删除事实 | 202，任务化删除派生索引 |
| POST | `/chat/messages` | 向二脑提问，开始检索与生成 | 建议 SSE，关联 conversation_id |
| GET | `/conversations/{id}/messages` | 恢复会话消息 | 200，按权限访问 |
| GET | `/health/live` | 服务进程存活 | 200，不能当作依赖健康 |
| GET | `/health/ready` | DB / 关键依赖可用性 | 200 / 503，返回最少状态 |

### 7.2 写入 API 请求与响应示例

```json
POST /api/v1/memory/records
Headers: Idempotency-Key: demo-request-001
{
  "conversation_id":"conv_demo_01",
  "text":"今天研究了长期记忆，我决定第一版先使用 PostgreSQL。",
  "client_timezone":"Asia/Shanghai"
}

202 Accepted
{
  "source_id":"src_demo_001",
  "job_id":"job_demo_001",
  "status":"RECEIVED",
  "trace_id":"tr_demo_001"
}
```

**关键语义：** `202 Accepted` 表示请求已被后端接受并创建处理任务，**不表示长期事实已经成功保存**。前端通过 job 状态查询或事件流接收 `EXTRACTED` / `COMMITTED` / `INDEXED` / `PENDING_REVIEW` 更新。

### 7.3 对话流事件契约（建议 SSE）

| SSE 事件 | 必需载荷 | 前端操作 |
|---|---|---|
| `retrieval.started` | trace_id、conversation_id | 显示正在查找记忆 |
| `retrieval.completed` | evidence_count、warnings | 切换到生成状态 |
| `retrieval.degraded` | reason_code、available_channels | 提示部分检索路径不可用 |
| `message.delta` | seq、text | 追加 AI 字符流 |
| `message.citations` | citations[] | 追加来源 chip |
| `message.completed` | message_id、usage、trace_id | 标记已结束 |
| `message.error` | error_code、retryable、trace_id | 以可恢复状态显示错误 |

必须定义流中断后的恢复策略：同一 `message_id`/请求幂等识别，避免重连后多次生成或重复持久化消息；若未支持真正断点续传，第一版允许显示“本次回答已中断，请重新生成”，不得把半段输出显示成完整回答。

### 7.4 统一错误响应

```json
{
  "error": {
    "code": "MEMORY_VERSION_CONFLICT",
    "message": "记忆已在其他会话中更新，请刷新后重新确认。",
    "stage": "memory_controller",
    "retryable": false,
    "trace_id": "tr_demo_001"
  }
}
```

HTTP 状态遵守职责：400 输入参数、401 未认证、403 无权限、404 未发现/不可见资源、409 乐观锁或重复冲突、422 业务结构校验、429 限流、502 上游响应不可用、503 关键依赖不可用、504 上游超时。用户错误文本不得暴露内部 SQL、API Key、敏感 Prompt 或栈追踪。

## 8. 模块划分、目录规划与可替换边界

### 8.1 建议工程目录（结构设计，不是已生成代码）

```text
personal-agent/
├─ apps/
│  ├─ web/                          # 唯一 Memory Chat 页面
│  │  ├─ src/app/memory/            # 记忆对话入口
│  │  ├─ src/components/chat/       # 消息流、输入区、流式回答
│  │  ├─ src/components/memory/     # 记忆回执、确认卡、证据详情
│  │  ├─ src/lib/api/               # HTTP/SSE 适配、响应校验
│  │  └─ src/state/                 # 当前模式/会话/处理任务状态
│  └─ api/
│     ├─ app/main.py               # FastAPI 装配（不得内嵌业务逻辑）
│     ├─ app/api/v1/               # routers：memory/chat/health
│     ├─ app/core/                 # config、auth、exceptions、logging
│     ├─ app/domain/               # schema、enum、domain decisions
│     ├─ app/services/memory/
│     │  ├─ extractor.py            # LLM 提取候选
│     │  ├─ resolver.py             # 旧记忆匹配与关系判断
│     │  ├─ controller.py           # 事务提交、审批和版本
│     │  └─ evidence.py             # 来源校验与双轨关联
│     ├─ app/services/retrieval/
│     │  ├─ query_analyzer.py
│     │  ├─ planner.py
│     │  ├─ candidate_retriever.py
│     │  ├─ fusion.py
│     │  ├─ grouper.py
│     │  ├─ temporal.py
│     │  ├─ adaptive_reranker.py
│     │  └─ context_builder.py
│     ├─ app/services/chat/         # 调度检索及流式生成
│     ├─ app/providers/             # qwen LLM / embedding / rerank 适配
│     ├─ app/repositories/          # 数据访问层：Source/Fact/Episode/Job
│     ├─ app/workers/               # outbox 消费、embedding、清理重试
│     ├─ app/db/                    # ORM、迁移、会话、RLS 支持
│     └─ tests/                     # unit/integration/e2e/fixtures
├─ migrations/                     # 数据库版本管理
├─ datasets/                       # 合成样例与人工标签
├─ evaluations/                    # 提取/检索/回答评估
├─ docs/                           # PRD、ADR、运行手册、数据字典
└─ infra/                          # docker-compose、环境示例、启动脚本
```

### 8.2 依赖方向（避免循环依赖）

API router 只校验与调用 Service；Service 使用 Domain Contract + Repository Interface + Model Provider Interface；Provider 与 Repository 不依赖业务 Service；Controller 持有事务边界；Retriever 只读 Repository；Chat Engine 只能消费 Retriever 的 `RetrievalResult`。禁止在路由函数中直接拼接 prompt、执行复杂 SQL 或调用模型后立即覆盖 Fact。

### 8.3 哪一层出了错，改哪一层？

| 用户现象 | 首先检查 | 不应该先做的事 |
|---|---|---|
| 一段话少提了事件 | Extractor 提示词、Schema、证据标注 | 重写数据库结构 |
|---|---|---|
| 同一事实保存多次 | Resolver 关系判断、幂等键、写入唯一条件 | 重写前端页面 |
|---|---|---|
| 新方案被旧方案覆盖 | Controller 版本事务与 Temporal Validator | 更换 LLM 品牌 |
|---|---|---|
| 问题相关事实找不到 | Candidate Retriever 和索引状态 | 盲目提高聊天 Prompt 长度 |
|---|---|---|
| 正确事实排名过低 | Fusion、Evidence Group、Rerank | 把所有候选都塞进 LLM |
|---|---|---|
| LLM 用证据编造原因 | Context Builder、Chat Prompt、答案评测 | 重建所有向量 |
|---|---|---|
| 记忆已保存却无向量 | Outbox/Worker、Embedding API、重试状态 | 重跑 Extractor 导致重复 |
|---|---|---|
| 用户看见“保存成功”却数据库无记录 | API 响应语义、前端状态映射 | 放弃异步任务机制 |

## 9. 稳定性、并发、幂等与一致性

### 9.1 数据流与事务策略

**同步：** 请求认证 → 参数校验 → 创建 `source_record` + 对应 job → 返回 202。**异步：** Extract → Validate → Resolve → Controller transaction → Outbox → Embedding Worker。前期可在同一 FastAPI 工程运行独立 Worker 进程轮询 PostgreSQL Job/Outbox，暂不引入 Redis/RabbitMQ；进程重启后能从持久任务继续。

**推荐采用至少一次投递 + 消费端幂等**，不是假设 Worker 永远只执行一次。Outbox 事件应有 `event_id` 和幂等消费记录。Index Worker 只有在 `target_version_id` 与当前允许索引的版本一致时才写向量；失效历史版本由独立状态决定是否可保留用于历史检索。

### 9.2 重试与状态恢复

LLM 超时可以有限重试提取且保留 Source；JSON Schema 连续不合格则 `FAILED_VALIDATION`，不可将错误候选入库。Controller DB 事务失败整体回滚，Worker 不创建重复事实。Embedding 失败只重建向量，不能重跑记忆提取。Rerank API 失败回退规则排序。所有后台任务支持 `attempt_count`、`next_retry_at`、`last_error_code`、死信或人工重试状态。

### 9.3 最小安全基线

后端唯一持有百炼密钥；环境变量或 Secret 存储，禁止提交到 Git。开发本地可以单用户，但数据表仍保留 owner_id；公开上线之前必须补齐身份认证与授权校验、HTTPS、数据库最小权限和跨用户测试。收到密码/API Key/私钥时拒绝进入长期记忆与普通原文日志。第三方引用/文档内容不得当作系统 Prompt 指令。对话默认只读取，不后台抽取新长期事实。

## 10. 可观测性与排障手册

### 10.1 每次请求的 trace 结构

一个前端 `request_id` 对应一个全链路 `trace_id`，每个模块写子阶段 `span_id`。建议日志统一字段：`timestamp`、`level`、`trace_id`、`span_id`、`owner_hash`（不可反推）、`source_id`、`job_id`、`stage`、`model_id`、`provider_region`、`latency_ms`、`token_in/out`、`candidate_count`、`error_code`、`retryable`。默认不记录原始私人全文或密钥。

### 10.2 错误码与排障矩阵

| 错误码 | 模块 | 触发条件 | 排障步骤 | 允许降级？ |
|---|---|---|---|---|
| `MODEL_AUTH_FAILED` | Provider | Key、区域、权限有误 | 核 Key、Endpoint、区域、模型授权 | 否，先修配置 |
| `MODEL_RATE_LIMITED` | Provider | 429/额度速率超限 | 查配额/账单；退避重试 | 可延迟任务 |
| `EXTRACT_SCHEMA_INVALID` | Extractor | 缺字段、枚举错误 | 对照 Schema、模型原始结构、提示词版本 | 标记 Source 待修 |
| `EXTRACT_EVIDENCE_MISSING` | Evidence | 候选无原文支持 | 查 Source span、归属、否定 | 拒绝自动写入 |
| `RESOLVE_AMBIGUOUS` | Resolver | 同名实体/冲突 | 查候选旧事实、subject_key、证据 | 待用户确认 |
| `MEMORY_VERSION_CONFLICT` | Controller | 提案基于过期版本 | 刷新事实版本与提案 | 不自动覆盖 |
| `DB_COMMIT_FAILED` | Repository | 事务失败 | 查数据库异常、连接池、约束 | 不宣布成功 |
| `OUTBOX_STUCK` | Worker | 事件积压 | 查任务状态、Worker、last_error | 可重试 |
| `EMBEDDING_FAILED` | Provider/Worker | API 错误/维度不符 | 查模型 ID、维度、输入文本 | 结构化检索回退 |
| `RETRIEVAL_PARTIAL` | Retriever | 一条路径失败 | 查通道 Trace、候选/索引状态 | 可降级并标注 |
| `RERANK_TIMEOUT` | Reranker | API 超时 | 查候选大小、网络、超时 | 回退 RRF |
| `EVIDENCE_INSUFFICIENT` | Context | 证据无关或缺失 | 查 Query Plan/Recall@K | 返回不知道 |
| `CHAT_GENERATION_FAILED` | Chat | LLM 输出中断 | 查 Provider、SSE、消息状态 | 保留重试入口 |
| `ACCESS_DENIED` | Auth | 越权操作 | 查身份/owner_id/RLS | 严禁宽松降级 |

### 10.3 分段健康检查与故障定位步骤

**从前到后查：** (1) API 健康 / 请求是否进入；(2) Source 是否创建；(3) Extractor 是否产生有效候选；(4) Resolver 决策是否正确；(5) Controller 事务是否提交；(6) Outbox 是否处理；(7) Embedding 是否 READY；(8) Retrieval Plan 是否命中正确实体/时间；(9) Candidate Recall 是否含正确事实；(10) Fusion/Temporal/Rerank 是否剔除了正确证据；(11) Context Builder 是否包含正确来源；(12) Chat LLM 是否忠实表达。每步有独立可复制的输入/输出快照（模拟/脱敏）。

建议维护一次失败的“故障样本包”：`trace_id + schema_version + model_id + stage input digest + stage output digest + expected + actual + repair commit`。修复后将该样本加入回归测试集，防止同类问题再次出现。

## 11. API 费用与性能基线

本地运行前端、FastAPI、PostgreSQL/pgvector 和轻量 Worker；模型推理通过百炼 API 完成，本地不要求独立 GPU，开发建议 16GB 内存、SSD；8GB 可以尝试但需限制并发。模型成本随调用次数、Token、模型区域和当期价格变化，**不得把本文价格或历史估算当作账单保证**。每次 API 调用记录实际 usage、供应商返回 ID、耗时和成本估算；PoC 设置自定义月度预算与调用上限。初期 Embedding 1024 维、事实/事件分别索引、Rerank 仅复杂问题，避免重复向量化。

建议追踪：写入 P50/P95、提取成功率、事务成功率、向量 READY 延迟、检索 P50/P95、Rerank 触发率、端到端回答延迟、每次写入/提问成本、后台积压任务数。

## 12. 测试设计、质量阈值与验收

### 12.1 数据集与分层评测

建议准备 60 条中文/中英混合记录，人工标注至少 100 条候选事实和事件；Retriever 使用 150 条独立模拟 Source、300+ Facts/Episodes 和 100 道人工标注问题。最初不要求数字越大越好，关键是包含可复现、容易区分正确/错误的边界样本。

| 测试集 | 核心场景 | 主要指标 | 建议目标（规划值，非实测） |
|---|---|---|---|
| Extractor | 事实、事件、否定、引用、计划、时间 | Precision / Recall / Schema Valid | Precision≥95%，Recall≥90%；Schema通过率接近100% |
| Resolver | 等价、补充、变更、冲突、跨项目 | Decision F1、误覆盖数 | F1≥90%，重要状态误覆盖=0 |
| Temporal | 昨天、上周、去年、历史变更、未来计划 | Temporal Accuracy | ≥90% |
| Retriever | Fact-only / Episode-only / Dual / Hybrid | Evidence Recall@10、nDCG@10、MRR | Recall@10≥85%，其余对基线提升 |
| Reranker | Fast / Always Rerank / Adaptive | nDCG、P95、调用率、成本 | 在质量可接受下减少额外 API 调用 |
| Answer | 有证据、无答案、来源引用 | Faithfulness、Abstention | ≥95%证据忠实度；无依据拒答≥90% |
| Security | 跨用户/敏感凭据/待审事实 | 越权成功、未授权检索 | 测试中 0 次成功越权 |

重要：评测召回时以**证据组和来源 ID**作为标签，避免同一 Source 派生多条 Fact+Episode 导致错误加分。Cross-Encoder 的实验必须在实际第一阶段召回的候选集上执行，不把正确答案偷偷放入候选集。

### 12.2 必须包含的回归样本

T01：记录“今天学了 RAG”，隔会话能回忆；T02：同一请求网络重试不能重复新增；T03：同一事实隔天重述应追加证据；T04：两次同名会议不同日期不得合并；T05：“考虑用 MySQL”与“决定用 PostgreSQL”区分模态；T06：“不是 PostgreSQL”正确处理否定；T07：转述朋友意见不写成用户偏好；T08：未来计划不作为已完成事件；T09：用户未说明理由时不得虚构原因；T10：同一个来源衍生 Fact 与 Episode 不算双证据；T11：历史有效性查询能找旧版本；T12：待确认变更不得进入当前聊天检索；T13：旧提案审批触发 409；T14：Embedding 失败后只重建索引；T15：Reranker 超时回退；T16：数据库不可用不能假装完成；T17：不同 owner 数据零交叉；T18：凭据禁止自动记忆；T19：问答默认不写长期记忆；T20：来源删除后引用显示失效而非悬空异常。

### 12.3 MVP 最终验收（Go / No-Go）

**必须达成：** 一个页面完整走通记录→提取→审核/提交→双轨索引→独立会话问答；来源可查；计划与已完成不混淆；重复请求幂等；事实更新留版本；待审不泄漏；错误可归因 trace_id；关键测试通过；没有 API Key 暴露。未达成任一条则不能声明 PoC 完成。

## 13. 实施里程碑、任务拆分与依赖

| 阶段 | 主要任务 | 交付物 | 完成门槛 |
|---|---|---|---|
| P0 模型与环境预检 | 百炼账户区域/API Key、Flash/Plus/Embedding/Rerank Smoke Test；PostgreSQL/pgvector 连通 | `api_smoke_report`、环境配置清单 | 4 类 API 调用有效、1024 维可读、费用/错误可记录 |
| P1 数据契约与 DB | ORM/迁移、Source、Episode、Fact、版本、证据、Job、Outbox | DB Schema、迁移、Repository 测试 | 约束与回滚、owner 隔离通过 |
| P2 写入引擎 | Extractor、Evidence Validator、Resolver、Controller、Proposals | 完整写入与更新流程 | 20 条关键写入案例及版本冲突可复现 |
| P3 索引与检索基线 | Embedding Worker、双轨向量、关键词、时间查询、RRF | `RetrievalResult` 基线 | Fact/Episode 单轨与双轨可测 |
| P4 自适应 Rerank | Plan、Grouper、Temporal、Qwen Rerank、回退 | Fast/Deep 对照报告 | Rerank 超时不阻塞检索，有指标 |
| P5 Chat Engine | Qwen Plus、Evidence Context、SSE、引用与无证据回复 | 后端端到端问答接口 | 能跨会话召回，回答有来源 |
| P6 唯一对话窗口 | 记录/提问模式、消息流、回执卡、提案卡、证据抽屉 | Memory Chat 页面 | 不产生隐式写入，用户可完整演示 |
| P7 回归与硬化 | 100 问评测、失败注入、成本压测、文档 | 演示脚本、测试报告、运维手册 | Go/No-Go 清单通过 |

**并行建议：** P0 后可并行创建最小前端壳和 DB Schema；业务功能依赖 P1→P2→P3→P4/P5；P6 不必等 P5 才开发 UI 样式，但数据契约必须冻结后接入。不要在 P0 没有验证模型输出时一次性写完整系统。

### 13.1 每个阶段必须提交的开发产物

任务卡至少写明 `Module / Input Contract / Output Contract / Dependencies / Happy Path / Failure Cases / Unit Tests / Integration Tests / Logs / Acceptance`。一个模块开发完先通过单元测试与伪造 Provider 输出的测试，再接真实 API。每次修改只替换本模块实现并运行邻接合同测试，不能以“先跑通”为由让上层直接访问底层 SQL 或模型 SDK。

### 13.2 推荐的提交顺序

`chore/bootstrap` → `feat/db-schema` → `feat/provider-gateway` → `feat/memory-extractor` → `feat/memory-resolver` → `feat/memory-controller` → `feat/embedding-worker` → `feat/retrieval-base` → `feat/adaptive-rerank` → `feat/chat-engine` → `feat/memory-chat-ui` → `test/e2e-and-hardening`。每一个提交阶段都必须可以运行独立测试，避免一次提交修改全栈且无法定位错误。

## 14. 风险、限制与待验证决策

| ID | 风险或待定项 | 默认处理 | 关闭条件 |
|---|---|---|---|
| R-01 | 百炼模型在具体区域不可调用 | P0 提前核实；更换同类可用 Qwen 模型并更新模型配置，不修改服务接口 | API Smoke Test |
| R-02 | 严格 JSON Schema 行为与文档差异 | 接口实际测试，不以文档描述代替运行验证 | 模拟/真实提取样本通过 |
| R-03 | 中文全文检索质量不足 | 先关键词精确匹配；根据失败样本决定是否加 PGroonga | 关键词测试报告 |
| R-04 | LLM 提取幻觉 | Evidence Validator + 批量人工评测 | 错误事实不自动入库 |
| R-05 | 旧向量滞后 | version_id 校验与索引任务重试 | 更新后当前状态检索测试通过 |
| R-06 | LLM 成本及响应慢 | 自适应模型调用、缓存/预算、模型 usage 记录 | 量化 P50/P95 和费用 |
| R-07 | 文本中包含秘密 | 提交前检测与拒绝或脱敏；暂不做复杂 Vault | 凭据泄漏样例测试通过 |
| R-08 | 未来多人上线 | MVP 单用户验证但保留 owner、auth、RLS 扩展点 | 上线前安全专项检查 |
| R-09 | 某条输入被误分类“记录/提问” | 模式由显式 UI 和 API Endpoint 决定，不依赖 LLM 猜测 | 模式误写测试通过 |
| R-10 | 删除与历史证据冲突 | 定义删除范围、引用降级、派生向量清理 | T20 与删除回归通过 |

## 15. 开发负责人可执行的第一天清单

**第一步**：确认本地 Python、PostgreSQL、pgvector、前端运行环境能启动；准备环境变量示例，不填真实 API Key 到仓库。**第二步**：在百炼同一地域分别验证 Flash、Plus、Embedding、Rerank，记录请求/响应、模型 ID、维度、usage 和错误。**第三步**：以 5 段完全虚构的中文记录运行提取，确认一个输入可以产生多个 Episode/Facts，时间、否定、引用保留。**第四步**：先建 Source、Fact、Version、Episode、Evidence、Job、Outbox 表与独立 repository 测试。**第五步**：开发写入接口后，用固定模型输出替身测试事务、幂等和重要变更审批。通过后再接入真实 LLM。**第六步**：将 Fact/Episode 写入 pgvector、建立最简单的查询，先测有证据是否能命中，再增加 RRF 和 Reranker。**第七步**：接 Chat Engine 和唯一记忆对话窗口，完成跨会话演示并运行故障注入。

## 16. 关键技术参考（开发时优先查官方文档）

1. 阿里云百炼文本生成与模型列表：https://help.aliyun.com/zh/model-studio/text-generation-model
2. 百炼向量与重排序模型：https://help.aliyun.com/zh/model-studio/embedding-rerank-model
3. 百炼 Embedding API：https://help.aliyun.com/zh/model-studio/embedding
4. 百炼 Reranking API：https://help.aliyun.com/zh/model-studio/rerank
5. pgvector 文档与多租户过滤说明：https://github.com/pgvector/pgvector
6. PostgreSQL 官方行级安全：https://www.postgresql.org/docs/current/ddl-rowsecurity.html
7. FastAPI 官方：https://fastapi.tiangolo.com/
8. SQLAlchemy 官方：https://docs.sqlalchemy.org/
9. Alembic 官方：https://alembic.sqlalchemy.org/
10. Graphiti（事件/事实与时间设计参考，不作为必须依赖）：https://github.com/getzep/graphiti
11. Mem0（去重和长期记忆思路参考，不作为底层替代）：https://github.com/mem0ai/mem0

## 附录 A：可视化流程图源文件

本文所有流程图提供独立、可编辑的 Mermaid 源码文件 `Personal_Agent_Technical_Flows_v1.0.mmd`。Markdown 版本原位包含 Mermaid 代码块，适合直接进入 Git 仓库维护；Word 版本嵌入渲染后的结构图。后续修改流程先更新源图，再同步文档和测试用例。

## 附录 B：实施前的设计冻结检查

在编写业务代码之前，开发者应逐项核对：唯一 UI 页面与两种输入模式；所有 Model Gateway 接口；Source/Fact/Episode/Version 的不变量；记录接口的 202 与异步结果语义；待审版本锁；重要状态时序；`RetrievalResult` schema；统一错误码和 `trace_id`；幂等和 Outbox；固定评测数据与模型配置。上述条款未对齐时不应跳过接口设计直接把业务写入路由文件。
