"use client";
import { Form } from "@/components/ui/form";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { onPersonalDataInvalidated } from "@/lib/privacy-events";
import { Button } from "@/components/ui/button";
import { DiscardDialog } from "@/components/ui/discard-dialog";
import { Modal } from "@/components/ui/modal";
import { RealGateway } from "@/lib/api/gateway";
import { mutation, type Batch } from "@/lib/api/v2";
import { useMemoryLibrary } from "@/state/use-memory-library";
import { useV2Pages } from "@/state/use-v2";
import { EvidenceDrawer } from "@/components/memory/evidence-drawer";
import { BatchReview } from "./batch-review";
import { MemoryDetail } from "./memory-detail";
import { MemoryJobStatus } from "./memory-job-status";
import { Feedback, LoadState, SectionShell, useAction } from "./common";

export function MemoriesPage() {
  const params = useSearchParams();
  const [gateway] = useState(() => new RealGateway());
  const library = useMemoryLibrary(gateway),
    batches = useV2Pages<Batch>("/memory/batches");
  const [tab, setTab] = useState(
    params.get("tab") === "pending" ? "pending" : "saved",
  );
  const [batch, setBatch] = useState<string | null>(params.get("batch"));
  const [detail, setDetail] = useState<string>(),
    [source, setSource] = useState<string>();
  const [draft, setDraft] = useState(""),
    [record, setRecord] = useState(false),
    [text, setText] = useState("");
  const [conversation, setConversation] = useState<string>();
  const action = useAction();
  const [discard, setDiscard] = useState(false);
  useEffect(
    () =>
      onPersonalDataInvalidated(() => {
        setDetail(undefined);
        setSource(undefined);
        setBatch(null);
      }),
    [],
  );
  function refresh() {
    library.retry();
    batches.refresh();
  }
  return (
    <SectionShell title="记忆">
      <div className="toolbar-line">
        <div className="section-tabs" role="group" aria-label="记忆视图">
          <Button
            aria-pressed={tab === "saved"}
            onClick={() => setTab("saved")}
          >
            已保存
          </Button>
          <Button
            aria-pressed={tab === "pending"}
            onClick={() => setTab("pending")}
          >
            待确认
          </Button>
        </div>
        <Button variant="solid" onClick={() => setRecord(true)}>
          记一件事
        </Button>
        <Button onClick={refresh}>刷新</Button>
      </div>
      {conversation && (
        <MemoryJobStatus gateway={gateway} conversationId={conversation} />
      )}
      {tab === "saved" ? (
        <>
          <Form
            noValidate
            className="memory-search"
            onSubmit={(e) => {
              e.preventDefault();
              library.change({ query: draft, page: 1 });
            }}
          >
            <input
              aria-label="搜索记忆"
              placeholder="搜索记忆"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button type="submit" variant="outline">
              搜索
            </Button>
          </Form>
          <div className="section-tabs" role="group" aria-label="记忆类型">
            {(
              [
                ["all", "全部"],
                ["fact", "事实"],
                ["episode", "事件"],
                ["source", "原始记录"],
              ] as const
            ).map(([kind, label]) => (
              <Button
                key={kind}
                aria-pressed={library.query.kind === kind}
                onClick={() => library.change({ kind, page: 1 })}
              >
                {label}
              </Button>
            ))}
          </div>
          <LoadState
            loading={library.loading}
            error={library.error}
            refresh={library.retry}
          />
          {!library.loading && !library.error && (
            <>
              <div className="record-list card-grid">
                {library.result.items.map((item) => (
                  <button
                    className="record-row memory-card"
                    key={item.id}
                    onClick={() =>
                      item.kind === "source" || item.status !== "current"
                        ? setSource(item.id)
                        : setDetail(item.id)
                    }
                  >
                    <strong>{item.title}</strong>
                    <p>{item.text}</p>
                    {item.eventTime && <span className="row-meta">发生于 {item.eventTime}</span>}
                    <span className="card-source">
                      <span>
                        {item.kind === "fact"
                          ? "事实"
                          : item.kind === "episode"
                            ? "事件"
                            : "原始记录"}
                      </span>
                      <span>
                        {item.kind === "source"
                          ? "查看原文"
                          : item.status === "current"
                            ? "当前版本 · 查看依据"
                            : item.status === "planned"
                              ? "计划中 · 查看依据"
                              : "历史版本 · 查看依据"}{" "}
                        →
                      </span>
                    </span>
                  </button>
                ))}
              </div>
              {!library.result.total && (
                <div className="management-empty">
                  暂无记忆
                  <Button onClick={() => setRecord(true)}>记一件事</Button>
                </div>
              )}
              <div className="form-actions">
                <Button
                  disabled={library.query.page <= 1}
                  onClick={() =>
                    library.change({ page: library.query.page - 1 })
                  }
                >
                  上一页
                </Button>
                <span>
                  第 {library.query.page} 页 · {library.result.total} 条
                </span>
                <Button
                  disabled={library.query.page * 10 >= library.result.total}
                  onClick={() =>
                    library.change({ page: library.query.page + 1 })
                  }
                >
                  下一页
                </Button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <LoadState {...batches} />
          <div className="record-list card-grid">
            {batches.items
              .filter(
                (b) =>
                  b.state === "pending" ||
                  b.state === "review" ||
                  b.state === "partial",
              )
              .map((b) => (
                <button
                  className="record-row memory-card"
                  key={b.id}
                  onClick={() => setBatch(b.id)}
                >
                  <strong>查看待确认内容</strong>
                  <span>{new Date(b.created).toLocaleString("zh-CN")}</span>
                </button>
              ))}
          </div>
          {!batches.loading &&
            !batches.error &&
            !batches.items.some((b) =>
              ["pending", "review", "partial"].includes(b.state),
            ) && (
              <p className="management-empty">当前已加载内容中没有待确认项</p>
            )}
          {batches.next && (
            <Button disabled={batches.busy} onClick={() => void batches.more()}>
              加载更多
            </Button>
          )}
        </>
      )}
      {detail && (
        <MemoryDetail
          key={detail}
          id={detail}
          onClose={() => setDetail(undefined)}
          onChanged={refresh}
          onSource={(id) => {
            setDetail(undefined);
            setSource(id);
          }}
        />
      )}
      {source && (
        <EvidenceDrawer
          readOnly
          key={source}
          id={source}
          gateway={gateway}
          onClose={() => setSource(undefined)}
          onChanged={refresh}
        />
      )}
      {batch && (
        <BatchReview
          id={batch}
          onClose={() => setBatch(null)}
          onChanged={refresh}
        />
      )}
      {record && (
        <Modal
          title="记一件事"
          onClose={() => {
            if (action.busy) return;
            if (text) setDiscard(true);
            else setRecord(false);
          }}
        >
          <Form
            noValidate
            className="dialog-body field-grid"
            onSubmit={(e) => {
              e.preventDefault();
              void action.run(async () => {
                let id = conversation;
                if (!id) {
                  id = (await gateway.createConversation()).id;
                  setConversation(id);
                }
                const body = { conversation_id: id, text, mode: "explicit" };
                const result = await mutation<{ job_id: string }>(
                  "/memory/records",
                  { ...body, request_id: action.requestId("record", body) },
                );
                gateway.dispatchEvent(
                  new CustomEvent("memory-job", {
                    detail: { id: result.job_id, conversationId: id },
                  }),
                );
                setRecord(false);
                setText("");
              }, "已提交整理");
            }}
          >
            <label>
              内容
              <textarea
                className="resize-none"
                required
                maxLength={16000}
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </label>
            <Feedback {...action} />
            <Button
              type="submit"
              variant="solid"
              disabled={action.busy || !text.trim()}
            >
              整理为记忆
            </Button>
          </Form>
        </Modal>
      )}
      {discard && (
        <DiscardDialog
          onKeep={() => setDiscard(false)}
          onDiscard={() => {
            setDiscard(false);
            setRecord(false);
            setText("");
          }}
        />
      )}
    </SectionShell>
  );
}
