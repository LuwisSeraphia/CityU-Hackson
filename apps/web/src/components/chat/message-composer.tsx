"use client";
import { useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  MessageCircle,
  BookmarkPlus,
  LoaderCircle,
} from "lucide-react";
import type { InputMode } from "@/types/memory";
import { MAX_INPUT_LENGTH } from "@/lib/validation";
export function MessageComposer({
  text,
  mode,
  busy,
  error,
  onText,
  onMode,
  onSend,
  demo = true,
  temporary = false,
  personalized = false,
}: {
  text: string;
  mode: InputMode;
  busy: boolean;
  error: string;
  onText: (text: string) => void;
  onMode: (mode: InputMode) => void;
  onSend: () => void;
  demo?: boolean;
  temporary?: boolean;
  personalized?: boolean;
}) {
  const fieldId = temporary ? "temporary-message-input" : "message-input";
  const helpId = temporary ? "temporary-composer-help" : "composer-help";
  const errorId = temporary ? "temporary-composer-error" : "composer-error";
  const field = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    if (field.current) {
      field.current.style.height = "auto";
      field.current.style.height = `${Math.min(field.current.scrollHeight, expanded ? 260 : 140)}px`;
    }
  }, [text, expanded]);
  function submit() {
    if (!busy && !composing.current) {
      onSend();
      field.current?.focus();
    }
  }
  return (
    <form
      className={`composer ${mode === "record" ? "composer-record" : ""}`}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      aria-label="发送消息"
    >
      <div className="composer-toolbar" hidden={personalized}>
        <fieldset className="mode-switch" disabled={busy}>
          <legend className="sr-only">输入模式</legend>
          <label>
            <input
              type="radio"
              name={temporary ? "temporary-input-mode" : "input-mode"}
              value="ask"
              checked={mode === "ask"}
              onChange={() => onMode("ask")}
            />
            <span>
              <MessageCircle size={14} />向 AI 提问
            </span>
          </label>
          <label hidden={temporary}>
            <input
              type="radio"
              name={temporary ? "temporary-input-mode" : "input-mode"}
              value="record"
              checked={mode === "record"}
              onChange={() => onMode("record")}
            />
            <span>
              <BookmarkPlus size={14} />
              记录到记忆
            </span>
          </label>
        </fieldset>
        <span className="composer-mode-hint" hidden>
          {mode === "ask" ? "从记忆中寻找答案" : "把值得记住的事留下来"}
        </span>
      </div>
      {personalized && mode === "record" && (
        <p className="record-notice">
          将整理为长期记忆{" "}
          <button type="button" onClick={() => onMode("ask")}>
            改为聊天
          </button>
        </p>
      )}
      <label htmlFor={fieldId} className="sr-only">
        {mode === "ask" ? "想问些什么？" : "想记住些什么？"}
      </label>
      <textarea
        id={fieldId}
        ref={field}
        className="resize-none"
        value={text}
        readOnly={busy}
        placeholder={
          mode === "ask"
            ? "输入消息…"
            : "记录一个想法、一段经历，或一个新的决定…"
        }
        rows={2}
        aria-invalid={Boolean(error)}
        aria-describedby={`${helpId} ${errorId}`}
        onChange={(event) => onText(event.target.value)}
        onCompositionStart={() => {
          composing.current = true;
        }}
        onCompositionEnd={() => {
          composing.current = false;
        }}
        onKeyDown={(event) => {
          if (
            event.key === "Enter" &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing &&
            !composing.current &&
            event.keyCode !== 229
          ) {
            event.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer-bottom">
        <span id={helpId} className={personalized ? "sr-only" : undefined}>
          {temporary
            ? "本次对话不保存到本机"
            : demo
              ? mode === "ask"
                ? "提问不会自动写入记忆"
                : "仅保留在当前演示页面"
              : mode === "ask"
                ? "按智能记忆设置处理；重要变化需确认"
                : "提交原文，整理后保存或等待确认"}
          <span className="keyboard-hint">
            {" "}
            · Enter 发送，Shift + Enter 换行
          </span>
        </span>
        <div className="flex items-center gap-2">
          {text.length > 300 && (
            <button
              type="button"
              className="text-action"
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "收起" : "展开"}
            </button>
          )}
          {text.length > 3000 && (
            <span className="input-count">
              {text.length}/{MAX_INPUT_LENGTH}
            </span>
          )}
          <button
            type="submit"
            className="send-button"
            disabled={busy || !text.trim()}
            aria-label={mode === "ask" ? "发送提问" : "提交记录"}
            aria-busy={busy}
          >
            {busy ? (
              <LoaderCircle size={18} className="spin" />
            ) : (
              <ArrowUp size={20} />
            )}
          </button>
        </div>
      </div>
      <div
        id={errorId}
        className="composer-error"
        role={error ? "alert" : undefined}
      >
        {error}
      </div>
    </form>
  );
}
