"use client";
import { Form } from "@/components/ui/form";
import { useState } from "react";
import { DiscardDialog } from "@/components/ui/discard-dialog";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { mutation, type MemoryItem, type UsePolicy } from "@/lib/api/v2";
import { useV2 } from "@/state/use-v2";
import { Feedback, LoadState, useAction } from "./common";

export function DeleteForm({
  target,
  onDeleted,
  onCancel,
}: {
  target: { type: "memory" | "profile"; id: string; expected_revision: number };
  onDeleted: () => void;
  onCancel: () => void;
}) {
  const [scope, setScope] = useState("remove_memory");
  const action = useAction();
  return (
    <div className="danger-zone" aria-busy={action.busy}>
      <h3>删除这条{target.type === "profile" ? "画像" : "记忆"}？</h3>
      {target.type === "memory" && (
        <fieldset>
          <legend>删除范围</legend>
          <label className="inline-check">
            <input
              type="radio"
              name="delete-scope"
              checked={scope === "remove_memory"}
              onChange={() => setScope("remove_memory")}
            />
            从长期记忆移除
          </label>
          <label className="inline-check">
            <input
              type="radio"
              name="delete-scope"
              checked={scope === "erase_records"}
              onChange={() => setScope("erase_records")}
            />
            同时删除原始记录
          </label>
        </fieldset>
      )}
      <p>
        {target.type === "profile"
          ? "将移除这条画像内容，无法撤销。"
          : scope === "remove_memory"
            ? "将移除记忆及相关画像。聊天原文保留，但不会再次自动整理为记忆。此操作无法撤销。"
            : "将删除原文、记忆和相关派生内容，无法撤销。"}
      </p>
      <p>相关会话的助手回复可能被清理；正在生成的回答会停止。</p>
      <Feedback {...action} />
      <div className="form-actions">
        <Button disabled={action.busy} onClick={onCancel}>
          取消
        </Button>
        <Button
          className="danger-button"
          variant="solid"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              const body = { scope, targets: [target] };
              await mutation("/privacy/deletions", {
                ...body,
                request_id: action.requestId("delete", body),
              });
              onDeleted();
            })
          }
        >
          {scope === "erase_records" ? "彻底删除" : "移除"}
        </Button>
      </div>
    </div>
  );
}
function PolicyForm({
  id,
  data,
  refresh,
}: {
  id: string;
  data: UsePolicy;
  refresh: () => void;
}) {
  const [value, setValue] = useState(data);
  const action = useAction();
  return (
    <Form
      noValidate
      aria-busy={action.busy}
      className="field-grid"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(async () => {
          const body = {
            expected_revision: data.revision,
            recall_policy: value.recall_policy,
            do_not_mention: value.do_not_mention,
            detail_level: value.detail_level,
            allow_profile_inference: value.allow_profile_inference,
          };
          await mutation(
            `/memory/items/${id}/use-policy`,
            { ...body, request_id: action.requestId("use-policy", body) },
            "PATCH",
          );
          refresh();
        }, "使用方式已保存");
      }}
    >
      <label>
        回忆方式
        <select
          value={value.recall_policy}
          onChange={(e) =>
            setValue({
              ...value,
              recall_policy: e.target.value as UsePolicy["recall_policy"],
            })
          }
        >
          <option value="explicit_only">仅我明确询问</option>
          <option value="explicit_or_continuation">
            也可延续我主动提起的话题
          </option>
        </select>
      </label>
      <label className="inline-check">
        <input
          type="checkbox"
          checked={value.do_not_mention}
          onChange={(e) =>
            setValue({ ...value, do_not_mention: e.target.checked })
          }
        />
        不主动提起
      </label>
      <label>
        使用细节
        <select
          value={value.detail_level}
          onChange={(e) =>
            setValue({
              ...value,
              detail_level: e.target.value as UsePolicy["detail_level"],
            })
          }
        >
          <option value="summary">概括</option>
          <option value="detail">具体内容</option>
        </select>
      </label>
      <details>
        <summary>更多权限</summary>
        <label className="inline-check">
          <input
            type="checkbox"
            checked={value.allow_profile_inference}
            onChange={(e) =>
              setValue({ ...value, allow_profile_inference: e.target.checked })
            }
          />
          允许用于性格推断
        </label>
      </details>
      <Feedback {...action} />
      <Button type="submit" variant="outline" disabled={action.busy}>
        保存使用方式
      </Button>
    </Form>
  );
}
export function MemoryDetail({
  id,
  onClose,
  onChanged,
  onSource,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
  onSource: (id: string) => void;
}) {
  const query = useV2<MemoryItem>(`/memory/items/${id}`),
    policy = useV2<UsePolicy>(`/memory/items/${id}/use-policy`);
  const [edit, setEdit] = useState(false),
    [text, setText] = useState(""),
    [reason, setReason] = useState("change"),
    [remove, setRemove] = useState(false);
  const action = useAction();
  const [discard, setDiscard] = useState(false);
  return (
    <>
      <Modal
        title="记忆详情"
        className="evidence-modal"
        onClose={() => {
          if (action.busy) return;
          if (edit && text !== query.data?.content) setDiscard(true);
          else onClose();
        }}
      >
        <div className="dialog-body">
          <LoadState {...query} />
          {query.data && (
            <>
              {remove ? (
                <DeleteForm
                  target={{
                    type: "memory",
                    id,
                    expected_revision:
                      query.data.revision ?? query.data.version,
                  }}
                  onCancel={() => setRemove(false)}
                  onDeleted={() => {
                    onChanged();
                    onClose();
                  }}
                />
              ) : (
                <>
                  {edit ? (
                    <Form
                      noValidate
                      aria-busy={action.busy}
                      className="field-grid"
                      onSubmit={(e) => {
                        e.preventDefault();
                        void action.run(async () => {
                          const body = {
                            content: text,
                            reason,
                            expected_revision:
                              query.data!.revision ?? query.data!.version,
                          };
                          await mutation(`/memory/items/${id}/revisions`, {
                            ...body,
                            request_id: action.requestId("revision", body),
                          });
                          onChanged();
                          onClose();
                        });
                      }}
                    >
                      <label>
                        内容
                        <textarea
                          className="resize-none"
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          maxLength={4000}
                          required
                        />
                      </label>
                      <label>
                        修改原因
                        <select
                          value={reason}
                          onChange={(e) => setReason(e.target.value)}
                        >
                          <option value="change">情况变了</option>
                          <option value="correction">之前记错了</option>
                        </select>
                      </label>
                      <p className="essential-note">旧版本会保留。</p>
                      <div className="form-actions">
                        <Button
                          disabled={action.busy}
                          onClick={() => setEdit(false)}
                        >
                          取消
                        </Button>
                        <Button
                          disabled={action.busy}
                          variant="solid"
                          type="submit"
                        >
                          保存新版本
                        </Button>
                      </div>
                    </Form>
                  ) : (
                    <>
                      <p className="memory-full-text">
                        {query.data.content || "内容已移除"}
                      </p>
                      <div className="row-meta">
                        {query.data.event_time && <span>发生于 {query.data.event_time}</span>}
                        {typeof query.data.metadata?.recorded_at === "string" && <span>记录于 {new Date(query.data.metadata.recorded_at).toLocaleString("zh-CN", { hour12: false })}</span>}
                      </div>
                      <div className="toolbar-line">
                        <Button
                          onClick={() => {
                            setText(query.data!.content);
                            setEdit(true);
                          }}
                        >
                          修改
                        </Button>
                        <Button onClick={() => onSource(id)}>来源与历史</Button>
                        <Button onClick={() => setRemove(true)}>删除</Button>
                      </div>
                    </>
                  )}
                  <Feedback {...action} />
                  <details className="use-policy">
                    <summary>使用这段记忆</summary>
                    <LoadState {...policy} />
                    {policy.data && (
                      <PolicyForm
                        key={policy.data.revision}
                        id={id}
                        data={policy.data}
                        refresh={policy.refresh}
                      />
                    )}
                  </details>
                </>
              )}
            </>
          )}
        </div>
      </Modal>
      {discard && (
        <DiscardDialog onKeep={() => setDiscard(false)} onDiscard={onClose} />
      )}
    </>
  );
}
