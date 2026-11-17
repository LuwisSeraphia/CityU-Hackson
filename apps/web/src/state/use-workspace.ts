"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Conversation,
  InputMode,
  MemoryGateway,
  Message,
  OperationProgress,
} from "@/types/memory";
import { validateMessage } from "@/lib/validation";

type Draft = { text: string; mode: InputMode };
export function useWorkspace(gateway: MemoryGateway) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState("");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<OperationProgress>();
  const locked = useRef(false);
  const pendingSends = useRef(new Map<string, string>());
  const generation = useRef(0);
  const draft = drafts[activeId] ?? { text: "", mode: "ask" as InputMode };
  const active = conversations.find((item) => item.id === activeId);
  const load = useCallback(async () => {
    const ticket = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const result = await gateway.load();
      if (ticket !== generation.current) return;
      setConversations(result.conversations);
      setActiveId(result.conversations[0]?.id ?? "");
    } catch {
      if (ticket === generation.current) setError("会话加载失败，请重新加载。");
    } finally {
      if (ticket === generation.current) setLoading(false);
    }
  }, [gateway]);
  useEffect(() => {
    let ignore = false;
    gateway
      .load()
      .then((result) => {
        if (!ignore) {
          setConversations(result.conversations);
          setActiveId(result.conversations[0]?.id ?? "");
        }
      })
      .catch(() => {
        if (!ignore) setError("会话加载失败，请重新加载。");
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [gateway]);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (
        Object.values(drafts).some((item) => item.text.trim()) ||
        locked.current
      )
        event.preventDefault();
    };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as Element).closest?.(
        "a[href]",
      ) as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || event.ctrlKey || event.metaKey)
        return;
      if (
        (Object.values(drafts).some((item) => item.text.trim()) ||
          locked.current) &&
        !window.confirm("离开后未发送的草稿将丢失。仍要离开？")
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", navigate, true);
    };
  }, [drafts]);
  useEffect(() => {
    if (gateway.mode !== "api" || !activeId) return;
    let active = true;
    let pending = false;
    const timer = setInterval(async () => {
      if (locked.current || pending) return;
      pending = true;
      const ticket = generation.current;
      try {
        const snapshot = await gateway.load();
        if (active && !locked.current && ticket === generation.current)
          setConversations(snapshot.conversations);
      } catch {
        // The next user action reports transport errors inline; polling must not erase drafts.
      } finally {
        pending = false;
      }
    }, 2500);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [gateway, activeId]);
  function updateDraft(change: Partial<Draft>) {
    setError("");
    setDrafts((current) => ({
      ...current,
      [activeId]: { ...draft, ...change },
    }));
  }
  function replace(updated: Conversation) {
    setConversations((items) =>
      items.map((item) => (item.id === updated.id ? updated : item)),
    );
  }
  async function execute(action: () => Promise<void>) {
    if (locked.current) return "正在处理，请稍候。";
    locked.current = true;
    generation.current++;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : "操作未完成，请重试。";
      setError(message);
      return message;
    } finally {
      locked.current = false;
      setBusy(false);
      setProgress(undefined);
    }
  }
  async function send() {
    const validation = validateMessage(draft.text);
    if (validation) {
      setError(validation);
      return;
    }
    const sentDraft = { ...draft };
    const sentId = activeId;
    const requestKey = JSON.stringify([sentId, sentDraft]);
    if (!pendingSends.current.has(requestKey))
      pendingSends.current.set(requestKey, crypto.randomUUID());
    await execute(async () => {
      replace(
        await gateway.send(
          {
            conversationId: sentId,
            ...sentDraft,
            requestId: pendingSends.current.get(requestKey)!,
          },
          setProgress,
        ),
      );
      pendingSends.current.delete(requestKey);
      setDrafts((items) => ({
        ...items,
        [sentId]: { ...sentDraft, text: "" },
      }));
    });
  }
  async function remove(id: string) {
    return execute(async () => {
      await gateway.deleteConversation(id);
      const remaining = conversations.filter((item) => item.id !== id);
      setConversations(remaining);
      setDrafts((items) => {
        const next = { ...items };
        delete next[id];
        return next;
      });
      if (activeId === id) setActiveId(remaining[0]?.id ?? "");
    });
  }
  async function create() {
    await execute(async () => {
      const created = await gateway.createConversation();
      setConversations((items) => [
        created,
        ...items.filter((item) => item.id !== created.id),
      ]);
      setActiveId(created.id);
    });
  }
  async function retry(message: Message) {
    const text = message.receipt?.retryText ?? message.answer?.retryText;
    if (!text) return;
    await execute(async () => {
      replace(
        await gateway.send(
          {
            conversationId: activeId,
            text,
            mode: message.answer ? "ask" : "record",
            requestId: crypto.randomUUID(),
            retryMessageId: message.id,
          },
          setProgress,
        ),
      );
    });
  }
  async function decide(message: Message, decision: "approve" | "reject") {
    const proposal = message.receipt?.proposal;
    if (!proposal) return;
    await execute(async () => {
      replace(
        await gateway.decide({
          conversationId: activeId,
          messageId: message.id,
          proposalId: proposal.id,
          baseVersionId: proposal.baseVersionId,
          decision,
        }),
      );
    });
  }
  function select(id: string) {
    if (!locked.current) {
      setActiveId(id);
      setError("");
    }
  }
  async function editProposal(message: Message, text: string) {
    return execute(async () => {
      replace(
        await gateway.editProposal({
          conversationId: activeId,
          messageId: message.id,
          text,
        }),
      );
    });
  }
  async function refreshProposal(message: Message) {
    return execute(async () => {
      replace(await gateway.refreshProposal(activeId, message.id));
    });
  }
  async function syncMemories() {
    try {
      const snapshot = await gateway.load();
      setConversations(snapshot.conversations);
    } catch {
      setError("记忆操作已完成，会话状态刷新失败，请稍后重新加载页面。");
    }
  }
  return {
    conversations,
    active,
    activeId,
    draft,
    loading,
    busy,
    error,
    progress,
    load,
    updateDraft,
    send,
    create,
    remove,
    select,
    retry,
    decide,
    editProposal,
    refreshProposal,
    syncMemories,
  };
}
