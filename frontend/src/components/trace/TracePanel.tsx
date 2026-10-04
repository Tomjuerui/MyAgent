"use client";

import { useMemo, useState } from "react";
import { TraceRunSummary, TraceSpan, TraceStats } from "@/lib/types";
import { fmtDuration, fmtTime, fmtTokens, KindFilter, matchesFilter } from "@/lib/trace-utils";
import { ALL_RUNS, FractionRange, inRange, projectSpans, RunBoundary, TimelineMode } from "@/lib/timeline-mode";
import TraceToolbar from "./TraceToolbar";
import TraceTimeline from "./TraceTimeline";
import TraceTable from "./TraceTable";
import TraceInspector from "./TraceInspector";

interface Props {
  spans: TraceSpan[];
  stats: TraceStats | null;
  streaming: boolean;
  runs: TraceRunSummary[];
  activeRunId: string | null;
  onSelectRun: (runId: string | null) => void;
  onClose: () => void;
  boundaries?: RunBoundary[];
}

export default function TracePanel({
  spans,
  stats,
  streaming,
  runs,
  activeRunId,
  onSelectRun,
  onClose,
  boundaries = [],
}: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [mode, setMode] = useState<TimelineMode>("actual");
  const [search, setSearch] = useState("");
  const [selection, setSelection] = useState<FractionRange | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  // 搜索命中集（对可检索字段做包含匹配）
  const searchMatches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const set = new Set<string>();
    for (const s of sorted) {
      const hay = [s.name, s.agent, s.model, s.node, s.error, s.args_preview, s.result_preview]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (hay.includes(q)) set.add(s.span_id);
    }
    return set;
  }, [sorted, search]);

  // 类型/失败过滤：保留命中 span 及其完整祖先链，维持树形缩进
  const filtered = useMemo(() => {
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
      return sorted.filter((s) => keep.has(s.span_id));
    }
    if (kindFilter === "all") return sorted;
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
    return sorted.filter((s) => keep.has(s.span_id));
  }, [sorted, onlyFailed, kindFilter, byId]);

  // 折叠裁剪（depth 语义：折叠节点的更深层级一并隐藏）。搜索时强制展开，保证命中可见。
  const visible = useMemo(() => {
    const effCollapsed = searchMatches ? new Set<string>() : collapsed;
    const collapsedDepths: boolean[] = [];
    const out: TraceSpan[] = [];
    for (const s of filtered) {
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
      if (effCollapsed.has(s.span_id)) collapsedDepths[s.depth] = true;
    }
    return out;
  }, [filtered, collapsed, searchMatches]);

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
      failed: stats?.error_count ?? body.filter((s) => s.status === "error" || s.status === "interrupted").length,
    };
  }, [sorted, stats, streaming]);

  // 时间轴选区 → 命中 span 集合（供表格聚焦）
  const rangeIds = useMemo(() => {
    if (!selection) return null;
    const proj = projectSpans(sorted, mode, Date.now());
    const set = new Set<string>();
    for (const s of sorted) if (inRange(proj.project(s), selection)) set.add(s.span_id);
    return set;
  }, [sorted, mode, selection]);

  const emphasized = searchMatches ?? rangeIds;
  const selectedSpan = selectedId ? byId.get(selectedId) ?? null : null;

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allCollapsed = collapsed.size > 0 && [...hasChild].every((id) => collapsed.has(id));
  const toggleAll = () => {
    setCollapsed(allCollapsed ? new Set() : new Set(hasChild));
  };

  return (
    <aside className="fixed right-0 top-0 z-40 flex h-full w-[880px] max-w-[96vw] border-l border-line-200 bg-surface-000 shadow-[var(--shadow-lg)]">
      {/* 左列：工具栏 / 时间轴 / 记录表 */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center justify-between border-b border-line-200 px-5 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium text-ink-800">执行链路</span>
            {streaming && (
              <span className="rounded-full bg-signal-soft px-2 py-0.5 text-[11px] text-signal-lo">采集中</span>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-[var(--radius-xs)] px-2 py-1 text-xs text-ink-400 transition-colors hover:bg-surface-100 hover:text-ink-700"
          >
            关闭
          </button>
        </div>

        {/* 轮次切换：本会话历次提问，可看全部轮次的连续链路 */}
        {runs.length > 0 && (
          <div className="flex items-center gap-2 border-b border-line-200 bg-surface-050 px-5 py-2">
            <span className="shrink-0 text-[11px] text-ink-400">轮次</span>
            <select
              value={activeRunId ?? ""}
              onChange={(e) => {
                setSelection(null);
                setSelectedId(null);
                onSelectRun(e.target.value || null);
              }}
              className="min-w-0 flex-1 rounded-[var(--radius-xs)] border border-line-300 bg-surface-000 px-2 py-1 text-[12px] text-ink-700 outline-none focus:border-signal"
            >
              <option value={ALL_RUNS}>全部轮次（{runs.length}）</option>
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

        <div className="grid grid-cols-5 gap-2 border-b border-line-200 px-5 py-3">
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

        <TraceToolbar
          mode={mode}
          onModeChange={setMode}
          kindFilter={kindFilter}
          onKindFilterChange={setKindFilter}
          onlyFailed={onlyFailed}
          onToggleOnlyFailed={() => setOnlyFailed((v) => !v)}
          allCollapsed={allCollapsed}
          onToggleAll={toggleAll}
          search={search}
          onSearchChange={setSearch}
        />

        {/* 图例 */}
        <div className="flex items-center gap-3 border-b border-line-200 bg-surface-050 px-5 py-1.5">
          {(["llm", "tool", "node"] as const).map((k) => (
            <span key={k} className="flex items-center gap-1 text-[10px] text-ink-500">
              <span className={`h-2 w-2 rounded-[2px] ${k === "llm" ? "bg-signal" : k === "tool" ? "bg-warn" : "bg-go"}`} />
              {k === "llm" ? "模型" : k === "tool" ? "工具" : "阶段"}
            </span>
          ))}
          <span className="flex items-center gap-1 text-[10px] text-ink-500">
            <span className="h-2 w-2 rounded-[2px] bg-line-400" />
            步骤
          </span>
          <span className="flex items-center gap-1 text-[10px] text-ink-500">
            <span className="h-2 w-2 rounded-[2px] bg-stop" />
            失败
          </span>
          <span className="ml-auto text-[11px] text-ink-300">
            {visible.length}/{sorted.length} spans
          </span>
        </div>

        {sorted.length > 0 && (
          <TraceTimeline
            spans={sorted}
            mode={mode}
            streaming={streaming}
            selection={selection}
            onSelectionChange={setSelection}
            selectedId={selectedId}
            onSelect={setSelectedId}
            searchMatches={searchMatches}
            boundaries={boundaries}
          />
        )}

        <TraceTable
          visible={visible}
          allSpans={sorted}
          hasChild={hasChild}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapse}
          selectedId={selectedId}
          onSelect={setSelectedId}
          searchMatches={emphasized}
          streaming={streaming}
        />
      </div>

      {/* 右列：详情面板 */}
      <div className="hidden w-[320px] shrink-0 flex-col border-l border-line-200 bg-surface-000 lg:flex">
        <div className="flex items-center justify-between border-b border-line-200 px-4 py-3">
          <span className="text-[12px] font-medium text-ink-700">步骤详情</span>
          {selectedId && (
            <button
              onClick={() => setSelectedId(null)}
              className="rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[11px] text-ink-400 hover:bg-surface-100"
            >
              清除
            </button>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <TraceInspector span={selectedSpan} />
        </div>
      </div>
    </aside>
  );
}

function Metric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="rounded-[var(--radius-sm)] bg-surface-050 px-2 py-2">
      <div className="text-[11px] text-ink-400">{label}</div>
      <div className={`text-[16px] font-medium ${danger ? "text-stop" : "text-ink-900"}`}>{value}</div>
    </div>
  );
}
