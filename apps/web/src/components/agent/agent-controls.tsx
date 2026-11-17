"use client";
import { useEffect, useRef, useState } from "react";
import { FileUp, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { RealGateway, type UploadedFile } from "@/lib/api/gateway";

export function AgentControls({
  gateway,
  conversationId,
  busy,
  onTemporary,
}: {
  gateway: RealGateway;
  conversationId: string;
  busy: boolean;
  onTemporary: () => void;
}) {
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const picker = useRef<HTMLInputElement>(null);
  const upload = useRef<AbortController>(null);
  const failure = (reason: unknown) =>
    setError(reason instanceof Error ? reason.message : "操作失败，请重试。");
  useEffect(() => {
    let active = true;
    gateway
      .files(conversationId)
      .then((items) => {
        if (active) setFiles(items);
      })
      .catch((reason) => {
        if (active) failure(reason);
      });
    return () => {
      active = false;
      upload.current?.abort();
    };
  }, [gateway, conversationId]);
  async function selectFile(file?: File) {
    if (!file || uploading) return;
    setUploading(true);
    setError("");
    const controller = new AbortController();
    upload.current = controller;
    try {
      const result = await gateway.upload(
        conversationId,
        file,
        controller.signal,
      );
      setFiles((current) => [
        ...current.filter((f) => f.id !== result.id),
        result,
      ]);
    } catch (reason) {
      if (controller.signal.aborted)
        setError("上传已取消；若服务已接收文件，可重新打开会话核对。");
      else failure(reason);
    } finally {
      setUploading(false);
      if (picker.current) picker.current.value = "";
    }
  }
  return (
    <div className="agent-controls">
      <div className="agent-control-row">
        <Button onClick={onTemporary} disabled={busy}>
          临时对话
        </Button>
        <input
          ref={picker}
          type="file"
          className="sr-only"
          aria-label="上传会话文件"
          accept=".txt,.md,.pdf,.docx"
          disabled={uploading || busy}
          onChange={(event) => void selectFile(event.target.files?.[0])}
        />
        <Button
          disabled={uploading || busy}
          onClick={() => picker.current?.click()}
        >
          <FileUp size={15} />
          {uploading ? "正在上传…" : "上传文件"}
        </Button>
        {uploading && (
          <Button onClick={() => upload.current?.abort()}>取消上传</Button>
        )}
        {busy && (
          <Button
            onClick={() => void gateway.cancel().catch(failure)}
            disabled={!gateway.currentRun}
          >
            <Square size={13} />
            停止回答
          </Button>
        )}
      </div>
      {files.length > 0 && (
        <div className="uploaded-files" aria-label="会话附件">
          {files.map((file) => (
            <span key={file.id}>{file.name} · 可读取</span>
          ))}
        </div>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
