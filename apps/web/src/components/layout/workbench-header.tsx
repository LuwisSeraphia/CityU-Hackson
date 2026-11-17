import { Menu, Plus, FlaskConical, BookOpen, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
export function WorkbenchHeader({
  title,
  busy,
  onMenu,
  onCreate,
  onAbout,
  onMemories,
  demo,
}: {
  title: string;
  busy: boolean;
  onMenu: () => void;
  onCreate: () => void;
  onAbout: () => void;
  onMemories: () => void;
  demo: boolean;
}) {
  return (
    <header className="workbench-header">
      <div className="flex items-center gap-3 min-w-0">
        <Button
          className="mobile-menu icon-button"
          onClick={onMenu}
          aria-label="打开导航"
        >
          <Menu size={20} />
        </Button>
        <div className="min-w-0">
          <h1 title={title}>{title}</h1>
        </div>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <button
          className="demo-badge"
          onClick={onAbout}
          aria-label={demo ? "演示模式说明" : "本机服务说明"}
          title={demo ? "演示模式说明" : "本机服务说明"}
        >
          {demo ? <FlaskConical size={13} /> : <Server size={13} />}
          <span>{demo ? "演示模式" : "本机服务"}</span>
        </button>
        {demo && (
          <Button
            variant="outline"
            disabled={busy}
            onClick={onMemories}
            className="header-create"
            aria-label="我的记忆"
            title="我的记忆"
          >
            <BookOpen size={16} />
            <span>我的记忆</span>
          </Button>
        )}
        <Button
          variant="outline"
          disabled={busy}
          onClick={onCreate}
          className="header-create"
          aria-label="新对话"
          title="新对话"
        >
          <Plus size={16} />
          <span>新对话</span>
        </Button>
      </div>
    </header>
  );
}
