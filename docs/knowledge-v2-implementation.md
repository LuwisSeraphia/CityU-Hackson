# V2 后端实施进度

日期：2026-11-03。基于 PRD V2.1 的首轮后端实现，**不是全部 PRD 的交付完成声明**。

## 已落地

- 独立 knowledge 包、schema revision 3 的增量建表，保留旧表和接口。
- 自定义集合、通用结构化条目、正文与属性校验、版本历史、乐观版本冲突。
- 显式保存、自动候选、审批前不召回、审批重检依据与记忆策略 epoch。
- 用户连接原话、端点版本检查、端点更新后标记待复核。
- 条目删除清空正文及派生依赖、连接、相关候选与摘要失效。
- 本地原文件保存与下载哈希核验，PPTX 文字/表格页级提取，局部解析提示。
- 按集合跨会话关键词检索，整合条目与文件块；Agent 新增 search_knowledge。
- ChatInput 可携带 knowledge_collection_ids；未选择集合时知识工具拒绝读取。
- 版本固定的 knowledge 引用与现有 evidence 接口适配。
- 按需调用模型生成模式候选；确认后以显式情境关键词匹配，最多3条/2000字；当前指令优先；纠正立即停用。
- ZIP 导出、新知识库空库恢复、哈希/引用/路径清单校验和失败补偿。

## 当前接口使用

所有请求使用现有 Bearer API_TOKEN，凭据保留在服务器。直接 API 调用是当前可用入口，前端尚未提供 V2 管理界面。

1. POST /api/v2/collections，正文 name，带 Idempotency-Key。
2. POST /api/v2/items，正文 text/kind/collection_ids/attributes，可选 evidence_ids，带 Idempotency-Key。
3. POST /api/v2/assets，multipart collection_id/file；GET /assets/{id} 或 /assets/{id}/download。
4. POST /api/v2/search，正文 query/collection_ids。
5. POST /api/v2/connections，正文 from_id/to_id/from_version_id/to_version_id/explanation_raw，带 Idempotency-Key。
6. POST /api/v2/proposals，使用 ItemInput；GET /proposals 查看候选；POST /proposals/{id}/decision，decision=approve/reject。
7. POST /api/v2/patterns/review，正文 query（当前必填、仅兼容 SearchInput）/collection_ids；POST /patterns/{id}/feedback，kind/text。
8. GET /api/v2/exports/download 下载；POST /api/v2/imports/restore 上传 file，仅空知识库可用。
9. 在现有 /api/v1/agent/runs 请求中附加 knowledge_collection_ids，让聊天读取所选资料。

## 与 PRD 尚有差距，实施前须继续补齐

- 资产上传目前同步处理、无资产多版本、原文件 crash 恢复/孤儿清理任务、PPTX 备注解析。
- 关键词检索已覆盖全部记录，但尚无 V2 向量索引、GIN 词索引、重排、连接说明召回和一跳扩展。
- 当前关系只支持通用条目端点，尚无 legacy fact/episode/asset 的统一引用适配、关系版本或候选关系编辑。
- 模式生成仅要求3条不同正文，未满足跨会话/独立来源证据门槛；不宣称达到 PRD 的模式自动学习验收。只有用户主动审核入口，无每日自动回顾。
- 暂无独立来源表、用户/外部/模型完整归属、时间范围查询、模式反例与冲突决策、专门动作 schema。
- 模式选择为保守文字条件匹配，暂无语义情境判定；运行记录保存选用模式，不代表模型实际遵循，需要评估。
- 删除目前直接 DELETE 并清理派生依赖，无预览确认接口及两种删除范围；无资产删除。
- 导出恢复为同步接口，未提供预检独立步骤、恢复中断持久任务或 Markdown 导出；只备份 V2 数据，不含旧聊天及旧事实。
- 请求幂等覆盖新增集合/条目/候选/连接；同 key 并发唯一冲突尚须转换为可重放结果；其他写入需统一补齐。
- 无新前端、打开时接续、实际用户试用；真实百炼与 PostgreSQL 重启迁移未验收。

不要把本轮同步 API 当成 PRD 规定的 202 后台任务合同。后续须迁移为任务管线，并补齐兼容层和测试。

## 验证

完整后端测试 58 项通过（SQLite 和 Provider 替身，非真实云端验收）。包括新增8项知识库测试：版本与隔离、候选/模式纠正、关系失效、属性约束、PPTX原文件、导出恢复、情境与删除、API与Agent工具引用。

修复了新进程持久化核对未加载新表元数据的问题。生产数据库未在本轮执行迁移；首次启动会按现有 auto_migrate 设置升级，使用正式数据前应先备份并在副本验证。
