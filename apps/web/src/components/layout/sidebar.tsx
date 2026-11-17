import Link from "next/link";
import {
  BookOpen,
  UserRound,
  Settings2,
  Plus,
  MessageSquare,
  Trash2,
} from "lucide-react";
import type { Conversation } from "@/types/memory";
import { AgentMark } from "@/components/ui/agent-mark";
import { Button } from "@/components/ui/button";
export function Sidebar({
  conversations,
  activeId,
  busy,
  onSelect,
  onCreate,
  onAbout,
  onDelete,
  demo = true,
}: {
  conversations: Conversation[];
  activeId: string;
  busy: boolean;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onAbout: () => void;
  onDelete: (id: string) => void;
  demo?: boolean;
}) {
  return (
    <aside className="sidebar" aria-label="侧边导航">
      <div className="brand">
        <AgentMark small />
        <span>Personal Agent</span>
      </div>
      <nav aria-label="功能模块" className="module-nav">
        <button
          className="nav-item selected"
          aria-current="page"
          onClick={() => document.getElementById("message-input")?.focus()}
        >
          <BookOpen size={18} />
          <span>对话</span>
          <span className="nav-dot" />
        </button>
        <Link className="nav-item" href="/memories">
          <BookOpen size={18} />
          <span>记忆</span>
        </Link>
        <Link className="nav-item" href="/profile">
          <UserRound size={18} />
          <span>关于我</span>
        </Link>
      </nav>
      <div className="history-header">
        <span>对话记录</span>
        <Button
          aria-label="新建对话"
          title="新建对话"
          disabled={busy}
          onClick={onCreate}
          className="icon-button"
        >
          <Plus size={18} />
        </Button>
      </div>
      <div className="history-list" aria-label="对话记录">
        {conversations.map((conversation) => (
          <div
            className={`history-row ${conversation.id === activeId ? "active" : ""}`}
            key={conversation.id}
          >
            <button
              className={`history-item ${conversation.id === activeId ? "active" : ""}`}
              aria-current={conversation.id === activeId ? "true" : undefined}
              disabled={busy}
              onClick={() => onSelect(conversation.id)}
            >
              <MessageSquare size={15} />
              <span title={conversation.title}>{conversation.title}</span>
            </button>
            <Button
              className="history-delete icon-button"
              aria-label={`删除对话：${conversation.title}`}
              title="删除对话"
              disabled={busy}
              onClick={() => onDelete(conversation.id)}
            >
              <Trash2 size={15} />
            </Button>
          </div>
        ))}
        {!conversations.length && (
          <p className="muted text-xs px-3">会话将在这里显示</p>
        )}
      </div>
      <div className="sidebar-bottom">
        <button className="nav-item" onClick={onAbout}>
          {demo ? "演示说明" : "关于"}
        </button>
        <Link className="nav-item settings" href="/settings/response">
          <Settings2 size={18} />
          <span>设置</span>
        </Link>
        <div className="profile">
          <span className="profile-avatar">P</span>
          <div>
            <strong>我的工作空间</strong>
            <span>{demo ? "本地演示 · V1.0" : "本机工作台 · V1.1"}</span>
          </div>
          <span className="profile-dot" />
        </div>
      </div>
    </aside>
  );
}
