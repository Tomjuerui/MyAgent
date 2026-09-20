"use client";

import { Trash2 } from "lucide-react";
import { Conversation } from "@/lib/types";

interface Props {
  conversation: Conversation;
  active: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function HistoryItem({
  conversation,
  active,
  onSelect,
  onDelete,
}: Props) {
  return (
    <div
      className={`group flex items-center gap-2.5 px-3 py-2 cursor-pointer border-l-[3px] transition-colors ${
        active
          ? "border-signal bg-signal-soft"
          : "border-transparent hover:bg-surface-100"
      }`}
      onClick={() => onSelect(conversation.thread_id)}
    >
      <span
        className="w-1.5 h-1.5 shrink-0"
        style={{ background: active ? "var(--signal)" : "var(--line-400)" }}
      />
      <span
        className={`flex-1 text-[13px] truncate ${
          active ? "text-signal-lo" : "text-ink-600"
        }`}
      >
        {conversation.title}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(conversation.thread_id);
        }}
        className="opacity-0 group-hover:opacity-100 p-0.5 text-ink-300 hover:text-stop transition-all"
        title="删除"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
