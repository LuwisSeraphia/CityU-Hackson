"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { mutation, type Batch, type Candidate } from "@/lib/api/v2";
import { useV2 } from "@/state/use-v2";
import { Feedback, LoadState, useAction } from "./common";

export function BatchReview({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const query = useV2<Batch & { candidates: Candidate[] }>(
    `/memory/batches/${id}`,
  );
  return query.data ? (
    <BatchForm
      key={query.data.revision}
      batch={query.data}
      refresh={() => {
        query.refresh();
        onChanged();
      }}
      onClose={onClose}
    />
  ) : (
    <Modal title="确认记忆" onClose={onClose}>
      <div className="dialog-body">
        <LoadState {...query} />
      </div>
    </Modal>
  );
}
function BatchForm({
  batch,
  refresh,
  onClose,
}: {
  batch: Batch & { candidates: Candidate[] };
  refresh: () => void;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string[]>([]),
    [defer, setDefer] = useState(false);
  const [edit, setEdit] = useState<string>(),
    [text, setText] = useState("");
  const action = useAction();
  const pending = batch.candidates.filter((row) => row.state === "pending");
  const eligible = pending.filter(
    (row) => row.data.assertion_kind !== "inferred",
  );
  async function decide(rows: Candidate[], decision: "accept" | "reject", reason: "change" | "correction" = "change") {
    await action.run(
      async () => {
        const body = {
          expected_revision: batch.revision,
          decisions: rows.map((row) => ({
            candidate_id: row.id,
            expected_revision: row.revision,
            action: decision,
            reason,
            defer_profile: defer,
          })),
        };
        await mutation(`/memory/batches/${batch.id}/decisions`, {
          ...body,
          request_id: action.requestId("batch", body),
        });
        refresh();
      },
      decision === "accept" ? "已保存" : "已不保存所选内容",
    );
  }
  const close = () => {
    if (!action.busy && (!edit || window.confirm("放弃未保存的修改？")))
      onClose();
  };
  return (
    <Modal title="确认记忆" className="review-modal" onClose={close}>
      <div className="dialog-body batch-review" aria-busy={action.busy}>
        <div className="toolbar-line">
          <Button
            disabled={action.busy}
            onClick={() => setSelected(eligible.map((row) => row.id))}
          >
            全选可保存项
          </Button>
          <Button disabled={action.busy} onClick={() => setSelected([])}>
            清除选择
          </Button>
        </div>
        <div className="review-rows">
          {batch.candidates.map((row) => (
            <article
              key={row.id}
              className={`review-row ${row.state !== "pending" ? "resolved" : ""}`}
            >
              <label className="candidate-select">
                <input
                  type="checkbox"
                  checked={selected.includes(row.id)}
                  disabled={
                    action.busy ||
                    row.state !== "pending" ||
                    row.data.assertion_kind === "inferred"
                  }
                  onChange={(e) =>
                    setSelected((current) =>
                      e.target.checked
                        ? [...current, row.id]
                        : current.filter((i) => i !== row.id),
                    )
                  }
                />
                <span>{row.data.title ?? "记录"}</span>
              </label>
              {row.data.previous_content && row.state === "pending" && <blockquote>原记录：{row.data.previous_content}</blockquote>}
              {edit === row.id ? (
                <div className="field-grid">
                  <label>
                    修改内容
                    <textarea
                      className="resize-none"
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      maxLength={4000}
                    />
                  </label>
                  <div className="toolbar-line">
                    <Button
                      disabled={action.busy}
                      onClick={() => setEdit(undefined)}
                    >
                      取消编辑
                    </Button>
                    <Button
                      disabled={action.busy || !text.trim()}
                      variant="outline"
                      onClick={() =>
                        void action.run(async () => {
                          const body = {
                            content: text,
                            expected_revision: row.revision,
                          };
                          await mutation(
                            `/memory/candidates/${row.id}`,
                            {
                              ...body,
                              request_id: action.requestId(
                                "edit:" + row.id,
                                body,
                              ),
                            },
                            "PATCH",
                          );
                          setEdit(undefined);
                          refresh();
                        })
                      }
                    >
                      保存修改
                    </Button>
                  </div>
                </div>
              ) : (
                <p>{row.data.content || "内容已移除"}</p>
              )}
              <div className="row-meta">
                {row.data.sensitivity === "private" && <span>敏感内容</span>}
                {row.data.assertion_kind === "inferred" && (
                  <span>推断 · 需独立确认</span>
                )}
                {row.state !== "pending" && (
                  <span>{row.state === "accepted" ? "已保存" : "未保存"}</span>
                )}
              </div>
              {row.data.evidence && (
                <details>
                  <summary>
                    {row.data.edited_source_id ? "修改依据" : "原文依据"}
                  </summary>
                  <blockquote>{row.data.evidence}</blockquote>
                </details>
              )}
              {row.state === "pending" && (
                <div className="row-actions">
                  {row.data.previous_content && row.data.assertion_kind !== "inferred" && <>
                    <Button disabled={action.busy || !!edit} onClick={() => void decide([row], "accept", "change")}>情况变了</Button>
                    <Button disabled={action.busy || !!edit} onClick={() => void decide([row], "accept", "correction")}>之前记错了</Button>
                  </>}
                  <Button
                    disabled={action.busy}
                    onClick={() => {
                      setEdit(row.id);
                      setText(row.data.content ?? "");
                    }}
                  >
                    编辑
                  </Button>
                  <Button
                    disabled={action.busy}
                    onClick={() => void decide([row], "reject")}
                  >
                    {row.data.previous_content ? "保留原记录" : "不保存"}
                  </Button>
                </div>
              )}
            </article>
          ))}
        </div>
        {!pending.length && <p role="status">本批次已处理</p>}
        {pending.length > 0 && (
          <label className="inline-check">
            <input
              type="checkbox"
              checked={defer}
              onChange={(e) => setDefer(e.target.checked)}
            />
            仅保存经历，不更新画像
          </label>
        )}
        <Feedback {...action} />
        <div className="dialog-footer">
          <span>{selected.length > 0 ? "选中内容将加入长期记忆" : ""}</span>
          <div className="form-actions">
            <Button disabled={action.busy} onClick={close}>
              {pending.length ? "稍后处理" : "关闭"}
            </Button>
            {pending.length > 0 && (
              <Button
                variant="solid"
                disabled={action.busy || !selected.length || !!edit}
                onClick={() =>
                  void decide(
                    eligible.filter((row) => selected.includes(row.id)),
                    "accept",
                  )
                }
              >
                保存选中 {selected.length} 项
              </Button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
