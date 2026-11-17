import { ArrowUpRight } from "lucide-react";
import { demoPrompts } from "@/lib/mock/fixtures";
import type { InputMode } from "@/types/memory";
export function DemoPrompts({
  busy,
  onChoose,
}: {
  busy: boolean;
  onChoose: (text: string, mode: InputMode) => void;
}) {
  return (
    <div className="demo-prompts" aria-label="演示场景">
      <span>试着聊聊</span>
      {demoPrompts.map((prompt) => (
        <button
          disabled={busy}
          key={prompt.label}
          onClick={() => onChoose(prompt.text, prompt.mode)}
        >
          {prompt.label}
          <ArrowUpRight size={12} />
        </button>
      ))}
    </div>
  );
}
