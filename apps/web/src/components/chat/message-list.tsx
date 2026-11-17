"use client";
import { useEffect, useRef } from "react";
import { LoaderCircle, Sparkles } from "lucide-react";
import type { Conversation, Message, OperationProgress } from "@/types/memory";
import { AgentMark } from "@/components/ui/agent-mark";
import { CitationChip } from "@/components/memory/citation-chip";
import { MemoryReceiptCard } from "@/components/memory/memory-receipt-card";
import { formatDate } from "@/lib/format";
import { progressLabels } from "@/lib/memory-presentation";
import { AnswerStatus } from "./answer-status";
import { ExecutionTrace } from "@/components/agent/execution-trace";
export function MessageList({
  conversation,
  busy,
  onEvidence,
  onDecide,
  onRetry,
  onRecord,
  progress,
  onEdit,
  onRefresh,
  demo,
}: {
  conversation?: Conversation;
  busy: boolean;
  onEvidence: (id: string) => void;
  onDecide: (message: Message, decision: "approve" | "reject") => void;
  onRetry: (message: Message) => void;
  onRecord: (text: string) => void;
  progress?: OperationProgress;
  onEdit: (message: Message, text: string) => Promise<string | undefined>;
  onRefresh: (message: Message) => void;
  demo: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    if (busy && atBottom.current) end.current?.scrollIntoView({ block: "end" });
  }, [busy, progress?.text]);
  const count = conversation?.messages.length ?? 0;
  const previous = useRef({ id: conversation?.id, count: 0 });
  useEffect(() => {
    if (
      previous.current.id === conversation?.id &&
      count > previous.current.count
    )
      end.current?.scrollIntoView({ block: "end" });
    previous.current = { id: conversation?.id, count };
  }, [conversation?.id, count]);
  return (
    <div
      className="message-scroller"
      id="conversation-content"
      tabIndex={0}
      aria-label="对话消息"
      onScroll={(event) => {
        const element = event.currentTarget;
        atBottom.current =
          element.scrollHeight - element.clientHeight - element.scrollTop < 100;
      }}
    >
      <div className="reading-column">
        {count === 0 ? (
          <div className="empty-conversation">
            <AgentMark />
            {demo && <span className="eyebrow">你的想法，值得被记住</span>}
            {demo ? (
              <h2>
                从一句话开始，
                <br />
                连接你的记忆。
              </h2>
            ) : (
              <h2 className="empty-chat-title">今天聊些什么？</h2>
            )}
            {demo && (
              <p>
                记录一个想法、一段经历，
                <br />
                或向过去的自己提一个问题。
              </p>
            )}
            <div className="empty-hint" hidden={!demo}>
              <Sparkles size={15} />
              {demo
                ? "试试下方的演示场景"
                : "告诉我你的偏好，或上传文件一起讨论"}
            </div>
          </div>
        ) : (
          <>
            <div className="date-divider">
              <span />
              {formatDate(conversation!.messages[0].createdAt)}
              {demo ? " · 演示对话" : ""}
              <span />
            </div>
            <div className="message-list">
              {conversation?.messages.map((message) => (
                <article
                  id={`message-${message.id}`}
                  key={message.id}
                  className={`message message-${message.role}`}
                  aria-label={
                    message.role === "user" ? "你的消息" : "Agent 回复"
                  }
                >
                  {message.role === "assistant" && <AgentMark small />}
                  <div className="message-content">
                    <div className="message-label">
                      {message.role === "user" ? "你" : "Personal Agent"}
                      {message.mode === "record" && (
                        <span className="mode-label">记录</span>
                      )}
                    </div>
                    <div className="message-text">
                      {message.text.split("\n\n").map((paragraph, index) => (
                        <p key={index}>{paragraph}</p>
                      ))}
                    </div>
                    {message.receipt && (
                      <MemoryReceiptCard
                        message={message}
                        busy={busy}
                        onEvidence={onEvidence}
                        onDecide={onDecide}
                        onRetry={onRetry}
                        onEdit={onEdit}
                        onRefresh={onRefresh}
                        demo={demo}
                      />
                    )}
                    <AnswerStatus
                      message={message}
                      busy={busy}
                      onRetry={onRetry}
                    />
                    {!demo &&
                      message.role === "assistant" &&
                      message.answer?.traceId && (
                        <ExecutionTrace
                          runId={message.answer.traceId}
                          onEvidence={onEvidence}
                        />
                      )}
                    {!!message.citations?.length && (
                      <div className="citation-row">
                        <span className="citation-label">
                          {demo ? "参考记忆" : "本次依据"}
                        </span>
                        {message.citations.map((id, index) => (
                          <CitationChip
                            key={id}
                            id={id}
                            index={index}
                            onOpen={onEvidence}
                          />
                        ))}
                      </div>
                    )}
                    {message.role === "user" && message.mode === "ask" && (
                      <button
                        className="convert-action"
                        disabled={busy}
                        onClick={() => onRecord(message.text)}
                      >
                        转为记忆草稿
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </div>
          </>
        )}
        <div className="processing-slot" role="status" aria-live="polite">
          {busy && (
            <span className="loading-line">
              <LoaderCircle size={15} className="spin" />
              {progress ? progressLabels[progress.stage] : "正在处理请求…"}
              {demo && "（演示）"}
            </span>
          )}
          {busy && progress?.text && (
            <div className="message-text streaming-answer">
              {progress.text}
              <span className="sr-only">（尚未完成）</span>
            </div>
          )}
        </div>
        <div ref={end} />
      </div>
    </div>
  );
}
