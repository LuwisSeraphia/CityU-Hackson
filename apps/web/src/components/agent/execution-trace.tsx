"use client";

import { useEffect, useState } from "react";
import { jobOutcome } from "@/lib/api/v2";
import { ApiClient } from "@/lib/api/client";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { Workflow, ArrowUpRight } from "lucide-react";
import { InfoTip } from "@/components/v2/common";
import { onPersonalDataInvalidated } from "@/lib/privacy-events";
import { toolLabels } from "@/lib/api/gateway";

interface Material {
  id: string;
  kind?: string;
  title?: string;
  evidence_id?: string;
  redacted?: boolean;
  summarized?: boolean;
}
interface Trace {
  intent?: { origin: string; degraded_reason?: string; plan: { task: string } };
  information?: { need_id: string; source: string; status: string; selected_count?: number }[];
  profile_context?: {
    profile_review_scope?: string;
    profile_selection?: { selected_count: number; eligible_count: number; categories: string[] };
    profile_digest?: { kind: string; summary_count?: number };
  };
  availability: string;
  status: string;
  answer_elapsed_ms?: number;
  injected?: Material[];
  cited?: Material[];
  context?: { summary_generated?: boolean; count_method?: string };
  steps?: { name: string; status: string; elapsed: number }[];
  calls?: {
    model?: string;
    elapsed_ms: number;
    status: string;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  }[];
  retrievals?: {
    id: string;
    origin: string;
    candidate_count?: number;
    selected_count?: number;
    cache_hit?: boolean;
    candidates?: { id: string; reason: string; rerank_score: number | null }[];
  }[];
  memory_job?: { status: string; stage?: string };
  background_jobs?: {
    id: string;
    kind: string;
    status: string;
    stage: string;
    outcome?: string | null;
  }[];
}

export function ExecutionTrace({
  runId,
  onEvidence,
}: {
  runId: string;
  onEvidence: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [trace, setTrace] = useState<Trace>();
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(
    () =>
      onPersonalDataInvalidated(() => {
        setTrace(undefined);
        setOpen(false);
      }),
    [],
  );
  useEffect(() => {
    if (!open) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      try {
        const result = await new ApiClient("/api/agent").request<Trace>(
          `/agent/runs/${encodeURIComponent(runId)}/trace`,
          { signal: controller.signal },
        );
        if (!active) return;
        setTrace(result);
        setError("");
        if (
          result.status === "RUNNING" ||
          ["QUEUED", "RUNNING"].includes(result.memory_job?.status ?? "") ||
          result.background_jobs?.some((j) =>
            ["QUEUED", "RUNNING"].includes(j.status),
          )
        )
          timer = setTimeout(refresh, 1500);
      } catch (reason) {
        if (active)
          setError(reason instanceof Error ? reason.message : "轨迹读取失败");
      }
    }
    void refresh();
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, runId, retry]);
  return (
    <>
      <button className="trace-trigger" onClick={() => setOpen(true)}>
        <Workflow size={15} /> 查看执行过程 <ArrowUpRight size={14} />
      </button>
      {open && (
        <Modal title="执行过程" onClose={() => setOpen(false)}>
          <div className="drawer-body agent-insights">
            {error && (
              <p role="alert">
                {error}{" "}
                <button onClick={() => setRetry(retry + 1)}>
                  重新读取轨迹
                </button>
              </p>
            )}
            <div className="row-actions">
              <Button onClick={() => setRetry((n) => n + 1)}>
                刷新执行记录
              </Button>
            </div>
            {!trace && !error && <p role="status">正在读取执行记录…</p>}
            {trace?.availability === "legacy_unavailable" && (
              <p>旧版本未记录，无法还原当时的模型输入。</p>
            )}
            {trace?.availability === "recorded" && (
              <>
                <div className="trace-summary">
                  <span className="state-badge" data-state={trace.status}>
                    {statusLabel(trace.status)}
                  </span>
                  <span>
                    {trace.answer_elapsed_ms === undefined
                      ? "耗时未记录"
                      : `${(trace.answer_elapsed_ms / 1000).toFixed(1)} 秒`}
                  </span>
                </div>
                <section className="trace-section">
                  <h3>
                    本轮读取{" "}
                    <InfoTip>
                      以下材料已提供给模型；只有回答引用列表能说明显式引用，不代表模型内部判断过程。
                    </InfoTip>
                  </h3>
                  {trace.profile_context?.profile_selection && <p>
                    {trace.profile_context.profile_review_scope === "learning_advice" ? "个人学习建议" : trace.profile_context.profile_review_scope ? "个人回顾" : "按当前话题"}
                    {" · "}选入 {trace.profile_context.profile_selection.selected_count} / {trace.profile_context.profile_selection.eligible_count} 条画像
                    {" · "}{trace.profile_context.profile_digest?.kind === "background_summary" ? "复用后台画像摘要" : "使用原始画像"}
                  </p>}
                  {trace.intent && <details>
                    <summary>信息规划{trace.intent.origin === "fallback" ? " · 已降级" : ""}</summary>
                    {trace.information?.map(need => <p key={need.need_id}>
                      {({ profile: "画像", memory: "历史记忆", file: "文件", web: "外部信息" } as Record<string, string>)[need.source] ?? need.source}
                      {" · "}{({ not_requested: "尚未查询", blocked: "未获许可或条件不满足", running: "查询中", found: "已获取", empty: "未找到匹配", failed: "查询失败", budget_excluded: "预算不足" } as Record<string, string>)[need.status] ?? "状态未知"}
                      {need.selected_count !== undefined && ` · 选入 ${need.selected_count} 条`}
                    </p>)}
                  </details>}
                  {!trace.injected?.length && <p>本轮未记录注入材料</p>}
                  {trace.injected?.map((item, index) => (
                    <button
                      className="trace-material"
                      key={`${item.id}-${index}`}
                      disabled={item.redacted || !item.evidence_id}
                      onClick={() => {
                        setOpen(false);
                        onEvidence(item.evidence_id!);
                      }}
                    >
                      <span>
                        {item.redacted
                          ? "材料已不可用"
                          : item.title || `记忆 ${index + 1}`}
                      </span>
                      <span className="state-badge">
                        {item.kind === "profile"
                          ? item.summarized ? "画像摘要依据" : "画像"
                          : item.kind === "source"
                            ? "原文片段"
                            : "记忆"}
                      </span>
                    </button>
                  ))}
                  <details>
                    <summary>
                      回答引用 ·{" "}
                      {trace.cited?.filter((i) => !i.redacted).length ?? 0}
                    </summary>
                    {trace.cited?.map((item, index) => (
                      <button
                        className="trace-material"
                        key={`${item.id}-${index}`}
                        disabled={item.redacted || !item.evidence_id}
                        onClick={() => {
                          setOpen(false);
                          onEvidence(item.evidence_id!);
                        }}
                      >
                        {item.redacted
                          ? "内容已不可见"
                          : item.title || `引用 ${index + 1}`}
                      </button>
                    ))}
                  </details>
                </section>
                <section className="trace-section">
                  <h3>本轮写入</h3>
                  <ol className="trace-timeline">
                    {trace.background_jobs?.length ? (
                      trace.background_jobs.map((j) => (
                        <li key={j.id} data-current={j.status === "RUNNING"}>
                          <span>
                            {(
                              {
                                memory_v2: "记忆整理",
                                memory: "记忆整理",
                                index: "索引",
                                profile_v2: "画像整理",
                              } as Record<string, string>
                            )[j.kind] ?? j.kind}
                          </span>{" "}
                          · {statusLabel(j.status)}
                          {jobOutcome(j.outcome)
                            ? ` · ${jobOutcome(j.outcome)}`
                            : j.stage === "REVIEW"
                              ? " · 待确认"
                              : ""}
                        </li>
                      ))
                    ) : (
                      <li>
                        {statusLabel(trace.memory_job?.status ?? "unknown")}
                      </li>
                    )}
                  </ol>
                </section>
                <section className="trace-section">
                  <h3>检索与工具</h3>
                  {trace.retrievals?.map((r, index) => (
                    <details key={`${r.id}-${index}`}>
                      <summary>
                        {r.origin === "server" ? "关键约束预检索" : "工具检索"}
                        ：候选 {r.candidate_count ?? "未记录"} 条，筛选{" "}
                        {r.selected_count ?? "未记录"} 条
                        {r.cache_hit ? " · 缓存命中" : ""}
                      </summary>
                      <p>筛选不等于最终注入，仍受预算限制。</p>
                      {r.candidates?.map((c) => (
                        <p key={c.id}>
                          {c.reason ?? "未入选"} · 重排分数{" "}
                          {c.rerank_score ?? "未记录"}
                        </p>
                      ))}
                    </details>
                  ))}
                  {trace.steps?.map((step, index) => (
                    <p key={index}>
                      {toolLabels[step.name] ?? step.name} · {statusLabel(step.status)} ·{" "}
                      {step.elapsed.toFixed(2)} 秒
                    </p>
                  ))}
                  <p>
                    本轮生成会话摘要：
                    {trace.context?.summary_generated === undefined
                      ? "未记录"
                      : trace.context.summary_generated
                        ? "是"
                        : "否"}
                  </p>
                </section>
                <details>
                  <summary>技术详情</summary>
                  <p>运行编号：{runId}</p>
                  <p>
                    记忆预算计数：{trace.context?.count_method ?? "未记录"}
                    ，不是供应商实测 token。
                  </p>
                  {trace.calls?.map((call, index) => (
                    <p key={index}>
                      {call.model} · {statusLabel(call.status)} · {call.elapsed_ms} ms · 输入{" "}
                      {call.usage?.prompt_tokens ?? "未知"} / 输出{" "}
                      {call.usage?.completion_tokens ?? "未知"} token
                    </p>
                  ))}
                  <p>
                    以上仅含已返回的调用用量，不代表完整费用；工具耗时包含内部调用，不应重复相加。
                  </p>
                </details>
              </>
            )}
          </div>
        </Modal>
      )}
    </>
  );
}

function statusLabel(status: string) {
  return (
    (
      {
        SUCCEEDED: "已完成",
        RUNNING: "处理中",
        QUEUED: "排队中",
        FAILED: "失败",
        CANCELLED: "已取消",
        not_started: "未关联到整理任务",
      } as Record<string, string>
    )[status] ?? "未记录"
  );
}
