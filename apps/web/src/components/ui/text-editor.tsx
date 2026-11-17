"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "./button";
import { validateMessage } from "@/lib/validation";
export function TextEditor({
  initialText,
  label,
  saveLabel,
  onSave,
  onCancel,
  onDraftChange,
}: {
  initialText: string;
  label: string;
  saveLabel: string;
  onSave: (text: string) => Promise<string | undefined>;
  onCancel: () => void;
  onDraftChange?: (text: string) => void;
}) {
  const id = useId();
  const [text, setText] = useState(initialText);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const lock = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (text !== initialText || saving) event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [text, initialText, saving]);
  async function save() {
    if (lock.current) return;
    const validation = validateMessage(text);
    if (validation) {
      setError(validation);
      field.current?.focus();
      return;
    }
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      const failure = await onSave(text.trim());
      if (failure) setError(failure);
      else onCancel();
    } catch {
      setError("保存失败，内容已保留，请重试。");
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <form
      className="memory-editor"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        ref={field}
        className="resize-none"
        rows={6}
        value={text}
        readOnly={saving}
        onChange={(event) => {
          setText(event.target.value);
          onDraftChange?.(event.target.value);
          setError("");
        }}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-error`}
      />
      <p
        id={`${id}-error`}
        role={error ? "alert" : undefined}
        className="inline-error"
      >
        {error}
      </p>
      <div className="flex gap-2">
        <Button
          type="submit"
          variant="solid"
          disabled={saving}
          aria-busy={saving}
        >
          {saving ? "正在保存…" : saveLabel}
        </Button>
        <Button disabled={saving} onClick={onCancel}>
          取消编辑
        </Button>
      </div>
    </form>
  );
}
