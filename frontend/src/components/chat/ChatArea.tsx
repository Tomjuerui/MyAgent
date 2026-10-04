"use client";

import { useState } from "react";
import { ChatMessage, InterruptData, TodoItem, TraceRunSummary, TraceSpan, TraceStats } from "@/lib/types";
import { RunBoundary } from "@/lib/timeline-mode";
import MessageList from "./MessageList";
import WelcomeScreen from "./WelcomeScreen";
import InputBar from "./InputBar";
import ThinkingIndicator from "./ThinkingIndicator";
import TodoListPanel from "./TodoListPanel";
import HarnessPhaseBar from "./HarnessPhaseBar";
import ToolCallToggle from "@/components/common/ToolCallToggle";
import ErrorBanner from "@/components/common/ErrorBanner";
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
  traceStats: TraceStats | null;
  traceRuns: TraceRunSummary[];
  activeRunId: string | null;
  traceBoundaries: RunBoundary[];
  error: string | null;
  loadingThread: boolean;
  onDismissError: () => void;
  onSelectTraceRun: (runId: string | null) => void;
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
  traceStats,
  traceRuns,
  activeRunId,
  traceBoundaries,
  error,
  loadingThread,
  onDismissError,
  onSelectTraceRun,
  onSend,
  onSupplement,
  onApprove,
  onReject,
}: Props) {
  const [showToolCalls, setShowToolCalls] = useState(true);
  const [showTrace, setShowTrace] = useState(false);
  const hasContent = messages.length > 0 || loadingThread;

  return (
    <main className="ic-atmosphere relative flex h-full min-w-0 flex-1 flex-col">
      {/* 顶部工具栏：去掉实心横线与「控制台」标签，只留悬浮控件 */}
      {hasContent && (
        <div className="flex items-center justify-end gap-2 px-6 py-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTrace((v) => !v)}
              className={
                showTrace
                  ? "ic-btn px-2.5 py-1 text-[12px]"
                  : "ic-btn-ghost px-2.5 py-1 text-[12px]"
              }
            >
              执行链路
              {traceSpans.length > 0 && (
                <span className="ic-tag ic-tag-signal px-1.5 py-0 text-[10px]">
                  {traceSpans.length}
                </span>
              )}
            </button>
            <ToolCallToggle show={showToolCalls} onToggle={setShowToolCalls} />
          </div>
        </div>
      )}

      {/* 错误提示 — 之前 error 状态被吞掉，失败时界面毫无反馈 */}
      {error && <ErrorBanner message={error} onDismiss={onDismissError} />}

      {/* TODO 任务列表 */}
      <TodoListPanel items={todoItems} visible={todoVisible} />

      {/* Harness 阶段指示器 */}
      <HarnessPhaseBar phase={phase} phaseLabel={phaseLabel} visible={streaming || phase === "done"} />

      {/* 消息区域 / 欢迎页。空态把输入框交给 hero，标题与输入框才能同屏 */}
      {hasContent ? (
        <MessageList
          messages={messages}
          streaming={streaming}
          showToolCalls={showToolCalls}
          loading={loadingThread}
        />
      ) : (
        <WelcomeScreen onPromptClick={onSend}>
          <InputBar
            onSend={onSend}
            disabled={streaming}
            queued={pendingQueue.length}
            variant="inline"
          />
        </WelcomeScreen>
      )}

      {/* 深度思考动画 */}
      {thinking && <ThinkingIndicator visible={thinking} label={phaseLabel} />}

      {/* 中断交互区 */}
      {interrupted && interruptData && (
        <InterruptBanner
          data={interruptData}
          onSupplement={onSupplement}
          onApprove={onApprove}
          onReject={onReject}
        />
      )}

      {/* 输入区（会话态才粘底；空态已在 hero 内渲染过一份） */}
      {hasContent && (
        <InputBar onSend={onSend} disabled={streaming} queued={pendingQueue.length} />
      )}

      {/* 执行链路抽屉 */}
      {showTrace && (
        <TracePanel
          spans={traceSpans}
          stats={traceStats}
          streaming={streaming}
          runs={traceRuns}
          activeRunId={activeRunId}
          boundaries={traceBoundaries}
          onSelectRun={onSelectTraceRun}
          onClose={() => setShowTrace(false)}
        />
      )}
    </main>
  );
}
