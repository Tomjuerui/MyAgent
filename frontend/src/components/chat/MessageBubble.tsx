"use client";

import ReactMarkdown from "react-markdown";
import { ChatMessage } from "@/lib/types";
import ToolCallDisplay from "./ToolCallDisplay";
import StreamingText from "./StreamingText";

interface Props {
  message: ChatMessage;
  isStreaming?: boolean;
  showToolCalls?: boolean;
}

function clock(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function MessageBubble({
  message,
  isStreaming,
  showToolCalls = true,
}: Props) {
  const isUser = message.role === "user";
  const hasToolCalls =
    !isUser && showToolCalls && !!message.toolCalls && message.toolCalls.length > 0;

  return (
    <div className="animate-fade-in py-1">
      {/* 记录头：角色 / 时间 / 来源 */}
      <div className="flex items-center gap-2 mb-1.5">
        <span className={isUser ? "ic-tag ic-tag-signal" : "ic-tag"}>
          {isUser ? "OPERATOR" : "AGENT"}
        </span>
        <span className="ic-metric" suppressHydrationWarning>
          {clock(message.timestamp)}
        </span>
        {!isUser && message.source && message.source !== "main" && (
          <span className="ic-tag">
            {message.source === "analyst" ? "分析专家" : "订单专家"}
          </span>
        )}
      </div>

      {/* 工具调用 */}
      {hasToolCalls && (
        <div className="max-w-[900px] mb-2">
          {message.toolCalls!.map((tc) => (
            <ToolCallDisplay key={tc.id} toolCall={tc} />
          ))}
        </div>
      )}

      {/* 内容 */}
      <div
        className={
          isUser
            ? "max-w-[900px] pl-3 py-2 bg-surface-100 border-l-[3px] border-signal"
            : "max-w-[900px] pl-3 py-1 border-l-[3px] border-line-400"
        }
      >
        {isUser ? (
          <p className="text-[13.5px] leading-relaxed whitespace-pre-wrap text-ink-800">
            {message.content}
          </p>
        ) : isStreaming ? (
          <div className="text-[13.5px] markdown-body text-ink-700">
            <StreamingText text={message.content} />
          </div>
        ) : (
          <div className="text-[13.5px] markdown-body text-ink-700">
            <ReactMarkdown>{message.content}</ReactMarkdown>
          </div>
        )}
      </div>
    </div>
  );
}
