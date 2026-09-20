"use client";

import { useState } from "react";
import { TodoItem } from "@/lib/types";
import { Square, SquareCheck, Loader2, XCircle, ListTodo, X } from "lucide-react";

interface Props {
  items: TodoItem[];
  visible: boolean;
}

const STATUS_CONFIG = {
  pending: { icon: Square, cls: "text-ink-300" },
  in_progress: { icon: Loader2, cls: "text-signal", spin: true },
  complete: { icon: SquareCheck, cls: "text-go" },
  cancelled: { icon: XCircle, cls: "text-stop" },
} as const;

export default function TodoListPanel({ items, visible }: Props) {
  const [open, setOpen] = useState(true);

  if (!visible || items.length === 0) return null;

  const completedCount = items.filter((i) => i.status === "complete").length;
  const progress = items.length > 0 ? (completedCount / items.length) * 100 : 0;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed top-14 right-4 z-[9999] ic-btn-ghost animate-fade-in"
      >
        <ListTodo size={13} />
        <span>
          {completedCount}/{items.length}
        </span>
      </button>
    );
  }

  return (
    <div className="fixed top-14 right-4 w-72 z-[9999] ic-panel animate-fade-in">
      <div className="flex items-center justify-between px-3 py-2 border-b border-line-200 bg-surface-050">
        <div className="flex items-center gap-2">
          <ListTodo size={13} className="text-signal" />
          <span className="text-[12px] font-medium text-ink-700">任务规划</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="ic-metric">
            {completedCount}/{items.length}
          </span>
          <button
            onClick={() => setOpen(false)}
            className="p-0.5 text-ink-300 hover:text-ink-600 transition-colors"
            title="收起"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="ic-progress">
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="px-3 py-2 max-h-60 overflow-y-auto">
        {items.map((item) => {
          const config = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
          const Icon = config.icon;
          return (
            <div key={item.id} className="flex items-start gap-2.5 py-1">
              <Icon
                size={13}
                className={`${config.cls} shrink-0 mt-0.5 ${
                  "spin" in config && config.spin ? "animate-spin" : ""
                }`}
              />
              <span
                className={`text-[12px] leading-relaxed ${
                  item.status === "complete"
                    ? "text-ink-300 line-through"
                    : item.status === "in_progress"
                      ? "text-ink-800"
                      : "text-ink-500"
                }`}
              >
                {item.content}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
