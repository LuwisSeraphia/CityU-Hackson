"use client";
import { useState } from "react";
import { FileText, LoaderCircle, Pencil, Trash2 } from "lucide-react";
import type { MemoryGateway } from "@/types/memory";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { TextEditor } from "@/components/ui/text-editor";
import { useEvidence } from "@/state/use-evidence";
import { EvidenceDetail } from "./evidence-detail";
export function EvidenceDrawer({
  id,
  gateway,
  onClose,
  onChanged,
  readOnly = false,
}: {
  readOnly?: boolean;
  id: string;
  gateway: MemoryGateway;
  onClose: () => void;
  onChanged: () => void;
}) {
  const detail = useEvidence(id, gateway, onChanged);
  const [view, setView] = useState<"read" | "edit" | "delete" | "discard">(
    "read",
  );
  const [deleteError, setDeleteError] = useState("");
  const [editDraft, setEditDraft] = useState("");
  const evidence = detail.data;
  function close() {
    if (detail.busy) return;
    if (view === "edit") setView("discard");
    else if (view === "discard") setView("edit");
    else onClose();
  }
  async function remove() {
    const error = await detail.remove();
    if (error) setDeleteError(error);
    else setView("read");
  }
  return (
    <Modal title="记忆来源" onClose={close} className="evidence-drawer">
      <div className="drawer-body">
        {detail.error ? (
          <div role="alert">
            <p>{detail.error}</p>
            <Button variant="outline" onClick={detail.reload}>
              重新加载
            </Button>
          </div>
        ) : !evidence ? (
          <p className="loading-line" role="status">
            <LoaderCircle className="spin" size={18} />
            正在读取来源…
          </p>
        ) : (
          <>
            <div className="source-symbol">
              <FileText size={25} />
            </div>
            <span className="eyebrow">
              {gateway.mode === "mock" ? "来自你的演示记录" : "记忆与证据"}
            </span>
            {view === "discard" ? (
              <div className="confirmation-panel">
                <h3>放弃尚未保存的修改？</h3>
                <p>关闭后，本次草稿不会写入记忆。</p>
                <div className="flex gap-2 mt-4">
                  <Button variant="outline" onClick={() => setView("edit")}>
                    继续编辑
                  </Button>
                  <Button onClick={onClose}>放弃修改并关闭</Button>
                </div>
              </div>
            ) : view === "delete" ? (
              <section className="confirmation-panel" aria-label="确认删除事实">
                <h3>删除这条事实？</h3>
                <p>{evidence.text}</p>
                <p>
                  删除该事实的全部版本与索引，使相关引用失效；保留原始记录。这不是普通撤销。
                </p>
                <div className="flex gap-2 mt-4">
                  <Button
                    variant="outline"
                    disabled={detail.busy}
                    onClick={() => setView("read")}
                  >
                    保留事实
                  </Button>
                  <Button
                    className="button-danger"
                    disabled={detail.busy}
                    onClick={() => void remove()}
                  >
                    删除事实及版本
                  </Button>
                </div>
                <p
                  className="inline-error"
                  role={deleteError ? "alert" : undefined}
                >
                  {deleteError}
                </p>
              </section>
            ) : (
              <>
                <EvidenceDetail
                  evidence={evidence}
                  onVersion={detail.open}
                  editing={view === "edit"}
                />
                {view === "edit" && (
                  <TextEditor
                    initialText={editDraft}
                    onDraftChange={setEditDraft}
                    label="修订事实内容"
                    saveLabel="保存为新版本"
                    onSave={detail.revise}
                    onCancel={() => setView("read")}
                  />
                )}
                {!readOnly && view === "read" &&
                  evidence.factId &&
                  evidence.status === "historical" && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setEditDraft(evidence.text);
                        setView("edit");
                      }}
                    >
                      恢复为新版本
                    </Button>
                  )}
                {!readOnly && view === "read" &&
                  evidence.factId &&
                  ["current", "planned"].includes(evidence.status) && (
                    <div className="evidence-actions">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setEditDraft(evidence.text);
                          setView("edit");
                        }}
                      >
                        <Pencil size={14} />
                        修订事实
                      </Button>
                      <Button
                        onClick={() => {
                          setDeleteError("");
                          setView("delete");
                        }}
                      >
                        <Trash2 size={14} />
                        删除事实
                      </Button>
                      <Button onClick={detail.reload}>刷新版本</Button>
                    </div>
                  )}
              </>
            )}
            <div className="source-footnote" hidden={readOnly}>
              {gateway.mode === "mock"
                ? "当前为本页内存中的模拟数据，刷新页面后重置。"
                : "事实修订保留历史版本；删除事实仍保留原始记录。"}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
