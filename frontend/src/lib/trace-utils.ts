import { TraceSpan } from "@/lib/types";

// ===== 类型标签 =====
export const KIND_LABEL: Record<string, string> = {
  run: "本轮提问",
  graph: "智能体",
  node: "阶段",
  llm: "模型",
  tool: "工具",
};

// 徽章配色：一眼区分「模型调用 / 工具调用 / 阶段」
export const KIND_BADGE: Record<string, string> = {
  run: "bg-ink-800 text-surface-000",
  graph: "bg-surface-200 text-ink-600",
  node: "bg-go-soft text-go",
  llm: "bg-signal-soft text-signal-lo",
  tool: "bg-warn-soft text-warn",
};

// 中间件钩子不是业务阶段，单独标成"步骤"并淡化，避免和 model/tools 节点混淆
const MIDDLEWARE_RE = /Middleware\.|RunnableSequence|Pregel|LangGraph$/;

// 工具名 → 来源提示。ERP 业务接口走 MCP，其余是框架内置工具。
const ERP_TOOL_PATTERN =
  /^(supplier_|part_|inventory_|order_|purchase_|bom_|price_|request_order|generate_chart)/;

export function toolSource(name: string): string | null {
  if (name.startsWith("mcp_browser_")) return "网页采集";
  if (ERP_TOOL_PATTERN.test(name)) return "ERP 接口";
  if (name === "task") return "子智能体";
  if (name === "write_todos") return "计划";
  if (name === "execute") return "沙箱";
  return null;
}

// webintel-mcp 的采集指标。result_preview 会被后端裁到 500 字符，
// 故用正则从（可能被截断的）JSON 前缀里取值，而不是 JSON.parse。
const ELAPSED_RE = /"elapsed_ms"\s*:\s*(\d+)/;
const CHARS_RE = /"extracted_chars"\s*:\s*(\d+)/;
const ROWS_RE = /"row_counts"\s*:\s*\[([0-9,\s]*)\]/;

export interface BrowserMetrics {
  elapsedMs?: number;
  chars?: number;
  rows?: number[];
}

export function browserMetrics(s: TraceSpan): BrowserMetrics | null {
  if (s.kind !== "tool" || !s.name.startsWith("mcp_browser_") || !s.result_preview) {
    return null;
  }
  const preview = s.result_preview;
  const elapsed = ELAPSED_RE.exec(preview);
  const chars = CHARS_RE.exec(preview);
  const rows = ROWS_RE.exec(preview);
  const metrics: BrowserMetrics = {};
  if (elapsed) metrics.elapsedMs = Number(elapsed[1]);
  if (chars) metrics.chars = Number(chars[1]);
  if (rows) {
    metrics.rows = rows[1]
      .split(",")
      .map((v) => Number(v.trim()))
      .filter((v) => !Number.isNaN(v));
  }
  return Object.keys(metrics).length > 0 ? metrics : null;
}

export function isStep(s: TraceSpan): boolean {
  return s.kind === "node" && MIDDLEWARE_RE.test(s.name);
}

export function badgeLabel(s: TraceSpan): string {
  if (isStep(s)) return "步骤";
  return KIND_LABEL[s.kind] ?? s.kind;
}

export function badgeClass(s: TraceSpan): string {
  if (isStep(s)) return "bg-surface-100 text-ink-400";
  return KIND_BADGE[s.kind] ?? "bg-surface-100 text-ink-500";
}

export function fmtDuration(ms: number | null): string {
  if (ms === null) return "…";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

export function fmtTokens(n: number): string {
  return n > 0 ? n.toLocaleString() : "—";
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

/** 时间轴 / 泳道条的颜色。step 走线色，其余按 kind 上色。 */
export function barClass(s: { kind: string; status?: string }): string {
  if (s.status === "error") return "bg-stop";
  if (s.status === "interrupted") return "bg-warn";
  if (s.status === "running") return "bg-signal animate-pulse";
  if (s.kind === "llm") return "bg-signal";
  if (s.kind === "tool") return "bg-warn";
  if (s.kind === "node") return "bg-go";
  return "bg-line-400";
}

export function nameOf(s: TraceSpan): string {
  const prefix = s.agent && s.agent !== "main" ? `${s.agent} · ` : "";
  if (s.kind === "llm") return `${prefix}${s.model || s.name}`;
  if (s.kind === "graph") {
    // 框架不给图 run 起名，回调侧回落成 "chain"
    if (s.name && !/^(chain|LangGraph|Pregel)$/i.test(s.name)) return prefix + s.name;
    return prefix + "智能体图";
  }
  return prefix + s.name;
}

// ===== 类型过滤 =====
export type KindFilter = "all" | "llm" | "tool" | "node" | "step";

export const FILTER_LABEL: Record<KindFilter, string> = {
  all: "全部",
  llm: "模型",
  tool: "工具",
  node: "阶段",
  step: "步骤",
};

export function matchesFilter(s: TraceSpan, f: KindFilter): boolean {
  if (f === "all") return true;
  if (f === "step") return isStep(s);
  if (f === "node") return s.kind === "node" && !isStep(s);
  return s.kind === f;
}

// ===== 时间轴泳道 =====
/** 0=模型/消息，1=阶段，2=工具（对标 dsh 的 laneFor） */
export function laneFor(kind: string): number {
  if (kind === "tool") return 2;
  if (kind === "node" || kind === "graph" || kind === "run") return 1;
  return 0;
}

export const LANE_LABEL = ["模型", "阶段", "工具"];

// ===== 分组摘要：某 span 直接子项里的工具直方图 =====
export function toolHistogram(s: TraceSpan, all: TraceSpan[]): string[] {
  const counts = new Map<string, number>();
  for (const c of all) {
    if (c.parent_id !== s.span_id || c.kind !== "tool") continue;
    counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
  }
  const out: string[] = [];
  for (const [name, n] of counts) out.push(n > 1 ? `${name}×${n}` : name);
  return out;
}

// ===== 搜索：拼接可检索文本 =====
export function haystack(s: TraceSpan): string {
  return [s.name, s.agent, s.model, s.node, s.error, s.args_preview, s.result_preview]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}
