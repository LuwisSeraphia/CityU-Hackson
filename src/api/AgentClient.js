export class ApiError extends Error {
  constructor(code, message, status = 0) { super(message); this.code = code; this.status = status; }
}
const terminal = value => ['SUCCEEDED', 'FAILED', 'CANCELLED'].includes(value?.status);
export async function readRunStream(body, onStatus) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, '\n');
      let end;
      while ((end = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
        const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!data) continue;
        let status;
        try { status = JSON.parse(data); } catch { throw new ApiError('STREAM_INVALID', '后端运行状态格式无效，请重新连接。'); }
        if (!status.id || !['RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED'].includes(status.status)) throw new ApiError('STREAM_INVALID', '后端运行状态不完整。');
        onStatus(status);
        if (terminal(status)) return status;
      }
      if (done) throw new ApiError('STREAM_INTERRUPTED', '状态连接已中断，请恢复连接；不要重复发送消息。');
    }
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export class AgentClient {
  constructor(fetcher = globalThis.fetch.bind(globalThis), base = '/api/v1') { this.fetcher = fetcher; this.base = base; }
  async request(path, { signal, raw = false, ...options } = {}) {
    const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(raw ? 130000 : 15000)]);
    let response;
    try {
      response = await this.fetcher(this.base + path, { ...options, signal: combined, credentials: 'same-origin', headers: { ...(options.body && !(options.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}), ...options.headers } });
      if (raw && response.ok) return response;
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new ApiError(data?.error?.code || 'BACKEND_UNAVAILABLE', data?.error?.message || '后端尚未就绪，请启动服务后重新连接。', response.status);
      if (!data || typeof data !== 'object') throw new ApiError('INVALID_RESPONSE', '后端响应格式无效。');
      return data;
    } catch (error) {
      if (signal?.aborted) throw new DOMException('请求已停止', 'AbortError');
      if (error instanceof ApiError) throw error;
      throw new ApiError(error.name === 'TimeoutError' ? 'REQUEST_TIMEOUT' : 'NETWORK_ERROR', error.name === 'TimeoutError' ? '请求超时，请重新连接确认运行状态。' : '无法连接后端，请检查服务是否已启动。');
    }
  }
  health() { return this.request('/health/ready'); }
  workspace() { return this.request('/workspace'); }
  conversation(id) { return this.request('/conversations/' + encodeURIComponent(id)); }
  create(id) { return this.request('/conversations', { method: 'POST', body: JSON.stringify({ request_id: id }) }); }
  start(body) { return this.request('/agent/runs', { method: 'POST', body: JSON.stringify(body) }); }
  cancel(id) { return this.request(`/agent/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }); }
  async watch(id, onStatus, signal) {
    const response = await this.request(`/agent/runs/${encodeURIComponent(id)}/events`, { raw: true, signal });
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new ApiError('STREAM_INVALID', '后端未返回运行状态流。');
    return readRunStream(response.body, status => {
      if (status.id !== id) throw new ApiError('RUN_MISMATCH', '运行状态不属于当前请求。');
      onStatus(status);
    });
  }
  async uploadContext(id, text) {
    const body = new FormData(); body.append('file', new Blob([text], { type: 'text/markdown' }), 'knowledge-context.md');
    return this.request(`/conversations/${encodeURIComponent(id)}/files`, { method: 'POST', body });
  }
  evidence(id) { return this.request('/evidence/' + encodeURIComponent(id)); }
}
