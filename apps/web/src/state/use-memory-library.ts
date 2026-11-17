"use client";
import { useEffect, useState } from "react";
import type { MemoryGateway, MemoryPage, MemoryQuery } from "@/types/memory";
import { onPersonalDataInvalidated } from "@/lib/privacy-events";
export function useMemoryLibrary(gateway: MemoryGateway) {
  const [query, setQuery] = useState<MemoryQuery>({
    query: "",
    kind: "all",
    page: 1,
  });
  const [result, setResult] = useState<MemoryPage>({ items: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => onPersonalDataInvalidated(() => { setResult({items:[],total:0}); setLoading(true); setRevision(n=>n+1); }),[]);
  useEffect(() => {
    let cancelled = false;
    gateway
      .listMemories(query)
      .then((value) => {
        if (!cancelled) setResult(value);
      })
      .catch(() => {
        if (!cancelled) setError("记忆列表暂时无法加载，请重试。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [query, gateway, revision]);
  function change(value: Partial<MemoryQuery>) {
    setLoading(true);
    setError("");
    setQuery((current) => ({ ...current, ...value }));
  }
  function retry() {
    setLoading(true);
    setError("");
    setRevision((value) => value + 1);
  }
  return { query, result, loading, error, change, retry };
}
