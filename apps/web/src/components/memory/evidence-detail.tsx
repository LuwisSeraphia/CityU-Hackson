import type { Evidence } from "@/types/memory";
import { Clock3, Layers, Quote } from "lucide-react";
import { formatDate } from "@/lib/format";
import { evidenceStatusLabels } from "@/lib/memory-presentation";
import { Button } from "@/components/ui/button";
export function EvidenceDetail({
  evidence,
  onVersion,
  editing = false,
}: {
  evidence: Evidence;
  onVersion: (id: string) => void;
  editing?: boolean;
}) {
  return (
    <>
      <h3>{evidence.title}</h3>
      <div className="source-meta">
        <span>
          <Clock3 size={14} />
          {formatDate(evidence.createdAt, true)}
        </span>
        <span>
          <Layers size={14} />
          {evidence.origin === "web"
            ? "网页来源"
            : evidence.origin === "file"
              ? "文件来源"
              : evidence.kind === "fact"
                ? "原子事实"
                : evidence.kind === "source"
                  ? "原始记录"
                  : "事件记录"}{" "}
          · v{evidence.version}
        </span>
      </div>
      <div className={`source-status ${evidence.status}`}>
        <span />
        {evidenceStatusLabels[evidence.status]}
      </div>
      {evidence.url && /^https?:\/\//i.test(evidence.url) && (
        <p className="source-footnote">
          <a href={evidence.url} target="_blank" rel="noopener noreferrer">
            打开原网页核验 ↗
          </a>
        </p>
      )}
      {evidence.status === "deleted" ? (
        <p className="source-footnote">
          这条事实及其版本已删除，旧引用不再展示内容。原始记录仍保留，可在“我的记忆
          → 原始记录”中查看。
        </p>
      ) : (
        <>
          <div className="source-quote">
            <Quote size={19} />
            <h4>{evidence.kind === "source" ? "原始记录" : "记忆内容"}</h4>
            <p>{evidence.text}</p>
          </div>
          {evidence.kind !== "source" && !!evidence.originalRecords?.length && (
            <section className="source-records">
              <h4>原始记录</h4>
              {evidence.originalRecords.map((record) => (
                <blockquote key={record.id}>
                  <p>{record.text}</p>
                  <small>{formatDate(record.createdAt, true)}</small>
                </blockquote>
              ))}
            </section>
          )}
          {!!evidence.versions?.length && (
            <section className="version-history">
              <h4>版本历史</h4>
              {[...evidence.versions]
                .sort((a, b) => b.version - a.version)
                .map((version) => (
                  <Button
                    key={version.id}
                    disabled={editing}
                    variant="outline"
                    aria-pressed={version.id === evidence.id}
                    onClick={() => onVersion(version.id)}
                  >
                    v{version.version} ·{" "}
                    {version.status === "current" ? "当前" : "历史"}
                  </Button>
                ))}
            </section>
          )}
        </>
      )}
    </>
  );
}
