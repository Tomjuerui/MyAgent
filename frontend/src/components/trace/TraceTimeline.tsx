"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { TraceSpan } from "@/lib/types";
import {
  barClass,
  fmtDuration,
  fmtTokens,
  isStep,
  laneFor,
  LANE_LABEL,
  nameOf,
} from "@/lib/trace-utils";
import {
  FractionRange,
  inRange,
  Projection,
  projectSpans,
  RunBoundary,
  TimelineMode,
} from "@/lib/timeline-mode";

const MIN_DRAG_PX = 3;
const HOVER_DELAY_MS = 400;

interface Props {
  spans: TraceSpan[];
  mode: TimelineMode;
  streaming: boolean;
  selection: FractionRange | null;
  onSelectionChange: (r: FractionRange | null) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  searchMatches: Set<string> | null;
  boundaries?: RunBoundary[];
}

interface HoverState {
  spanId: string;
  xPct: number;
  lane: number;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

export default function TraceTimeline({
  spans,
  mode,
  streaming,
  selection,
  onSelectionChange,
  selectedId,
  onSelect,
  searchMatches,
  boundaries = [],
}: Props) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [viewport, setViewport] = useState<FractionRange | null>(null); // 全域名内可见窗口
  const [draft, setDraft] = useState<FractionRange | null>(null);
  const [hover, setHover] = useState<HoverState | null>(null);
  const [panning, setPanning] = useState(false);
  const dragRef = useRef<{ anchor: number; startX: number; moved: boolean } | null>(null);
  const panRef = useRef<{ anchorStart: number; startX: number } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const nowMs = streaming ? Date.now() : Number.MAX_SAFE_INTEGER;
  const projection = useMemo(
    () => projectSpans(spans, mode, streaming ? nowMs : Number.MAX_SAFE_INTEGER),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spans, mode, streaming, nowMs]
  );

  // 模式/数据变化时重置缩放，避免窗口落在域外
  useEffect(() => {
    setViewport(null);
  }, [mode]);

  const vStart = viewport?.start ?? 0;
  const vEnd = viewport?.end ?? 1;
  const vSpan = Math.max(vEnd - vStart, 1e-6);

  const toScreen = (p: Projection) => ({
    left: ((p.left - vStart) / vSpan) * 100,
    width: (p.width / vSpan) * 100,
  });

  const lanes = useMemo(() => {
    const buckets: TraceSpan[][] = [[], [], []];
    for (const s of spans) buckets[laneFor(s.kind)].push(s);
    return buckets;
  }, [spans]);

  const fractionAt = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return vStart + clamp01((clientX - rect.left) / Math.max(1, rect.width)) * vSpan;
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const anchor = clamp01((e.clientX - (trackRef.current?.getBoundingClientRect().left ?? 0)) /
      Math.max(1, trackRef.current?.getBoundingClientRect().width ?? 1));
    const cur = viewport ?? { start: 0, end: 1 };
    const nextSpan = Math.min(1, Math.max(0.04, (cur.end - cur.start) * Math.exp(e.deltaY * 0.0015)));
    if (nextSpan >= 0.999) {
      setViewport(null);
      return;
    }
    const anchorFrac = cur.start + clamp01(anchor) * (cur.end - cur.start);
    let start = anchorFrac - anchor * nextSpan;
    start = Math.min(Math.max(start, 0), 1 - nextSpan);
    setViewport({ start, end: start + nextSpan });
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 2) {
      panRef.current = { anchorStart: vStart, startX: e.clientX };
      setPanning(true);
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const f = fractionAt(e.clientX);
    dragRef.current = { anchor: f, startX: e.clientX, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
    setDraft({ start: f, end: f });
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (pan) {
      const rect = trackRef.current?.getBoundingClientRect();
      const dx = (e.clientX - pan.startX) / Math.max(1, rect?.width ?? 1);
      const size = vEnd - vStart;
      let start = pan.anchorStart - dx * size;
      start = Math.min(Math.max(start, 0), 1 - size);
      setViewport({ start, end: start + size });
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    if (Math.abs(e.clientX - drag.startX) >= MIN_DRAG_PX) drag.moved = true;
    const f = fractionAt(e.clientX);
    setDraft({ start: Math.min(drag.anchor, f), end: Math.max(drag.anchor, f) });
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const pan = panRef.current;
    if (pan) {
      panRef.current = null;
      setPanning(false);
      return;
    }
    const drag = dragRef.current;
    if (!drag) return;
    dragRef.current = null;
    setDraft(null);
    if (drag.moved) {
      const f = fractionAt(e.clientX);
      onSelectionChange({ start: Math.min(drag.anchor, f), end: Math.max(drag.anchor, f) });
    } else {
      // 单击空白：清选区
      onSelectionChange(null);
      onSelect(null);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    onSelectionChange(null);
  };

  const showHover = (span: TraceSpan, lane: number, leftPct: number, widthPct: number) => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    const xPct = leftPct + widthPct / 2;
    hoverTimer.current = setTimeout(() => setHover({ spanId: span.span_id, xPct, lane }), HOVER_DELAY_MS);
  };
  const clearHover = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    setHover(null);
  };
  useEffect(() => () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
  }, []);

  const activeRange = draft ?? selection;
  const hoveredSpan = hover ? spans.find((s) => s.span_id === hover.spanId) ?? null : null;

  return (
    <section className="relative border-b border-line-200 bg-surface-050 px-5 py-2">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[11px] text-ink-400">时间概览</span>
        <span className="text-[10px] text-ink-300">拖拽框选区间 · 滚轮缩放 · 右键平移 · Esc 清除</span>
        {viewport && (
          <button
            onClick={() => setViewport(null)}
            className="ml-auto rounded-[var(--radius-xs)] px-1.5 py-0.5 text-[10px] text-ink-500 hover:bg-surface-100"
          >
            重置缩放
          </button>
        )}
      </div>

      <div className="flex items-stretch gap-2">
        {/* 泳道标签 */}
        <div className="flex w-9 shrink-0 flex-col justify-between py-0.5" aria-hidden="true">
          {LANE_LABEL.map((l) => (
            <span key={l} className="text-[9px] leading-[16px] text-ink-300">
              {l}
            </span>
          ))}
        </div>

        {/* 绘图区 */}
        <div
          ref={trackRef}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragRef.current = null;
            panRef.current = null;
            setDraft(null);
            setPanning(false);
          }}
          onPointerLeave={() => {
            if (!dragRef.current && !panRef.current) clearHover();
          }}
          onDoubleClick={() => {
            onSelectionChange(null);
            setViewport(null);
          }}
          onContextMenu={(e) => e.preventDefault()}
          className="relative h-[54px] min-w-0 flex-1 select-none overflow-hidden rounded-[var(--radius-xs)] bg-surface-100/60"
          data-panning={panning || undefined}
        >
          {/* 轮次分界 */}
          {boundaries.map((b, i) => {
            const at = (b.startMs - projection.start) / projection.total;
            const x = ((at - vStart) / vSpan) * 100;
            if (x < -1 || x > 101) return null;
            return (
              <div
                key={`${b.label}-${i}`}
                className="pointer-events-none absolute top-0 bottom-0 border-l border-dashed border-line-400"
                style={{ left: `${x}%` }}
              >
                <span className="absolute -top-0.5 left-1 whitespace-nowrap text-[9px] text-ink-300">
                  {b.label}
                </span>
              </div>
            );
          })}

          {/* 泳道行 */}
          {lanes.map((row, lane) => (
            <div
              key={lane}
              className="absolute right-0 left-0"
              style={{ top: `${lane * 18 + 1}px`, height: "16px" }}
            >
              {row.map((s) => {
                const p = projection.project(s);
                const { left, width } = toScreen(p);
                if (left + width < -1 || left > 101) return null;
                const failed = s.status === "error" || s.status === "interrupted";
                const isSel = selectedId === s.span_id;
                const isMatch = searchMatches?.has(s.span_id) ?? false;
                const inSel = activeRange ? inRange(p, activeRange) : false;
                return (
                  <button
                    key={s.span_id}
                    onPointerEnter={() => showHover(s, lane, left, Math.max(width, 0.6))}
                    onPointerLeave={clearHover}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelect(s.span_id);
                    }}
                    title={undefined}
                    className={`absolute top-0 h-full rounded-[2px] transition-[opacity,box-shadow] ${barClass(s)} ${
                      isStep(s) ? "opacity-60" : ""
                    } ${isSel ? "ring-2 ring-ink-800/70" : ""} ${
                      searchMatches && !isMatch ? "opacity-30" : ""
                    } ${activeRange && !inSel ? "opacity-25" : ""}`}
                    style={{ left: `${left}%`, width: `${Math.max(width, 0.6)}%` }}
                  />
                );
              })}
            </div>
          ))}

          {/* 框选高亮 */}
          {activeRange && (
            <div
              className="pointer-events-none absolute inset-y-0 bg-signal/10 ring-1 ring-signal/30"
              style={{
                left: `${(activeRange.start - vStart) / vSpan * 100}%`,
                width: `${(activeRange.end - activeRange.start) / vSpan * 100}%`,
              }}
            />
          )}

          {/* 悬停提示 */}
          {hover && hoveredSpan && (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-[var(--radius-xs)] border border-line-300 bg-surface-000 px-2 py-1 text-[10px] leading-tight text-ink-700 shadow-[var(--shadow-md)]"
              style={{ left: `${hover.xPct}%`, bottom: "100%" }}
            >
              <div className="font-medium text-ink-800">{nameOf(hoveredSpan)}</div>
              <div className="text-ink-500">
                {fmtDuration(hoveredSpan.duration_ms ?? (streaming ? nowMs - hoveredSpan.start_ms : null))}
                {" · "}tokens {fmtTokens(hoveredSpan.kind === "llm" ? hoveredSpan.tokens_total : hoveredSpan.subtree_total)}
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
