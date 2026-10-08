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
  // 后端 chat.py 发的是扁平 JSON：hitl_approval 的 tool_name/tool_args/order_data
  // 与 order_info_supplement 的 missing_fields/message/extracted_data 均在顶层
  tool_name?: string;
  tool_args?: Record<string, unknown>;
  order_data?: Record<string, unknown>;
  missing_fields?: string[];
  message?: string;
  extracted_data?: Record<string, unknown>;
  // LangGraph Interrupt.id：并发子 Agent 产生多个 pending interrupt 时，
  // 恢复必须用 {interrupt_id: resume_value} 映射，见 useChat.ts resumeApproval
  interrupt_id?: string;
  data?: InterruptData;
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

// 思考型模型的推理链（reasoning_content），仅展示、不落库
export interface SSEReasoningEvent {
  type: "reasoning";
  content: string;
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

// 评审器（RubricMiddleware）结构化判定，后端 chat.py custom 流发出
export interface SSEReviewResultEvent {
  type: "review_result";
  verdict: string;
  explanation: string;
  criteria: { criterion?: string; description?: string; passed?: boolean; status?: string; explanation?: string }[];
  iteration: number;
}

// T9 确定性审计未过 → 系统触发返工（后端注入返工指令并重跑 astream 前发出）
export interface SSEReworkEvent {
  type: "rework";
  round: number;
  missing: string[];
  risk_missing: boolean;
  chart_missing: string[];
}

// ===== 执行链路 Trace =====
export interface TraceSpan {
  span_id: string;
  parent_id: string | null;
  kind: "run" | "graph" | "node" | "llm" | "tool" | "review";
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

// 静默心跳：父流长时间无事件（典型：子智能体正在跑）时后端每 3s 发一次
export interface SSEProgressEvent {
  type: "progress";
  elapsed_ms: number;
  note: string;
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
  | SSEReasoningEvent
  | SSETodoUpdateEvent
  | SSEPhaseEvent
  | SSEReviewResultEvent
  | SSEReworkEvent
  | SSETraceEvent
  | SSETraceEndEvent
  | SSEProgressEvent;

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
  // 思考型模型的推理链，流式期累积、仅展示，不参与正文与落库
  reasoning?: string;
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
  // 后端 src/agent/schema.py ResumeRequest 的字段名是 "resume"，
  // 曾经误写成 resume_data 导致 422（审批点批准后流程静默卡死）
  resume: Record<string, unknown>;
}

// ===== 功能条目 =====
// icon 为自绘线性图标的 key，不再使用 emoji
export interface CapabilityCard {
  icon: "analysis" | "order" | "inventory" | "parts" | "release" | "sentiment";
  title: string;
  description: string;
  prompt: string;
}

// ===== 用户画像 =====
export interface UserProfile {
  user_id: string;
  content: string;
  quick_report_prompt: string;
}
