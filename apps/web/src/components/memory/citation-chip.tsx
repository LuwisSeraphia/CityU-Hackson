import { FileText, ArrowUpRight } from "lucide-react";
export function CitationChip({
  id,
  index,
  onOpen,
}: {
  id: string;
  index: number;
  onOpen: (id: string) => void;
}) {
  return (
    <button className="citation-chip" onClick={() => onOpen(id)}>
      <FileText size={13} />
      <span>
        {id.startsWith("run:")
          ? "网页来源"
          : id.startsWith("file:")
            ? "文件来源"
            : "记忆来源"}{" "}
        {index + 1}
      </span>
      <ArrowUpRight size={12} />
    </button>
  );
}
