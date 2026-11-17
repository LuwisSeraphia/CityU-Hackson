"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorText, v2, type PageResult } from "@/lib/api/v2";
import { onPersonalDataInvalidated } from "@/lib/privacy-events";

export function useV2<T>(path: string) {
  const [revision, setRevision] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    data?: T;
    error: string;
  }>();
  const key = `${path}:${revision}`;
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => onPersonalDataInvalidated(refresh), [refresh]);
  useEffect(() => {
    const controller = new AbortController();
    v2<T>(path, { signal: controller.signal }).then(
      (data) => {
        if (!controller.signal.aborted) setResult({ key, data, error: "" });
      },
      (reason) => {
        if (!controller.signal.aborted)
          setResult({ key, error: errorText(reason) });
      },
    );
    return () => controller.abort();
  }, [path, key]);
  const current = result?.key === key ? result : undefined;
  return {
    data: current?.data,
    error: current?.error ?? "",
    loading: !current,
    refresh,
  };
}

export function useV2Pages<T>(path: string) {
  const initial = useV2<PageResult<T>>(path);
  const [page, setPage] = useState<{
    path: string;
    items: T[];
    cursor?: string | null;
    error: string;
    busy: boolean;
  }>({ path, items: [], error: "", busy: false });
  const request = useRef<AbortController | null>(null);
  const reset = useCallback(() => {
    request.current?.abort();
    request.current = null;
    setPage({ path, items: [], error: "", busy: false });
  }, [path]);
  useEffect(() => {
    const dispose = onPersonalDataInvalidated(reset);
    return () => {
      dispose();
      request.current?.abort();
      request.current = null;
    };
  }, [reset]);
  if (page.path !== path) setPage({ path, items: [], error: "", busy: false });
  const current = page.path === path && initial.data ? page : undefined;
  const next =
    current?.cursor === undefined ? initial.data?.next_cursor : current.cursor;
  async function more() {
    if (!next || request.current || initial.loading) return;
    const controller = new AbortController();
    request.current = controller;
    setPage((p) => ({
      path,
      items: p.path === path ? p.items : [],
      cursor: next,
      error: "",
      busy: true,
    }));
    try {
      const result = await v2<PageResult<T>>(
        `${path}${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(next)}`,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted)
        setPage((p) => ({
          path,
          items: [...p.items, ...result.items],
          cursor: result.next_cursor,
          error: "",
          busy: false,
        }));
    } catch (reason) {
      if (!controller.signal.aborted)
        setPage((p) => ({ ...p, error: errorText(reason), busy: false }));
    } finally {
      if (request.current === controller) request.current = null;
    }
  }
  function refresh() {
    reset();
    initial.refresh();
  }
  return {
    items: [...(initial.data?.items ?? []), ...(current?.items ?? [])],
    next,
    more,
    busy: current?.busy ?? false,
    refresh,
    loading: initial.loading,
    error: current?.error || initial.error,
  };
}
