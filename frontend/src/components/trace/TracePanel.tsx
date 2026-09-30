"use client";

import { useMemo, useState } from "react";
import { TraceRunSummary, TraceSpan, TraceStats } from "@/lib/types";

interface Props {
  spans: TraceSpan[];
  stats: TraceStats | null;
  streaming: boolean;
  runs: TraceRunSummary[];
  activeRunId: string | null;
  onSelectRun: (runId: string | null) => void;
  onClose: () => void;
}

const KIND_LABEL: Record<string, string> = {
  run: "本轮提问",
  graph: "智能体",
  node: "阶段",
  llm: "模型",
  tool: "工具",
};

// 徽章配色：一眼区分「模型调用 / 工具调用 / 阶段」
const KIND_BADGE: Record<string, string> = {
  run: "bg-gray-800 text-white",
  graph: "bg-gray-200 text-gray-700",
  node: "bg-teal-100 text-teal-800",
  llm: "bg-blue-100 text-blue-800",
  tool: "bg-purple-100 text-purple-800",
};

// 中间件钩子不是业务阶段，单独标成"步骤"并淡化，避免和 model/tools 节点混淆
const MIDDLEWARE_RE = /Middleware\.|RunnableSequence|Pregel|LangGraph$/;

// 工具名 → 来源提示。ERP 业务接口走 MCP，其余是框架内置工具。
const ERP_TOOL_PATTERN =
  /^(supplier_|part_|inventory_|order_|purchase_|bom_|price_|request_order|generate_chart)/;

function toolSource(name: string): string | null {
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

interface BrowserMetrics {
  elapsedMs?: number;
  chars?: number;
  rows?: number[];
}

function browserMetrics(s: TraceSpan): BrowserMetrics | null {
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

function isStep(s: TraceSpan): boolean {
  return s.kind === "node" && MIDDLEWARE_RE.test(s.name);
}

function badgeLabel(s: TraceSpan): string {
  if (isStep(s)) return "步骤";
  return KIND_LABEL[s.kind] ?? s.kind;
}

function badgeClass(s: TraceSpan): string {
  if (isStep(s)) return "bg-gray-100 text-gray-500";
  return KIND_BADGE[s.kind] ?? "bg-gray-100 text-gray-600";
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return "…";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function fmtTokens(n: number): string {
  return n > 0 ? n.toLocaleString() : "—";
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleTimeString("zh-CN", { hour12: false });
}

function barClass(s: TraceSpan): string {
  if (s.status === "error") return "bg-red-500";
  if (s.status === "interrupted") return "bg-amber-400";
  if (s.status === "running") return "bg-blue-400 animate-pulse";
  if (s.kind === "llm") return "bg-blue-500";
  if (s.kind === "tool") return "bg-purple-500";
  if (isStep(s)) return "bg-gray-300";
  if (s.kind === "node") return "bg-teal-400";
  return "bg-gray-300";
}

function nameOf(s: TraceSpan): string {
  const prefix = s.agent && s.agent !== "main" ? `${s.agent} · ` : "";
  if (s.kind === "llm") return `${prefix}${s.model || s.name}`;
  if (s.kind === "graph") {
    // 框架不给图 run 起名，回调侧回落成 "chain"
    if (s.name && !/^(chain|LangGraph|Pregel)$/i.test(s.name)) return prefix + s.name;
    return prefix + "智能体图";
  }
  return prefix + s.name;
}

type KindFilter = "all" | "llm" | "tool" | "node" | "step";

const FILTER_LABEL: Record<KindFilter, string> = {
  all: "全部",
  llm: "模型",
  tool: "工具",
  node: "阶段",
  step: "步骤",
};

function matchesFilter(s: TraceSpan, f: KindFilter): boolean {
  if (f === "all") return true;
  if (f === "step") return isStep(s);
  if (f === "node") return s.kind === "node" && !isStep(s);
  return s.kind === f;
}

export default function TracePanel({
  spans,
  stats,
  streaming,
  runs,
  activeRunId,
  onSelectRun,
  onClose,
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");

  const sorted = useMemo(
    () => [...spans].sort((a, b) => a.start_ms - b.start_ms || a.seq - b.seq),
    [spans]
  );

  const byId = useMemo(() => new Map(sorted.map((s) => [s.span_id, s])), [sorted]);
  const hasChild = useMemo(() => {
    const set = new Set<string>();
    sorted.forEach((s) => {
      if (s.parent_id) set.add(s.parent_id);
    });
    return set;
  }, [sorted]);

  // 仅看失败：保留失败 span 及其完整祖先链，其余隐藏
  const visible = useMemo(() => {
    let list = sorted;
    if (onlyFailed) {
      const keep = new Set<string>();
      sorted
        .filter((s) => s.status === "error" || s.status === "interrupted")
        .forEach((s) => {
          let cur: string | null | undefined = s.span_id;
          while (cur) {
            if (keep.has(cur)) break;
            keep.add(cur);
            cur = byId.get(cur)?.parent_id ?? null;
          }
        });
      list = sorted.filter((s) => keep.has(s.span_id));
    } else {
      // 按类型过滤：保留命中 span 及其祖先链，维持树形缩进
      const keep = new Set<string>();
      sorted
        .filter((s) => matchesFilter(s, kindFilter))
        .forEach((s) => {
          let cur: string | null | undefined = s.span_id;
          while (cur) {
            if (keep.has(cur)) break;
            keep.add(cur);
            cur = byId.get(cur)?.parent_id ?? null;
          }
        });
      list = sorted.filter((s) => keep.has(s.span_id));
    }

    // 按折叠状态裁剪（depth 语义：被折叠节点的更深层级一并隐藏）
    const collapsedDepths: boolean[] = [];
    const out: TraceSpan[] = [];
    for (const s of list) {
      for (let k = s.depth + 1; k < collapsedDepths.length; k++) collapsedDepths[k] = false;
      let hidden = false;
      for (let d = 0; d < s.depth; d++) {
        if (collapsedDepths[d]) {
          hidden = true;
          break;
        }
      }
      if (hidden) continue;
      out.push(s);
      if (collapsed.has(s.span_id)) collapsedDepths[s.depth] = true;
    }
    return out;
  }, [sorted, onlyFailed, kindFilter, collapsed, byId]);

  const summary = useMemo(() => {
    if (sorted.length === 0) {
      return { duration: 0, tokensIn: 0, tokensOut: 0, tokens: 0, llm: 0, tool: 0, failed: 0 };
    }
    const now = Date.now();
    const start = Math.min(...sorted.map((s) => s.start_ms));
    const end = Math.max(...sorted.map((s) => s.end_ms ?? (streaming ? now : s.start_ms)));
    const body = sorted.filter((s) => s.kind !== "run");
    return {
      duration: stats?.duration_ms ?? Math.max(end - start, 0),
      tokensIn: stats?.tokens_in ?? 0,
      tokensOut: stats?.tokens_out ?? 0,
      tokens: stats?.tokens_total ?? body.filter((s) => s.kind === "llm").reduce((a, s) => a + s.tokens_total, 0),
      llm: stats?.llm_calls ?? body.filter((s) => s.kind === "llm").length,
      tool: stats?.tool_calls ?? body.filter((s) => s.kind === "tool").length,
      failed:
        stats?.error_count ??
        body.filter((s) => s.status === "error" || s.status === "interrupted").length,
    };
  }, [sorted, stats, streaming]);

  const timeline = useMemo(() => {
    if (sorted.length === 0) return { start: 0, total: 1 };
    const now = Date.now();
    const start = Math.min(...sorted.map((s) => s.start_ms));
    const end = Math.max(...sorted.map((s) => s.end_ms ?? (streaming ? now : s.start_ms)));
    return { start, total: Math.max(end - start, 1) };
  }, [sorted, streaming]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const now = Date.now();

  return (
    <aside className="fixed right-0 top-0 z-40 flex h-full w-[600px] max-w-[92vw] flex-col border-l border-gray-200 bg-white shadow-xl">
      <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-gray-900">执行链路</span>
          {streaming && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[11px] text-blue-600">
              采集中
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-600"
        >
          关闭
        </button>
      </div>

      {/* run 切换：本会话的历次提问 */}
      {runs.length > 0 && (
        <div className="flex items-center gap-2 border-b border-gray-100 bg-gray-50 px-5 py-2">
          <span className="shrink-0 text-[11px] text-gray-400">轮次</span>
          <select
            value={activeRunId ?? ""}
            onChange={(e) => onSelectRun(e.target.value || null)}
            className="min-w-0 flex-1 rounded border border-gray-200 bg-white px-2 py-1 text-[12px] text-gray-700"
          >
            {runs.map((r, i) => (
              <option key={r.run_id} value={r.run_id}>
                第 {runs.length - i} 轮 · {fmtTime(r.started_at)} ·{" "}
                {r.status === "ok" ? "成功" : r.status === "error" ? "失败" : "中断"} ·{" "}
                {fmtTokens(r.stats?.tokens_total ?? 0)} tokens
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="grid grid-cols-5 gap-2 border-b border-gray-200 px-5 py-3">
        <Metric label="总耗时" value={fmtDuration(summary.duration)} />
        <Metric
          label="tokens 进/出"
          value={
            summary.tokensIn || summary.tokensOut
              ? `${fmtTokens(summary.tokensIn)} / ${fmtTokens(summary.tokensOut)}`
              : fmtTokens(summary.tokens)
          }
        />
        <Metric label="模型调用" value={String(summary.llm)} />
        <Metric label="工具调用" value={String(summary.tool)} />
        <Metric label="失败/中断" value={String(summary.failed)} danger={summary.failed > 0} />
      </div>

      {/* 类型过滤 + 图例 */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-gray-100 px-5 py-2">
        {(["all", "llm", "tool", "node", "step"] as KindFilter[]).map((k) => (
          <button
            key={k}
            onClick={() => {
              setKindFilter(k);
              setOnlyFailed(false);
            }}
            className={`rounded px-2 py-1 text-[11px] ${
              kindFilter === k && !onlyFailed
                ? "bg-gray-800 text-white"
                : "text-gray-500 hover:bg-gray-100"
            }`}
          >
            {FILTER_LABEL[k]}
          </button>
        ))}
        <button
          onClick={() => setOnlyFailed((v) => !v)}
          className={`rounded px-2 py-1 text-[11px] ${
            onlyFailed ? "bg-red-50 text-red-600 ring-1 ring-red-200" : "text-gray-500 hover:bg-gray-100"
          }`}
        >
          仅看失败
        </button>
        <button
          onClick={() => setCollapsed(new Set())}
          className="rounded px-2 py-1 text-[11px] text-gray-500 hover:bg-gray-100"
        >
          展开全部
        </button>
        <span className="ml-auto text-[11px] text-gray-400">
          {visible.length}/{sorted.length} spans
        </span>
      </div>

      <div className="flex items-center gap-3 border-b border-gray-100 bg-gray-50/60 px-5 py-1.5">
        {(["llm", "tool", "node", "step"] as const).map((k) => (
          <span key={k} className="flex items-center gap-1 text-[10px] text-gray-500">
            <span
              className={`h-2 w-2 rounded-sm ${
                k === "step" ? "bg-gray-300" : barClass({ kind: k } as TraceSpan)
              }`}
            />
            {FILTER_LABEL[k]}
          </span>
        ))}
        <span className="flex items-center gap-1 text-[10px] text-gray-500">
          <span className="h-2 w-2 rounded-sm bg-red-500" />
          失败
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="px-5 py-10 text-center text-xs text-gray-400">
            暂无链路数据
            <br />
            <span className="text-gray-300">
              {runs.length > 0
                ? "请在上方切换轮次查看历史链路"
                : "该会话还没有已保存的执行链路"}
            </span>
          </div>
        ) : (
          visible.map((s) => {
            const endMs = s.end_ms ?? (streaming ? now : s.start_ms);
            const dur = s.duration_ms ?? Math.max(endMs - s.start_ms, 0);
            const left = ((s.start_ms - timeline.start) / timeline.total) * 100;
            const width = Math.max((dur / timeline.total) * 100, 0.6);
            const isFailed = s.status === "error" || s.status === "interrupted";
            const open = expanded.has(s.span_id);
            const step = isStep(s);
            const source = s.kind === "tool" ? toolSource(s.name) : null;
            const metrics = browserMetrics(s);

            return (
              <div
                key={s.span_id}
                className={`border-b border-gray-50 px-5 py-2 ${step ? "opacity-70" : ""}`}
              >
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => toggleCollapse(s.span_id)}
                    className="w-3 shrink-0 text-[10px] text-gray-400 hover:text-gray-700"
                  >
                    {hasChild.has(s.span_id)
                      ? collapsed.has(s.span_id)
                        ? "▸"
                        : "▾"
                      : ""}
                  </button>
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${badgeClass(s)}`}
                  >
                    {badgeLabel(s)}
                  </span>
                  {source && (
                    <span className="shrink-0 rounded border border-purple-200 px-1 py-0.5 text-[10px] text-purple-600">
                      {source}
                    </span>
                  )}
                  <button
                    onClick={() => toggleExpand(s.span_id)}
                    style={{ paddingLeft: `${s.depth * 12}px` }}
                    className={`min-w-0 flex-1 truncate text-left text-[13px] ${
                      isFailed ? "text-red-600" : "text-gray-800"
                    }`}
                  >
                    {nameOf(s)}
                  </button>
                  <span className="w-14 shrink-0 text-right text-[12px] text-gray-500">
                    {fmtDuration(dur)}
                  </span>
                  <span
                    className={`w-16 shrink-0 text-right text-[12px] ${
                      s.kind === "llm" ? "text-gray-800" : "text-gray-400"
                    }`}
                  >
                    {fmtTokens(s.kind === "llm" ? s.tokens_total : s.subtree_total)}
                  </span>
                </div>

                <div className="mt-1.5 flex items-center gap-2">
                  <div className="relative h-1.5 flex-1 rounded bg-gray-100">
                    <div
                      className={`absolute h-full rounded ${barClass(s)}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    />
                  </div>
                </div>

                {open && (
                  <div className="mt-2 space-y-1 rounded bg-gray-50 px-3 py-2 text-[12px]">
                    <div className="text-gray-400">
                      {KIND_LABEL[s.kind] ?? s.kind}
                      {s.model ? ` · model=${s.model}` : ""}
                      {s.node ? ` · 阶段=${s.node}` : ""}
                      {` · agent=${s.agent}`}
                    </div>
                    {s.kind === "llm" && (
                      <div className="text-gray-600">
                        tokens: in {fmtTokens(s.tokens_in)} / out{" "}
                        {fmtTokens(s.tokens_out)} / total {fmtTokens(s.tokens_total)}
                      </div>
                    )}
                    {s.kind !== "llm" && s.subtree_total > 0 && (
                      <div className="text-gray-600">
                        含子项 token: {fmtTokens(s.subtree_total)}
                      </div>
                    )}
                    {metrics && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {metrics.elapsedMs !== undefined && (
                          <span className="rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[11px] text-teal-700">
                            网站响应耗时{" "}
                            <span className="font-mono font-medium">
                              {fmtDuration(metrics.elapsedMs)}
                            </span>
                          </span>
                        )}
                        {metrics.chars !== undefined && (
                          <span className="rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[11px] text-teal-700">
                            提取字符数{" "}
                            <span className="font-mono font-medium">
                              {metrics.chars.toLocaleString()}
                            </span>
                          </span>
                        )}
                        {metrics.rows && (
                          <span className="rounded border border-teal-200 bg-teal-50 px-1.5 py-0.5 text-[11px] text-teal-700">
                            表格行数{" "}
                            <span className="font-mono font-medium">
                              {metrics.rows.join(" / ")}
                            </span>
                          </span>
                        )}
                      </div>
                    )}
                    {s.error && (
                      <div className="break-all text-red-600">错误：{s.error}</div>
                    )}
                    {s.args_preview && (
                      <div className="break-all text-gray-500">
                        入参：{s.args_preview}
                      </div>
                    )}
                    {s.result_preview && (
                      <div className="break-all text-gray-500">
                        出参：{s.result_preview}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}

function Metric({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="rounded-md bg-gray-50 px-2 py-2">
      <div className="text-[11px] text-gray-400">{label}</div>
      <div
        className={`text-[16px] font-medium ${danger ? "text-red-600" : "text-gray-900"}`}
      >
        {value}
      </div>
    </div>
  );
}
