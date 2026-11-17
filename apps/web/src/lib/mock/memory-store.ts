import type {
  Evidence,
  FactDeleteInput,
  FactRevisionInput,
  MemoryQuery,
  SourceRecord,
} from "@/types/memory";
import { seedEvidence } from "./fixtures";
import { validateMessage } from "@/lib/validation";

/** In-memory provider only; never a substitute for the server Controller. */
export function createMemoryStore() {
  const records: SourceRecord[] = seedEvidence.map((item) => ({
    id: `record-${item.id}`,
    text: item.text,
    createdAt: item.createdAt,
  }));
  const evidence: Evidence[] = structuredClone(seedEvidence).map((item) => ({
    ...item,
    sourceIds: [`record-${item.id}`],
    ...(item.kind === "fact" ? { factId: `fact-${item.id}` } : {}),
  }));
  function detail(id: string): Evidence {
    if (id.startsWith("raw:")) {
      const record = records.find((item) => item.id === id.slice(4));
      if (!record) throw new Error("找不到原始记录。");
      return {
        id,
        title: "原始记录",
        text: record.text,
        createdAt: record.createdAt,
        kind: "source",
        version: 1,
        status: "current",
        originalRecords: [structuredClone(record)],
      };
    }
    const item = evidence.find((entry) => entry.id === id);
    if (!item) throw new Error("这条来源暂时无法查看，请重试。");
    if (item.status === "deleted") return structuredClone(item);
    return structuredClone({
      ...item,
      originalRecords: records.filter((source) =>
        item.sourceIds?.includes(source.id),
      ),
      versions: item.factId
        ? evidence.filter(
            (version) =>
              version.factId === item.factId &&
              ["current", "historical"].includes(version.status),
          )
        : [],
    });
  }
  function source(text: string) {
    const record = {
      id: crypto.randomUUID(),
      text,
      createdAt: new Date().toISOString(),
    };
    records.push(record);
    return record;
  }
  function current(factId: string, baseVersionId: string) {
    const item = evidence.find(
      (entry) => entry.factId === factId && entry.status === "current",
    );
    if (!item || item.id !== baseVersionId)
      throw new Error("记忆版本已变化，请重新加载后再操作。");
    return item;
  }
  return {
    evidence,
    records,
    detail,
    source,
    current,
    list(query: MemoryQuery) {
      const collection =
        query.kind === "source"
          ? records.map((item) => detail(`raw:${item.id}`))
          : evidence;
      const matched = collection
        .filter(
          (item) =>
            ["current", "planned"].includes(item.status) &&
            (query.kind === "all" || item.kind === query.kind) &&
            `${item.title} ${item.text}`
              .toLocaleLowerCase()
              .includes(query.query.trim().toLocaleLowerCase()),
        )
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      const start = Math.max(0, query.page - 1) * 10;
      return structuredClone({
        items: matched.slice(start, start + 10),
        total: matched.length,
      });
    },
    revise(input: FactRevisionInput) {
      const error = validateMessage(input.text);
      if (error) throw new Error(error);
      const previous = current(input.factId, input.baseVersionId);
      if (input.text.trim() === previous.text)
        throw new Error("内容未变化，无需创建新版本。");
      const record = source(input.text.trim());
      const next: Evidence = {
        ...previous,
        id: crypto.randomUUID(),
        text: input.text.trim(),
        sourceIds: [record.id],
        createdAt: record.createdAt,
        version: previous.version + 1,
      };
      previous.status = "historical";
      evidence.push(next);
      return detail(next.id);
    },
    remove(input: FactDeleteInput) {
      current(input.factId, input.baseVersionId);
      for (const entry of evidence.filter(
        (item) => item.factId === input.factId,
      )) {
        // Keep a non-content tombstone for existing citations, while retaining Source separately.
        entry.status = "deleted";
        entry.text = "";
        entry.title = "已删除的事实";
        entry.sourceIds = [];
      }
    },
  };
}
