"use client";
import { useEffect, useState } from "react";
import { BatchReview } from "./batch-review";
import { RealGateway } from "@/lib/api/gateway";
import { v2, mutation, type Job, errorText, jobOutcome } from "@/lib/api/v2";
import { Button } from "@/components/ui/button";
export function MemoryJobStatus({
  gateway,
  conversationId,
}: {
  gateway: RealGateway;
  conversationId: string;
}) {
  const [review, setReview] = useState<string>();
  const [result, setResult] = useState<{
      conversationId: string;
      jobs: Job[];
    }>(),
    [error, setError] = useState(""),
    [revision, setRevision] = useState(0),
    [retrying, setRetrying] = useState(false);
  useEffect(() => {
    const refresh = () => setRevision((n) => n + 1);
    gateway.addEventListener("memory-job", refresh);
    gateway.addEventListener("sent", refresh);
    return () => {
      gateway.removeEventListener("memory-job", refresh);
      gateway.removeEventListener("sent", refresh);
    };
  }, [gateway]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    async function poll() {
      try {
        const result = await v2<{ items: Job[] }>(
          `/conversations/${conversationId}/memory-jobs`,
          { signal: controller.signal },
        );
        if (controller.signal.aborted) return;
        setResult({ conversationId, jobs: result.items });
        setError("");
        failures = 0;
        if (result.items.some((j) => ["QUEUED", "RUNNING"].includes(j.state)))
          timer = setTimeout(poll, 1500);
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(errorText(reason));
          if (++failures < 3) timer = setTimeout(poll, 3000);
        }
      }
    }
    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [conversationId, revision]);
  const visible = result?.conversationId === conversationId ? result.jobs : [];
  if (error)
    return (
      <div className="compact-status">
        <span>记忆状态暂不可用</span>
        <Button onClick={() => setRevision((n) => n + 1)}>重试</Button>
      </div>
    );
  return (
    <>
      {review && <BatchReview id={review} onClose={() => setReview(undefined)} onChanged={() => setRevision(n => n + 1)} />}
      {visible.map((job) => (
        <div className="compact-status" key={job.id} role="status">
          <span>
            {job.state === "CANCELLED"
              ? "已取消整理"
              : job.state === "FAILED"
                ? "整理失败"
                : jobOutcome(job.outcome)
                  ? jobOutcome(job.outcome)
                  : job.stage === "REVIEW"
                    ? "有内容待确认"
                    : job.state === "SUCCEEDED"
                      ? "整理完成"
                      : "整理中…"}
          </span>
          {job.error?.message && <span>{job.error.message}</span>}
          {job.batch_id && (
            <Button onClick={() => setReview(job.batch_id)}>{["pending", "partial"].includes(job.outcome ?? "") ? "查看并确认" : "查看记忆"}</Button>
          )}
          {job.state === "FAILED" && (
            <Button
              disabled={retrying}
              onClick={() => {
                setRetrying(true);
                void mutation(`/memory/jobs/${job.id}/retry`, {})
                  .then(() => setRevision((n) => n + 1))
                  .catch((reason) => setError(errorText(reason)))
                  .finally(() => setRetrying(false));
              }}
            >
              重新整理
            </Button>
          )}
        </div>
      ))}
    </>
  );
}
