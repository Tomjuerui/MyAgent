"use client";

import { MessageSquare, SearchX } from "lucide-react";
import { Conversation } from "@/lib/types";
import HistoryItem from "./HistoryItem";

interface Props {
  conversations: Conversation[];
  activeThreadId: string;
  searchQuery: string;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

export default function HistoryList({
  conversations,
  activeThreadId,
  searchQuery,
  onSelect,
  onDelete,
}: Props) {
  const isSearching = searchQuery.trim().length > 0;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="flex items-center justify-between px-4 pb-1.5 pt-3">
        <span className="ic-label">会话记录</span>
        <span className="ic-metric">{conversations.length}</span>
      </div>

      {conversations.length === 0 ? (
        <div className="px-4 py-10 text-center">
          {isSearching ? (
            <>
              <SearchX size={22} className="mx-auto text-ink-300" />
              <p className="mt-2 text-[13px] text-ink-500">没有匹配的会话</p>
              <p className="mt-1 text-[12px] text-ink-400">换个关键词试试</p>
            </>
          ) : (
            <>
              <MessageSquare size={22} className="mx-auto text-ink-300" />
              <p className="mt-2 text-[13px] text-ink-500">还没有会话</p>
              <p className="mt-1 text-[12px] text-ink-400">新建对话后记录会出现在这里</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-0.5 px-2">
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
