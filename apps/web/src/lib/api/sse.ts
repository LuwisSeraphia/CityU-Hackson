import type { ChatStreamEvent } from "@/types/api";

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown) =>
  Array.isArray(value) && value.every((entry) => typeof entry === "string");
export function parseChatEvent(
  name: string,
  raw: string,
): ChatStreamEvent | undefined {
  const known = [
    "retrieval.started",
    "retrieval.completed",
    "retrieval.degraded",
    "message.delta",
    "message.citations",
    "message.completed",
    "message.error",
  ];
  if (!known.includes(name)) return undefined;
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("服务返回了无法解析的流事件。");
  }
  if (!object(data)) throw new Error("服务返回的流事件结构不正确。");
  const valid = (() => {
    switch (name) {
      case "retrieval.started":
        return (
          typeof data.trace_id === "string" &&
          typeof data.conversation_id === "string"
        );
      case "retrieval.completed":
        return (
          Number.isInteger(data.evidence_count) &&
          (data.evidence_count as number) >= 0 &&
          strings(data.warnings)
        );
      case "retrieval.degraded":
        return (
          typeof data.reason_code === "string" &&
          strings(data.available_channels)
        );
      case "message.delta":
        return (
          Number.isInteger(data.seq) &&
          (data.seq as number) >= 0 &&
          typeof data.text === "string"
        );
      case "message.citations":
        return (
          Array.isArray(data.citations) &&
          data.citations.every(
            (entry) =>
              object(entry) &&
              typeof entry.source_id === "string" &&
              typeof entry.version_id === "string",
          )
        );
      case "message.completed":
        return (
          typeof data.message_id === "string" &&
          typeof data.trace_id === "string"
        );
      case "message.error":
        return (
          typeof data.error_code === "string" &&
          typeof data.retryable === "boolean" &&
          typeof data.trace_id === "string"
        );
    }
  })();
  if (!valid) throw new Error("服务返回的流事件字段不完整。");
  return { event: name, data } as ChatStreamEvent;
}

/** Incremental UTF-8 SSE parser; comments/unknown events are ignored, partial frames never count as completion. */
export async function* readChatEvents(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ChatStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let frame = "";
  function decodeFrame(value: string) {
    let name = "message";
    const data: string[] = [];
    for (const line of value.split("\n")) {
      if (line.startsWith("event:")) name = line.slice(6).trim();
      if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    return data.length ? parseChatEvent(name, data.join("\n")) : undefined;
  }
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // Process LF and CRLF line endings even when a chunk ends between CR and LF.
      let end: number;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).replace(/\r$/, "");
        buffer = buffer.slice(end + 1);
        if (!line) {
          const event = decodeFrame(frame);
          frame = "";
          if (event) yield event;
        } else frame += line + "\n";
        if (frame.length > 1_048_576) throw new Error("服务返回的事件过大。");
      }
      if (buffer.length > 1_048_576) throw new Error("服务返回的事件过大。");
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export interface ChatStreamState {
  text: string;
  status:
    "retrieving" | "generating" | "complete" | "interrupted" | "unavailable";
  citations: { source_id: string; version_id: string }[];
  warnings: string[];
  traceId: string;
  lastSequence: number;
  messageId?: string;
}
export const initialChatState = (): ChatStreamState => ({
  text: "",
  status: "retrieving",
  citations: [],
  warnings: [],
  traceId: "",
  lastSequence: -1,
});
export function applyChatEvent(
  state: ChatStreamState,
  event: ChatStreamEvent,
): ChatStreamState {
  if (["complete", "interrupted", "unavailable"].includes(state.status))
    return state;
  switch (event.event) {
    case "retrieval.started":
      return { ...state, traceId: event.data.trace_id };
    case "retrieval.completed":
      return {
        ...state,
        status: "generating",
        warnings: [...state.warnings, ...event.data.warnings],
      };
    case "retrieval.degraded":
      return {
        ...state,
        warnings: [
          ...state.warnings,
          "部分检索路径不可用，使用可用证据继续回答。",
        ],
      };
    case "message.delta":
      if (event.data.seq <= state.lastSequence) return state;
      if (state.lastSequence >= 0 && event.data.seq !== state.lastSequence + 1)
        return {
          ...state,
          status: "interrupted",
          warnings: [...state.warnings, "回答片段不连续，请重新生成。"],
        };
      return {
        ...state,
        status: "generating",
        text: state.text + event.data.text,
        lastSequence: event.data.seq,
      };
    case "message.citations":
      return {
        ...state,
        citations: Array.from(
          new Map(
            event.data.citations.map((item) => [
              item.version_id + ":" + item.source_id,
              item,
            ]),
          ).values(),
        ),
      };
    case "message.completed":
      return {
        ...state,
        status: "complete",
        messageId: event.data.message_id,
        traceId: event.data.trace_id,
      };
    case "message.error":
      return {
        ...state,
        status: state.text ? "interrupted" : "unavailable",
        traceId: event.data.trace_id,
      };
  }
}
export function finishChatStream(state: ChatStreamState): ChatStreamState {
  return state.status === "complete"
    ? state
    : { ...state, status: state.text ? "interrupted" : "unavailable" };
}
