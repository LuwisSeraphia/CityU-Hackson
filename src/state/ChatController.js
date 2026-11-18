import { AgentClient, ApiError } from '../api/AgentClient.js';
export class ChatController {
  constructor(conversations, { client = new AgentClient(), onChange = () => {}, onTask = () => {} } = {}) {
    Object.assign(this, { conversations, client, onChange, onTask, health: null, error: '', busy: false, loading: false, stage: '', runSession: null, disposed: false });
  }
  get ready() { const h = this.health; return !!(h?.database && h.api_token_configured && (h.mode === 'local_demo' || h.model_configured) && (!h.worker_required || h.worker)); }
  emit() { if (!this.disposed) this.onChange(); }
  async connect() {
    if (this.loading || this.disposed) return;
    this.loading = true; this.error = ''; this.emit();
    try {
      this.health = await this.client.health();
      if (!this.ready) throw new ApiError('NOT_READY', this.health.message || '后端尚未就绪，请检查数据库、模型和后台任务配置。');
      const data = await this.client.workspace();
      if (!Array.isArray(data.conversations)) throw new ApiError('INVALID_RESPONSE', '后端会话列表格式无效。');
      for (const remote of data.conversations) this.conversations.upsertRemote(remote);
    } catch (error) { this.health = null; this.error = error.message; }
    finally { this.loading = false; this.emit(); }
  }
  async activate(session) {
    if (!session?.backendId || this.busy) return;
    if (session.pendingRunId) return this.resume(session);
    try { this.conversations.upsertRemote(await this.client.conversation(session.backendId), session.agentId, session.id); }
    catch (error) { this.error = error.message; this.emit(); }
  }
  async send(text, { context = '', retryMessageId } = {}) {
    const session = this.conversations.active;
    text = text.trim();
    if (!session || !text || this.busy) return;
    if (session.pendingRunId) { this.error = '这次回答尚未确认结束，请先恢复连接或停止回答。'; this.emit(); return; }
    if (!session.backendId && session.messages.length) { this.error = '这是旧版本地演示记录，请新建对话使用后端。'; this.emit(); return; }
    this.busy = true; this.runSession = session; this.error = ''; this.stage = 'connecting'; this.emit();
    try {
      if (!this.ready) {
        await this.connect();
        if (!this.ready) throw new ApiError('NOT_READY', this.error || '后端未就绪。');
      }
      if (!session.backendId) this.conversations.upsertRemote(await this.client.create(session.id), session.agentId, session.id);
      // Persist the exact payload before sending: ambiguous network failures must reuse its key.
      if (!session.pendingRequest || session.pendingRequest.text !== text || session.pendingRequest.retry !== retryMessageId) {
        session.pendingRequest = { id: crypto.randomUUID(), text, context, retry: retryMessageId, fileIds: [] };
        this.conversations.save();
      }
      const request = session.pendingRequest;
      if (request.context && !request.fileIds.length) {
        const file = await this.client.uploadContext(session.backendId, request.context);
        request.fileIds = [file.id]; this.conversations.save();
      }
      const result = await this.client.start({ conversation_id: session.backendId, text: request.text, request_id: request.id, file_ids: request.fileIds, memory_policy_override: 'skip', ...(request.retry ? { retry_message_id: request.retry } : {}) });
      if (typeof result.run_id !== 'string') throw new ApiError('INVALID_RESPONSE', '后端没有返回运行编号，请重试确认。');
      session.pendingRunId = result.run_id; session.draft = ''; this.conversations.save();
      this.onTask({ agentId: session.agentId, text, status: 'RUNNING', runId: result.run_id });
      this.conversations.upsertRemote(await this.client.conversation(session.backendId), session.agentId, session.id);
      await this.follow(session);
    } catch (error) { if (error.name !== 'AbortError') this.error = error.message; }
    finally { this.busy = false; this.stage = ''; this.emit(); }
  }
  async follow(session) {
    this.abort?.abort(); this.abort = new AbortController();
    const result = await this.client.watch(session.pendingRunId, status => { this.stage = status.stage || status.status; this.emit(); }, this.abort.signal);
    // Keep the run ID until the final history has also been fetched successfully.
    this.conversations.upsertRemote(await this.client.conversation(session.backendId), session.agentId, session.id);
    this.onTask({ agentId: session.agentId, text: session.pendingRequest?.text || '', status: result.status, runId: session.pendingRunId });
    delete session.pendingRunId; delete session.pendingRequest; this.conversations.save();
    this.error = result.status === 'FAILED' ? (result.error?.message || '回答失败，可在消息下重试。') : '';
  }
  async resume(session = this.conversations.active) {
    if (!session?.pendingRunId || this.busy) return;
    this.busy = true; this.runSession = session; this.error = ''; this.stage = 'reconnecting'; this.emit();
    try { await this.follow(session); }
    catch (error) { if (error.name !== 'AbortError') this.error = error.message; }
    finally { this.busy = false; this.stage = ''; this.emit(); }
  }
  async cancel() {
    const session = this.runSession?.pendingRunId ? this.runSession : this.conversations.active;
    if (!session?.pendingRunId || this.cancelling) return;
    this.cancelling = true; this.emit();
    try { await this.client.cancel(session.pendingRunId); if (!this.busy) await this.resume(session); }
    catch (error) { this.error = '停止请求未确认：' + error.message; }
    finally { this.cancelling = false; this.emit(); }
  }
  dispose() { this.disposed = true; this.abort?.abort(); }
}
