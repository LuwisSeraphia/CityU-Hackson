"use client";
import { useEffect, useRef, useState } from "react";
import type { Evidence, MemoryGateway } from "@/types/memory";
export function useEvidence(
  initialId: string,
  gateway: MemoryGateway,
  onChanged: () => void,
) {
  const [id, setId] = useState(initialId);
  const [data, setData] = useState<Evidence>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let cancelled = false;
    gateway
      .evidence(id)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch(() => {
        if (!cancelled) setError("来源暂时无法加载，请重试。");
      });
    return () => {
      cancelled = true;
    };
  }, [id, gateway, attempt]);
  function open(next: string) {
    setError("");
    setData(undefined);
    setId(next);
    setAttempt((value) => value + 1);
  }
  async function revise(text: string) {
    if (!data?.factId || lock.current) return "当前记忆暂时无法修订。";
    lock.current = true;
    setBusy(true);
    try {
      const current = ["current", "planned"].includes(data.status)
        ? data
        : data.versions?.find((version) =>
            ["current", "planned"].includes(version.status),
          );
      if (!current) return "找不到当前版本，请重新加载。";
      const updated = await gateway.reviseFact({
        factId: data.factId,
        baseVersionId: current.id,
        text,
      });
      setId(updated.id);
      setData(updated);
      onChanged();
    } catch (error) {
      return error instanceof Error ? error.message : "修订失败，请重试。";
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  async function remove() {
    if (!data?.factId || lock.current) return "当前记忆暂时无法删除。";
    lock.current = true;
    setBusy(true);
    try {
      await gateway.deleteFact({ factId: data.factId, baseVersionId: data.id });
      setData(await gateway.evidence(data.id));
      onChanged();
    } catch (error) {
      return error instanceof Error ? error.message : "删除失败，请重试。";
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return { data, error, busy, open, revise, remove, reload: () => open(id) };
}
