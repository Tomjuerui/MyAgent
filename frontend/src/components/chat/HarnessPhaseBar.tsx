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
  { key: "done", label: "完成", icon: CheckCircle2 },
];

const PHASE_ORDER = ["thinking", "planning", "executing", "reviewing", "done"];

/**
 * 阶段状态条
 * 思考 → 规划 → 执行 → 审查 → 完成
 */
export default function HarnessPhaseBar({ phase, phaseLabel, visible }: Props) {
  if (!visible || phase === "idle") return null;

  const currentIdx = PHASE_ORDER.indexOf(phase);

  return (
    <div className="border-b border-line-200 bg-surface-000">
      <div className="mx-auto w-full max-w-[1000px] px-8 py-2">
        <div className="flex items-stretch border border-line-300">
          {PHASES.map((p, idx) => {
            const Icon = p.icon;
            const isPast = idx < currentIdx;
            const isCurrent = idx === currentIdx;

            const tone = isCurrent
              ? "bg-signal text-[#eaf2f6]"
              : isPast
                ? "bg-surface-000 text-go"
                : "bg-surface-100 text-ink-300";

            return (
              <div
                key={p.key}
                className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 transition-colors duration-200 ${tone} ${
                  idx < PHASES.length - 1 ? "border-r border-line-300" : ""
                }`}
              >
                <Icon size={12} />
                <span className="font-mono text-[11px] tracking-wider">{p.label}</span>
              </div>
            );
          })}
        </div>

        {phaseLabel && (
          <div className="mt-1.5 flex items-center gap-2">
            <span className="ic-label">当前阶段</span>
            <span className="text-[12px] text-ink-600">{phaseLabel}</span>
          </div>
        )}
      </div>
    </div>
  );
}
