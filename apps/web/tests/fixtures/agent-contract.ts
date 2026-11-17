import type { Page } from "@playwright/test";
import type { Conversation } from "../../src/types/memory";

/** HTTP fixtures only. This file is never imported by the application. */
export async function installAgentContract(page: Page) {
  const conversation: Conversation = {
    id: "conversation-1",
    title: "接口契约测试",
    updatedAt: "2026-10-26T08:00:00Z",
    messages: [],
  };
  const state = {
    enabled: true,
    consentOn: true,
    policyFailure: false,
    runs: 0,
    polls: 0,
    files: [] as { id: string; name: string; status: string }[],
    lastInput: undefined as
      { text: string; memory_policy_override: string } | undefined,
  };
  await page.route("**/api/agent-v2/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/settings/response"))
      return route.fulfill({
        json: {
          revision: 1,
          options: {
            mode: "auto",
            memory_budget_tokens: null,
            retrieval_rounds: null,
            history_scope: "recent",
          },
          limits: { memory_budget_max: 6400, retrieval_rounds_max: 3 },
        },
      });
    if (path.endsWith("/memory-policy")) {
      if (route.request().method() === "PATCH") {
        if (state.policyFailure)
          return route.fulfill({
            status: 503,
            json: { error: { message: "设置保存失败，请重试。" } },
          });
        state.consentOn = route.request().postDataJSON().mode === "on";
      }
      return route.fulfill({
        json: { mode: state.consentOn ? "on" : "off", revision: 1 },
      });
    }
    return route.fulfill({ json: { items: [] } });
  });
  await page.route("**/api/agent/**", async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname.replace("/api/agent", ""),
      method = request.method();
    const send = (json: unknown, status = 200) =>
      route.fulfill({ status, json });
    if (path === "/workspace") return send({ conversations: [conversation] });
    if (path === "/settings/memory") {
      if (method === "PATCH") {
        if (state.policyFailure)
          return send({ error: { message: "设置保存失败，请重试。" } }, 503);
        state.enabled = request.postDataJSON().enabled;
      }
      return send({ enabled: state.enabled });
    }
    if (path.endsWith("/files")) {
      if (method === "POST") {
        const file = { id: "file-1", name: "project.md", status: "READY" };
        state.files.push(file);
        return send(file, 201);
      }
      return send(state.files);
    }
    if (path.endsWith("/insights"))
      return send({
        core: [],
        jobs_pending: 0,
        summary: state.runs
          ? { text: "优先保留已确认约束。", message_ids: ["user-first"] }
          : null,
        last_run: state.runs
          ? {
              id: "run-1",
              status: "SUCCEEDED",
              events: [
                { name: "search_files", status: "SUCCEEDED", elapsed: 0.2 },
              ],
              usage: [
                { model: "test-provider", provider_request_id: "test-only" },
              ],
              warnings: [],
            }
          : null,
      });
    if (path === "/conversations/conversation-1") return send(conversation);
    if (path === "/agent/runs" && method === "POST") {
      state.runs++;
      state.lastInput = request.postDataJSON();
      state.polls = 0;
      conversation.messages.push({
        id: "user-first",
        role: "user",
        text: state.lastInput!.text,
        createdAt: "2026-10-26T08:00:00Z",
      });
      return send({ run_id: "run-1" }, 202);
    }
    if (path === "/agent/runs/run-1") {
      state.polls++;
      if (state.polls < 3)
        return send({
          id: "run-1",
          status: "RUNNING",
          stage: "tool",
          active_tool: "search_files",
          events: [],
        });
      if (conversation.messages.length === 1)
        conversation.messages.push({
          id: "answer-1",
          role: "assistant",
          text: "根据文件，项目采用 PostgreSQL。",
          createdAt: "2026-10-26T08:00:01Z",
          citations: ["file:chunk-1"],
          answer: { status: "complete", warnings: [], traceId: "run-1" },
        });
      return send({
        id: "run-1",
        status: "SUCCEEDED",
        stage: "complete",
        events: [],
      });
    }
    if (decodeURIComponent(path) === "/evidence/file:chunk-1")
      return send({
        id: "file:chunk-1",
        title: "project.md · 第 1 段",
        origin: "file",
        kind: "source",
        text: "项目采用 PostgreSQL。",
        status: "current",
        version: 1,
        createdAt: "2026-10-26T08:00:00Z",
      });
    if (path === "/temporary/messages")
      return send({ text: "这条回答仅用于临时契约测试。", sources: [] });
    return send(
      { error: { message: `Unhandled test contract: ${method} ${path}` } },
      404,
    );
  });
  return { state };
}
