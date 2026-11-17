import type { Conversation, Evidence, InputMode } from "@/types/memory";

export const demoPrompts: { label: string; text: string; mode: InputMode }[] = [
  {
    label: "回顾项目方向",
    text: "我的 Personal Agent 项目目前采用什么技术方案？",
    mode: "ask",
  },
  {
    label: "记录一个想法",
    text: "今天想到：记忆助手的回答应该始终展示来源，让每个结论都有依据。",
    mode: "record",
  },
  {
    label: "体验更新确认",
    text: "我决定把项目的第一阶段目标改为：先完成工作台界面。",
    mode: "record",
  },
  {
    label: "体验处理失败",
    text: "演示处理失败：今天整理了记忆模块的测试计划。",
    mode: "record",
  },
  {
    label: "索引失败恢复",
    text: "演示索引失败：今天整理了项目的界面反馈。",
    mode: "record",
  },
  {
    label: "未来计划",
    text: "演示未来计划：下周准备完成项目的可用性测试，还没有开始。",
    mode: "record",
  },
  { label: "无可提取事实", text: "演示零候选：嗯，再想想。", mode: "record" },
  {
    label: "回答中断",
    text: "演示回答中断：我的项目技术方案是什么？",
    mode: "ask",
  },
  {
    label: "检索降级",
    text: "演示检索降级：我的项目技术方案是什么？",
    mode: "ask",
  },
  {
    label: "服务不可用",
    text: "演示服务不可用：最近记录了什么？",
    mode: "ask",
  },
];

export const seedEvidence: Evidence[] = [
  {
    id: "source-project",
    title: "Personal Agent · 项目定位",
    text: "我正在开发 Personal Agent，一个拥有长期记忆能力的个人 AI Agent。V1.0 只做记忆助手，之后再考虑知识图谱和任务管理。",
    createdAt: "2026-10-24T10:30:00+08:00",
    kind: "episode",
    version: 1,
    status: "current",
  },
  {
    id: "source-stack",
    title: "技术方案",
    text: "Personal Agent 前端采用 Next.js，后端使用 FastAPI。模型接入 Qwen 百炼 API，数据库采用 PostgreSQL + pgvector。记忆保留事件和原子事实两条轨道。",
    createdAt: "2026-10-24T14:20:00+08:00",
    kind: "fact",
    version: 1,
    status: "current",
  },
  {
    id: "source-scope",
    title: "第一阶段目标",
    text: "第一阶段先验证记忆引擎。",
    createdAt: "2026-10-23T16:00:00+08:00",
    kind: "fact",
    version: 1,
    status: "current",
  },
  {
    id: "source-reading",
    title: "阅读习惯",
    text: "我希望每周留出两个晚上阅读技术文章，并把有价值的想法整理成自己的笔记。",
    createdAt: "2026-10-23T20:15:00+08:00",
    kind: "episode",
    version: 1,
    status: "current",
  },
];

export const seedConversations: Conversation[] = [
  {
    id: "conversation-project",
    title: "Personal Agent 的技术方向",
    updatedAt: "2026-10-24T14:25:00+08:00",
    messages: [
      {
        id: "message-1",
        role: "user",
        mode: "record",
        text: "记一下：Personal Agent 前端用 Next.js，后端用 FastAPI，数据库采用 PostgreSQL + pgvector。",
        createdAt: "2026-10-24T14:20:00+08:00",
      },
      {
        id: "message-2",
        role: "assistant",
        text: "这条技术决策已加入演示记忆，之后可以在不同会话中回顾。",
        createdAt: "2026-10-24T14:20:01+08:00",
        receipt: {
          kind: "added",
          summary: "项目技术方案",
          sourceIds: ["source-stack"],
        },
      },
      {
        id: "message-3",
        role: "user",
        mode: "ask",
        text: "帮我回顾一下，Personal Agent 现在的方向是什么？",
        createdAt: "2026-10-24T14:25:00+08:00",
      },
      {
        id: "message-4",
        role: "assistant",
        text: "你正在构建一个拥有长期记忆能力的个人 AI Agent。V1.0 聚焦「记忆助手」：主动记录、跨会话回忆，并让回答有来源可查。\n\n技术上，前端采用 Next.js，后端规划为 FastAPI，搭配 Qwen 百炼 API 和 PostgreSQL + pgvector。记忆将同时保留事件和原子事实。",
        createdAt: "2026-10-24T14:25:02+08:00",
        citations: ["source-project", "source-stack"],
      },
    ],
  },
  {
    id: "conversation-reading",
    title: "把阅读变成自己的知识",
    updatedAt: "2026-10-23T20:15:00+08:00",
    messages: [
      {
        id: "message-reading-1",
        role: "user",
        mode: "record",
        text: seedEvidence[3].text,
        createdAt: "2026-10-23T20:15:00+08:00",
      },
      {
        id: "message-reading-2",
        role: "assistant",
        text: "已加入演示记忆。你可以随时回来查看这条阅读计划。",
        createdAt: "2026-10-23T20:15:01+08:00",
        receipt: {
          kind: "added",
          summary: "每周阅读与笔记计划",
          sourceIds: ["source-reading"],
        },
      },
    ],
  },
];
