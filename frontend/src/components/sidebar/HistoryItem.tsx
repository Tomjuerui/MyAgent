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
      className={`group flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 transition-colors ${
        active ? "bg-signal-soft" : "hover:bg-surface-100"
      }`}
      onClick={() => onSelect(conversation.thread_id)}
    >
      <span
        className={`min-w-0 flex-1 truncate text-[13px] ${
          active ? "font-medium text-signal-lo" : "text-ink-600"
        }`}
      >
        {conversation.title}
      </span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onDelete(conversation.thread_id);
        }}
        className="ic-icon-btn shrink-0 p-1 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
        title="删除"
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}
