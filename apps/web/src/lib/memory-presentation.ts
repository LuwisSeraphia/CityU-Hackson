import type {
  Evidence,
  OperationStage,
  RecordProcessing,
} from "@/types/memory";
export const progressLabels: Record<OperationStage, string> = {
  received: "已收到，等待处理",
  extracting: "正在整理事件与事实",
  resolving: "正在比对已有记忆",
  indexing: "正在同步检索索引",
  retrieving: "正在查找相关记忆",
  generating: "正在组织回答",
};
export const evidenceStatusLabels: Record<Evidence["status"], string> = {
  current: "当前版本",
  pending: "待确认 · 暂不用于回答",
  historical: "历史内容 · 不作为当前记忆",
  corrected: "已纠正 · 原记录有误",
  planned: "计划 · 尚未发生",
  deleted: "此事实已删除 · 引用已失效",
  rejected: "未采用候选 · 不用于回答",
};
export function processingDescription(job: RecordProcessing) {
  if (job.sourceStatus === "FAILED") return "处理失败，尚未提交记忆。";
  if (job.sourceStatus === "RECEIVED")
    return job.pending
      ? "原始记录已收到，候选仍待确认；尚未提交正式记忆。"
      : "原始记录已保留，没有新增正式记忆。";
  if (job.indexStatus === "FAILED")
    return "记忆已提交，检索索引同步失败；重试只重建索引。";
  if (job.indexStatus === "READY") return "记忆已提交，检索索引已同步。";
  return "记忆已提交，索引尚未同步。";
}
