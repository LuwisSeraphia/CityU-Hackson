"use client";
import { useEffect, useState } from "react";
import { onPersonalDataInvalidated } from "@/lib/privacy-events";
import { LoaderCircle } from "lucide-react";
import { Sidebar } from "@/components/layout/sidebar";
import { WorkbenchHeader } from "@/components/layout/workbench-header";
import { MessageList } from "@/components/chat/message-list";
import { MessageComposer } from "@/components/chat/message-composer";
import { DemoPrompts } from "@/components/chat/demo-prompts";
import { EvidenceDrawer } from "@/components/memory/evidence-drawer";
import { MemoryLibrary } from "@/components/memory/memory-library";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { createMockGateway } from "@/lib/mock/gateway";
import { RealGateway } from "@/lib/api/gateway";
import { ServiceSetup } from "@/components/agent/service-setup";
import { AgentControls } from "@/components/agent/agent-controls";
import { TemporaryChat } from "@/components/agent/temporary-chat";
import { useWorkspace } from "@/state/use-workspace";
import { ConversationOptions } from "@/components/v2/conversation-options";
import { MemoryJobStatus } from "@/components/v2/memory-job-status";
import type { InputMode } from "@/types/memory";
export function Workbench({ demo = false }: { demo?: boolean }) {
  const [gateway] = useState(() =>
    demo ? createMockGateway() : new RealGateway(),
  );
  const workspace = useWorkspace(gateway);
  const [deleteId, setDeleteId] = useState<string>();
  const [deleteError, setDeleteError] = useState("");
  const [v2Ready, setV2Ready] = useState(false);
  const [sourceId, setSourceId] = useState<string>();
  const [menu, setMenu] = useState(false);
  const [about, setAbout] = useState(false);
  const [library, setLibrary] = useState(false);
  const [temporary, setTemporary] = useState(false);
  const [returnToLibrary, setReturnToLibrary] = useState(false);
  const reloadWorkspace = workspace.load;
  useEffect(
    () =>
      onPersonalDataInvalidated(() => {
        setSourceId(undefined);
        setLibrary(false);
        void reloadWorkspace();
      }),
    [reloadWorkspace],
  );
  const [suggestion, setSuggestion] = useState<{
    text: string;
    mode: InputMode;
  }>();
  function choose(text: string, mode: InputMode) {
    if (workspace.draft.text.trim() && workspace.draft.text !== text) {
      setSuggestion({ text, mode });
      return;
    }
    workspace.updateDraft({ text, mode });
    document.getElementById("message-input")?.focus();
  }
  const sidebar = (
    <Sidebar
      demo={demo}
      conversations={workspace.conversations}
      activeId={workspace.activeId}
      busy={workspace.busy || workspace.loading}
      onSelect={(id) => {
        workspace.select(id);
        setMenu(false);
      }}
      onCreate={() => {
        void workspace.create();
        setMenu(false);
      }}
      onDelete={(id) => {
        setDeleteId(id);
        setDeleteError("");
        setMenu(false);
      }}
      onAbout={() => {
        setMenu(false);
        setAbout(true);
      }}
    />
  );
  return (
    <div className="workbench">
      <nav aria-label="快捷导航">
        <a
          href={workspace.active ? "#message-input" : "#workbench-main"}
          className="skip-link"
        >
          {workspace.active ? "跳到消息输入框" : "跳到工作台"}
        </a>
      </nav>
      <div className="desktop-sidebar">{sidebar}</div>
      <main className="main-panel" id="workbench-main" tabIndex={-1}>
        <WorkbenchHeader
          title={workspace.active?.title ?? "对话"}
          busy={workspace.busy || workspace.loading}
          onMenu={() => setMenu(true)}
          onCreate={() => void workspace.create()}
          onAbout={() => setAbout(true)}
          onMemories={() => setLibrary(true)}
          demo={gateway.mode === "mock"}
        />
        {workspace.loading ? (
          <div className="page-state" role="status">
            <LoaderCircle className="spin" size={22} />
            <p>正在准备你的工作台…</p>
          </div>
        ) : !workspace.active ? (
          gateway instanceof RealGateway && workspace.error ? (
            <div className="message-scroller">
              <ServiceSetup
                key={String(workspace.loading)}
                gateway={gateway}
                onRetry={() => void workspace.load()}
              />
            </div>
          ) : (
            <div className="page-state" role="alert">
              <p>{workspace.error || "开始新的对话"}</p>
              <Button
                variant="outline"
                onClick={() =>
                  void (workspace.error ? workspace.load() : workspace.create())
                }
              >
                {workspace.error ? "重新加载" : "新建对话"}
              </Button>
            </div>
          )
        ) : (
          <>
            <MessageList
              key={workspace.activeId}
              conversation={workspace.active}
              busy={workspace.busy}
              onEvidence={setSourceId}
              onDecide={(message, decision) =>
                void workspace.decide(message, decision)
              }
              onRetry={(message) => void workspace.retry(message)}
              onRecord={(text) => choose(text, "record")}
              onEdit={workspace.editProposal}
              onRefresh={(message) => void workspace.refreshProposal(message)}
              progress={workspace.progress}
              demo={gateway.mode === "mock"}
            />
            <footer className="composer-region">
              <div className="reading-column">
                <div className="conversation-toolbar">
                  {gateway instanceof RealGateway ? (
                    <AgentControls
                      key={`tools:${workspace.activeId}`}
                      gateway={gateway}
                      conversationId={workspace.activeId}
                      busy={workspace.busy}
                      onTemporary={() => setTemporary(true)}
                    />
                  ) : (
                    <DemoPrompts busy={workspace.busy} onChoose={choose} />
                  )}
                  {gateway instanceof RealGateway && (
                    <ConversationOptions
                      key={`policy:${workspace.activeId}`}
                      id={workspace.activeId}
                      gateway={gateway}
                      busy={workspace.busy}
                      onReady={setV2Ready}
                    />
                  )}
                </div>
                {v2Ready && gateway instanceof RealGateway && (
                  <MemoryJobStatus
                    key={`jobs:${workspace.activeId}`}
                    gateway={gateway}
                    conversationId={workspace.activeId}
                  />
                )}
                <MessageComposer
                  personalized={v2Ready}
                  text={workspace.draft.text}
                  mode={workspace.draft.mode}
                  busy={workspace.busy}
                  error={workspace.error}
                  onText={(text) => workspace.updateDraft({ text })}
                  onMode={(mode) => workspace.updateDraft({ mode })}
                  onSend={() => void workspace.send()}
                  demo={demo}
                />
                <p className="demo-disclaimer" hidden={!demo}>
                  {demo
                    ? "演示数据仅保留在当前页面，刷新后重置。尚未连接真实 AI 与长期记忆服务。"
                    : "文本由云端百炼模型处理 · 记忆保存于本机数据库 · 网页与文件内容按需读取"}
                </p>
              </div>
            </footer>
          </>
        )}
      </main>
      {deleteId && (
        <Modal
          title="删除这段对话？"
          onClose={() => {
            if (!workspace.busy) setDeleteId(undefined);
          }}
        >
          <div className="dialog-body" aria-busy={workspace.busy}>
            <p>
              聊天记录和会话附件将被删除，无法恢复。已保存的长期记忆及其来源仍然保留，可在“记忆”页单独删除。
            </p>
            {deleteError && (
              <p role="alert" className="form-error">
                {deleteError}
              </p>
            )}
            <div className="form-actions">
              <Button
                disabled={workspace.busy}
                onClick={() => setDeleteId(undefined)}
              >
                取消
              </Button>
              <Button
                className="danger-button"
                disabled={workspace.busy}
                onClick={async () => {
                  const error = await workspace.remove(deleteId);
                  if (error) setDeleteError(error);
                  else setDeleteId(undefined);
                }}
              >
                删除对话
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {temporary && gateway instanceof RealGateway && (
        <TemporaryChat gateway={gateway} onClose={() => setTemporary(false)} />
      )}
      {menu && (
        <Modal
          title="工作空间"
          onClose={() => setMenu(false)}
          className="navigation-modal"
        >
          {sidebar}
        </Modal>
      )}
      {sourceId && (
        <EvidenceDrawer
          readOnly={v2Ready}
          key={sourceId}
          id={sourceId}
          gateway={gateway}
          onClose={() => {
            setSourceId(undefined);
            if (returnToLibrary) {
              setLibrary(true);
              setReturnToLibrary(false);
            }
          }}
          onChanged={() => void workspace.syncMemories()}
        />
      )}
      {library && (
        <MemoryLibrary
          gateway={gateway}
          onClose={() => setLibrary(false)}
          onOpen={(id) => {
            setLibrary(false);
            setReturnToLibrary(true);
            setSourceId(id);
          }}
        />
      )}
      {suggestion && (
        <Modal title="替换当前草稿？" onClose={() => setSuggestion(undefined)}>
          <div className="about-body">
            <p>输入框中还有未发送的内容。使用此演示场景会替换当前草稿。</p>
            <div className="flex gap-2 mt-6">
              <Button
                variant="outline"
                onClick={() => setSuggestion(undefined)}
              >
                保留草稿
              </Button>
              <Button
                variant="solid"
                onClick={() => {
                  workspace.updateDraft(suggestion);
                  setSuggestion(undefined);
                }}
              >
                替换草稿
              </Button>
            </div>
          </div>
        </Modal>
      )}
      {about && (
        <Modal title="关于这个工作台" onClose={() => setAbout(false)}>
          <div className="about-body">
            <span className="eyebrow">PERSONAL AGENT · V1.0</span>
            {!demo ? (
              <>
                <h3>一个逐渐了解你的 Agent。</h3>
                <p>
                  对话由百炼模型生成。Agent
                  可以检索个人记忆、联网查找资料，并读取当前会话上传的文件。
                </p>
                <p>
                  智能记忆可以关闭；低风险新增自动保存，重要变化等待确认。对话较长时会生成带原文引用的上下文摘要。
                </p>
                <p>
                  在左侧“记忆”和“关于我”查看已保存内容，回复下方可查看执行过程。
                </p>
              </>
            ) : (
              <>
                <h3>先让记忆，有一个舒适的入口。</h3>
                <p>
                  这是第一阶段的前端演示。你可以切换会话、提问、记录、查看来源，并体验更新确认。
                </p>
                <p>
                  新增、合并、更新和失败反馈均为模拟结果；数据只在本页内存中保留，刷新后重置。不会调用
                  Qwen，也不会写入数据库。
                </p>
                <div className="about-tip">
                  体验合并：连续记录两次相同内容。
                  <br />
                  体验更新与失败：点击输入框上方的演示场景。
                </div>
              </>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
