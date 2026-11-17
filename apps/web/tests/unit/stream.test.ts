import { describe, expect, it, vi, afterEach } from "vitest";
import { ApiClient } from "@/lib/api/client";
import {
  applyChatEvent,
  finishChatStream,
  initialChatState,
  readChatEvents,
  parseChatEvent,
} from "@/lib/api/sse";
afterEach(() => vi.unstubAllGlobals());
const encode = (name: string, data: unknown) =>
  `event: ${name}\r\ndata: ${JSON.stringify(data)}\r\n\r\n`;
function chunks(text: string, size = 1) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size)
        controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  });
}
describe("SSE contract", () => {
  it("decodes Chinese across byte chunks, ignores heartbeats and requires completion", async () => {
    let state = initialChatState();
    const stream =
      ": heartbeat\r\n\r\n" +
      encode("future.event", {}) +
      encode("retrieval.started", { conversation_id: "c", trace_id: "t" }) +
      encode("message.delta", { seq: 1, text: "你好，记忆。" }) +
      encode("message.completed", { message_id: "m", trace_id: "t" });
    for await (const event of readChatEvents(chunks(stream)))
      state = applyChatEvent(state, event);
    expect(finishChatStream(state)).toMatchObject({
      text: "你好，记忆。",
      status: "complete",
      messageId: "m",
      traceId: "t",
    });
  });
  it("never treats truncated frames or lost sequence chunks as completed", async () => {
    let state = initialChatState();
    for await (const event of readChatEvents(
      chunks(
        encode("message.delta", { seq: 1, text: "一半" }) +
          'event: message.completed\ndata: {"message_id":',
      ),
    ))
      state = applyChatEvent(state, event);
    expect(finishChatStream(state).status).toBe("interrupted");
    expect(
      applyChatEvent(state, {
        event: "message.delta",
        data: { seq: 1, text: "重复" },
      }).text,
    ).toBe("一半");
    const gap = applyChatEvent(state, {
      event: "message.delta",
      data: { seq: 3, text: "缺一段" },
    });
    expect(gap.status).toBe("interrupted");
    expect(
      applyChatEvent(gap, {
        event: "message.completed",
        data: { message_id: "m", trace_id: "t" },
      }).status,
    ).toBe("interrupted");
  });
  it("rejects malformed known events and invalid payloads", () => {
    expect(() => parseChatEvent("message.delta", "bad json")).toThrow(
      "无法解析",
    );
    expect(() =>
      parseChatEvent("message.delta", '{"seq":"1","text":"x"}'),
    ).toThrow("字段不完整");
    expect(() =>
      parseChatEvent("message.citations", '{"citations":[null]}'),
    ).toThrow("字段不完整");
    expect(finishChatStream(initialChatState()).status).toBe("unavailable");
  });
  it("preserves degraded warnings and deduplicates citations", () => {
    let state = applyChatEvent(initialChatState(), {
      event: "retrieval.degraded",
      data: { reason_code: "RERANK_TIMEOUT", available_channels: ["keyword"] },
    });
    state = applyChatEvent(state, {
      event: "retrieval.completed",
      data: { evidence_count: 1, warnings: [] },
    });
    state = applyChatEvent(state, {
      event: "message.citations",
      data: {
        citations: [
          { source_id: "s", version_id: "v" },
          { source_id: "s", version_id: "v" },
        ],
      },
    });
    expect(state.warnings).toHaveLength(1);
    expect(state.citations).toHaveLength(1);
  });
  it("sends POST with request identity and propagates cancellation without a mock fallback", async () => {
    const controller = new AbortController();
    const fetcher = vi
      .fn()
      .mockResolvedValue(
        new Response(
          chunks(
            encode("message.completed", { message_id: "m", trace_id: "t" }),
          ),
          { headers: { "Content-Type": "text/event-stream" } },
        ),
      );
    vi.stubGlobal("fetch", fetcher);
    const events = [];
    for await (const event of new ApiClient("http://example.test/api/v1").chat(
      {
        conversation_id: "c",
        text: "最近记录了什么？",
        request_id: "r",
        retry_message_id: "m",
      },
      controller.signal,
    ))
      events.push(event);
    expect(events).toHaveLength(1);
    expect(fetcher).toHaveBeenCalledWith(
      "http://example.test/api/v1/chat/messages",
      expect.objectContaining({
        method: "POST",
        signal: controller.signal,
        headers: expect.objectContaining({ "Idempotency-Key": "r" }),
      }),
    );
    fetcher.mockRejectedValue(new DOMException("Aborted", "AbortError"));
    await expect(
      new ApiClient()
        .chat({ conversation_id: "c", text: "问", request_id: "r" })
        .next(),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});
