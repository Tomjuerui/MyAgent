"use client";

import { Brain, ListChecks, Cog, SearchCheck, CheckCircle2 } from "lucide-react";

interface Props {
  phase: string;
  phaseLabel: string;
  visible: boolean;
}

const PHASES = [
  { key: "thinking", label: "思考", icon: Brain },
  { key: "planning", label: "规划", icon: ListChecks },
  { key: "executing", label: "执行", icon: Cog },
  { key: "reviewing", label: "审查", icon: SearchCheck },
  // 后端（src/api_view/api/chat.py 的 PHASE_LABELS 与 harness_config.yaml 的 phases）
  // 发的是 "result"，此前这里写 "done" 导致 currentIdx === -1、五格全程置灰
  { key: "result", label: "完成", icon: CheckCircle2 },
];

const PHASE_ORDER = ["thinking", "planning", "executing", "reviewing", "result"];

/**
 * 阶段状态条：思考 → 规划 → 执行 → 审查 → 完成
 */
export default function HarnessPhaseBar({ phase, phaseLabel, visible }: Props) {
  if (!visible || phase === "idle") return null;

  const currentIdx = PHASE_ORDER.indexOf(phase);

  return (
    <div className="border-b border-line-200 bg-surface-000">
      <div className="mx-auto flex w-full max-w-[var(--content-width)] items-center gap-1 px-6 py-2.5">
        {PHASES.map((p, idx) => {
          const Icon = p.icon;
          const isPast = idx < currentIdx;
          const isCurrent = idx === currentIdx;

          const tone = isCurrent
            ? "bg-signal-soft text-signal-lo"
            : isPast
              ? "text-go"
              : "text-ink-300";

          return (
            <div key={p.key} className="flex items-center">
              <div
                className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] transition-colors duration-200 ${tone}`}
              >
                <Icon size={12} />
                <span>{p.label}</span>
              </div>
              {idx < PHASES.length - 1 && (
                <span
                  className={`mx-0.5 h-px w-3 ${
                    isPast ? "bg-go" : "bg-line-300"
                  }`}
                />
              )}
            </div>
          );
        })}

        {phaseLabel && (
          <span className="ml-auto truncate pl-3 text-[12px] text-ink-400">
            {phaseLabel}
          </span>
        )}
      </div>
    </div>
  );
}
