import { ApiError } from "./client";
import { invalidatePersonalData } from "../privacy-events";

export type ResponseMode = "auto" | "fast" | "personalized" | "deep";
export interface ResponseOptions {
  mode: ResponseMode;
  memory_budget_tokens: number | null;
  retrieval_rounds: number | null;
  history_scope: string;
}
export const modes: Record<ResponseMode, string> = {
  auto: "自动",
  fast: "简洁快速",
  personalized: "结合我的情况",
  deep: "深入梳理",
};
export interface ResponseSettings {
  revision: number;
  options: ResponseOptions;
  limits: { memory_budget_max: number; retrieval_rounds_max: number };
}
export interface PageResult<T> {
  items: T[];
  next_cursor: string | null;
}
export interface Batch {
  id: string;
  source_id: string;
  state: string;
  revision: number;
  reasons: string[];
  created: string;
}
export interface Candidate {
  id: string;
  state: string;
  revision: number;
  data: {
    title?: string;
    content?: string;
    evidence?: string;
    kind?: string;
    subject?: string;
    assertion_kind?: string;
    sensitivity?: string;
    profile_category?: string;
    edited_source_id?: string;
    previous_content?: string | null;
    review_reasons?: string[];
  };
}
export interface Profile {
  id: string;
  content: string;
  category: string;
  origin: string;
  state: string;
  pinned: boolean;
  revision: number;
  evidence_ids: string[];
  context: { counterevidence_ids?: string[] };
}
export interface MemoryItem {
  event_time?: string | null;
  id: string;
  content: string;
  title?: string;
  status: string;
  version: number;
  revision?: number;
  source_ids: string[];
  metadata?: Record<string, unknown>;
}
export interface UsePolicy {
  revision: number;
  recall_policy: "explicit_only" | "explicit_or_continuation";
  do_not_mention: boolean;
  detail_level: "summary" | "detail";
  allow_profile_inference: boolean;
}
export interface Job {
  outcome?: string | null;
  id?: string;
  state: string;
  stage?: string;
  batch_id?: string;
  error?: { message?: string };
}
export async function v2<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(`/api/agent-v2${path}`, {
    ...init,
    headers,
    cache: "no-store",
    signal: init.signal ?? AbortSignal.timeout(150000),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, body?.error);
  }
  const data = await response.json();
  if (
    path === "/settings/response" &&
    (!data?.options || !Number.isInteger(data?.revision) || data.revision < 1 ||
      !(data.options.mode in modes) ||
      ((!init.method || init.method === "GET") && !data?.limits))
  ) {
    throw new Error("服务返回的回应设置不完整，请刷新重试。");
  }
  if (
    (!init.method || init.method === "GET") &&
    (/^\/(profiles|memory\/batches)(\?|$)/.test(path) ||
      path.endsWith("/memory-jobs"))
  ) {
    if (!data || !Array.isArray(data.items))
      throw new Error("服务返回的列表格式不正确，请刷新重试。");
  }
  return data as T;
}
export async function mutation<T>(path: string, body: object, method = "POST") {
  const result = await v2<T>(path, { method, body: JSON.stringify(body) });
  if (path === "/privacy/deletions" || /\/imports\/.*\/commit$/.test(path))
    invalidatePersonalData();
  return result;
}
export function errorText(reason: unknown): string {
  if (reason instanceof ApiError) {
    if (reason.detail?.code === "FEATURE_DISABLED")
      return "新版记忆尚未启用。请在连接设置中检查服务。";
    if (reason.status === 409)
      return `${reason.message} 请刷新后查看最新内容；未提交的输入仍保留。`;
  }
  return reason instanceof Error ? reason.message : "操作失败，请重试。";
}
export async function downloadBackup(id: string) {
  const response = await fetch(
    `/api/agent-v2/exports/${encodeURIComponent(id)}/download`,
  );
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new ApiError(response.status, body?.error);
  }
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "personal-memory.zip";
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function jobOutcome(outcome?: string | null) {
  return (
    {
      no_candidates: "没有新增记忆",
      committed: "已保存",
      partial: "部分待确认",
      pending: "待确认",
      review: "待确认",
      rejected: "未保存",
      deleted: "已删除",
    } as Record<string, string>
  )[outcome ?? ""];
}
