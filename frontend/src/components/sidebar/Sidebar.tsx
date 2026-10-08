"use client";

import { Settings } from "lucide-react";
import Link from "next/link";
import { Conversation } from "@/lib/types";
import { BRAND } from "@/lib/brand";
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
      <Link
        href="/erp"
        target="_blank"
        className="mx-3 mb-2 flex items-center justify-center gap-1.5 rounded-md bg-surface-100 px-3 py-2 text-sm font-medium hover:bg-surface-200"
      >
        ERP 数据台
      </Link>
      <NewChatButton onClick={onNewChat} />
      <SearchBox value={searchQuery} onChange={onSearchChange} />
      <HistoryList
        conversations={conversations}
        activeThreadId={activeThreadId}
        searchQuery={searchQuery}
        onSelect={onSelectThread}
        onDelete={onDeleteThread}
      />

      {/* 底部用户行：头像 + 名称 + 版本，右侧是主题切换与画像入口 */}
      <div className="border-t border-line-200 px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-signal-soft text-[13px] font-medium text-signal-lo">
            {BRAND.userRole.slice(0, 1)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium leading-tight text-ink-800">
              {BRAND.userRole}
            </div>
            <div className="ic-metric leading-tight">DeepAgent {BRAND.version}</div>
          </div>
          <ThemeToggle />
          <button
            type="button"
            onClick={onEditProfile}
            className="ic-icon-btn shrink-0"
            aria-label="编辑用户画像"
            title="编辑用户画像"
          >
            <Settings size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
