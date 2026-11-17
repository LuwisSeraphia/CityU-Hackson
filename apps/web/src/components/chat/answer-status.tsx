import { TriangleAlert, RotateCcw } from "lucide-react";
import type { Message } from "@/types/memory";
import { Button } from "@/components/ui/button";
export function AnswerStatus({
  message,
  busy,
  onRetry,
}: {
  message: Message;
  busy: boolean;
  onRetry: (message: Message) => void;
}) {
  const answer = message.answer;
  if (!answer || answer.status === "complete") return null;
  const labels = {
    partial: "回答存在限制",
    insufficient: "证据不足",
    interrupted: "回答已中断",
    unavailable: "检索暂不可用",
  };
  return (
    <div className="answer-status" role="status">
      <strong>
        <TriangleAlert size={14} />
        {labels[answer.status]}
      </strong>
      {answer.status === "interrupted" && (
        <p>上方内容尚未完成，请重新生成。重新生成会替换这段未完成回答。</p>
      )}
      {answer.warnings.map((warning) => (
        <p key={warning}>{warning}</p>
      ))}
      {answer.retryText && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => onRetry(message)}
        >
          <RotateCcw size={13} />
          重新生成回答
        </Button>
      )}
    </div>
  );
}
