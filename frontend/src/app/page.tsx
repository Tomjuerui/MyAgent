"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Sidebar from "@/components/sidebar/Sidebar";
import ChatArea from "@/components/chat/ChatArea";
import { useChat } from "@/hooks/useChat";
import { useHistory } from "@/hooks/useHistory";
import { getMessages } from "@/lib/api";
import { ChatMessage } from "@/lib/types";

// 拉取会话消息并归一化为前端 ChatMessage 形状（挂载恢复 / 切换会话共用）
async function loadThreadMessages(threadId: string): Promise<ChatMessage[]> {
  const data = await getMessages(threadId);
  return (data.messages || data || []).map(
    (m: Record<string, unknown>, idx: number): ChatMessage => ({
      id: (m.id as string) || `msg-${idx}`,
      role: (m.role as "user" | "assistant") || "assistant",
      content: (m.content as string) || "",
      source: m.source as string | undefined,
      toolCalls: m.toolCalls as ChatMessage["toolCalls"],
      timestamp: (m.timestamp as number) || Date.now(),
    })
  );
}

export default function Home() {
  const chat = useChat();
  const history = useHistory();
  const wasStreaming = useRef(false);
  const [loadingThread, setLoadingThread] = useState(false);

  // 聊天结束后自动刷新历史列表
  useEffect(() => {
    if (wasStreaming.current && !chat.streaming) {
      // 延迟 500ms 等待后端保存完成
      const timer = setTimeout(() => history.refresh(), 500);
      return () => clearTimeout(timer);
    }
    wasStreaming.current = chat.streaming;
  }, [chat.streaming, history]);

  const handleSelectThread = useCallback(
    async (threadId: string) => {
      setLoadingThread(true);
      try {
        const msgs = await loadThreadMessages(threadId);
        chat.loadThread(threadId, msgs);
      } catch (err) {
        // 之前是静默处理，导致切会话失败时界面毫无反馈
        console.error("加载会话消息失败", threadId, err);
      } finally {
        setLoadingThread(false);
      }
    },
    [chat]
  );

  // 刷新后恢复 URL 中记录的当前会话（P0：修复刷新丢会话）。
  // 用 useChat 挂载时捕获的 initialThreadFromUrl，避免和「新 uuid 回写 URL」的 effect 竞态
  useEffect(() => {
    const thread = chat.initialThreadFromUrl;
    if (!thread) return;
    (async () => {
      setLoadingThread(true);
      try {
        const msgs = await loadThreadMessages(thread);
        chat.loadThread(thread, msgs);
      } catch (err) {
        console.error("恢复会话失败", thread, err);
      } finally {
        setLoadingThread(false);
      }
    })();
  }, [chat.initialThreadFromUrl, chat.loadThread]);

  const handleDeleteThread = useCallback(
    (threadId: string) => {
      history.remove(threadId);
      if (threadId === chat.threadId) {
        chat.newChat();
      }
    },
    [history, chat]
  );

  const handleSupplement = useCallback(
    (text: string) => {
      chat.resumeWith({ supplement: text });
    },
    [chat]
  );

  const handleApprove = useCallback(() => {
    chat.resumeApproval("approve");
  }, [chat]);

  const handleReject = useCallback(() => {
    chat.resumeApproval("reject");
  }, [chat]);

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <Sidebar
        conversations={history.conversations}
        activeThreadId={chat.threadId}
        searchQuery={history.searchQuery}
        onSearchChange={history.setSearchQuery}
        onNewChat={chat.newChat}
        onSelectThread={handleSelectThread}
        onDeleteThread={handleDeleteThread}
      />
      <ChatArea
        messages={chat.messages}
        streaming={chat.streaming}
        thinking={chat.thinking}
        interrupted={chat.interrupted}
        interruptData={chat.interruptData}
        todoItems={chat.todoItems}
        todoVisible={chat.todoVisible}
        pendingQueue={chat.pendingQueue}
        phase={chat.phase}
        phaseLabel={chat.phaseLabel}
        traceSpans={chat.traceSpans}
        traceStats={chat.traceStats}
        traceRuns={chat.traceRuns}
        activeRunId={chat.activeRunId}
        traceBoundaries={chat.traceBoundaries}
        error={chat.error}
        loadingThread={loadingThread}
        onDismissError={chat.dismissError}
        onSelectTraceRun={chat.selectTraceRun}
        onSend={chat.sendMessage}
        onSupplement={handleSupplement}
        onApprove={handleApprove}
        onReject={handleReject}
      />
    </div>
  );
}
