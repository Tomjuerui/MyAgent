"use client";

const PHASES = [
  { key: "thinking", label: "思考" },
  { key: "planning", label: "规划" },
  { key: "executing", label: "执行" },
  { key: "reviewing", label: "审查" },
  // 后端（src/api_view/api/chat.py 的 PHASE_LABELS 与 harness_config.yaml 的 phases）
  // 发的是 "result"，此前这里写 "done" 导致 currentIdx === -1、五格全程置灰
  { key: "result", label: "完成" },
];

const PHASE_ORDER = PHASES.map((p) => p.key);

/**
 * 阶段进度：一行分段细线 + 当前阶段文字。
 * 原先是「整条 border-b + 5 个带图标的胶囊」，两条横线把画面切碎，
 * 现在只留进度本身，阶段个数靠分段数体现，名称挂在 title 上。
 */
export default function HarnessPhaseBar({ phase, phaseLabel, visible }: Props) {
  if (!visible || phase === "idle") return null;

  const currentIdx = PHASE_ORDER.indexOf(phase);
  const current = currentIdx >= 0 ? PHASES[currentIdx] : null;

  return (
    <div className="animate-fade-in">
      <div className="mx-auto flex w-full max-w-[var(--content-width)] items-center gap-3 px-6 py-2">
        <div
          className="flex flex-1 items-center gap-1"
          role="progressbar"
          aria-valuemin={1}
          aria-valuemax={PHASES.length}
          aria-valuenow={currentIdx + 1}
          aria-label="执行阶段"
        >
          {PHASES.map((p, idx) => (
            <span
              key={p.key}
              title={p.label}
              className={`h-[3px] flex-1 rounded-full transition-colors duration-300 ${
                idx < currentIdx
                  ? "bg-signal/40"
                  : idx === currentIdx
                    ? "bg-signal"
                    : "bg-line-200"
              }`}
            />
          ))}
        </div>
        <span className="shrink-0 text-[12px] text-ink-400">
          {phaseLabel || current?.label || ""}
        </span>
      </div>
    </div>
  );
}

interface Props {
  phase: string;
  phaseLabel: string;
  visible: boolean;
}
