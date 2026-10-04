"use client";

import { KindFilter, FILTER_LABEL } from "@/lib/trace-utils";
import { TimelineMode, MODE_LABEL } from "@/lib/timeline-mode";

interface Props {
  mode: TimelineMode;
  onModeChange: (m: TimelineMode) => void;
  kindFilter: KindFilter;
  onKindFilterChange: (f: KindFilter) => void;
  onlyFailed: boolean;
  onToggleOnlyFailed: () => void;
  allCollapsed: boolean;
  onToggleAll: () => void;
  search: string;
  onSearchChange: (v: string) => void;
}

const MODES: TimelineMode[] = ["actual", "duration", "sequence"];
const FILTERS: KindFilter[] = ["all", "llm", "tool", "node", "step"];

export default function TraceToolbar({
  mode,
  onModeChange,
  kindFilter,
  onKindFilterChange,
  onlyFailed,
  onToggleOnlyFailed,
  allCollapsed,
  onToggleAll,
  search,
  onSearchChange,
}: Props) {
  return (
    <div className="flex flex-col gap-1.5 border-b border-line-200 px-5 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-ink-400">时间轴</span>
        <div className="flex items-center rounded-[var(--radius-xs)] bg-surface-100 p-0.5">
          {MODES.map((m) => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={`rounded-[var(--radius-xs)] px-2 py-0.5 text-[11px] transition-colors ${
                mode === m ? "bg-surface-000 text-ink-800 shadow-[var(--shadow-xs)]" : "text-ink-500 hover:text-ink-700"
              }`}
            >
              {MODE_LABEL[m]}
            </button>
          ))}
        </div>
        <button
          onClick={onToggleAll}
          className="ml-auto rounded-[var(--radius-xs)] px-2 py-1 text-[11px] text-ink-500 transition-colors hover:bg-surface-100"
        >
          {allCollapsed ? "展开全部" : "折叠全部"}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((k) => (
          <button
            key={k}
            onClick={() => {
              onKindFilterChange(k);
              if (onlyFailed) onToggleOnlyFailed();
            }}
            className={`rounded-[var(--radius-xs)] px-2 py-1 text-[11px] transition-colors ${
              kindFilter === k && !onlyFailed ? "bg-signal text-white" : "text-ink-500 hover:bg-surface-100"
            }`}
          >
            {FILTER_LABEL[k]}
          </button>
        ))}
        <button
          onClick={onToggleOnlyFailed}
          className={`rounded-[var(--radius-xs)] px-2 py-1 text-[11px] transition-colors ${
            onlyFailed ? "bg-stop-soft text-stop ring-1 ring-stop/25" : "text-ink-500 hover:bg-surface-100"
          }`}
        >
          仅看失败
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="搜索名称 / 错误 / 入参"
            className="w-40 rounded-[var(--radius-xs)] border border-line-300 bg-surface-000 px-2 py-1 text-[11px] text-ink-700 outline-none focus:border-signal"
          />
          {search && (
            <button
              onClick={() => onSearchChange("")}
              className="rounded-[var(--radius-xs)] px-1.5 py-1 text-[11px] text-ink-400 hover:bg-surface-100"
            >
              ✕
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
