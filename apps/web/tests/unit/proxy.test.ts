import { afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, POST } from "../../src/app/api/agent/[...path]/route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
it("rejects cross-origin writes before contacting the backend", async () => {
  const fetch = vi.fn();
  vi.stubGlobal("fetch", fetch);
  const request = new NextRequest(
    "http://127.0.0.1:3000/api/agent/agent/runs",
    {
      method: "POST",
      headers: { Host: "127.0.0.1:3000", Origin: "https://untrusted.example" },
      body: "{}",
    },
  );
  expect(
    (
      await POST(request, {
        params: Promise.resolve({ path: ["agent", "runs"] }),
      })
    ).status,
  ).toBe(403);
  expect(fetch).not.toHaveBeenCalled();
});
it("injects server token without exposing it or forwarding browser credentials", async () => {
  vi.stubEnv("AGENT_API_TOKEN", "test-server-only");
  const fetch = vi.fn().mockResolvedValue(Response.json({ database: false }));
  vi.stubGlobal("fetch", fetch);
  const request = new NextRequest(
    "http://127.0.0.1:3000/api/agent/health/ready",
    {
      headers: {
        Host: "127.0.0.1:3000",
        Authorization: "untrusted-client-value",
      },
    },
  );
  const response = await GET(request, {
    params: Promise.resolve({ path: ["health", "ready"] }),
  });
  expect(fetch.mock.calls[0][1].headers.get("Authorization")).toBe(
    "Bearer test-server-only",
  );
  expect(await response.text()).not.toContain("test-server-only");
  expect(response.headers.has("Authorization")).toBe(false);
});
