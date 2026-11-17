"use client";
import Link from "next/link";
import { DiscardDialog } from "@/components/ui/discard-dialog";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  MessageSquare,
  BookOpen,
  UserRound,
  Settings2,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/api/v2";

export function InfoTip({ children }: { children: ReactNode }) {
  return (
    <details className="info-tip">
      <summary aria-label="更多说明">
        <Info size={16} />
      </summary>
      <div role="note">{children}</div>
    </details>
  );
}
export function useUnsavedChanges(dirty: boolean) {
  const router = useRouter();
  const [destination, setDestination] = useState<string>();
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (
        link &&
        link.target !== "_blank" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        !event.altKey &&
        event.button === 0 &&
        link.origin === window.location.origin &&
        link.href !== window.location.href
      ) {
        event.preventDefault();
        event.stopPropagation();
        setDestination(link.pathname + link.search + link.hash);
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", navigate, true);
    };
  }, [dirty]);
  return destination ? (
    <DiscardDialog
      onKeep={() => setDestination(undefined)}
      onDiscard={() => {
        const href = destination;
        setDestination(undefined);
        router.push(href);
      }}
    />
  ) : null;
}
export function SectionShell({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="management-shell">
      <aside className="management-nav">
        <Link className="management-brand" href="/">
          Personal Agent
        </Link>
        <nav aria-label="主导航">
          {[
            ["/", "对话", MessageSquare],
            ["/memories", "记忆", BookOpen],
            ["/profile", "关于我", UserRound],
            ["/settings/response", "设置", Settings2],
          ].map(([href, label, Icon]) => {
            const Glyph = Icon as typeof MessageSquare;
            const target = href as string;
            return (
              <Link
                key={target}
                href={target}
                aria-current={
                  pathname === target ||
                  (target.includes("settings") &&
                    pathname.startsWith("/settings"))
                    ? "page"
                    : undefined
                }
              >
                <Glyph size={18} />
                {label as string}
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="management-main">
        <header>
          <h1>{title}</h1>
        </header>
        <div className="management-content">{children}</div>
      </main>
    </div>
  );
}
export function Feedback({
  error,
  message,
}: {
  error?: string;
  message?: string;
}) {
  return (
    <>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="operation-feedback" role="status">
          {message}
        </p>
      )}
    </>
  );
}
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const lock = useRef(false);
  const keys = useRef(new Map<string, string>());
  function requestId(operation: string, data: object) {
    const key = operation + JSON.stringify(data);
    if (!keys.current.has(key)) keys.current.set(key, crypto.randomUUID());
    return keys.current.get(key)!;
  }
  async function run(task: () => Promise<void>, success = "") {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
      setMessage(success);
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { busy, error, message, run, requestId };
}
export function LoadState({
  loading,
  error,
  refresh,
}: {
  loading: boolean;
  error: string;
  refresh: () => void;
}) {
  return loading ? (
    <div className="management-empty" role="status">
      正在加载…
    </div>
  ) : error ? (
    <div className="management-empty">
      <Feedback error={error} />
      <Button variant="outline" onClick={refresh}>
        重试
      </Button>
      <Link href="/settings/service">连接设置</Link>
    </div>
  ) : null;
}
