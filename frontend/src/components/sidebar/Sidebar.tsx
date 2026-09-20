"use client";

import { Conversation } from "@/lib/types";
import Logo from "./Logo";
import NewChatButton from "./NewChatButton";
import SearchBox from "./SearchBox";
import HistoryList from "./HistoryList";

interface Props {
  conversations: Conversation[];
  activeThreadId: string;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  onNewChat: () => void;
  onSelectThread: (id: string) => void;
  onDeleteThread: (id: string) => void;
}

export default function Sidebar({
  conversations,
  activeThreadId,
  searchQuery,
  onSearchChange,
  onNewChat,
  onSelectThread,
  onDeleteThread,
}: Props) {
  return (
    <aside
      className="h-screen flex flex-col bg-surface-050 shrink-0"
      style={{
        width: "var(--shell-sidebar)",
        borderRight: "1px solid var(--line-300)",
      }}
    >
      <Logo />
      <NewChatButton onClick={onNewChat} />
      <SearchBox value={searchQuery} onChange={onSearchChange} />
      <HistoryList
        conversations={conversations}
        activeThreadId={activeThreadId}
        onSelect={onSelectThread}
        onDelete={onDeleteThread}
      />
      <div className="px-4 py-2.5 border-t border-line-200">
        <span className="ic-metric">DeepAgent v1.0.0</span>
      </div>
    </aside>
  );
}
