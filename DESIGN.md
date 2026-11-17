---
version: alpha
name: Personal Agent
description: 面向 AI 研究生的学习、项目交流与日常记忆伙伴
colors:
  canvas: "#ffffff"
  sidebar: "#f5f6f8"
  ink: "#24262b"
  muted: "#69717d"
  line: "#e7e9ed"
  primary: "#3568d4"
  primary-soft: "#edf3ff"
  success: "#39705a"
  success-soft: "#f0f7f3"
  warning: "#865e25"
  warning-soft: "#fbf6ec"
  danger: "#b04444"
  danger-soft: "#fcf1f1"
  scroll-thumb: "#c2c7d0"
  scroll-hover: "#929aa7"
  scroll-active: "#69717d"
typography:
  sans:
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", sans-serif'
  mono:
    fontFamily: '"SFMono-Regular", Consolas, monospace'
rounded:
  sm: "8px"
  md: "12px"
  lg: "20px"
spacing:
  unit: "4px"
  sidebar: "256px"
  reading: "780px"
components:
  button: {}
  receipt: {}
  composer: {}
  evidence: {}
---

> 历史设计材料：旧前端及其 token 生成脚本已移除，当前知乎前端样式位于 src/style.css。


# Personal Agent Design System

## Overview

面向个人研发者，以中文记录经历、回忆项目决策。产品工具界面，桌面优先，同时支持手机浏览。依据 PRD v1.1；默认连接本机 FastAPI，百炼和数据库需配置。独立 `/demo` 保留集中 Mock。

视觉参考是安静的 macOS 工作空间：雾灰侧栏、白色画布、精确间距和克制的圆角。签名元素是回复下方的“来源条”，让记忆的依据成为内容的一部分。避免营销式大标题、装饰性渐变、仪表盘指标卡。

仅支持 zh-CN，时间采用 Asia/Shanghai；英文产品名和技术名称保留原文。没有日本市场或日语需求。首版仅浅色主题。

Token ownership: Model A。此文件的 frontmatter 为颜色、字体、圆角与空间 token 的唯一来源。`apps/web/scripts/generate-tokens.mjs` 生成 `src/app/tokens.css`，`globals.css` 导入后经 Tailwind v4 `@theme` 提供工具类。运行 `npm run tokens:check` 检查漂移；不得手改生成文件。

## Colors

canvas、sidebar 区分内容与导航；ink 为正文，muted 为辅助文字。primary 仅用于选择、焦点、发送与来源。success、warning、danger 总是配合图标和文字，分别用于完成、待确认和失败。line 是低对比装饰边框，不单独承担交互状态。

## Typography

sans 用于中英混排及标题；品牌 17px/650，页面标题 19px/600，消息正文 13px/1.9，来源正文 14px/2，辅助信息 9–12px。对话引导标题 26px，空会话标题 32px。mono 预留给后续版本和接口标识。使用系统字体避免字体下载与布局漂移。

## Layout

4px 节奏。桌面侧栏 256px，消息阅读区最大 780px。顶部工具栏最小 86px。工作台为视口高度的 flex 布局，消息区独立滚动，输入区固定在布局底部。侧栏历史独立滚动。宽度低于 768px 使用原生 dialog 包装侧栏，保持所有导航与会话可达。来源使用模态侧抽屉，手机使用近全屏宽度。

## Elevation & Depth

主要层级由底色、边框、留白形成；只给输入框与浮层轻阴影，不给所有卡片阴影。

## Shapes

sm 为小按钮，md 为消息与反馈卡片，lg 为输入区域。圆形只用于用户、Agent 标识和发送按钮。图标采用 Lucide 统一线宽。

## Components

规范所有者：按钮由 `components/ui/button.tsx` 管理；输入与校验由 MessageComposer 和 lib/validation 管理；反馈由 MemoryReceiptCard 管理；模态与焦点由 ui/modal 管理；全局滚动条由 globals.css 管理。业务状态由 useWorkspace 管理，异步读写只能通过 MemoryGateway。

| Capability   | Canonical owner                             | Source of truth | Allowed variants                   | Verification       |
| ------------ | ------------------------------------------- | --------------- | ---------------------------------- | ------------------ |
| Form         | MessageComposer + validateMessage           | PRD §1.2, §1.4  | ask / record                       | unit + browser     |
| Scrollbar    | globals.css                                 | 本设计规范      | global                             | browser            |
| Feedback     | MemoryReceiptCard                           | PRD §1.4        | added / merged / pending / failed  | browser            |
| Dialog       | Modal                                       | 本设计规范      | centered / drawer                  | keyboard + browser |
| Navigation   | Sidebar                                     | 第一阶段指令    | desktop / mobile                   | browser            |
| CRUD         | MemoryLibrary + EvidenceDrawer + TextEditor | UX-CONTRACT.md  | revise / restore / delete / review | unit + browser     |
| Agent policy | AgentControls + RealGateway                 | PRD §17–21      | smart-memory / skip / cancel       | API + browser      |
| Upload       | AgentControls + RealGateway.upload          | PRD §19         | file picker / abort / retry        | API + browser      |
| Context      | AgentControls insights + Modal              | PRD §20         | core facts / summary / tools       | API + browser      |
| Setup        | ServiceSetup                                | local-setup.md  | disconnected / configured          | browser + axe      |

按钮提供 hover、pressed、focus-visible、disabled 和 busy 状态；等待时固定几何尺寸。双模式为原生单选组，遵循键盘方向键操作。输入支持中文输入法、Shift+Enter 换行、Enter 发送；保留每会话草稿；输入错误关联文本域。

来源模态提供标题、关闭按钮、Escape 关闭、背景隔离和焦点恢复。所有可点击来源都通过网关读取，有加载、失败和重试状态。

`/demo` 模拟内容标明“演示”，只留在网页内存，刷新重置。真实页面显示本机服务模式，加载失败给出配置或重试入口，不回退 Mock。工具活动与正文分开显示，模型返回后展示全文，不用动画伪造 token 流。重要更新批准前不进入已确认来源；拒绝维持旧版本。中断和降级保留说明，重生成替换未完成内容。

智能记忆开关保存成功后更新，失败保留旧值。上传使用原生文件选择器，校验类型/大小，支持取消与重新选择重试。网页/文件/记忆共享来源抽屉并标注类型。上下文面板沿用 Modal，展示后端事实、摘要原文指针和工具活动。临时聊天用 MessageComposer temporary 变体，隐藏记录入口，关闭前确认清空。

记忆库保持搜索、筛选和分页可见，中间结果列表独立滚动。详情区分事实、事件、计划、历史、原始记录和已删除引用。修改候选使用模态表单，需返回对比界面再确认；修订产生新版本，历史恢复使用补偿版本。删除必须展示影响范围并确认，保留 Source。详细交互状态与退出规则见 UX-CONTRACT.md。

动效仅用于 150ms 控件状态过渡和请求中的加载指示；prefers-reduced-motion 下取消。滚动条全局可见且支持 forced-colors。禁用导航附“即将推出”，不进入空白页。

## Do's and Don'ts

- 保持提问、记录、来源与更新确认的语义一致，见 PRD ADR-002、ADR-009。
- 所有 Mock 响应和样本集中于 lib/mock；组件不得嵌入模拟回答。
- 不用“已永久保存”等措辞描述内存中的演示结果。
- 不以装饰或动画争夺消息内容的注意力。

## 2026-11-04 前端 V2.1

主导航为对话、记忆、关于我、设置。真实使用界面移除宣传型空态及不可用占位导航；演示路由保留独立演示内容。管理页使用浅灰导航、白色正文和蓝色主操作，沿用现有颜色及字体 token。内容以分隔行呈现，状态文本仅用于必要区分；详细权限和预算说明按需展开。新增样式位于 `apps/web/src/app/v2.css`，不直接修改生成的 tokens.css。

移动端管理导航横排，主内容独立滚动；表单保留标签，弹窗使用原生 dialog。不可逆删除、导入替换和备份隐私范围持续可见。高级参数称为记忆预算和检索次数，不暗示控制模型内部推理。

### 2026-11-05：记忆引擎 MVP 界面

- `components/v2/memories-page.tsx` 与 `profiles-page.tsx` 统一使用 `v2.css` 的卡片网格。桌面双列、手机单列，底部来源条固定为主要阅读线索。画像明确区分本人陈述/系统推断；active 显示「可使用」，不宣称本轮已使用。
- `components/agent/execution-trace.tsx` 是执行过程唯一展示入口。读取材料、回答显式引用和写入任务分区；不以任务完成冒充索引/画像完成，也不以候选数冒充最终注入数。
- `components/ui/form.tsx` 是新版管理表单校验 owner：复用 HTML constraints，在应用内显示错误并聚焦无效字段，不弹浏览器校验气泡。`Select/Listbox` 保留原生 select，中文 label、系统键盘行为；不另造下拉组件。
- `components/ui/discard-dialog.tsx` 是丢弃草稿确认 owner，复用 Modal 的焦点与 Esc 行为。删除仍由 DeleteForm 明确说明不可逆后果。
- 卡片悬停 180ms、弹窗进入 180ms；prefers-reduced-motion 下关闭位移动效。非必要解释收进 InfoTip。不会增加打字机式假流式输出。

### 会话界面约定（2026-11-06）

真实聊天区仅保留一个会话记忆开关；“记忆与上下文”和头部“我的记忆”不再作为重复入口。记忆/画像管理从侧栏进入。上传与临时对话保留。兄弟组件 key 使用类型前缀区分。
侧栏会话删除使用独立按钮和应用 Modal，明确聊天与附件删除、长期记忆及来源保留；移动端删除按钮常显。空工作区由用户显式新建，不自动创建。
