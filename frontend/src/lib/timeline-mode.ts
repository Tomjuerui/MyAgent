import { TraceSpan } from "@/lib/types";

/** 时间轴投影模式：真实墙钟 / 压缩空闲 / 按序等宽 */
export type TimelineMode = "actual" | "duration" | "sequence";

/** 多轮次连续视图时的时间轴分界 */
export interface RunBoundary {
  label: string;
  /** 该轮次的绝对起始时刻（epoch ms），投影时换算成分数位置 */
  startMs: number;
}

/** 「全部轮次」在轮次下拉里的哨兵值 */
export const ALL_RUNS = "__all__";

export const MODE_LABEL: Record<TimelineMode, string> = {
  actual: "真实时间",
  duration: "压缩空闲",
  sequence: "按序等宽",
};

/** 单个 span 在时间轴上的横向投影（0..1） */
export interface Projection {
  left: number;
  width: number;
}

export interface TimelineProjection {
  /** span_id → 投影 */
  get: (spanId: string) => Projection | undefined;
  /** 某 span 的投影；缺失时退回零宽 */
  project: (s: TraceSpan) => Projection;
  /** 域范围（供刻度/分界定位） */
  start: number;
  total: number;
}

const MIN_WIDTH = 0.004; // 极短 span 也留可见底线

function spanEnd(s: TraceSpan, nowMs: number): number {
  if (s.end_ms != null) return s.end_ms;
  // 运行中的 span：用当前时刻撑出宽度（对应"不虚构耗时"的反面，仅限 live）
  return Math.max(s.start_ms, nowMs);
}

/**
 * 把一组 span 投影到统一时间轴。
 * - actual   : 真实墙钟，保留下游等待间隙
 * - duration : 保留各自真实耗时，但压缩 span 之间的空闲（HITL 长等待被挤掉）
 * - sequence : 忽略墙钟，按 (start, seq) 顺序等宽排布
 */
export function projectSpans(
  spans: TraceSpan[],
  mode: TimelineMode,
  nowMs: number
): TimelineProjection {
  if (spans.length === 0) {
    return { get: () => undefined, project: () => ({ left: 0, width: 0 }), start: 0, total: 1 };
  }

  const sorted = [...spans].sort((a, b) => a.start_ms - b.start_ms || a.seq - b.seq);

  if (mode === "sequence") {
    const n = sorted.length;
    const map = new Map<string, Projection>();
    sorted.forEach((s, i) => map.set(s.span_id, { left: i / n, width: 1 / n }));
    return {
      get: (id) => map.get(id),
      project: (s) => map.get(s.span_id) ?? { left: 0, width: 0 },
      start: 0,
      total: n,
    };
  }

  // 真实墙钟域
  const domainStart = Math.min(...sorted.map((s) => s.start_ms));

  if (mode === "actual") {
    const end = Math.max(...sorted.map((s) => spanEnd(s, nowMs)));
    const total = Math.max(end - domainStart, 1);
    const map = new Map<string, Projection>();
    for (const s of sorted) {
      const left = (s.start_ms - domainStart) / total;
      const width = Math.max((spanEnd(s, nowMs) - s.start_ms) / total, MIN_WIDTH);
      map.set(s.span_id, { left, width });
    }
    return { get: (id) => map.get(id), project: (s) => map.get(s.span_id) ?? { left: 0, width: 0 }, start: domainStart, total };
  }

  // duration：压缩空闲间隙
  // coveredUntil 记录目前已覆盖到的最远时刻；下一 span 若晚于它，其空隙被扣掉。
  const offsets = new Map<string, number>();
  let coveredUntil: number | null = null;
  let removed = 0;
  for (const s of sorted) {
    const end = spanEnd(s, nowMs);
    if (coveredUntil !== null && s.start_ms > coveredUntil) {
      removed += s.start_ms - coveredUntil;
    }
    offsets.set(s.span_id, removed);
    coveredUntil = coveredUntil === null ? end : Math.max(coveredUntil, end);
  }
  const projStart = Math.min(...sorted.map((s) => s.start_ms - (offsets.get(s.span_id) ?? 0)));
  const projEnd = Math.max(...sorted.map((s) => spanEnd(s, nowMs) - (offsets.get(s.span_id) ?? 0)));
  const total = Math.max(projEnd - projStart, 1);
  const map = new Map<string, Projection>();
  for (const s of sorted) {
    const off = offsets.get(s.span_id) ?? 0;
    const left = (s.start_ms - off - projStart) / total;
    const width = Math.max((spanEnd(s, nowMs) - s.start_ms) / total, MIN_WIDTH);
    map.set(s.span_id, { left, width });
  }
  return { get: (id) => map.get(id), project: (s) => map.get(s.span_id) ?? { left: 0, width: 0 }, start: projStart, total };
}

/** 选区（0..1 分数域）命中测试 */
export interface FractionRange {
  start: number;
  end: number;
}

export function inRange(p: Projection, r: FractionRange): boolean {
  return p.left <= r.end && p.left + p.width >= r.start;
}
