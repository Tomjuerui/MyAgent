"use client";

import { memo } from "react";
import { ChatMessage } from "@/lib/types";
import ToolCallDisplay from "./ToolCallDisplay";
import StreamingText from "./StreamingText";
import MarkdownRenderer from "./MarkdownRenderer";
import MessageActions from "./MessageActions";
import ReasoningBlock from "./ReasoningBlock";

interface Props {
  message: ChatMessage;
  isStreaming?: boolean;
  showToolCalls?: boolean;
}

function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const SOURCE_LABEL: Record<string, string> = {
  analyst: "分析专家",
  order: "订单专家",
};

function MessageBubble({ message, isStreaming, showToolCalls = true }: Props) {
  const isUser = message.role === "user";
  const hasToolCalls =
    !isUser && showToolCalls && !!message.toolCalls && message.toolCalls.length > 0;
  const sourceLabel = message.source ? SOURCE_LABEL[message.source] : undefined;

  if (isUser) {
    return (
      <div className="group flex flex-col items-end">
        <div className="max-w-[76%] rounded-[18px] rounded-br-md bg-surface-100 px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words text-ink-800">
          {message.content}
        </div>
        <span
          className="ic-metric mt-1 opacity-0 transition-opacity group-hover:opacity-100"
          suppressHydrationWarning
        >
          {clock(message.timestamp)}
        </span>
      </div>
    );
  }

  return (
    <div className="group">
      {sourceLabel && (
        <div className="mb-2">
          <span className="ic-tag">{sourceLabel}</span>
        </div>
      )}

      {message.reasoning && (
        <ReasoningBlock reasoning={message.reasoning} streaming={isStreaming} />
      )}

      {hasToolCalls && (
        <div className="mb-3 space-y-1.5">
          {message.toolCalls!.map((tc) => (
            <ToolCallDisplay key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}

      <div className={isStreaming ? "markdown-body md-streaming" : "markdown-body"}>
        {isStreaming && !message.content ? (
          <span className="ic-caret" />
        ) : isStreaming ? (
          <StreamingText text={message.content} />
        ) : (
          <MarkdownRenderer content={message.content} />
        )}
      </div>

      {!isStreaming && message.content && <MessageActions content={message.content} />}
    </div>
  );
}

export default memo(MessageBubble);
