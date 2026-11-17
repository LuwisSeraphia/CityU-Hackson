import type { RecordProcessing } from "@/types/memory";
import { processingDescription } from "@/lib/memory-presentation";
export function ProcessingDetails({
  processing,
}: {
  processing: RecordProcessing;
}) {
  return (
    <div className="processing-details">
      <p>{processingDescription(processing)}</p>
      <div className="processing-counts">
        <span>事件 {processing.addedEpisodes}</span>
        <span>事实 {processing.addedFacts}</span>
        <span>待确认 {processing.pending}</span>
        <span>失败 {processing.failed}</span>
      </div>
      <details>
        <summary>处理详情</summary>
        <dl>
          <div>
            <dt>记录状态</dt>
            <dd>{processing.sourceStatus}</dd>
          </div>
          <div>
            <dt>索引状态</dt>
            <dd>{processing.indexStatus}</dd>
          </div>
          <div>
            <dt>追踪编号</dt>
            <dd>{processing.traceId}</dd>
          </div>
        </dl>
      </details>
    </div>
  );
}
