import { NextRequest } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function error(message: string, status: number) {
  return Response.json(
    { error: { code: "LOCAL_API_UNAVAILABLE", message } },
    { status },
  );
}

async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const host = request.headers.get("host") ?? "";
  const hostname = host.split(":")[0];
  const origin = request.headers.get("origin");
  if (
    !["localhost", "127.0.0.1"].includes(hostname) ||
    (origin && new URL(origin).host !== host) ||
    request.headers.get("sec-fetch-site") === "cross-site"
  ) {
    return error("此本地工作台不接受外部站点的请求。", 403);
  }
  const { path } = await context.params;
  if (
    !path.length ||
    path.some((part) => part === "." || part === ".." || /[\\/?#]/.test(part))
  )
    return error("无效路径。", 400);
  if (
    ![
      "workspace",
      "conversations",
      "settings",
      "memory",
      "messages",
      "evidence",
      "agent",
      "health",
      "temporary",
    ].includes(path[0])
  )
    return error("接口不存在。", 404);
  const headers = new Headers();
  for (const name of ["Content-Type", "Accept", "Idempotency-Key"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Authorization", `Bearer ${process.env.AGENT_API_TOKEN ?? ""}`);
  let body: Uint8Array | undefined;
  if (request.body && request.method !== "GET") {
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > 21 * 1024 * 1024) {
        await reader.cancel();
        return error("文件不能超过 20 MB。", 413);
      }
      chunks.push(next.value);
    }
    body = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.length;
    }
  }
  try {
    const base = process.env.AGENT_API_URL ?? "http://127.0.0.1:8000/api/v1";
    const target = `${base.replace(/\/$/, "")}/${path.map(encodeURIComponent).join("/")}${request.nextUrl.search}`;
    const response = await fetch(target, {
      method: request.method,
      headers,
      body: body as BodyInit | undefined,
      cache: "no-store",
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(150000)]),
      redirect: "error",
    });
    return new Response(response.body, {
      status: response.status,
      headers: {
        "Content-Type":
          response.headers.get("Content-Type") ?? "application/json",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch {
    return error(
      "后端尚未启动。请先运行 scripts/start-api.ps1，再检查数据库与百炼配置。",
      503,
    );
  }
}

export { proxy as GET, proxy as POST, proxy as PATCH, proxy as DELETE };
