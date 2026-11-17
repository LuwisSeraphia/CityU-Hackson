import type { FactDetailResponse } from "@/types/api";
import type { Evidence } from "@/types/memory";

/** Wire DTO -> UI model. Deleted versions never expose text, versions or source content. */
export function factToEvidence(
  fact: FactDetailResponse,
  versionId = fact.current_version_id,
): Evidence {
  const version = fact.versions.find((entry) => entry.version_id === versionId);
  if (!version) throw new Error("指定版本已不存在或不可访问。");
  const toVersion = (
    item: FactDetailResponse["versions"][number],
  ): Evidence => ({
    id: item.version_id,
    factId: fact.fact_id,
    title: item.status === "DELETED" ? "已删除的事实" : "记忆事实",
    text: item.status === "DELETED" ? "" : item.content,
    kind: "fact",
    createdAt: item.created_at,
    version: item.version,
    status:
      item.status === "CURRENT"
        ? "current"
        : item.status === "DELETED"
          ? "deleted"
          : item.status === "CORRECTED" ? "corrected" : "historical",
    sourceIds: item.status === "DELETED" ? [] : item.source_ids,
  });
  const evidence = toVersion(version);
  if (evidence.status === "deleted") return evidence;
  return {
    ...evidence,
    originalRecords: fact.sources
      .filter((source) => version.source_ids.includes(source.source_id))
      .map((source) => ({
        id: source.source_id,
        text: source.text,
        createdAt: source.created_at,
      })),
    versions: fact.versions
      .filter((item) => item.status !== "DELETED")
      .map(toVersion),
  };
}
