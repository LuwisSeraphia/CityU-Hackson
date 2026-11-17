"use client";
import { useRef, useState } from "react";
import { Search, X, ArrowRight, LoaderCircle } from "lucide-react";
import type { MemoryGateway, MemoryQuery } from "@/types/memory";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { useMemoryLibrary } from "@/state/use-memory-library";
import { formatDate } from "@/lib/format";
const filters: { kind: MemoryQuery["kind"]; label: string }[] = [
  { kind: "all", label: "全部记忆" },
  { kind: "fact", label: "事实" },
  { kind: "episode", label: "事件" },
  { kind: "source", label: "原始记录" },
];
export function MemoryLibrary({
  gateway,
  onClose,
  onOpen,
}: {
  gateway: MemoryGateway;
  onClose: () => void;
  onOpen: (id: string) => void;
}) {
  const library = useMemoryLibrary(gateway);
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const composing = useRef(false);
  return (
    <Modal title="我的记忆" onClose={onClose} className="memory-library">
      <div className="library-body">
        <p className="library-description">
          查看事实、事件和保留的原始记录。
          {gateway.mode === "mock" && "当前为本页演示数据。"}
        </p>
        <form
          className="memory-search"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!composing.current) library.change({ query: draft, page: 1 });
          }}
        >
          <label htmlFor="memory-search" className="sr-only">
            搜索记忆
          </label>
          <Search size={17} />
          <input
            id="memory-search"
            ref={input}
            value={draft}
            placeholder="搜索内容或标题"
            onChange={(event) => setDraft(event.target.value)}
            onCompositionStart={() => {
              composing.current = true;
            }}
            onCompositionEnd={() => {
              composing.current = false;
            }}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                (event.nativeEvent.isComposing ||
                  composing.current ||
                  event.keyCode === 229)
              )
                event.preventDefault();
            }}
          />
          {draft && (
            <Button
              className="icon-button"
              aria-label="清空记忆搜索"
              onClick={() => {
                setDraft("");
                library.change({ query: "", page: 1 });
                input.current?.focus();
              }}
            >
              <X size={16} />
            </Button>
          )}
          <Button type="submit" variant="outline">
            搜索
          </Button>
        </form>
        <div className="memory-filters" role="group" aria-label="记忆类型">
          {filters.map((filter) => (
            <Button
              key={filter.kind}
              aria-pressed={library.query.kind === filter.kind}
              onClick={() => library.change({ kind: filter.kind, page: 1 })}
            >
              {filter.label}
            </Button>
          ))}
        </div>
        <div className="library-results" aria-busy={library.loading}>
          {library.loading ? (
            <p className="loading-line" role="status">
              <LoaderCircle className="spin" size={17} />
              正在加载记忆…
            </p>
          ) : library.error ? (
            <div role="alert">
              <p>{library.error}</p>
              <Button onClick={library.retry}>重试加载</Button>
            </div>
          ) : library.result.items.length ? (
            <ul>
              {library.result.items.map((item) => (
                <li key={item.id}>
                  <button
                    className="memory-list-item"
                    onClick={() => onOpen(item.id)}
                  >
                    <div>
                      <span className="memory-type">
                        {item.kind === "fact"
                          ? "事实"
                          : item.kind === "source"
                            ? "原始记录"
                            : item.status === "planned"
                              ? "计划 · 尚未发生"
                              : "事件"}
                      </span>
                      <strong>{item.title}</strong>
                      <p>{item.text}</p>
                      <small>
                        {formatDate(item.createdAt, true)}
                        {item.kind === "fact" && ` · v${item.version}`}
                      </small>
                    </div>
                    <ArrowRight size={17} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="library-empty">
              <p>
                {library.query.query ? "没有找到匹配的记忆" : "这里还没有记录"}
              </p>
              <p>可以更换关键词，或回到对话记录新内容。</p>
            </div>
          )}
        </div>
        <div className="library-pagination">
          <span>
            {library.result.total} 条 · 第 {library.query.page} 页
          </span>
          <div className="flex gap-2">
            <Button
              disabled={library.loading || library.query.page <= 1}
              onClick={() => library.change({ page: library.query.page - 1 })}
            >
              上一页
            </Button>
            <Button
              disabled={
                library.loading ||
                library.query.page * 10 >= library.result.total
              }
              onClick={() => library.change({ page: library.query.page + 1 })}
            >
              下一页
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
