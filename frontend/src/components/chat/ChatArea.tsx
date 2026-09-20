"use client";

import { useState } from "react";
import { ChatMessage, InterruptData, TodoItem, TraceSpan } from "@/lib/types";
import MessageList from "./MessageList";
import WelcomeScreen from "./WelcomeScreen";
import InputBar from "./InputBar";
import ThinkingIndicator from "./ThinkingIndicator";
import TodoListPanel from "./TodoListPanel";
import HarnessPhaseBar from "./HarnessPhaseBar";
import ToolCallToggle from "@/components/common/ToolCallToggle";
import InterruptBanner from "@/components/interrupt/InterruptBanner";
import TracePanel from "@/components/trace/TracePanel";

interface Props {
  messages: ChatMessage[];
  streaming: boolean;
  thinking: boolean;
  interrupted: boolean;
  interruptData: InterruptData | null;
  todoItems: TodoItem[];
  todoVisible: boolean;
  pendingQueue: string[];
  phase: string;
  phaseLabel: string;
  traceSpans: TraceSpan[];
  onSend: (msg: string) => void;
  onSupplement: (text: string) => void;
  onApprove: () => void;
  onReject: () => void;
}

export default function ChatArea({
  messages,
  streaming,
  thinking,
  interrupted,
  interruptData,
  todoItems,
  todoVisible,
  pendingQueue,
  phase,
  phaseLabel,
  traceSpans,
  onSend,
  onSupplement,
  onApprove,
  onReject,
}: Props) {
  const [showToolCalls, setShowToolCalls] = useState(true);
  const [showTrace, setShowTrace] = useState(false);
  const hasMessages = messages.length > 0;

  return (
    <main className="flex-1 flex flex-col h-screen bg-surface-050 min-w-0">
      {/* 顶部工具栏 */}
      {hasMessages && (
        <div className="flex items-center justify-between px-8 py-2 border-b border-line-200 bg-surface-000">
          <span className="ic-label">采购控制台</span>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowTrace((v) => !v)}
              className={
                showTrace ? "ic-btn px-2 py-1 text-[11px]" : "ic-btn-ghost px-2 py-1 text-[11px]"
              }
            >
              执行链路
            </button>
            <ToolCallToggle show={showToolCalls} onToggle={setShowToolCalls} />
          </div>
        </div>
      )}

      {/* TODO 任务列表 - 最顶层悬浮（在 main 层级，不被任何父级影响） */}
      <TodoListPanel items={todoItems} visible={todoVisible} />

      {/* Harness 阶段指示器 */}
      <HarnessPhaseBar phase={phase} phaseLabel={phaseLabel} visible={streaming || phase === "done"} />

      {/* 消息区域 / 欢迎页 */}
      {hasMessages ? (
        <MessageList
          messages={messages}
          streaming={streaming}
          showToolCalls={showToolCalls}
        />
      ) : (
        <WelcomeScreen onPromptClick={onSend} />
      )}

      {/* 深度思考动画 */}
      {thinking && <ThinkingIndicator visible={thinking} />}

      {/* 中断交互区 */}
      {interrupted && interruptData && (
        <InterruptBanner
          data={interruptData}
          onSupplement={onSupplement}
          onApprove={onApprove}
          onReject={onReject}
        />
      )}

      {/* 输入区 */}
      <InputBar onSend={onSend} disabled={streaming} queued={pendingQueue.length} />

      {/* 执行链路抽屉 */}
      {showTrace && (
        <TracePanel
          spans={traceSpans}
          streaming={streaming}
          onClose={() => setShowTrace(false)}
        />
      )}
    </main>
  );
}
