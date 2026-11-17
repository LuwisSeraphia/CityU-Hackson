"use client";
import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { MessageComposer } from "@/components/chat/message-composer";
import { RealGateway } from "@/lib/api/gateway";
import { validateMessage } from "@/lib/validation";

type Turn = { role: "user" | "assistant"; content: string };
export function TemporaryChat({
  gateway,
  onClose,
}: {
  gateway: RealGateway;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [sources, setSources] = useState<{ url: string; title: string }[]>([]);
  const abort = useRef<AbortController>(null);
  const lock = useRef(false);
  useEffect(() => () => abort.current?.abort(), []);
  function close() {
    if (text || messages.length || busy) setConfirm(true);
    else onClose();
  }
  async function send() {
    if (lock.current) return;
    const invalid = validateMessage(text);
    if (invalid) {
      setError(invalid);
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    const next: Turn[] = [...messages, { role: "user", content: text }];
    abort.current = new AbortController();
    try {
      const result = await gateway.request<{
        text: string;
        sources: { url: string; title: string }[];
      }>("/temporary/messages", {
        method: "POST",
        body: JSON.stringify({ messages: next }),
        signal: AbortSignal.any([
          abort.current.signal,
          AbortSignal.timeout(130000),
        ]),
      });
      setMessages([...next, { role: "assistant", content: result.text }]);
      setSources(result.sources);
      setText("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "临时回答未完成。");
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <Modal title="临时对话" onClose={close} className="temporary-chat">
      <div className="drawer-body">
        {confirm ? (
          <>
            <h3>结束并清空这次临时对话？</h3>
            <p>这里的对话和草稿不会保存。关闭后无法恢复。</p>
            <div className="flex gap-2 mt-4">
              <Button variant="outline" onClick={() => setConfirm(false)}>
                继续对话
              </Button>
              <Button onClick={onClose}>结束并清空</Button>
            </div>
          </>
        ) : (
          <>
            <p className="source-footnote">
              不读取个人记忆，也不写入本机数据库。文字仍会发送给百炼，云端保留政策由服务方决定。
            </p>
            <div className="temporary-messages" aria-live="polite">
              {messages.map((message, i) => (
                <article key={i}>
                  <strong>
                    {message.role === "user" ? "你" : "Personal Agent"}
                  </strong>
                  <p>{message.content}</p>
                </article>
              ))}
            </div>
            {sources.length > 0 && (
              <ul>
                {sources.map((source, i) => (
                  <li key={i}>
                    {/^https?:\/\//i.test(source.url) ? (
                      <a
                        href={source.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {source.title}
                      </a>
                    ) : (
                      source.title
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="temporary-composer">
              <MessageComposer
                text={text}
                mode="ask"
                busy={busy}
                error={error}
                onText={setText}
                onMode={() => {}}
                onSend={() => void send()}
                demo={false}
                temporary
              />
            </div>
            {busy && (
              <Button onClick={() => abort.current?.abort()}>停止回答</Button>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
