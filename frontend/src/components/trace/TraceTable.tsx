"use client";

import { TraceSpan } from "@/lib/types";
import {
  badgeClass,
  badgeLabel,
  fmtDuration,
  fmtTokens,
  isStep,
  nameOf,
  toolHistogram,
  toolSource,
} from "@/lib/trace-utils";

interface Props {
  visible: TraceSpan[];
  allSpans: TraceSpan[];
  hasChild: Set<string>;
  collapsed: Set<string>;
  onToggleCollapse: (id: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  searchMatches: Set<string> | null;
  streaming: boolean;
}

export default function TraceTable({
  visible,
  allSpans,
  hasChild,
  collapsed,
  onToggleCollapse,
  selectedId,
  onSelect,
  searchMatches,
  streaming,
}: Props) {
  return (
    <div className="flex-1 overflow-y-auto">
      {visible.length === 0 ? (
        <div className="px-5 py-10 text-center text-xs text-ink-400">
          暂无链路数据
          <br />
          <span className="text-ink-300">请在上方切换轮次查看历史链路</span>
        </div>
      ) : (
        visible.map((s) => {
          const endMs = s.end_ms ?? (streaming ? Date.now() : s.start_ms);
          const dur = s.duration_ms ?? Math.max(endMs - s.start_ms, 0);
          const isFailed = s.status === "error" || s.status === "interrupted";
          const step = isStep(s);
          const source = s.kind === "tool" ? toolSource(s.name) : null;
          const selected = selectedId === s.span_id;
          const isMatch = searchMatches?.has(s.span_id) ?? false;
          const dimmed = searchMatches !== null && !isMatch;
          const tools = s.kind === "node" ? toolHistogram(s, allSpans) : [];

          const inTok = s.kind === "llm" ? s.tokens_in : s.subtree_in;
          const outTok = s.kind === "llm" ? s.tokens_out : s.subtree_out;

          return (
            <div
              key={s.span_id}
              className={`border-b border-line-200/60 transition-colors ${
                selected ? "bg-signal-soft/60" : "hover:bg-surface-050"
              } ${step ? "opacity-70" : ""} ${dimmed ? "opacity-40" : ""}`}
            >
              <div className="flex w-full items-center gap-2 px-5 py-1.5">
                {hasChild.has(s.span_id) ? (
                  <button
                    type="button"
                    onClick={() => onToggleCollapse(s.span_id)}
                    aria-label={collapsed.has(s.span_id) ? "展开" : "折叠"}
                    className="w-3 shrink-0 text-[10px] text-ink-300 hover:text-ink-700"
                  >
                    {collapsed.has(s.span_id) ? "▸" : "▾"}
                  </button>
                ) : (
                  <span className="w-3 shrink-0" />
                )}
                <button
                  type="button"
                  onClick={() => onSelect(s.span_id)}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left"
                >
                  <span
                    className={`shrink-0 rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[10px] ${badgeClass(s)}`}
                  >
                    {badgeLabel(s)}
                  </span>
                  {source && (
                    <span className="shrink-0 rounded-[var(--radius-xs)] border border-line-300 px-1 py-0.5 text-[10px] text-ink-500">
                      {source}
                    </span>
                  )}
                  <span
                    style={{ paddingLeft: `${s.depth * 10}px` }}
                    className={`min-w-0 flex-1 truncate text-[13px] ${
                      isFailed ? "text-stop" : "text-ink-800"
                    }`}
                  >
                    {nameOf(s)}
                    {tools.length > 0 && (
                      <span className="ml-2 text-[11px] text-ink-400">{tools.join(" ")}</span>
                    )}
                  </span>
                  <span className="w-12 shrink-0 text-right font-mono text-[11px] text-ink-500">
                    {fmtTokens(inTok)}
                  </span>
                  <span className="w-12 shrink-0 text-right font-mono text-[11px] text-ink-400">
                    {fmtTokens(outTok)}
                  </span>
                  <span className="w-14 shrink-0 text-right text-[12px] text-ink-500">
                    {fmtDuration(dur)}
                  </span>
                  {s.status === "running" && (
                    <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-signal" />
                  )}
                </button>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
