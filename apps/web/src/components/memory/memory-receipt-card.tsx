"use client";
import { useState } from "react";
import {
  Check,
  Combine,
  TriangleAlert,
  RefreshCw,
  ArrowRight,
  BookmarkPlus,
} from "lucide-react";
import type { Message } from "@/types/memory";
import { Button } from "@/components/ui/button";
import { TextEditor } from "@/components/ui/text-editor";
import { ProcessingDetails } from "./processing-details";
import { Modal } from "@/components/ui/modal";
import { formatDate } from "@/lib/format";
export function MemoryReceiptCard({
  message,
  busy,
  onEvidence,
  onDecide,
  onRetry,
  onEdit,
  onRefresh,
  demo,
}: {
  message: Message;
  busy: boolean;
  onEvidence: (id: string) => void;
  onDecide: (message: Message, decision: "approve" | "reject") => void;
  onRetry: (message: Message) => void;
  onEdit: (message: Message, text: string) => Promise<string | undefined>;
  onRefresh: (message: Message) => void;
  demo: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [candidateDraft, setCandidateDraft] = useState("");
  const receipt = message.receipt;
  if (!receipt) return null;
  const proposal = receipt.proposal;
  const pending = proposal?.status === "pending";
  const title =
    receipt.kind === "failed"
      ? "处理失败"
      : proposal
        ? {
            pending: "等待你的确认",
            approved: "已确认更新",
            rejected: "已忽略更新",
            stale: "版本已变化，需重新审核",
            expired: "提案已失效",
          }[proposal.status]
        : receipt.kind === "partial"
          ? "部分完成 · 索引待恢复"
          : receipt.kind === "noop"
            ? "未形成长期事实"
            : receipt.kind === "pending"
              ? receipt.processing?.pending
                ? "候选等待审核"
                : "正在整理记忆"
              : receipt.kind === "merged"
                ? "已合并重复记忆"
                : demo
                  ? "已新增演示记忆"
                  : "已新增记忆";
  const Icon =
    receipt.kind === "failed"
      ? TriangleAlert
      : receipt.kind === "merged"
        ? Combine
        : pending
          ? RefreshCw
          : proposal
            ? Check
            : BookmarkPlus;
  return (
    <section
      className={`receipt receipt-${pending ? "pending" : receipt.kind}`}
      aria-label={title}
    >
      <div className="receipt-heading">
        <Icon size={17} />
        <strong>{title}</strong>
        {demo && <span>演示</span>}
      </div>
      <p>{receipt.summary}</p>
      {receipt.processing && (
        <ProcessingDetails processing={receipt.processing} />
      )}
      {proposal?.reason && <p>{proposal.reason}</p>}
      {proposal?.createdAt && (
        <p className="receipt-explanation">
          重要记忆变更 · {formatDate(proposal.createdAt, true)}
        </p>
      )}
      {proposal && (
        <div className="proposal-comparison">
          <div>
            <small>原有记忆</small>
            <p>{proposal.before}</p>
          </div>
          <ArrowRight size={16} aria-hidden="true" />
          <div>
            <small>建议更新为</small>
            <p>{proposal.after}</p>
          </div>
        </div>
      )}
      {proposal?.status === "rejected" && (
        <p className="receipt-explanation">
          原有记忆保持不变，这条提案不会用于回答。
        </p>
      )}
      {pending && (
        <p className="receipt-explanation">
          确认后才会更新{demo ? "演示" : ""}记忆。
        </p>
      )}
      {proposal?.status === "stale" && (
        <p className="receipt-explanation">
          原有版本已变化。先加载最新内容进行比较，再决定是否确认。
        </p>
      )}
      {proposal?.status === "expired" && (
        <p className="receipt-explanation">
          关联事实已不存在或提案已到期，不能继续批准。
        </p>
      )}
      {editing && proposal && (
        <Modal
          title="修改候选"
          onClose={() => {
            if (!busy) setDiscard((current) => !current);
          }}
        >
          <div className="about-body">
            {discard ? (
              <>
                <h3>放弃尚未保存的候选修改？</h3>
                <div className="flex gap-2 mt-4">
                  <Button variant="outline" onClick={() => setDiscard(false)}>
                    继续编辑
                  </Button>
                  <Button onClick={() => setEditing(false)}>放弃修改</Button>
                </div>
              </>
            ) : (
              <TextEditor
                initialText={candidateDraft}
                onDraftChange={setCandidateDraft}
                label="修改候选内容"
                saveLabel="保存候选，重新审核"
                onSave={(text) => onEdit(message, text)}
                onCancel={() => setEditing(false)}
              />
            )}
          </div>
        </Modal>
      )}
      <div className="receipt-actions">
        {pending && !editing && (
          <>
            <Button
              variant="solid"
              disabled={busy}
              onClick={() => onDecide(message, "approve")}
            >
              确认更新
            </Button>
            <Button
              disabled={busy}
              onClick={() => {
                setCandidateDraft(proposal!.after);
                setDiscard(false);
                setEditing(true);
              }}
            >
              修改候选
            </Button>
            <Button disabled={busy} onClick={() => onDecide(message, "reject")}>
              忽略此更新
            </Button>
          </>
        )}
        {proposal?.status === "stale" && (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => onRefresh(message)}
            >
              加载最新版本
            </Button>
            <Button disabled={busy} onClick={() => onDecide(message, "reject")}>
              忽略此更新
            </Button>
          </>
        )}
        {(receipt.kind === "failed" ||
          receipt.processing?.indexStatus === "FAILED") && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => onRetry(message)}
          >
            <RefreshCw size={13} />
            {receipt.processing?.indexStatus === "FAILED"
              ? "仅重试索引"
              : "重试处理"}
          </Button>
        )}
        {receipt.sourceIds.map((id) => (
          <button
            key={id}
            className="text-action"
            onClick={() => onEvidence(id)}
          >
            查看来源 <ArrowRight size={13} />
          </button>
        ))}
      </div>
    </section>
  );
}
