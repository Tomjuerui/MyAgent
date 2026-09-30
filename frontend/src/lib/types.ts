// ===== SSE 事件类型 =====
export interface SSETokenEvent {
  type: "token";
  content: string;
  source: "main" | "analyst" | "order";
}

export interface SSEToolStartEvent {
  type: "tool_start";
  name: string;
  id: string;
}

export interface SSEToolArgsEvent {
  type: "tool_args";
  args: string;
}

export interface SSEToolResultEvent {
  type: "tool_result";
  name: string;
  content: string;
}

export interface SSEToolEndEvent {
  type: "tool_end";
  id: string;
}

export interface SSEInterruptEvent {
  type: "interrupt";
  interrupt_type: "hitl_approval" | "order_info_supplement";
  data: InterruptData;
}

export interface SSEDoneEvent {
  type: "done";
  thread_id: string;
  interrupted: boolean;
}

export interface SSEThinkingEvent {
  type: "thinking";
  status: "start" | "end";
}

export interface SSETodoUpdateEvent {
  type: "todo_update";
  phase?: string;
  todos?: { id: string; content: string; status: string }[];
  status_change?: string;
  // legacy fields
  tool?: string;
  args?: string;
  result?: string;
}

export interface SSEPhaseEvent {
  type: "phase";
  phase: "thinking" | "planning" | "executing" | "reviewing" | "done";
  label: string;
}

// ===== 执行链路 Trace =====
export interface TraceSpan {
  span_id: string;
  parent_id: string | null;
  kind: "run" | "graph" | "node" | "llm" | "tool";
  name: string;
  start_ms: number;
  end_ms: number | null;
  duration_ms: number | null;
  status: "running" | "ok" | "error" | "interrupted";
  node: string | null;
  agent: string;
  model: string | null;
  tokens_in: number;
  tokens_out: number;
  tokens_total: number;
  subtree_in: number;
  subtree_out: number;
  subtree_total: number;
  error: string | null;
  args_preview: string | null;
  result_preview: string | null;
  depth: number;
  seq: number;
}

export interface TraceStats {
  status: string;
  duration_ms: number;
  span_count: number;
  llm_calls: number;
  tool_calls: number;
  error_count: number;
  interrupted_count: number;
  missing_usage: number;
  tokens_in: number;
  tokens_out: number;
  tokens_total: number;
  max_depth: number;
}

export interface SSETraceEvent {
  type: "trace";
  op: "start" | "end";
  span: TraceSpan;
}

export interface SSETraceEndEvent {
  type: "trace_end";
  run_id: string;
  stats: TraceStats;
}

export interface TraceRun {
  thread_id: string;
  run_id: string;
  started_at: string;
  ended_at: string;
  status: string;
  spans: TraceSpan[];
  stats: TraceStats | null;
}

// /trace/runs 返回的轻量条目（不含 spans）
export interface TraceRunSummary {
  run_id: string;
  started_at: string;
  ended_at: string;
  status: string;
  stats: TraceStats | null;
}

export type SSEEvent =
  | SSETokenEvent
  | SSEToolStartEvent
  | SSEToolArgsEvent
  | SSEToolResultEvent
  | SSEToolEndEvent
  | SSEInterruptEvent
  | SSEDoneEvent
  | SSEThinkingEvent
  | SSETodoUpdateEvent
  | SSEPhaseEvent
  | SSETraceEvent
  | SSETraceEndEvent;

// ===== 中断数据 =====
export interface InterruptData {
  interrupt_type: string;
  // order_info_supplement
  extracted_data?: Record<string, unknown>;
  missing_fields?: string[];
  message?: string;
  // hitl_approval
  order_data?: Record<string, unknown>;
  tool_name?: string;
  tool_args?: Record<string, unknown>;
}

// ===== 消息类型 =====
export interface ToolCallInfo {
  id: string;
  name: string;
  args: string;
  result?: string;
  status: "running" | "done" | "error";
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  source?: string;
  toolCalls?: ToolCallInfo[];
  timestamp: number;
}

// ===== TODO 任务列表 =====
export interface TodoItem {
  id: string;
  content: string;
  status: "pending" | "in_progress" | "complete" | "cancelled";
}

export interface TodoState {
  items: TodoItem[];
  visible: boolean;
}

// ===== 会话历史 =====
export interface Conversation {
  thread_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

// ===== 请求/响应 =====
export interface ChatRequest {
  message: string;
  thread_id: string;
  user_id: string;
  username: string;
}

export interface ResumeRequest {
  thread_id: string;
  resume_data: Record<string, unknown>;
}

// ===== 功能条目 =====
// icon 为自绘线性图标的 key，不再使用 emoji
export interface CapabilityCard {
  icon: "analysis" | "order" | "inventory" | "parts";
  title: string;
  description: string;
  prompt: string;
}
