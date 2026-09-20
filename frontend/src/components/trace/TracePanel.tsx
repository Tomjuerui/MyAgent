"use client";

import { useMemo, useState } from "react";
import { TraceSpan } from "@/lib/types";

interface Props {
  spans: TraceSpan[];
  streaming: boolean;
  onClose: () => void;
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return "…";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function fmtTokens(n: number): string {
  return n > 0 ? n.toLocaleString() : "—";
}

function barClass(s: TraceSpan): string {
  if (s.status === "error") return "bg-red-500";
  if (s.status === "interrupted") return "bg-amber-400";
  if (s.status === "running") return "bg-blue-400 animate-pulse";
  if (s.kind === "llm") return "bg-blue-500";
  if (s.kind === "tool") return "bg-blue-700";
  if (s.kind === "node") return "bg-blue-300";
  return "bg-blue-200";
}

function nameOf(s: TraceSpan): string {
  const prefix = s.agent && s.agent !== "main" ? `${s.agent} · ` : "";
  const body = s.kind === "llm" || s.kind === "tool" ? `${s.kind} · ${s.name}` : s.name;
  return prefix + body;
}

export default function TracePanel({ spans, streaming, onClose }: Props) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [onlyFailed, setOnlyFailed] = useState(false);

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
  }, [sorted, onlyFailed, collapsed, byId]);

  const summary = useMemo(() => {
    if (sorted.length === 0) {
      return { duration: 0, tokens: 0, llm: 0, tool: 0, failed: 0 };
    }
    const now = Date.now();
    const start = Math.min(...sorted.map((s) => s.start_ms));
    const end = Math.max(...sorted.map((s) => s.end_ms ?? (streaming ? now : s.start_ms)));
    const body = sorted.filter((s) => s.kind !== "run");
    return {
      duration: Math.max(end - start, 0),
      tokens: body.filter((s) => s.kind === "llm").reduce((a, s) => a + s.tokens_total, 0),
      llm: body.filter((s) => s.kind === "llm").length,
      tool: body.filter((s) => s.kind === "tool").length,
      failed: body.filter((s) => s.status === "error" || s.status === "interrupted").length,
    };
  }, [sorted, streaming]);

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
    <aside className="fixed right-0 top-0 z-40 flex h-full w-[560px] max-w-[92vw] flex-col border-l border-gray-200 bg-white shadow-xl">
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

      <div className="grid grid-cols-5 gap-2 border-b border-gray-200 px-5 py-3">
        <Metric label="总耗时" value={fmtDuration(summary.duration)} />
        <Metric label="tokens" value={fmtTokens(summary.tokens)} />
        <Metric label="模型调用" value={String(summary.llm)} />
        <Metric label="工具调用" value={String(summary.tool)} />
        <Metric
          label="失败/中断"
          value={String(summary.failed)}
          danger={summary.failed > 0}
        />
      </div>

      <div className="flex items-center gap-2 border-b border-gray-100 px-5 py-2">
        <button
          onClick={() => setOnlyFailed((v) => !v)}
          className={`rounded px-2 py-1 text-[11px] ${
            onlyFailed
              ? "bg-red-50 text-red-600"
              : "text-gray-500 hover:bg-gray-100"
          }`}
        >
          仅看失败路径
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

      <div className="flex-1 overflow-y-auto">
        {sorted.length === 0 ? (
          <div className="px-5 py-10 text-center text-xs text-gray-400">
            暂无链路数据
            <br />
            <span className="text-gray-300">
              若后端未挂载 trace 回调，这里会一直为空
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

            return (
              <div key={s.span_id} className="border-b border-gray-50 px-5 py-2">
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
                    className={`h-2 w-2 shrink-0 rounded-sm ${barClass(s)}`}
                  />
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
                      kind={s.kind} · agent={s.agent}
                      {s.node ? ` · node=${s.node}` : ""}
                      {s.model ? ` · model=${s.model}` : ""}
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
        className={`text-[18px] font-medium ${danger ? "text-red-600" : "text-gray-900"}`}
      >
        {value}
      </div>
    </div>
  );
}
