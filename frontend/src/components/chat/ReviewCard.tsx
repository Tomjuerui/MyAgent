"use client";

import { Check, X } from "lucide-react";
import { ReviewItem } from "@/hooks/useChat";

const VERDICT_META: Record<string, { label: string; cls: string }> = {
  satisfied: { label: "评审通过", cls: "bg-emerald-500/10 text-emerald-600" },
  needs_revision: { label: "评审未通过", cls: "bg-red-500/10 text-red-500" },
  failed: { label: "评审失败", cls: "bg-surface-200 text-ink-500" },
  max_iterations_reached: { label: "达到评审上限", cls: "bg-amber-500/10 text-amber-600" },
  grader_error: { label: "评审器异常", cls: "bg-surface-200 text-ink-500" },
};

export default function ReviewCard({ item }: { item: ReviewItem }) {
  const meta = VERDICT_META[item.verdict] ?? {
    label: item.verdict || "评审",
    cls: "bg-surface-200 text-ink-500",
  };

  return (
    <div className="mx-auto w-full max-w-[var(--content-width)]">
      <div className="animate-fade-in rounded-xl border border-surface-200 bg-surface-50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${meta.cls}`}>
            {meta.label}
          </span>
          <span className="text-[12px] text-ink-500">第 {item.iteration + 1} 轮评审</span>
        </div>

        {item.explanation && (
          <p className="mt-2 text-[13px] leading-relaxed text-ink-700">{item.explanation}</p>
        )}

        {item.criteria.length > 0 && (
          <ul className="mt-2 space-y-1">
            {item.criteria.map((c, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[12px] leading-relaxed">
                {c.passed ? (
                  <Check size={13} className="mt-0.5 shrink-0 text-emerald-500" />
                ) : (
                  <X size={13} className="mt-0.5 shrink-0 text-red-500" />
                )}
                <span className={c.passed ? "text-ink-600" : "text-ink-700"}>
                  {c.criterion}
                  {c.explanation && (
                    <span className="text-ink-500"> — {c.explanation}</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
