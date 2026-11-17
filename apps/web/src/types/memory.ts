export type InputMode = "ask" | "record";
export type ReceiptKind =
  "added" | "merged" | "pending" | "failed" | "partial" | "noop";
export type ProposalStatus =
  "pending" | "approved" | "rejected" | "stale" | "expired";
export type OperationStage =
  | "received"
  | "extracting"
  | "resolving"
  | "indexing"
  | "retrieving"
  | "generating";
export interface OperationProgress {
  stage: OperationStage;
  conversationId: string;
  text?: string;
}
export interface RecordProcessing {
  sourceStatus: "RECEIVED" | "COMMITTED" | "FAILED";
  indexStatus: "NOT_STARTED" | "READY" | "FAILED";
  traceId: string;
  addedEpisodes: number;
  addedFacts: number;
  pending: number;
  failed: number;
}
export interface SourceRecord {
  id: string;
  text: string;
  createdAt: string;
}
export interface MemoryPage {
  items: Evidence[];
  total: number;
}
export interface MemoryQuery {
  query: string;
  kind: "all" | "fact" | "episode" | "source";
  page: number;
}
export interface FactRevisionInput {
  factId: string;
  baseVersionId: string;
  text: string;
}
export interface FactDeleteInput {
  factId: string;
  baseVersionId: string;
}
export interface ProposalEditInput {
  conversationId: string;
  messageId: string;
  text: string;
}
export interface AnswerState {
  status:
    "complete" | "partial" | "insufficient" | "interrupted" | "unavailable";
  warnings: string[];
  traceId: string;
  retryText?: string;
}
export interface Evidence {
  origin?: "web" | "file";
  url?: string;
  id: string;
  title: string;
  text: string;
  createdAt: string;
  kind: "episode" | "fact" | "source";
  version: number;
  status:
    "current" | "pending" | "historical" | "corrected" | "planned" | "deleted" | "rejected";
  eventTime?: string | null;
  factId?: string;
  sourceIds?: string[];
  originalRecords?: SourceRecord[];
  versions?: Evidence[];
}
export interface Proposal {
  id: string;
  baseVersionId: string;
  before: string;
  after: string;
  status: ProposalStatus;
  reason?: string;
  createdAt?: string;
  eventTime?: string | null;
  factId?: string;
}
export interface MemoryReceipt {
  kind: ReceiptKind;
  summary: string;
  sourceIds: string[];
  proposal?: Proposal;
  retryText?: string;
  processing?: RecordProcessing;
  originalSourceId?: string;
}
export interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  mode?: InputMode;
  citations?: string[];
  receipt?: MemoryReceipt;
  answer?: AnswerState;
}
export interface Conversation {
  id: string;
  title: string;
  updatedAt: string;
  messages: Message[];
}
export interface WorkspaceSnapshot {
  conversations: Conversation[];
}
export interface SendInput {
  conversationId: string;
  text: string;
  mode: InputMode;
  requestId: string;
  retryMessageId?: string;
}
export interface ProposalInput {
  conversationId: string;
  messageId: string;
  proposalId: string;
  baseVersionId: string;
  decision: "approve" | "reject";
}
export interface MemoryGateway {
  readonly mode: "mock" | "api";
  load(): Promise<WorkspaceSnapshot>;
  createConversation(): Promise<Conversation>;
  deleteConversation(id: string): Promise<void>;
  send(
    input: SendInput,
    onProgress?: (progress: OperationProgress) => void,
  ): Promise<Conversation>;
  decide(input: ProposalInput): Promise<Conversation>;
  evidence(id: string): Promise<Evidence>;
  listMemories(query: MemoryQuery): Promise<MemoryPage>;
  reviseFact(input: FactRevisionInput): Promise<Evidence>;
  deleteFact(input: FactDeleteInput): Promise<void>;
  editProposal(input: ProposalEditInput): Promise<Conversation>;
  refreshProposal(
    conversationId: string,
    messageId: string,
  ): Promise<Conversation>;
}
