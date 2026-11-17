import type {
  ProcessingJob,
  RecordAccepted,
  JobAccepted,
  FactDetailResponse,
} from "@/types/api";
export class ContractError extends Error {
  constructor() {
    super("服务响应格式不符合接口约定，请稍后重试。");
  }
}
const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
export function accepted(value: unknown): JobAccepted {
  if (
    !object(value) ||
    value.status !== "RECEIVED" ||
    typeof value.job_id !== "string" ||
    typeof value.trace_id !== "string"
  )
    throw new ContractError();
  return value as unknown as JobAccepted;
}
export function recordAccepted(value: unknown): RecordAccepted {
  accepted(value);
  if (!object(value) || typeof value.source_id !== "string")
    throw new ContractError();
  return value as unknown as RecordAccepted;
}
export function processingJob(value: unknown): ProcessingJob {
  if (
    !object(value) ||
    typeof value.job_id !== "string" ||
    typeof value.trace_id !== "string" ||
    ![
      "RECEIVED",
      "EXTRACTED",
      "COMMITTED",
      "INDEXED",
      "PENDING_REVIEW",
      "FAILED",
    ].includes(value.stage as string)
  )
    throw new ContractError();
  return value as unknown as ProcessingJob;
}
export function factDetail(value: unknown): FactDetailResponse {
  if (
    !object(value) ||
    typeof value.fact_id !== "string" ||
    !(
      value.current_version_id === null ||
      typeof value.current_version_id === "string"
    ) ||
    !Array.isArray(value.versions) ||
    !Array.isArray(value.sources)
  )
    throw new ContractError();
  for (const version of value.versions)
    if (
      !object(version) ||
      typeof version.version_id !== "string" ||
      typeof version.content !== "string" ||
      !Number.isInteger(version.version) ||
      typeof version.created_at !== "string" ||
      !["CURRENT", "HISTORICAL", "DELETED"].includes(
        version.status as string,
      ) ||
      !Array.isArray(version.source_ids) ||
      !version.source_ids.every((id) => typeof id === "string")
    )
      throw new ContractError();
  for (const source of value.sources)
    if (
      !object(source) ||
      typeof source.source_id !== "string" ||
      typeof source.text !== "string" ||
      typeof source.created_at !== "string"
    )
      throw new ContractError();
  return value as unknown as FactDetailResponse;
}
