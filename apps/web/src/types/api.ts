// Wire contracts from PRD §7. No backend endpoints are implemented in phase one.
export interface RecordRequest {
  conversation_id: string;
  text: string;
  client_timezone: string;
}
export interface RecordAccepted {
  source_id: string;
  job_id: string;
  trace_id: string;
  status: "RECEIVED";
}
export type JobStage =
  | "RECEIVED"
  | "EXTRACTED"
  | "COMMITTED"
  | "INDEXED"
  | "PENDING_REVIEW"
  | "FAILED";
export interface ProcessingJob {
  job_id: string;
  stage: JobStage;
  trace_id: string;
  error?: ApiErrorBody["error"];
}
export interface JobAccepted {
  job_id: string;
  trace_id: string;
  status: "RECEIVED";
}
export interface FactVersionResponse {
  version_id: string;
  content: string;
  version: number;
  status: "CURRENT" | "HISTORICAL" | "CORRECTED" | "DELETED";
  source_ids: string[];
  created_at: string;
}
/** Proposed DTOs where the PRD specifies an endpoint but not its complete response shape. */
export interface FactDetailResponse {
  fact_id: string;
  current_version_id: string | null;
  versions: FactVersionResponse[];
  sources: { source_id: string; text: string; created_at: string }[];
}
export interface ChatRequest {
  conversation_id: string;
  text: string;
  request_id: string;
  retry_message_id?: string;
}
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    stage: string;
    retryable: boolean;
    trace_id: string;
  };
}
export type ChatStreamEvent =
  | {
      event: "retrieval.started";
      data: { trace_id: string; conversation_id: string };
    }
  | {
      event: "retrieval.completed";
      data: { evidence_count: number; warnings: string[] };
    }
  | {
      event: "retrieval.degraded";
      data: { reason_code: string; available_channels: string[] };
    }
  | { event: "message.delta"; data: { seq: number; text: string } }
  | {
      event: "message.citations";
      data: { citations: { source_id: string; version_id: string }[] };
    }
  | {
      event: "message.completed";
      data: {
        message_id: string;
        trace_id: string;
        usage?: { input_tokens: number; output_tokens: number };
      };
    }
  | {
      event: "message.error";
      data: { error_code: string; retryable: boolean; trace_id: string };
    };
