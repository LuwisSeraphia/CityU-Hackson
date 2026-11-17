# Personal Agent V2：个人知识库与 AI 搭子

版本：2.1 · 日期：2026-11-03

状态：增量需求文档；关键路线已由用户确认，功能尚未实施。

适用对象：项目所有者本人；不限领域的个人资料、认知、思考与协作积累。

基线：[V1.1 PRD](../Personal_Agent_Memory_Module_PRD_v1.0.md)。本文件定义下一阶段增量；既有实现与验收状态仍以原文档及验证记录为准。

## 1. 产品目标与问题

建立由用户持有、能够持续积累的个人知识库。工作台帮助用户记录、整理、找回和使用资料及自己的理解，通过有温度的对话承接日常状态。优先服务真实个人使用，不以服务未知用户群为本期前提。

核心问题：资料散落在课程文件夹；每次聊天重复解释背景；零散想法无法整理；难以找回上次进度；模型概括可能覆盖本人表达；记录了结论却遗失思考依据。

核心价值：保存原始材料、用户自己的理解与连接理由；更换会话后能接着聊；能纠正、撤回、删除并备份自己的积累。保存思想不意味着证明其正确。

系统通过用户授权的记录、思想连接和明确反馈，持续形成可解释、可修正的个人思考方式记忆，并在相关情境下改善未来的回应与协作。用户当前的要求优先于历史模式；系统不得将推断固化为人格标签。

V2.1 是供编码 Agent 执行的产品与实现规格。第 13–18 节将前文逻辑模型具体化，包含存储、接口、模块、任务依赖及测试合同；同一需求以具体合同为准，不能绕过第 2 节授权边界。生活、课程、工作只是验收示例，不得成为必须填写的场景枚举。

## 2. 已确认决策与范围

| 编号  | 已确认决策                                     | 实施含义                                                                         |
| ----- | ---------------------------------------------- | -------------------------------------------------------------------------------- |
| KD-01 | 本地数据库＋原文件库＋云端模型                 | 沿用 PostgreSQL/pgvector、FastAPI 和百炼；必要文本会发往云端，不能宣称全本地推理 |
| KD-02 | 明确要求记录就保存；自动提炼的思想与连接先确认 | 用户明确指定的原文和关系可直接保存；AI 整理的新解释进入候选                      |
| KD-03 | 手动上传，支持 PPTX                            | 暂不监控文件夹；保留原文件，解析范围见第 6 节                                    |
| KD-04 | 打开工作台时接续近况，暂不定时推送             | 无后台主动消息、通知或自动安排日程                                               |
| KD-05 | 暂不做其他 Agent 接入                          | 本期不实现 MCP、外部 Agent 授权或第三方写入接口                                  |

保留现有事实的低风险自动新增、重要变化审批、智能记忆开关与临时对话规则。KD-02 的直接保存适用于明确授权的新记录；更新已有重要事实仍走版本审批。关闭智能记忆后不后台提炼，仍可主动保存；临时对话不写长期库。

本期包含：用户自定义集合、多场景结构化记忆、长期资料、思想卡片、连接说明、思考模式与反馈修正、统一检索、思绪整理、温暖对话、进度接续、导出恢复。

本期不做：大型图谱美术、3D 动画、其他 Agent 接入、多用户公网服务、全自动人格画像、任务管理系统、定时推送、文件夹同步、扫描件 OCR、图片/音视频理解。最小界面只承担必要的审核和知识管理操作。

## 3. 现有实现与差距

代码核对基线：`apps/api/app/{db,memory,retrieval,files,tools,runtime,context}.py`。

| 现有能力                                 | V2 增量                                          |
| ---------------------------------------- | ------------------------------------------------ |
| Source、事件、事实、版本、审批、索引任务 | 思想及连接独立版本与状态                         |
| 文件绑定会话，数据库保存元数据和文本块   | 集合级长期资料、原文件持久化、跨会话授权读取     |
| TXT/MD/文本 PDF/DOCX 解析                | PPTX 文本、表格、备注解析与页级定位              |
| 事实/事件关键词＋向量混合检索            | 资料、思想、连接统一候选与类型标识               |
| 关键词候选只取最近 2,000 条              | 数据库侧检索，覆盖旧记录                         |
| 最新十二条当前事实作为核心记忆           | 用户置顶＋当前集合相关信息＋近期进度的预算化选择 |
| 模型判断 related 但未保存连接            | 用户解释的连接正式持久化                         |
| 长对话摘要、近期上下文                   | 接续近况、倾听/整理/推进对话策略                 |

已有来源、审批、幂等、删除抑制与失败恢复机制应复用。文档中的规划能力不能视为已实现。

## 4. 核心用户流程

### 4.1 课程资料与理解

创建课程集合 → 手动上传 PPTX/PDF → 查看解析范围 → 提问并引用页码 → 用户表达自己的理解 → 明确保存或审核候选 → 下次会话继续使用。

资料包含某知识点，不代表用户已经掌握。教师要求、模型解释、用户理解必须区分。作业截止时间须保留出处；年份、时区或表述不明确时询问，不猜测。

### 4.2 倾倒与整理

用户输入零散长段内容 → AI 简短复述理解 → 区分事实、感受、假设与待决定问题 → 找到一个优先讨论点 → 用户确认需要留下的内容。不得强制把每次倾诉变成长清单或任务。

### 4.3 思想连接

选择或明确指认 A/B → 用户说明为什么相关 → 保存连接原话及两端版本 → 后续问“我为什么这样联系”时返回原说明、时间和引用。AI 推荐只是候选；未确认解释不作为用户观点。

### 4.4 生活与进度接续

用户记录近况或工作卡点 → 下次打开工作台可看到一次轻量接续 → 可忽略、关闭或继续。不得虚构离线观察、主动思考或约定之外的跟进。

## 5. 知识模型与写入政策

| 对象                           | 必需信息与规则                                                                              |
| ------------------------------ | ------------------------------------------------------------------------------------------- |
| Collection                     | 稳定 ID、owner、自定义名称和标签；无固定场景分类                                            |
| Asset / AssetVersion           | 集合、文件名、原文件相对路径、哈希、版本、类型、解析/索引状态                               |
| Source                         | 原话或来源定位、记录时间、明确的发生时间；保留现有来源语义                                  |
| Thought / ThoughtVersion       | 稳定 ID、正文、原文证据、类型、用户态度、保存状态、版本与时间                               |
| KnowledgeRef                   | 统一可引用对象标识，指向资料版本、事件、事实或思想；服务端校验 owner 和存在性               |
| Connection / ConnectionVersion | 两端稳定 ID 及版本、用户原话、可选整理文本、关系类型、方向、情境、提出者/确认者、状态和时间 |
| State                          | 当前进度或近况、有效时间、来源；不得永久固化临时情绪                                        |

本节是概念模型，第 13 节指定物理实现：Thought 与 State 使用通用条目及版本表，Connection 独立存储。保持独立审批与生命周期，不将它们套入事实 claim_key 自动合并。

思想类型：观点、问题、假设、灵感、反思。用户态度：暂定、认同、保留疑问、放弃。保存状态：待确认、已保存、归档、删除。三者独立，确认保存不是证明观点成立。

| 输入                                   | 写入行为                                     |
| -------------------------------------- | -------------------------------------------- |
| 用户明确说“保存这段话”                 | 保存原话及来源；可选整理版作为候选           |
| 用户明确说“A 联系 B，因为……”且目标唯一 | 直接保存用户说明；指代含糊时询问             |
| AI 自动提炼思想、感受或连接            | 保存候选，确认前不进入正式知识召回           |
| 一般聊天中的低风险事实                 | 继承原记忆政策                               |
| AI 对用户思考方式的归纳                | 标为推断、提供依据、请求确认；不能替代原记录 |
| 临时情绪                               | 本轮回应；长期提炼需确认，不推断人格或诊断   |

候选状态：pending → approved/rejected；编辑后重审；依据版本变化时 stale。思想修订追加版本；相似思想不自动吞并。关系可一对多条、可有方向，不默认对称或传递；反对或限定一个观点也可构成有效联系。

## 6. 原文件保存、解析与个人持有

采用服务端生成 ID 的本地原文件目录与 PostgreSQL 元数据；文件路径不得由模型任意指定。原文件不可变，替换产生新版本；同集合相同哈希重复上传可复用，跨集合只共享字节时不得混淆权限和出处。

上传按暂存、哈希核验、元数据登记、原文件就位、解析、索引阶段执行。通过任务状态与补偿清理协调文件系统和数据库；不能把两者假设成一个事务。保存成功、解析成功和索引成功分别呈现；索引失败只重试索引。

首期 PPTX 提取文本框、表格及可读取备注，定位至幻灯片编号；图表、图片公式及扫描内容明确列为未解析，不能声称已读完整 PPT。旧 `.ppt` 提示转换为 `.pptx` 或文本 PDF。沿用现有 20 MB 上传限制并增加压缩包展开与资源限制；不执行宏、嵌入程序或外部链接。

导出包包含原文件、Markdown 正文、JSON 关系/版本/来源、schema 版本和哈希清单；不包含 API Key、令牌、临时任务凭据。恢复前检查格式、路径、哈希及引用，先预检再导入；首期仅恢复至空库，非空库拒绝合并并明确原因。向量可重建，不是唯一知识副本。

删除提供两个清楚范围：删除派生条目并保留来源；删除选定来源及相关派生内容。后者清理原文件、文本块、相关连接、索引与摘要引用；后台任务重检删除状态，防止复活。已有离线备份不会自动消失，恢复必须说明备份时间与删除影响。引用失效应明确显示，不返回残留内容。

## 7. 检索与 Agent 技术路线

继续使用 FastAPI、PostgreSQL/pgvector、百炼 Provider、受限工具循环；暂不引入 Neo4j、独立向量数据库或额外 Agent 服务。

流程：解析查询范围 → 按集合/类型/时间/状态过滤 → 关键词＋向量召回 → 融合与按需重排 → 按需扩展一层已确认连接 → 来源去重与预算限制 → 生成带证据回答。

连接说明单独建立关键词与向量索引。检索返回类型、作者归属、确认状态、版本、来源定位及命中路径。资料原文、个人观点、模型推断不可混为同一类事实。默认当前版本，历史查询显式启用；跨集合检索由用户选择全部或指定范围，不能因主题相似自动越过范围。

重排按查询与候选歧义判断，失败回退并说明。无相关证据时返回不足，不填充无关材料。时间不确定时保留未知；旧关系依赖旧版本时标注历史或待复核，不用于无提示推断当前观点。

内部新增工具能力：search_knowledge、get_knowledge、get_connections、get_knowledge_history、propose_thought、propose_connection。写入工具只提交受控请求，审批由后端校验。保留现有工具兼容适配，本期不对其他 Agent 开放。

## 8. 有温度的对话要求

回应应具体、自然、不过度夸赞；在倾听、整理、推进之间根据用户意图切换。不清楚时简短询问。倾听不急于给方案；整理保留矛盾与犹豫；推进一次选择一个可执行动作。

例如用户说“看了很久 PPT，作业还是没动”，可以先回应投入与进展感之间的落差，再询问卡点。只有检索到依据才说“你上次提到……”。不编造真实情感、生活经历或离线行为，不暗示排他依赖，不依据少量记录作心理诊断。

思绪整理输出长度适应用户状态，默认简短概括＋一个问题，用户要求时再展开。用户可以要求更直接或少共情；明确偏好可记忆。

打开时接续每个启动会话至多一次，不阻挡输入；无可靠近况时不强行个性化。可关闭接续；不创建定时任务。

## 9. 迁移与实施阶段

| 阶段 | 交付与依赖                                             |
| ---- | ------------------------------------------------------ |
| P0   | 固化本 PRD；制作生活、课程、工作脱敏样例与验收集       |
| P1   | 集合、原文件库、PPTX、跨会话资料查询；原有记忆回归通过 |
| P2   | 通用条目/连接模型、审批、版本、删除与可引用检索        |
| P3   | 统一检索、思考模式与反馈、思想整理和近况接续           |
| P4   | 导出恢复、端到端验收与一周本人试用                     |

增量迁移必须备份数据库、原文件目录和迁移版本；在副本验证后执行。旧记忆保留 ID 和来源，可放入默认集合。旧上传只有文本块时标记“原文件未保留”，允许重新上传关联，不能假装能还原二进制文件。旧会话附件不得未经用户选择自动成为全库可见资料。

兼容旧 API，新增接口使用显式版本与幂等键；后台任务阶段可恢复。失败迁移不能遗留半可用 schema；迁移失败恢复原数据库和文件快照，不靠删除新字段猜测回滚。模型变更时按模型 ID 和正文哈希重建索引，禁止混用向量维度。

## 10. 验收标准

| 编号  | 场景                     | 通过条件                                               |
| ----- | ------------------------ | ------------------------------------------------------ |
| KA-01 | 上传课程 PPTX 后新开会话 | 可查询同一集合内容，引用正确幻灯片及原文件版本         |
| KA-02 | 只有图片的 PPTX          | 明确解析不足，不伪造内容                               |
| KA-03 | “我猜测……”保存           | 仍标为假设，确认保存不变成客观事实                     |
| KA-04 | 自动生成思想和连接       | 待审不能作为用户已认可内容召回                         |
| KA-05 | 明确记录 A/B 连接理由    | 跨会话找回逐字原话、时间和两端版本                     |
| KA-06 | 修改卡片后查当前/历史    | 当前查询标明关系待复核，历史能还原原依据               |
| KA-07 | 删除来源与派生内容       | 连接、摘要和索引不泄露，不被重试任务复活               |
| KA-08 | 记忆关闭/临时对话        | 不生成自动思想候选；临时对话无长期落库                 |
| KA-09 | 超过 2,000 条资料与记忆  | 指定旧记录仍可由关键词查询找到                         |
| KA-10 | 索引/云端失败及重启      | 已保存内容不丢失，重试不重复新增                       |
| KA-11 | 导出后恢复空库           | 原文件哈希、ID、正文、来源、版本、连接一致，向量可重建 |
| KA-12 | 倾倒一段混乱想法         | 保留用户意思，未说出的原因标为猜测，无自动人格定性     |
| KA-13 | 集合范围与路径校验       | 不能越范围读取，不接受导入包路径穿越                   |
| KA-14 | 打开时接续与关闭         | 每启动会话至多一次，关闭有效，无后台推送               |

建立不少于 30 个脱敏样例，覆盖生活/课程/工作、中文否定、时间、思想、连接和无答案问题。记录证据命中、引用正确、错误归因、延迟、模型调用成本；首轮基线后再设性能阈值，不预先宣称记忆准确率。错误归因、未经确认关系冒充用户观点、越范围读取在固定验收集中必须为零。

本人试用观察：是否减少重复说明背景；能否找回自己的连接理由；是否更容易整理思绪；是否愿意继续记录；审核负担是否过高。用实际反馈决定后续功能。

## 11. 后续确认边界

本次已确认 KD-01 至 KD-05，无须重复确认。用户另已明确要求多场景通用结构化记忆与思考方式持续适应；具体实施合同见第 13–18 节。性能阈值和提示词可以通过实验调整，不能自行扩大写入权限或推断类型。

若后续要自动保存未经确认的思想、扩大文件夹访问、加入定时问候、换为全本地模型、开放其他 Agent 或公网多用户，必须另行请用户确认。扫描图片和图表理解、备份自动调度、非空库合并恢复为后续独立议题。

## 12. 文档依据与验证说明

本 PRD 基于现有 V1.1 PRD、后端实际代码和本次三项用户回复编写。不代表新增功能已运行或部署。原始文件保存与 PPTX 支持是新增能力；文档交付只执行文档契约与格式检查，实施阶段须完成第 10 节的功能、真实模型、数据库重启及恢复验收。

## 13. 通用结构化记忆：存储合同

### 13.1 通用原则

使用固定公共字段表达“谁、说了什么、依据是什么、何时适用、是否确认”，使用可选扩展字段表达特定领域信息。用户无需选择生活、课程或工作；新场景可直接保存为 note。未知属性不得丢弃原话，也不得让模型动态创建 SQL 表或执行代码。

所有新实体使用 UUID、服务端 owner、UTC 时间；呈现时间采用用户时区。未提供发生时间时为 null。客户端和模型不能指定 owner、审批人或 active 状态。使用 Pydantic extra=forbid 校验顶层输入，只有 attributes 允许受限扩展。

### 13.2 表与约束

| 表                                          | 必需字段与约束                                                                                                                                                                                                                                       |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| knowledge_collections                       | id, owner, name, description, tags, created_at；名称不充当主键                                                                                                                                                                                       |
| knowledge_items                             | id, owner, kind, current_version_id, deleted_at；kind 为 note/claim/experience/thought/question/decision/preference/state/pattern                                                                                                                    |
| knowledge_versions                          | id, owner, item_id, version, title, body, attribution, modality, stance, review_status, lifecycle, occurred_at, valid_from, valid_to, recorded_at, context, attributes, schema_version；唯一(item_id,version)                                        |
| knowledge_memberships                       | owner, item_id, collection_id；复合唯一；跨集合引用不自动扩大可读范围                                                                                                                                                                                |
| knowledge_sources                           | id, owner, source_record_id 或 asset_version_id 或 message_id, locator, quote, content_hash；至少一个来源端点                                                                                                                                        |
| knowledge_evidence                          | owner, version_id, source_id, role；role=support/counterexample；外键与 owner 一致                                                                                                                                                                   |
| knowledge_refs                              | id, owner, target_type, target_id；target_type=legacy_fact/legacy_episode/item/asset；唯一(owner,target_type,target_id)，适配器验证目标存在                                                                                                          |
| knowledge_connections                       | id, owner, current_version_id, deleted_at                                                                                                                                                                                                            |
| knowledge_connection_versions               | id, owner, connection_id, version, from_ref_id, to_ref_id, from_version_id, to_version_id, explanation_raw, explanation_edited, relation_type, direction, context, review_status, lifecycle, creator_kind, evidence_ids；唯一(connection_id,version) |
| knowledge_proposals                         | id, owner, target_type, target_id, base_version_id, payload, evidence_ids, status, reason, policy_epoch, created_at；复用审批语义，不复用强制 fact_id 的旧 Proposal 表                                                                               |
| knowledge_feedback                          | id, owner, run_id, message_id, target_pattern_version_id 可空, kind, text, scope, created_at；kind=helpful/unhelpful/correction/override；明确用户反馈，不根据停留时间推断                                                                           |
| knowledge_applications                      | id, owner, run_id, pattern_version_id, context_match, applied_action, feedback_id 可空；记录使用依据，不保存模型隐藏推理                                                                                                                             |
| knowledge_search_documents                  | id, owner, target_type, target_version_id, content, lexical_terms, embedding, embedding_model, content_hash, index_status；唯一(target_type,target_version_id,embedding_model)                                                                       |
| knowledge_assets / knowledge_asset_versions | 稳定资料 ID；版本含 owner, asset_id, version, collection_id, original_name, relative_path, digest, parse_status, index_status, coverage；唯一(asset_id,version)                                                                                      |
| knowledge_asset_chunks                      | id, owner, asset_version_id, ordinal, locator, content；唯一(asset_version_id,ordinal)                                                                                                                                                               |

attribution=user/external/assistant；modality=asserted/hypothetical/planned/uncertain；stance=tentative/endorsed/questioning/abandoned。review_status=pending/approved/rejected；lifecycle=active/archived/withdrawn/deleted。确认用户观点只改变 review_status，不改变 modality 或 attribution。

context 为结构化对象：collection_ids、topics、activity、conditions、exceptions；除 collection_ids 外均可空，自由文本仅作为匹配数据。attributes 最多 32 个键、嵌套深度 3、序列化不超过 16 KB，禁止可执行表达式。可选模板只做校验和展示，例如 deadline、decision_options，不参与授权和审批判断。业务逻辑不得依赖自由属性中的 approved/owner 等伪造字段。

标题最多 200 字，单条正文最多 16,000 字，连接说明最多 8,000 字；超长输入采用已有分段和上下文机制，原话不可静默截断。旧 fact/episode 通过 KnowledgeRef 和查询适配器接入，不复制为第二份事实，不产生两份独立版本真相。

### 13.3 状态机与并发

显式记录：验证当前用户原话及目标 → 同事务保存来源/条目版本/索引任务 → 返回已保存及索引状态。自动提炼：来源验证 → pending proposal → 用户批准后在同事务写正式版本与索引任务。模型不得把自己生成的正文当成用户原话授权。

proposal：pending → approved/rejected；编辑或依据变化 → stale → 用户刷新比较后 pending。正式修订必须提供 base_version_id，失配返回 409。卡片内容变更使依赖旧版本的连接和模式进入待复核集合，历史仍可显式读取，当前自动应用停止。删除与索引并发时，索引 worker 在写入前重检版本、正文哈希、owner、删除状态和策略 epoch。

## 14. 思考方式记忆与持续适应

### 14.1 保存对象

pattern 是一种通用条目，保存情境、观察到的方式、建议的协作动作、支持记录、反例、适用范围和复核状态。避免“用户就是某类人”的人格断言。原始思想和连接保留，模式只是可撤回的派生认识。

knowledge_items 与 knowledge_connections 增加 usage_status=ready/needs_review/suspended；它与 review_status、lifecycle 独立。正式自动使用必须同时 approved、active、ready；来源变更为 needs_review，明确纠正为 suspended。usage_status 只由服务端写入，修订重新确认后才恢复 ready；每次应用前从数据库重检，不能仅信任向量索引状态。

pattern 的 attributes 使用专门 Pydantic Schema：observation、when_applicable、exceptions、suggested_actions、origin(explicit/inferred)、last_reviewed_at。suggested_actions 限定为 adjust_detail/ask_clarifying/summarize_first/use_example/offer_small_step/retrieve_prior_reasoning；禁止修改系统规则、权限或写入策略。

### 14.2 形成与确认

用户明确提出稳定协作偏好时直接保存 preference；“这次简短一点”仅作为本轮 override。范围不明确时先局部应用，不推定长期授权。

推断模式由用户点击“回顾我的思考方式”触发，或在智能记忆开启且新增足够已确认材料时生成候选。工程默认门槛：至少 3 条不同来源、跨 2 次会话，或 2 次明确反馈；门槛只是减少噪声，不代表统计证明。资料作者的观点、AI 自己的回复、同源改写和 pending 内容不能充当独立的用户模式证据。

每次最多生成 2 个候选，同一证据集合以哈希幂等；每用户自动评估最多每日一次，只在有新材料的在线处理任务中触发，无离线消息推送。无清晰模式则零候选；相反证据必须一起呈现。用户拒绝后，相同证据不得重复打扰。推断模式只有确认后才允许进入未来自动个性化上下文。

### 14.3 如何影响未来

上下文构建按以下顺序执行：系统与安全约束 → 用户本轮要求 → 已明确的适用偏好 → 已确认且当前情境匹配的模式。历史偏好冲突时，更具体范围优先；同范围最新明确修订优先；仍有冲突则不自动选择并简短询问。

每轮最多应用 3 条模式，模式上下文最多 2,000 字。集合范围先确定，再匹配 activity/topics/conditions；不得仅凭“都是用户的记忆”跨场景套用。无法判断是否适用时不用。模式内容以数据区传入，不作为更高优先级指令。

记录实际采用的 pattern_version_id 与动作到 knowledge_applications。用户可以询问“为什么这样回复”，系统返回已使用的偏好/模式及公开依据，不编造决策原因。模式缺失、超时或索引失败时正常回答，不阻塞聊天。

### 14.4 反馈、纠正与失效

“有帮助”记录为反馈，不自动证明模式普遍成立。“你理解错了”立即暂停对应模式的未来使用，形成修订候选；“只在写作时这样”调整范围候选并停止宽范围应用。“今天直接给步骤”仅覆盖当前请求，不自动删除长期偏好。

来源被删除、证据版本过时或用户撤回确认时，相关模式不再自动应用；在下次使用前必须重新核对。更新与撤回使上下文缓存失效。模式、反馈和应用记录纳入导出与删除依赖图；反馈删除不能让已经明确撤回的模式自动复活。

这是一套记忆驱动的适应机制，本期不微调模型、不修改模型权重、不做自动强化学习。优化效果根据用户反馈和任务结果验证，不能以“模型更自信”或“回答更长”替代。

## 15. API 与任务执行合同

新接口前缀 `/api/v2`，沿用现有认证和错误 envelope。owner 永远来自服务端身份。写入使用 Idempotency-Key，同 key 同 payload 返回原结果，不同 payload 返回 409 IDEMPOTENCY_CONFLICT。分页采用 limit(默认20，上限100)＋cursor；资源详情包含 id/version_id/review_status/lifecycle/source_refs。

| 方法与路径                    | 请求要点                                                                      | 返回与行为                                     |
| ----------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------- |
| POST /collections             | name, description?, tags?                                                     | 201 collection                                 |
| GET /collections              | cursor?, limit?                                                               | items, next_cursor                             |
| PATCH /collections/{id}       | name?, description?, tags?                                                    | 200；不隐式移动或删除条目                      |
| POST /assets                  | multipart file, collection_id                                                 | 202 asset_id, version_id, job_id               |
| GET /assets/{id}              | version_id?                                                                   | 元信息、解析覆盖范围、索引状态                 |
| GET /assets/{id}/download     | version_id?                                                                   | 经授权读取原文件；缺失返回明确错误             |
| POST /assets/{id}/versions    | file, base_version_id                                                         | 202 新版本及 job_id                            |
| POST /items                   | text, kind?, collection_ids, source_message_id?                               | 201 显式原文记录；仅用户 UI 调用可授权直接保存 |
| GET /items/{id}               | version_id?                                                                   | 当前或指定可访问版本                           |
| PATCH /items/{id}             | base_version_id, text, attributes?                                            | 200 新版本；旧版本保留                         |
| GET /items/{id}/history       | cursor?, limit?                                                               | 历史版本                                       |
| POST /connections             | 两端 ref/version, explanation_raw, context?                                   | 201；验证目标唯一和用户明确授权                |
| GET /items/{id}/connections   | history=false                                                                 | 可读连接及待复核提示                           |
| PATCH /connections/{id}       | base_version_id, explanation_raw, context?                                    | 200 新版本                                     |
| POST /proposals               | type, evidence_ids, payload, base_version_id?                                 | 201 pending；模型工具只能使用此入口语义        |
| POST /proposals/{id}/decision | approve/reject, base_version_id                                               | 200；重检端点、证据、策略和版本                |
| PATCH /proposals/{id}         | payload                                                                       | stale；必须重新比较和确认                      |
| POST /proposals/{id}/refresh  | 无                                                                            | 最新依据下 pending；不自动批准                 |
| POST /search                  | query, collection_ids或all_collections, kinds?, time_range?, history?, limit? | items, warnings, retrieval_trace_id            |
| POST /patterns/review         | collection_ids或all_collections                                               | 202 job_id；返回候选，不直接激活               |
| POST /feedback                | run_id, target_pattern_version_id?, kind, text, scope                         | 201；correction 同步停用被纠正模式             |
| POST /deletion-previews       | target_type, target_id, scope                                                 | 影响清单、短期有效 preview_id                  |
| POST /deletions               | preview_id, base_version_id                                                   | 202；重检影响清单，变化返回409                 |
| POST /exports                 | scope                                                                         | 202 job_id；完成后返回下载入口                 |
| POST /imports/preflight       | 备份包                                                                        | 校验结果与 import_id；不改变正式库             |
| POST /imports/{id}/restore    | 已通过 preflight 的 import_id                                                 | 202；仅空库，失败不留部分正式数据              |
| GET /jobs/{id}                | 无                                                                            | state, stage, progress, error, result          |
| POST /jobs/{id}/retry         | 无                                                                            | 202；仅重试允许的失败阶段                      |

新增错误码：KNOWLEDGE_VERSION_CONFLICT、EVIDENCE_UNAVAILABLE、SCOPE_REQUIRED、ASSET_ORIGINAL_MISSING、PARSE_PARTIAL、IMPORT_TARGET_NOT_EMPTY、IMPORT_INTEGRITY_FAILED。PARSE_PARTIAL 为结果警告，不误报全部失败。集合范围必须显式传入或由会话已选择范围补齐，不能默认 all_collections。

Job state=QUEUED/RUNNING/SUCCEEDED/PARTIAL/FAILED/CANCELLED。stage 区分 RECEIVED/STORED/PARSING/PARSED/EXTRACTING/PENDING_REVIEW/INDEXING/READY/EXPORTING/VALIDATING/RESTORING。恢复进程只重跑幂等阶段；不得重复重放已完成云端调用而覆盖用户修订。

查询内部建议：关键词、向量每路最多30候选，RRF合并后最多20，必要重排后最多8条直接证据，再扩展最多4条一跳连接；总证据默认12,000字，保留引用完整性。这些为配置默认值，不是性能保证。中文关键词沿用二元分词并将词集合物化到搜索表，PostgreSQL GIN 索引实现全量候选筛选；不先截取最近 N 条再过滤。历史与正式状态在召回前过滤。

## 16. 代码功能规划

以下均为待实现路径，不表示文件已经存在。新增模块使用依赖注入，禁止把整个 V2 塞进 main.py 或 memory.py。

| 路径                                  | 职责与主要函数                                                                            | 对应测试                      |
| ------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------- |
| apps/api/app/knowledge/models.py      | 新 SQLAlchemy 模型、约束；复用现有 Base                                                   | test_knowledge_models.py      |
| apps/api/app/knowledge/schemas.py     | ItemCreate/ConnectionCreate/PatternAttributes/SearchRequest/FeedbackInput；输入限制       | test_knowledge_schemas.py     |
| apps/api/app/knowledge/policy.py      | can_read、validate_evidence、authorize_write、resolve_scope；确定性授权                   | test_knowledge_policy.py      |
| apps/api/app/knowledge/service.py     | create_item、revise_item、propose、decide；事务与版本                                     | test_knowledge_lifecycle.py   |
| apps/api/app/knowledge/connections.py | create_connection、revise_connection、invalidate_dependents                               | test_knowledge_connections.py |
| apps/api/app/knowledge/assets.py      | stage_upload、commit_original、parse_version、download；文件系统补偿                      | test_knowledge_assets.py      |
| apps/api/app/knowledge/parsers.py     | 按类型适配现有解析，新增 parse_pptx；页码和覆盖报告                                       | test_knowledge_parsers.py     |
| apps/api/app/knowledge/retrieval.py   | index_version、search、expand_connections；新旧证据统一 DTO                               | test_knowledge_retrieval.py   |
| apps/api/app/knowledge/patterns.py    | collect_evidence、propose_patterns、select_applicable、record_application、apply_feedback | test_knowledge_patterns.py    |
| apps/api/app/knowledge/backup.py      | export_bundle、validate_bundle、restore_empty；清单、哈希、事务与暂存目录                 | test_knowledge_backup.py      |
| apps/api/app/knowledge/router.py      | FastAPI 路由，只做 schema、鉴权、调用服务与响应转换                                       | test_knowledge_api.py         |
| apps/api/app/knowledge/jobs.py        | 分阶段 worker、重试、进程恢复、删除与策略重检                                             | test_knowledge_jobs.py        |
| apps/api/app/migrate.py 与 db.py      | 注册新模型、顺序 schema 迁移、旧条目映射                                                  | test_knowledge_migrations.py  |
| apps/api/app/tools.py                 | 添加只读知识工具与候选写入工具，兼容旧工具                                                | test_agent.py 与新工具测试    |
| apps/api/app/context.py 与 runtime.py | 注入适用模式、记录应用、当前指令优先、模式故障回退                                        | test_knowledge_context.py     |

对应测试置于 apps/api/tests/。前端只需最小 API 映射、集合选择、条目与关系审核、反馈和导出恢复操作；开始修改 apps/web 前须读取其 AGENTS.md 和设计约定。新增 web/src/lib/api/knowledge.ts 与 types/knowledge.ts，组件按现有 memory/agent 分层；不得引入与后端重复的审批状态机。

现有 Provider structured/embed/rerank/chat 接口复用。提取器提示词输出必须经 schema 与逐字来源核验，模型不能设定正式状态。PPTX 解析实现时评估 python-pptx，采用后同步 requirements/lock 并加入真实文件 fixture；不执行 Office 应用或宏。所有依赖选择需与实际 Python 版本兼容。

## 17. 编码执行顺序与完成定义

1. 读取现有 AGENTS/README、本 PRD 和代码，检查工作区；不覆盖用户未提交改动。记录原测试基线。
2. 实现新模型、输入 schema 和迁移副本测试；旧 API 与旧数据 ID 保持兼容。先做空库与旧库升级，不直接试改用户正式库。
3. 完成集合/原文件/PPTX/任务恢复；以真实文件验收跨会话查询和下载一致性。
4. 完成通用条目、连接、审批及删除依赖；用多场景同一接口证明无固定场景分支。
5. 完成混合检索、模式候选/确认/应用/纠正；接入 Agent，验证本轮要求覆盖历史模式。
6. 完成导出恢复和最小交互；跑真实 PostgreSQL、真实百炼与重启验收，区分模拟与真实结果。
7. 更新实施说明、验收记录和启动文档；每个可验证阶段提交 Git commit。未完成项明确列出，不把接口存在或 mock 通过当成真实完成。

每阶段入口条件为上一阶段相关测试通过；完成条件包括正常路径、失败恢复、权限/状态隔离和必要迁移检查。费用/延迟记录实际测量，不写虚构阈值。真实云端凭据缺失时报告阻塞并保留已完成代码与模拟验证，不能伪造云端结果。

## 18. V2.1 增量验收与评估

| 编号  | 输入或操作                                                   | 必须观察到的结果                                             |
| ----- | ------------------------------------------------------------ | ------------------------------------------------------------ |
| KB-01 | 同一接口保存旅行比较、阅读疑问、实验观察、家庭事务与课程理解 | 公共字段可查询；未知扩展保留；无需修改场景枚举或新增数据库表 |
| KB-02 | 提交 attributes 中伪造 owner/approved 与超限嵌套             | 不改变权限或正式状态；非法结构明确拒绝                       |
| KB-03 | 同源材料改写3次                                              | 不满足模式多来源门槛                                         |
| KB-04 | 用户明确说“以后思绪乱时先帮我归纳”                           | 保存带条件的偏好，未来匹配时使用                             |
| KB-05 | 多次已确认材料支持一种模式                                   | 生成带证据及反例的 pending；批准前不用于跨会话个性化         |
| KB-06 | 已确认先归纳模式；本轮说“直接给步骤”                         | 本轮遵循当前要求，历史模式不擅自删除                         |
| KB-07 | 模式只适用于写作，当前讨论旅行                               | 不自动套用；应用记录无该模式                                 |
| KB-08 | 用户纠正“你理解错了”                                         | 下轮立即停止原模式，修订待审；不能等索引完成才停用           |
| KB-09 | 删除模式支持来源                                             | 当前模式与缓存失效；导出不含已删除正文                       |
| KB-10 | 询问“为何这样回应”                                           | 返回实际应用版本及可见依据，不编造归因                       |
| KB-11 | 并发审批、修订、索引完成                                     | 旧版本批准返回409；过时索引不覆盖新正文                      |
| KB-12 | 相同请求重放；进程在原文件就位后崩溃                         | 不重复条目；重启恢复或补偿，元数据与原文件可核对             |
| KB-13 | 模式选择服务失败                                             | 普通聊天可完成，记录降级，不伪装已个性化                     |
| KB-14 | 备份含思想、关系、模式与反馈；空库恢复                       | ID/版本/证据链一致，撤回模式仍不应用                         |

新增同一组任务的“无模式/已确认模式/已被纠正模式”对照，记录当前要求遵循、情境误用、用户评价及执行后是否需要重述。固定测试集要求本轮覆盖、未确认模式不应用、错误归因与越权规则全部通过；“更懂用户”需要本人试用反馈，不能仅靠结构检查宣称达成。

文档合同测试只验证编号、必要边界与规格完整性，功能测试必须真实调用实现并断言行为，不能只检查源文件包含某个字符串。V2.1 发布记录须分别列出通过的自动测试、真实集成测试、尚未验收项。
