"use client";

import { useState, useCallback, useEffect } from "react";
import { Conversation } from "@/lib/types";
import { getConversations, deleteConversation } from "@/lib/api";

export function useHistory() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getConversations();
      setConversations(data);
    } catch (err) {
      console.error("加载会话列表失败", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // 窗口获得焦点时自动刷新（解决后端重启后历史不显示问题）
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    // 首次加载失败时 3s 后重试
    const retry = setTimeout(() => refresh(), 3000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearTimeout(retry);
    };
  }, [refresh]);

  const remove = useCallback(
    async (threadId: string) => {
      try {
        await deleteConversation(threadId);
        setConversations((prev) =>
          prev.filter((c) => c.thread_id !== threadId)
        );
      } catch (err) {
        console.error("删除会话失败", threadId, err);
      }
    },
    []
  );

  const filtered = searchQuery.trim()
    ? conversations.filter((c) =>
        c.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : conversations;

  return {
    conversations: filtered,
    loading,
    searchQuery,
    setSearchQuery,
    refresh,
    remove,
  };
}
