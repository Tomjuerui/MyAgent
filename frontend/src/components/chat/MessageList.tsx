"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { ChatMessage } from "@/lib/types";
import MessageBubble from "./MessageBubble";

interface Props {
  messages: ChatMessage[];
  streaming: boolean;
  showToolCalls: boolean;
  loading?: boolean;
}

function MessagesSkeleton() {
  return (
    <div className="mx-auto w-full max-w-[var(--content-width)] space-y-7 px-6 py-6">
      <div className="flex justify-end">
        <div className="h-11 w-2/5 animate-pulse rounded-[18px] bg-surface-200" />
      </div>
      <div className="space-y-3">
        {[100, 92, 74].map((w) => (
          <div
            key={w}
            className="h-4 animate-pulse rounded bg-surface-200"
            style={{ width: `${w}%` }}
          />
        ))}
      </div>
    </div>
  );
}

export default function MessageList({
  messages,
  streaming,
  showToolCalls,
  loading = false,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const userScrolledUp = useRef(false);
  const [showJump, setShowJump] = useState(false);

  const syncScrolledUp = useCallback((up: boolean) => {
    userScrolledUp.current = up;
    setShowJump(up);
  }, []);

  const handleScroll = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const threshold = 96;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    syncScrolledUp(!isNearBottom);
  }, [syncScrolledUp]);

  // 流式期间用 auto：每个 token 触发一次 smooth 会让画面持续轻微晃动
  useEffect(() => {
    if (!userScrolledUp.current) {
      bottomRef.current?.scrollIntoView({ behavior: "auto" });
    }
  }, [messages, streaming]);

  const scrollToBottom = useCallback(() => {
    syncScrolledUp(false);
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [syncScrolledUp]);

  if (loading) {
    return (
      <div className="flex-1 min-h-0 overflow-hidden">
        <MessagesSkeleton />
      </div>
    );
  }

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto"
      >
        <div className="mx-auto w-full max-w-[var(--content-width)] space-y-7 px-6 py-6">
          {messages.map((msg, idx) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isStreaming={
                streaming && idx === messages.length - 1 && msg.role === "assistant"
              }
              showToolCalls={showToolCalls}
            />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>

      {showJump && (
        <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center">
          <button
            type="button"
            onClick={scrollToBottom}
            className="ic-btn-ghost pointer-events-auto animate-fade-in shadow-md"
          >
            <ArrowDown size={14} />
            回到最新
          </button>
        </div>
      )}
    </div>
  );
}
