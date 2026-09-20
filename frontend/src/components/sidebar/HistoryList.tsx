"use client";

import { Conversation } from "@/lib/types";
import HistoryItem from "./HistoryItem";

interface Props {
  conversations: Conversation[];
  activeThreadId: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function HistoryList({
  conversations,
  activeThreadId,
  onSelect,
  onDelete,
}: Props) {
  return (
    <div className="flex-1 min-h-0 overflow-y-auto">
      <div className="flex items-center justify-between px-4 py-2 border-b border-line-200">
        <span className="ic-label">会话记录</span>
        <span className="ic-metric">
          {String(conversations.length).padStart(2, "0")}
        </span>
      </div>

      {conversations.length === 0 ? (
        <p className="px-4 py-3 ic-metric">暂无记录</p>
      ) : (
        <div className="py-1">
          {conversations.map((conv) => (
            <HistoryItem
              key={conv.thread_id}
              conversation={conv}
              active={conv.thread_id === activeThreadId}
              onSelect={onSelect}
              onDelete={onDelete}
            />
          ))}
        </div>
      )}
    </div>
  );
}
