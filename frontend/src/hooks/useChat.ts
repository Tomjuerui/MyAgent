"use client";

import { useState, useCallback, useRef } from "react";
import { v4 as uuidv4 } from "uuid";
import { ChatMessage, ToolCallInfo, SSEEvent, InterruptData, TodoItem, TraceSpan, TraceStats, TraceRunSummary } from "@/lib/types";
import { streamChat, resumeChat, fetchTrace, fetchTraceRuns } from "@/lib/api";
import { useSSE } from "./useSSE";

const USER_ID = "user-001";
const USERNAME = "采购管理员";

export type HarnessPhase = "idle" | "thinking" | "planning" | "executing" | "reviewing" | "done";

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [interrupted, setInterrupted] = useState(false);
  const [interruptData, setInterruptData] = useState<InterruptData | null>(null);
  const [threadId, setThreadId] = useState<string>(uuidv4());
  const [error, setError] = useState<string | null>(null);
  const [todoItems, setTodoItems] = useState<TodoItem[]>([]);
  const [todoVisible, setTodoVisible] = useState(false);
  const [phase, setPhase] = useState<HarnessPhase>("idle");
  const [phaseLabel, setPhaseLabel] = useState("");
  const [pendingQueue, setPendingQueue] = useState<string[]>([]);
  const [traceSpans, setTraceSpans] = useState<TraceSpan[]>([]);
  const [traceStats, setTraceStats] = useState<TraceStats | null>(null);
  const [traceRuns, setTraceRuns] = useState<TraceRunSummary[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);

  const threadIdRef = useRef(threadId);
  threadIdRef.current = threadId;

  const assistantMsgRef = useRef<string>("");
  const toolCallsRef = useRef<ToolCallInfo[]>([]);
  const currentToolIdRef = useRef<string>("");
  const pendingQueueRef = useRef<string[]>([]);
  // 本轮暂停中累积的 LangGraph Interrupt.id（并发子 Agent 可能同时挂起多个 interrupt，
  // 恢复时须拼成 {interrupt_id: {"decisions":[...]}} 映射）
  const pendingInterruptIdsRef = useRef<string[]>([]);

  const resetAssistantState = useCallback(() => {
    assistantMsgRef.current = "";
    toolCallsRef.current = [];
    currentToolIdRef.current = "";
  }, []);

  const updateAssistantMessage = useCallback(() => {
    setMessages((prev) => {
      const lastMsg = prev[prev.length - 1];
      const updated: ChatMessage = {
        id: lastMsg?.role === "assistant" ? lastMsg.id : uuidv4(),
        role: "assistant",
        content: assistantMsgRef.current,
        toolCalls: [...toolCallsRef.current],
        timestamp: Date.now(),
      };
      if (lastMsg?.role === "assistant") {
        return [...prev.slice(0, -1), updated];
      }
      return [...prev, updated];
    });
  }, []);

  const handleEvent = useCallback(
    (event: SSEEvent) => {
      switch (event.type) {
        case "token":
          assistantMsgRef.current += event.content;
          updateAssistantMessage();
          break;

        case "tool_start": {
          const tc: ToolCallInfo = {
            id: event.id,
            name: event.name,
            args: "",
            status: "running",
          };
          toolCallsRef.current = [...toolCallsRef.current, tc];
          currentToolIdRef.current = event.id;
          updateAssistantMessage();
          break;
        }

        case "tool_args": {
          toolCallsRef.current = toolCallsRef.current.map((tc) =>
            tc.id === currentToolIdRef.current
              ? { ...tc, args: tc.args + event.args }
              : tc
          );
          updateAssistantMessage();
          break;
        }

        case "tool_result": {
          toolCallsRef.current = toolCallsRef.current.map((tc) =>
            tc.name === event.name && tc.status === "running"
              ? { ...tc, result: event.content, status: "done" as const }
              : tc
          );
          updateAssistantMessage();
          break;
        }

        case "tool_end": {
          toolCallsRef.current = toolCallsRef.current.map((tc) =>
            tc.id === event.id ? { ...tc, status: "done" as const } : tc
          );
          updateAssistantMessage();
          break;
        }

        case "interrupt":
          setInterrupted(true);
          // 后端 sse_event 发的是扁平 JSON（interrupt_type/tool_name/tool_args 在顶层，
          // 无 data 包装），直接把事件本体存入即可；event.data 为旧协议残留字段
          setInterruptData({
            interrupt_type: event.interrupt_type ?? "",
            tool_name: event.tool_name,
            tool_args: event.tool_args,
            order_data: event.order_data,
            extracted_data: event.extracted_data,
            missing_fields: event.missing_fields,
            message: event.message,
          });
          if (event.interrupt_id && !pendingInterruptIdsRef.current.includes(event.interrupt_id)) {
            pendingInterruptIdsRef.current.push(event.interrupt_id);
          }
          break;

        case "thinking":
          if (event.status === "start") {
            setThinking(true);
            setPhase("thinking");
            setPhaseLabel("💭 深度思考中");
          } else {
            // 延迟结束 thinking，保证动画至少显示 800ms
            setTimeout(() => setThinking(false), 800);
          }
          break;

        case "phase":
          setPhase(event.phase as HarnessPhase);
          setPhaseLabel(event.label);
          break;

        case "todo_update": {
          // 新格式：后端直接发送 todos 数组
          if (event.todos && Array.isArray(event.todos)) {
            const items: TodoItem[] = event.todos.map((t) => ({
              id: t.id || `todo-${Math.random().toString(36).slice(2)}`,
              content: t.content || "",
              status: (t.status as TodoItem["status"]) || "pending",
            }));
            setTodoItems(items);
            setTodoVisible(true);
          } else if (event.status_change === "executing") {
            // 执行阶段：将所有 pending 改为 in_progress
            setTodoItems((prev) =>
              prev.map((item) =>
                item.status === "pending" ? { ...item, status: "in_progress" as const } : item
              )
            );
          } else if (event.args) {
            // 兼容旧格式
            try {
              const args = JSON.parse(event.args);
              if (args.todos && Array.isArray(args.todos)) {
                const items: TodoItem[] = args.todos.map((t: Record<string, unknown>, i: number) => ({
                  id: (t.id as string) || `todo-${i}`,
                  content: (t.content as string) || "",
                  status: (t.status as TodoItem["status"]) || "pending",
                }));
                setTodoItems(items);
                setTodoVisible(true);
              }
            } catch {
              // 解析失败静默处理
            }
          }
          break;
        }

        case "trace":
          // 增量 patch：start 插入，end 就地更新（耗时/token/error 只有 end 才有）
          setTraceSpans((prev) => {
            const idx = prev.findIndex((s) => s.span_id === event.span.span_id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = { ...next[idx], ...event.span };
              return next;
            }
            return [...prev, event.span];
          });
          break;

        case "trace_end":
          setTraceStats(event.stats);
          setActiveRunId(event.run_id);
          break;

        case "done":
          setStreaming(false);
          setPhase("done");
          setPhaseLabel("✅ 完成");
          // 本轮 trace 已在 done 之前落库，刷新 run 列表供切换查看
          {
            const id = threadIdRef.current;
            fetchTraceRuns(id)
              .then((runs) => {
                if (threadIdRef.current === id) setTraceRuns(runs);
              })
              .catch(() => {});
          }
          setTodoItems((prev) =>
            prev.map((item) =>
              item.status !== "cancelled" ? { ...item, status: "complete" as const } : item
            )
          );
          if (event.interrupted) {
            setInterrupted(true);
          }
          // 检查排队队列，有消息自动发出
          const q = pendingQueueRef.current;
          if (q.length > 0) {
            const next = q.shift()!;
            setPendingQueue([...q]);
            // 延迟一帧发送，确保 streaming 状态已更新
            setTimeout(() => doSend(next), 50);
          }
          break;
      }
    },
    [updateAssistantMessage]
  );

  const { start, abort } = useSSE({
    onEvent: handleEvent,
    onError: (err) => {
      setError(err.message);
      setStreaming(false);
    },
    onComplete: () => {
      setStreaming(false);
    },
  });

  // 实际的发送逻辑（非排队）
  const doSend = useCallback(
    (content: string) => {
      setError(null);
      setInterrupted(false);
      setInterruptData(null);
      pendingInterruptIdsRef.current = [];
      setThinking(false);
      setTodoItems([]);
      setTodoVisible(false);
      setPhase("idle");
      setPhaseLabel("");
      resetAssistantState();
      // 新一轮提问 → 清空上一轮链路；resume 走的路径不清（审批恢复属于同一轮）
      setTraceSpans([]);
      setTraceStats(null);
      setActiveRunId(null);

      const userMsg: ChatMessage = {
        id: uuidv4(),
        role: "user",
        content: content.trim(),
        timestamp: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg]);
      setStreaming(true);

      start((onChunk, signal) =>
        streamChat(
          {
            message: content.trim(),
            thread_id: threadId,
            user_id: USER_ID,
            username: USERNAME,
          },
          onChunk,
          signal
        )
      );
    },
    [threadId, start, resetAssistantState]
  );

  const sendMessage = useCallback(
    (content: string) => {
      if (!content.trim()) return;

      if (streaming) {
        // 正在回答：加入排队队列，回答完后自动发送
        const q = [...pendingQueueRef.current, content.trim()];
        pendingQueueRef.current = q;
        setPendingQueue(q);
        return;
      }

      doSend(content.trim());
    },
    [streaming, doSend]
  );

  const resumeWith = useCallback(
    (resumeData: Record<string, unknown>) => {
      setInterrupted(false);
      setInterruptData(null);
      setStreaming(true);
      // 本轮暂停的 interrupt id 已随本次恢复消费，清空以便下一轮暂停重新累积
      pendingInterruptIdsRef.current = [];
      resetAssistantState();

      start((onChunk, signal) =>
        resumeChat(
          { thread_id: threadId, resume: resumeData },
          onChunk,
          signal
        )
      );
    },
    [threadId, start, resetAssistantState]
  );

  // 审批/驳回：若本轮暂停挂起了多个 interrupt（并发子 Agent 场景），
  // 拼成 LangGraph 要求的 {interrupt_id: {"decisions":[...]}} 映射；
  // 否则退回单 interrupt 的 {"decisions":[...]} 形式（向后兼容旧后端）。
  const resumeApproval = useCallback(
    (decision: "approve" | "reject") => {
      const ids = pendingInterruptIdsRef.current.filter((id) => id && id.length > 0);
      const decisions = [{ type: decision }];
      const resume: Record<string, unknown> =
        ids.length > 0
          ? Object.fromEntries(ids.map((id) => [id, { decisions }]))
          : { decisions };
      resumeWith(resume);
    },
    [resumeWith]
  );

  const newChat = useCallback(() => {
    abort();
    setMessages([]);
    setStreaming(false);
    setInterrupted(false);
    setInterruptData(null);
    pendingInterruptIdsRef.current = [];
    setError(null);
    setThreadId(uuidv4());
    setPendingQueue([]);
    pendingQueueRef.current = [];
    resetAssistantState();
    setTraceSpans([]);
    setTraceStats(null);
    setTraceRuns([]);
    setActiveRunId(null);
  }, [abort, resetAssistantState]);

  const loadThread = useCallback(
    (id: string, msgs: ChatMessage[]) => {
      abort();
      setThreadId(id);
      setMessages(msgs);
      setStreaming(false);
      setInterrupted(false);
      setInterruptData(null);
      pendingInterruptIdsRef.current = [];
      setError(null);
      resetAssistantState();
      setTraceSpans([]);
      setTraceStats(null);
      setTraceRuns([]);
      setActiveRunId(null);
      // 历史会话的链路已落库：并行拉「run 列表」和「最近一次 run 的 spans」
      fetchTraceRuns(id)
        .then((runs) => {
          if (threadIdRef.current !== id) return; // 用户已切走
          setTraceRuns(runs);
        })
        .catch(() => {});
      fetchTrace(id)
        .then((trace) => {
          if (threadIdRef.current !== id) return;
          setTraceSpans(trace.spans ?? []);
          setTraceStats(trace.stats ?? null);
          setActiveRunId(trace.run_id ?? null);
        })
        .catch(() => {});
    },
    [abort, resetAssistantState]
  );

  const selectTraceRun = useCallback(
    (runId: string | null) => {
      const id = threadIdRef.current;
      setActiveRunId(runId);
      if (!runId) {
        setTraceSpans([]);
        setTraceStats(null);
        return;
      }
      fetchTrace(id, runId)
        .then((trace) => {
          if (threadIdRef.current !== id) return;
          setTraceSpans(trace.spans ?? []);
          setTraceStats(trace.stats ?? null);
        })
        .catch(() => {});
    },
    []
  );

  return {
    messages,
    streaming,
    thinking,
    interrupted,
    interruptData,
    threadId,
    error,
    todoItems,
    todoVisible,
    pendingQueue,
    phase,
    phaseLabel,
    traceSpans,
    traceStats,
    traceRuns,
    activeRunId,
    selectTraceRun,
    sendMessage,
    resumeWith,
    resumeApproval,
    newChat,
    loadThread,
    abort,
  };
}
