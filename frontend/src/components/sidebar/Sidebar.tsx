"use client";

import { Conversation } from "@/lib/types";
import Logo from "./Logo";
import NewChatButton from "./NewChatButton";
import SearchBox from "./SearchBox";
import HistoryList from "./HistoryList";
import ThemeToggle from "./ThemeToggle";

interface Props {
  conversations: Conversation[];
  activeThreadId: string;
  searchQuery: string;
  onSearchChange: (v: string) => void;
  onNewChat: () => void;
  onSelectThread: (id: string) => void;
  onDeleteThread: (id: string) => void;
  onEditProfile: () => void;
}

export default function Sidebar({
  conversations,
  activeThreadId,
  searchQuery,
  onSearchChange,
  onNewChat,
  onSelectThread,
  onDeleteThread,
  onEditProfile,
}: Props) {
  return (
    <aside
      className="flex h-full shrink-0 flex-col border-r border-line-200 bg-surface-050"
      style={{ width: "var(--shell-sidebar)" }}
    >
      <Logo />
      <NewChatButton onClick={onNewChat} />
      <SearchBox value={searchQuery} onChange={onSearchChange} />
      <HistoryList
        conversations={conversations}
        activeThreadId={activeThreadId}
        searchQuery={searchQuery}
        onSelect={onSelectThread}
        onDelete={onDeleteThread}
      />
      <button
        onClick={onEditProfile}
        className="mx-4 mb-2 flex items-center gap-2 rounded-lg border border-line-200 px-3 py-2 text-[13px] text-ink-600 hover:bg-surface-100"
      >
        编辑用户画像
      </button>
      <div className="flex items-center justify-between border-t border-line-200 px-4 py-2">
        <span className="ic-metric">DeepAgent v1.0.0</span>
        <ThemeToggle />
      </div>
    </aside>
  );
}
