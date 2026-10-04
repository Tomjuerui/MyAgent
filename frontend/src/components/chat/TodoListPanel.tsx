"use client";

import { useState } from "react";
import { Square, CheckCircle2, Loader2, XCircle, ListTodo, X } from "lucide-react";
import { TodoItem } from "@/lib/types";

interface Props {
  items: TodoItem[];
  visible: boolean;
}

const STATUS_CONFIG = {
  pending: { icon: Square, cls: "text-ink-300" },
  in_progress: { icon: Loader2, cls: "text-signal", spin: true },
  complete: { icon: CheckCircle2, cls: "text-go" },
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
        className="ic-btn-ghost animate-fade-in absolute right-6 top-14 z-30 shadow-md"
      >
        <ListTodo size={13} />
        <span>
          {completedCount}/{items.length}
        </span>
      </button>
    );
  }

  return (
    <div className="ic-panel animate-fade-in absolute right-6 top-14 z-30 w-72">
      <div className="flex items-center justify-between border-b border-line-200 px-3 py-2">
        <div className="flex items-center gap-2">
          <ListTodo size={14} className="text-signal" />
          <span className="text-[12.5px] font-medium text-ink-700">任务规划</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="ic-metric">
            {completedCount}/{items.length}
          </span>
          <button
            onClick={() => setOpen(false)}
            className="ic-icon-btn p-1"
            title="收起"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="ic-progress">
        <span style={{ width: `${progress}%` }} />
      </div>

      <div className="max-h-64 overflow-y-auto px-3 py-2">
        {items.map((item) => {
          const config = STATUS_CONFIG[item.status] || STATUS_CONFIG.pending;
          const Icon = config.icon;
          return (
            <div key={item.id} className="flex items-start gap-2.5 py-1.5">
              <Icon
                size={14}
                className={`${config.cls} mt-0.5 shrink-0 ${
                  "spin" in config && config.spin ? "animate-spin" : ""
                }`}
              />
              <span
                className={`text-[12.5px] leading-relaxed ${
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
