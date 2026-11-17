"use client";
import { Form } from "@/components/ui/form";
import { useEffect, useState } from "react";
import { onPersonalDataInvalidated } from "@/lib/privacy-events";
import { Button } from "@/components/ui/button";
import { DiscardDialog } from "@/components/ui/discard-dialog";
import { Modal } from "@/components/ui/modal";
import { EvidenceDrawer } from "@/components/memory/evidence-drawer";
import { RealGateway } from "@/lib/api/gateway";
import { mutation, type Profile } from "@/lib/api/v2";
import { useV2Pages } from "@/state/use-v2";
import {
  Feedback,
  LoadState,
  SectionShell,
  useAction,
  InfoTip,
} from "./common";
import { DeleteForm } from "./memory-detail";
const categories: Record<string, string> = {
  background: "背景",
  goal: "目标",
  learning: "学习",
  lifestyle: "生活",
  communication: "交流偏好",
  personality: "性格",
};
const states: Record<string, string> = {
  active: "可使用",
  paused: "已暂停",
  pending: "待确认",
  rejected: "已拒绝",
  superseded: "历史版本",
  deleted: "已删除",
};
function ProfileEditor({
  item,
  close,
  refresh,
  source,
}: {
  item: Profile;
  close: () => void;
  refresh: () => void;
  source: (id: string) => void;
}) {
  const action = useAction();
  const [discard, setDiscard] = useState(false);
  const [edit, setEdit] = useState(false),
    [text, setText] = useState(item.content),
    [remove, setRemove] = useState(false);
  async function change(body: object, suffix = "", method = "PATCH") {
    await action.run(async () => {
      const data = { ...body, expected_revision: item.revision };
      await mutation(
        `/profiles/${item.id}${suffix}`,
        { ...data, request_id: action.requestId("profile" + suffix, data) },
        method,
      );
      refresh();
      close();
    });
  }
  return (
    <>
      <Modal
        title="画像详情"
        onClose={() => {
          if (action.busy) return;
          if (edit && text !== item.content) setDiscard(true);
          else close();
        }}
      >
        <div className="dialog-body field-grid" aria-busy={action.busy}>
          {remove ? (
            <DeleteForm
              target={{
                type: "profile",
                id: item.id,
                expected_revision: item.revision,
              }}
              onCancel={() => setRemove(false)}
              onDeleted={() => {
                refresh();
                close();
              }}
            />
          ) : (
            <>
              <span>
                {categories[item.category] || item.category} ·{" "}
                {states[item.state] || item.state}
              </span>
              {edit ? (
                <Form
                  noValidate
                  className="field-grid"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void change({ content: text }, "/corrections", "POST");
                  }}
                >
                  <label>
                    更正内容
                    <textarea
                      className="resize-none"
                      required
                      maxLength={4000}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                    />
                  </label>
                  <Button
                    variant="solid"
                    type="submit"
                    disabled={action.busy || !text.trim()}
                  >
                    保存更正
                  </Button>
                </Form>
              ) : (
                <p className="memory-full-text">{item.content}</p>
              )}
              <div className="toolbar-line">
                {item.state === "pending" ? (
                  <>
                    <Button
                      variant="solid"
                      disabled={action.busy}
                      onClick={() =>
                        void change({ action: "accept" }, "/decision", "POST")
                      }
                    >
                      确认画像
                    </Button>
                    <Button
                      disabled={action.busy}
                      onClick={() =>
                        void change({ action: "reject" }, "/decision", "POST")
                      }
                    >
                      拒绝
                    </Button>
                  </>
                ) : (
                  ["active", "paused"].includes(item.state) && (
                    <>
                      <Button
                        disabled={action.busy}
                        onClick={() =>
                          void change({
                            state:
                              item.state === "active" ? "paused" : "active",
                          })
                        }
                      >
                        {item.state === "active" ? "暂停使用" : "恢复使用"}
                      </Button>
                      <Button
                        disabled={action.busy}
                        onClick={() => void change({ pinned: !item.pinned })}
                      >
                        {item.pinned ? "取消优先" : "优先使用"}
                      </Button>
                    </>
                  )
                )}
                <Button disabled={action.busy} onClick={() => setEdit(!edit)}>
                  更正
                </Button>
                <Button disabled={action.busy} onClick={() => setRemove(true)}>
                  删除
                </Button>
              </div>
              <details open>
                <summary>依据</summary>
                {item.evidence_ids.map((id, i) => (
                  <Button key={id} onClick={() => source(id)}>
                    来源 {i + 1}
                  </Button>
                ))}
                {!item.evidence_ids.length && <p>暂无可查看的来源</p>}
                {item.context?.counterevidence_ids?.map((id, i) => (
                  <Button key={id} onClick={() => source(id)}>
                    相反证据 {i + 1}
                  </Button>
                ))}
              </details>
              <Feedback {...action} />
            </>
          )}
        </div>
      </Modal>
      {discard && (
        <DiscardDialog onKeep={() => setDiscard(false)} onDiscard={close} />
      )}
    </>
  );
}
export function ProfilesPage() {
  const query = useV2Pages<Profile>("/profiles"),
    action = useAction();
  const [filter, setFilter] = useState("active"),
    [selected, setSelected] = useState<Profile>(),
    [source, setSource] = useState<string>();
  const [gateway] = useState(() => new RealGateway());
  useEffect(
    () =>
      onPersonalDataInvalidated(() => {
        setSelected(undefined);
        setSource(undefined);
      }),
    [],
  );
  return (
    <SectionShell title="关于我">
      <div className="toolbar-line">
        <Button
          variant="outline"
          disabled={action.busy}
          onClick={() =>
            void action.run(async () => {
              await mutation("/profiles/review", {});
              query.refresh();
            }, "画像已重新整理")
          }
        >
          {action.busy ? "整理中…" : "重新整理画像"}
        </Button>
        <InfoTip>
          根据已确认的记忆整理画像。推断出的性格特征需要你确认后才使用；优先使用仍受相关性和预算限制。
        </InfoTip>
        <Button onClick={query.refresh}>刷新</Button>
      </div>
      <Feedback {...action} />
      <div
        className="section-tabs"
        role="group"
        aria-label="已加载画像的状态筛选"
      >
        <InfoTip>筛选当前已加载的画像；可加载更多以查看其余内容。</InfoTip>
        {["active", "pending", "paused", "all"].map((s) => (
          <Button
            key={s}
            aria-pressed={filter === s}
            onClick={() => setFilter(s)}
          >
            {states[s] || "全部"}
          </Button>
        ))}
      </div>
      <LoadState {...query} />
      <div className="record-list card-grid">
        {query.items
          .filter((p) => filter === "all" || p.state === filter)
          .map((p) => (
            <button
              className="record-row memory-card"
              key={p.id}
              onClick={() => setSelected(p)}
            >
              <span className="card-topline">
                <span>
                  {categories[p.category] || p.category}
                  {p.pinned ? " · 优先" : ""}
                </span>
                <span className="state-badge" data-state={p.state}>
                  {states[p.state] || p.state}
                </span>
              </span>
              <strong>{p.content}</strong>
              <span className="card-source">
                <span>
                  {p.origin === "self_report"
                    ? "本人陈述"
                    : p.origin === "inference"
                      ? "系统推断"
                      : "来源未标注"}
                </span>
                <span>{p.evidence_ids.length} 条依据 →</span>
              </span>
            </button>
          ))}
      </div>
      {!query.loading &&
        !query.error &&
        !query.items.some((p) => filter === "all" || p.state === filter) && (
          <p className="management-empty">当前已加载内容中没有此类画像</p>
        )}
      {query.next && (
        <Button disabled={query.busy} onClick={() => void query.more()}>
          加载更多
        </Button>
      )}
      {selected && (
        <ProfileEditor
          key={selected.id}
          item={selected}
          close={() => setSelected(undefined)}
          refresh={query.refresh}
          source={(id) => {
            setSelected(undefined);
            setSource(id);
          }}
        />
      )}
      {source && (
        <EvidenceDrawer
          readOnly
          id={source}
          gateway={gateway}
          onClose={() => setSource(undefined)}
          onChanged={query.refresh}
        />
      )}
    </SectionShell>
  );
}
