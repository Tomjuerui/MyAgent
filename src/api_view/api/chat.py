"""
核心 SSE 流式对话 + 中断检测 + 中断恢复 + 展示消息持久化

关键设计：
- 双模式流: stream_mode=["messages", "values"], subgraphs=True
- 输出格式: (namespace, mode, data) 三元组
- 中断检测在 messages 处理之前（values 流优先）
- display_messages 实时累积（用户消息 + 助手回复 + 工具调用）
- SSE 事件协议: token / tool_start / tool_args / tool_result / tool_end / trace / progress / interrupt / done
"""
import json
import uuid
import asyncio
import time
from typing import AsyncGenerator, Optional
from datetime import datetime

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from langgraph.types import Command

from ..agent_loader import agent_loader
from ...agent.schema import ChatRequest, ResumeRequest
from ...agent.log_utils import web_logger
from ...agent.profile import build_injection_block, extract_and_update_profile
from ...agent.trace import TraceCollector
from ...agent.trace.models import STATUS_RUNNING
from ...agent.harness_gate import FACT_TOOLS, audit_report
from ...agent.harness import detect_task_type, load_harness_config

# 父级 astream 静默超过该秒数就发一次心跳（子智能体走 task 工具的 ainvoke，
# 其 token 不进父流，父流会静默数分钟 → 前端像"冻住"）。
HEARTBEAT_SECONDS = 3.0

# T9 评审外环：确定性审计未过时的最大返工轮数（0/1/2 → 最多 3 轮输出）
MAX_REWORK = 2

# Trace 是可观测旁路：handler 不可用时降级为"不采集"，绝不影响对话本身
try:
    from ...agent.trace.handler import LangChainTraceHandler
except Exception as _trace_import_err:  # pragma: no cover
    LangChainTraceHandler = None
    web_logger.warning(f"Trace handler unavailable, tracing disabled: {_trace_import_err}")

# Langfuse 旁路：模块顶层只 import os/log_utils，langfuse 包在函数内延迟 import，
# 因此即使 langfuse 未安装，这里也不会抛错。
from ...agent.trace.langfuse import build_langfuse_handler

router = APIRouter(prefix="/api/chat", tags=["chat"])


def sse_event(event: str, data: dict) -> str:
    """格式化 SSE 事件（严格遵循 event:/data: 协议）"""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


# Harness 阶段 → 前端展示文案
PHASE_LABELS = {
    "planning": "规划中",
    "executing": "执行中",
    "reviewing": "审查中",
    "result": "已完成",
    "thinking": "思考中",
}


class _HumanMessageShim:
    """detect_task_type 只依赖 .type/.content 两个属性，用 shim 免构造真消息对象。"""

    type = "human"

    def __init__(self, content: str):
        self.content = content


def _progress_note(collector: TraceCollector) -> str:
    """心跳文案：当前正在执行的节点/工具名。

    子智能体经 deepagents 的 task 工具用 `subagent.ainvoke` 跑（subagents.py:721），
    其 token 不进父流，父流在整段子智能体运行期间静默——此时提示"子智能体执行中"，
    让前端能显示"仍在跑"，而不是像卡死。
    """
    try:
        running = [
            s for s in collector.iter_spans()
            if s.status == STATUS_RUNNING and s.span_id != collector.root_id
        ]
    except Exception:
        return "处理中"
    if not running:
        return "处理中"
    if any(s.name == "task" for s in running):
        return "子智能体执行中"
    latest = max(running, key=lambda s: s.start_ms)
    return f"{latest.name} 处理中"


def _derive_title(message: str, display_messages: list) -> str:
    """生成会话标题：优先当前提问，否则取首条用户消息（中断/恢复场景 message 为空）"""
    src = (message or "").strip()
    if not src:
        for m in display_messages:
            if m.get("role") == "user" and (m.get("content") or "").strip():
                src = m["content"].strip()
                break
    if not src:
        return "新对话"
    return src[:20] + "..." if len(src) > 20 else src


async def stream_chat_response(
    message: str,
    thread_id: str,
    user_id: str = "default_user",
    resume_data: dict = None,
) -> AsyncGenerator[str, None]:
    """
    核心流式响应生成器

    双流模式（subgraphs=True 时输出为 3-tuple）：
    - (namespace, "values", data): 检测中断（__interrupt__ 字段）
    - (namespace, "messages", data): 逐 token 输出 + 工具调用事件

    消息累积：
    - 实时将 assistant 回复追加到 display_messages
    - 流结束后持久化到 MongoDB
    """
    config = agent_loader.create_config(thread_id)

    # 执行链路采集：每次 SSE 请求（含 resume）一个 run
    collector = TraceCollector(thread_id=thread_id)

    # 两个 handler 并存，各取所需：Langfuse 做全量快照（事后深查/成本），自研做实时前端链路
    callbacks = []
    langfuse_handler = build_langfuse_handler()
    if langfuse_handler is not None:
        callbacks.append(langfuse_handler)
    if LangChainTraceHandler is not None:
        callbacks.append(LangChainTraceHandler(collector))
    config["callbacks"] = callbacks
    config["metadata"] = {
        "langfuse_user_id": user_id,
        "langfuse_session_id": thread_id,
        "langfuse_tags": ["procurement", "deepagent"],
    }

    async def flush_trace(interrupted: bool):
        """补齐未推送的增量 → 压实 → 发 trace_end → 落库"""
        for op, span in collector.drain():
            yield sse_event("trace", {"op": op, "span": span})
        try:
            payload = collector.finalize(interrupted=interrupted)
        except Exception as e:
            web_logger.warning(f"Trace finalize failed: {e}")
            return
        yield sse_event("trace_end", {"run_id": collector.run_id, "stats": payload["stats"]})
        try:
            await agent_loader.save_trace(thread_id, collector.run_id, payload)
        except Exception as e:
            web_logger.warning(f"Failed to save trace: {e}")

    # 加载已有消息（恢复场景）或初始化
    if resume_data:
        display_messages = await agent_loader.get_display_messages(thread_id)
        current_input = Command(resume=resume_data)
    else:
        display_messages = await agent_loader.get_display_messages(thread_id)
        # 仅新会话首条消息注入画像快照：既满足「下一会话生效」，也避免每轮重复注入
        is_new_thread = len(display_messages) == 0
        display_messages.append({
            "id": str(uuid.uuid4()),
            "role": "user",
            "content": message,
            "timestamp": datetime.now().isoformat(),
        })
        if is_new_thread:
            profile_block = build_injection_block(user_id)
            current_input = {"messages": [
                {"role": "user", "content": profile_block + message}
            ]}
        else:
            current_input = {"messages": [{"role": "user", "content": message}]}

    # 当前助手消息累积缓冲
    assistant_content = ""
    tool_calls_buffer = []
    thinking_emitted = False
    phase = "thinking"  # 当前阶段: thinking → planning → executing → reviewing → result
    last_phase = "thinking"  # 上次已发射的阶段（去重）
    last_todos_sig = None  # 上次已发射的 todo 列表签名（去重）
    harness_trace: list = []  # Harness 阶段流转 trace（P3 可观测）
    reviewing_emitted = False  # 本轮是否已发过 reviewing（custom 流是唯一来源，见下方 T4 契约注释）
    harness_review_count = 0   # 本轮评审轮次计数（Trace review span 命名）
    _review_span_id = None     # 当前评审轮 span id
    facts_list: list = []      # Harness 事实累积（事实类工具返回），供 harness_gate 信源比对

    # 任务类型识别（T9 外环只在 tech_selection 白皮书任务上强制返工，避免打扰闲聊）
    _task_type = "default"
    try:
        _task_type = detect_task_type([_HumanMessageShim(message)], load_harness_config())
    except Exception as _detect_err:  # 识别失败降级为不启用外环
        web_logger.warning(f"task type detect failed: {_detect_err}")

    try:
        # 发射“深度思考”事件（前端展示思考动画）
        yield sse_event("thinking", {"status": "start"})

        # 父级 astream 在子智能体运行期间是静默的：deepagents 的 task 工具用
        # `subagent.ainvoke` 一次性等子图跑完（deepagents/middleware/subagents.py:721），
        # 子智能体的 token 不进父流。长任务（实测一次 task 219s）会让前端像"冻住"。
        # 解决：后台 task 灌队列 + 主循环带超时取；静默超过 HEARTBEAT_SECONDS 就
        # 补推已采集的链路事件（callback 采到的子智能体 span）+ 发 progress 心跳。
        # ===== T9 评审外环：确定性审计未过 → 注入返工指令 → 重跑 astream =====
        for rework_round in range(MAX_REWORK + 1):
            # 每轮重置的缓冲（phase/last_phase/harness_trace/facts_list 跨轮延续；
            # harness_review_count 不重置——评审 span_id 要跨返工轮次全局唯一，
            # 否则第 N 轮 review-N 会被后一轮同名覆盖，丢评审历史）
            assistant_content = ""
            tool_calls_buffer = []
            thinking_emitted = False
            reviewing_emitted = False
            last_todos_sig = None
            _review_span_id = None
            audit_result = None
            yield sse_event("thinking", {"status": "start"})
            stream_queue: asyncio.Queue = asyncio.Queue()

            async def _pump_astream():
                try:
                    async for chunk in agent_loader.agent.astream(
                        input=current_input,
                        config=config,
                        stream_mode=["messages", "values", "custom"],
                        subgraphs=True,
                    ):
                        await stream_queue.put(("item", chunk))
                except BaseException as exc:  # noqa: BLE001 — 透传给主循环重抛
                    await stream_queue.put(("error", exc))
                finally:
                    await stream_queue.put(("end", None))

            async def _astream_with_heartbeat():
                pump_task = asyncio.create_task(_pump_astream())
                try:
                    while True:
                        try:
                            yield await asyncio.wait_for(
                                stream_queue.get(), timeout=HEARTBEAT_SECONDS
                            )
                        except asyncio.TimeoutError:
                            yield ("beat", None)
                finally:
                    pump_task.cancel()

            t_start = time.monotonic()
            async for kind, payload in _astream_with_heartbeat():
                # ===== 静默心跳 =====
                if kind == "beat":
                    for op, span in collector.drain():
                        yield sse_event("trace", {"op": op, "span": span})
                    yield sse_event("progress", {
                        "elapsed_ms": int((time.monotonic() - t_start) * 1000),
                        "note": _progress_note(collector),
                    })
                    continue
                if kind == "end":
                    break
                if kind == "error":
                    raise payload

                namespace, chunk_type, chunk = payload
                # ===== 执行链路增量（实时推送 span 开始/结束）=====
                for op, span in collector.drain():
                    yield sse_event("trace", {"op": op, "span": span})

                # ===== 中断检测 + 结构化 Harness 状态读取（必须在 messages 处理之前）=====
                if chunk_type == "values":
                    if isinstance(chunk, dict):
                        # --- 结构化阶段流转（来自 HarnessPhaseMiddleware 写入的 state.phase）---
                        new_phase = chunk.get("phase")
                        if new_phase and new_phase != last_phase:
                            last_phase = new_phase
                            phase = new_phase
                            label = PHASE_LABELS.get(new_phase, new_phase)
                            harness_trace.append({
                                "type": "phase",
                                "phase": new_phase,
                                "label": label,
                                "timestamp": datetime.now().isoformat(),
                            })
                            yield sse_event("phase", {
                                "phase": new_phase,
                                "label": label,
                            })

                        # --- 结构化 todo 列表（来自 TodoListMiddleware 的 write_todos 状态）---
                        todos = chunk.get("todos")
                        if todos is not None:
                            todos_sig = json.dumps(todos, ensure_ascii=False, sort_keys=True)
                            if todos_sig != last_todos_sig:
                                last_todos_sig = todos_sig
                                plan_items = [
                                    {
                                        "id": f"todo-{i}",
                                        "content": t.get("content", ""),
                                        "status": t.get("status", "pending"),
                                    }
                                    for i, t in enumerate(todos)
                                ]
                                if plan_items:
                                    yield sse_event("todo_update", {
                                        "phase": "planning",
                                        "todos": plan_items,
                                    })

                        # --- 中断检测 ---
                        # LangGraph 把中断放在 state 的 __interrupt__ 键；此前只读了不存在的
                        # "interrupts"，导致中断一律走不到这里、done 事件的 interrupted 恒为 false。
                        interrupts = chunk.get("__interrupt__") or chunk.get("interrupts")
                        if interrupts:
                            for interrupt_item in interrupts:
                                interrupt_value = (
                                    interrupt_item.value
                                    if hasattr(interrupt_item, "value")
                                    else interrupt_item
                                )
                                if not isinstance(interrupt_value, dict):
                                    continue
                                # 判断中断类型
                                if interrupt_value.get("type") == "order_info_request":
                                    yield sse_event("interrupt", {
                                        "interrupt_type": "order_info_supplement",
                                        "missing_fields": interrupt_value.get("missing_fields", []),
                                        "message": interrupt_value.get("message", ""),
                                        "extracted_data": interrupt_value.get("current_data", {}),
                                    })
                                    continue
                                # HumanInTheLoopMiddleware 的负载是
                                # {"action_requests": [{"name", "args", "description"}], "review_configs": [...]}，
                                # 归一化成 ApprovalCard 需要的 tool_name / tool_args 形状；
                                # 否则前端会把列表下标当成字段名渲染成一堆 "0" 行。
                                requests_ = interrupt_value.get("action_requests") or []
                                first = (
                                    requests_[0]
                                    if requests_ and isinstance(requests_[0], dict)
                                    else {}
                                )
                                args = first.get("args") if isinstance(first.get("args"), dict) else {}
                                # 并发子 Agent（多个 task 调用）会在同一 super-step 产生多个 pending
                                # interrupt，LangGraph 要求用 {interrupt_id: resume_value} 映射恢复，
                                # 因此把 Interrupt.id 透传给前端，由前端拼 resume map（见 useChat.ts）。
                                yield sse_event("interrupt", {
                                    "interrupt_type": "hitl_approval",
                                    "tool_name": first.get("name", ""),
                                    "tool_args": args,
                                    "order_data": args,
                                    "interrupt_id": getattr(interrupt_item, "id", ""),
                                })

                            # 保存当前累积的消息
                            if assistant_content:
                                display_messages.append({
                                    "id": str(uuid.uuid4()),
                                    "role": "assistant",
                                    "content": assistant_content,
                                    "toolCalls": tool_calls_buffer,
                                    "timestamp": datetime.now().isoformat(),
                                })
                            await agent_loader.save_display_messages(thread_id, display_messages)
                            await agent_loader.save_harness_trace(thread_id, harness_trace)
                            # 中断（审批/补充）也是会话的自然落点，必须入库否则历史列表里看不到
                            await agent_loader.save_conversation(
                                thread_id, user_id, _derive_title(message, display_messages)
                            )
                            async for evt in flush_trace(interrupted=True):
                                yield evt
                            yield sse_event("done", {"thread_id": thread_id, "interrupted": True})
                            return
                    continue

                # ===== Custom 流处理（评审器等中间件的结构化事件）=====
                if chunk_type == "custom":
                    if isinstance(chunk, dict):
                        ev_type = chunk.get("type", "")
                        if ev_type == "rubric_evaluation_start":
                            # reviewing 窗口的唯一来源：grader 评审期间不产生 values 帧，
                            # state.phase 要到 after_agent（评审结束后）才会变化，靠 state
                            # 会晚于 verdict 才显示。planning/executing/result 则唯一来自
                            # state.phase（上方 values 分支）。
                            reviewing_emitted = True
                            if phase != "reviewing":
                                phase = "reviewing"
                                last_phase = "reviewing"
                                yield sse_event("phase", {"phase": "reviewing", "label": "审查中"})
                            # 评审轮 span 起点（Trace 面板可见「第 N 轮评审」）
                            harness_review_count += 1
                            _review_span_id = f"review-{harness_review_count}"
                            collector.start_span(
                                span_id=_review_span_id,
                                parent_id=collector.root_id,
                                kind="review",
                                name=f"rubric_review#{harness_review_count}",
                            )
                        elif ev_type == "rubric_evaluation_end":
                            # 评审器产出结构化判定 → 发射 review_result 事件
                            review_data = {
                                "verdict": chunk.get("result", ""),
                                "explanation": chunk.get("explanation", ""),
                                "criteria": chunk.get("criteria", []),
                                "iteration": chunk.get("iteration", 0),
                            }
                            # 异常路径兜底：start 事件丢失时补发 reviewing
                            if not reviewing_emitted:
                                reviewing_emitted = True
                                yield sse_event("phase", {"phase": "reviewing", "label": "审查中"})
                            # 评审轮 span 终点：判定 + 原因进 result_preview（未通过标 error 红显）
                            collector.end_span(
                                span_id=_review_span_id,
                                status="ok" if review_data["verdict"] == "satisfied" else "error",
                                result_preview=json.dumps(
                                    {
                                        "verdict": review_data["verdict"],
                                        "explanation": review_data["explanation"][:300],
                                    },
                                    ensure_ascii=False,
                                ),
                            )
                            harness_trace.append({
                                "type": "review",
                                **review_data,
                                "timestamp": datetime.now().isoformat(),
                            })
                            yield sse_event("review_result", review_data)
                    continue

                # ===== Messages 流处理 =====
                if chunk_type == "messages":
                    # chunk 格式: (message_chunk, metadata_dict)
                    if isinstance(chunk, (list, tuple)) and len(chunk) >= 1:
                        token = chunk[0]
                    else:
                        token = chunk

                    if token is None:
                        continue

                    token_type = getattr(token, "type", "")
                    content = getattr(token, "content", "")
                    tool_call_chunks = getattr(token, "tool_call_chunks", None)

                    # 思考型模型（hy4-preview-f / deepseek-v4.1-flash）推理期把正文放在
                    # content（此时为空）之外的 additional_kwargs.reasoning_content。
                    # 只实时透传给前端展示「思考过程」，绝不累加进 assistant_content，
                    # 否则推理链会混入研报正文并落库。
                    reasoning = (getattr(token, "additional_kwargs", None) or {}).get(
                        "reasoning_content"
                    )
                    if reasoning and isinstance(reasoning, str) and reasoning.strip():
                        if not thinking_emitted:
                            yield sse_event("thinking", {"status": "end"})
                            thinking_emitted = True
                        yield sse_event("reasoning", {"content": reasoning})

                    # AIMessage with tool_call_chunks → tool_start / tool_args
                    if tool_call_chunks:
                        # 首次收到工具调用时结束 thinking 状态
                        if not thinking_emitted:
                            yield sse_event("thinking", {"status": "end"})
                            thinking_emitted = True
                        for tc in tool_call_chunks:
                            if isinstance(tc, dict):
                                if tc.get("name"):
                                    tool_calls_buffer.append({
                                        "id": tc.get("id", str(uuid.uuid4())),
                                        "name": tc["name"],
                                        "args": "",
                                        "status": "running",
                                    })
                                    yield sse_event("tool_start", {
                                        "name": tc["name"],
                                        "id": tc.get("id", ""),
                                    })
                                if tc.get("args"):
                                    # 追加到最近的 tool_call
                                    if tool_calls_buffer:
                                        tool_calls_buffer[-1]["args"] += tc["args"]
                                    yield sse_event("tool_args", {"args": tc["args"]})
                        continue

                    # ToolMessage → tool_result / tool_end
                    if token_type == "tool":
                        tool_name = getattr(token, "name", "unknown")
                        tool_content = content if isinstance(content, str) else str(content)
                        # 更新 buffer 中对应工具的状态
                        for tc in tool_calls_buffer:
                            if tc["name"] == tool_name and tc["status"] == "running":
                                tc["result"] = tool_content[:1000]
                                tc["status"] = "done"
                                break

                        # Harness 事实累积（T8）：事实类工具返回进入 facts_list，
                        # 供 harness_gate.audit_report 做「URL 必须可追溯」的代码比对
                        if tool_name in FACT_TOOLS:
                            _args = ""
                            for tc in tool_calls_buffer:
                                if tc["name"] == tool_name and tc.get("args"):
                                    _args = tc["args"][:500]
                                    break
                            facts_list.append({"tool": tool_name, "args": _args, "result": tool_content})

                        # 检测 TODO 工具调用，发射任务列表更新事件
                        if "todo" in tool_name.lower() or "task" in tool_name.lower():
                            try:
                                # 尝试从工具参数中提取 todo 列表
                                todo_args = None
                                for tc in tool_calls_buffer:
                                    if tc["name"] == tool_name and tc.get("args"):
                                        todo_args = tc["args"]
                                        break
                                if todo_args:
                                    yield sse_event("todo_update", {
                                        "tool": tool_name,
                                        "args": todo_args[:2000],
                                        "result": tool_content[:500],
                                    })
                            except Exception:
                                pass

                        yield sse_event("tool_result", {
                            "name": tool_name,
                            "content": tool_content[:2000],
                        })
                        yield sse_event("tool_end", {
                            "id": getattr(token, "tool_call_id", ""),
                        })
                        continue

                    # AIMessage 纯文本 → token 事件
                    # ⚠️ 准入判断不能用 content.strip()：网关会把换行/空格单独流成一个分片
                    # （实测一次 18 个分片里有 4 个是纯 '\n' 或 ' '），丢掉之后落库和前端展示的
                    # 正文会把 '## 标题\n正文' 粘成 '## 标题正文' —— 标题、表格、代码围栏集体失效。
                    if content and isinstance(content, str):
                        # 首个「有实际内容」的分片才结束 thinking，纯空白分片只做累积
                        if content.strip() and not thinking_emitted:
                            yield sse_event("thinking", {"status": "end"})
                            thinking_emitted = True
                        assistant_content += content

                        # 判断来源（通过 namespace 元组）
                        source = "main"
                        if namespace:
                            ns_str = str(namespace)
                            if "analyst" in ns_str:
                                source = "analyst"
                            elif "order" in ns_str:
                                source = "order"
                        yield sse_event("token", {"content": content, "source": source})

            # ===== 流正常结束 =====
            if assistant_content:
                display_messages.append({
                    "id": str(uuid.uuid4()),
                    "role": "assistant",
                    "content": assistant_content,
                    "toolCalls": tool_calls_buffer if tool_calls_buffer else None,
                    "timestamp": datetime.now().isoformat(),
                })

            await agent_loader.save_display_messages(thread_id, display_messages)
            await agent_loader.save_harness_trace(thread_id, harness_trace)
            # Harness 确定性审计（T8）：本轮报告 vs 事实库，未过由 T9 外环触发返工
            audit_result = audit_report(facts_list, assistant_content)
            await agent_loader.save_facts(thread_id, facts_list)
            if not audit_result["passed"]:
                web_logger.info(
                    f"Harness audit failed for {thread_id}: "
                    f"missing_urls={len(audit_result['missing_urls'])} "
                    f"chart_missing={len(audit_result['chart_missing'])} "
                    f"risk_missing={audit_result['risk_missing']}"
                )

            # 会话入库：resume 场景 message 为空，用首条用户消息兜底生成标题
            await agent_loader.save_conversation(
                thread_id, user_id, _derive_title(message, display_messages)
            )

            # ===== 确定性审计 → 返工判定（仅 tech_selection 任务启用外环）=====
            if audit_result["passed"] or rework_round >= MAX_REWORK or _task_type != "tech_selection":
                break
            _missing_lines = [f"- {u}" for u in audit_result["missing_urls"]]
            if audit_result["risk_missing"]:
                _missing_lines.append("- 风险警告节缺失")
            if audit_result["chart_missing"]:
                _missing_lines.append(f"- 图表缺失或为空: {', '.join(audit_result['chart_missing'])}")
            rework_text = (
                f"系统确定性审计未通过（第 {rework_round + 1} 轮）。缺失项：\n"
                + "\n".join(_missing_lines)
                + "\n你必须重新调用工具补充采集上述事实（不得仅修改文字），然后重新输出完整白皮书。"
            )
            display_messages.append({
                "id": str(uuid.uuid4()),
                "role": "user",
                "content": rework_text,
                "timestamp": datetime.now().isoformat(),
            })
            current_input = {"messages": [{"role": "user", "content": rework_text}]}
            yield sse_event("rework", {
                "round": rework_round + 1,
                "missing": audit_result["missing_urls"],
                "risk_missing": audit_result["risk_missing"],
                "chart_missing": audit_result["chart_missing"],
            })

        async for evt in flush_trace(interrupted=False):
            yield evt
        yield sse_event("done", {"thread_id": thread_id, "interrupted": False})
        _schedule_profile_extraction(user_id, display_messages)

    except Exception as e:
        web_logger.error(f"Stream error for thread {thread_id}: {e}", exc_info=True)
        # 异常也要留下链路和会话记录，方便事后定位"哪一步失败的"以及历史列表可见
        try:
            if display_messages:
                await agent_loader.save_display_messages(thread_id, display_messages)
            await agent_loader.save_conversation(
                thread_id, user_id, _derive_title(message, display_messages)
            )
        except Exception:
            pass
        try:
            async for evt in flush_trace(interrupted=True):
                yield evt
        except Exception:
            pass
        yield sse_event("error", {"message": f"服务内部错误: {str(e)[:200]}"})
        yield sse_event("done", {"thread_id": thread_id, "interrupted": False})


def _schedule_profile_extraction(user_id: str, display_messages: list):
    """流正常结束后 fire-and-forget 提炼画像（≥2 轮用户消息才触发，失败静默）。"""
    user_count = sum(1 for m in display_messages if m.get("role") == "user")
    if user_count < 2:
        return
    try:
        asyncio.create_task(extract_and_update_profile(user_id, display_messages))
    except Exception as e:
        web_logger.warning(f"Profile extraction schedule failed: {e}")


@router.post("/stream")
async def chat_stream(request: ChatRequest):
    """SSE 流式对话端点"""
    await agent_loader.initialize()

    thread_id = request.thread_id or agent_loader.generate_thread_id()

    return StreamingResponse(
        stream_chat_response(
            message=request.message,
            thread_id=thread_id,
            user_id=request.user_id,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Thread-Id": thread_id,
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/{thread_id}/resume")
async def chat_resume(thread_id: str, request: ResumeRequest):
    """中断恢复端点"""
    await agent_loader.initialize()

    return StreamingResponse(
        stream_chat_response(
            message="",
            thread_id=thread_id,
            resume_data=request.resume,
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Thread-Id": thread_id,
            "X-Accel-Buffering": "no",
        },
    )


@router.get("/{thread_id}/state")
async def chat_state(thread_id: str):
    """获取 Agent 状态（是否处于中断中）"""
    await agent_loader.initialize()
    config = agent_loader.create_config(thread_id)
    try:
        state = await agent_loader.agent.aget_state(config)
        is_interrupted = bool(state.next) if state else False
        return {"thread_id": thread_id, "interrupted": is_interrupted}
    except Exception:
        return {"thread_id": thread_id, "interrupted": False}


@router.get("/{thread_id}/history")
async def chat_history(thread_id: str):
    """获取对话消息历史"""
    messages = await agent_loader.get_display_messages(thread_id)
    return {"thread_id": thread_id, "messages": messages}


@router.get("/{thread_id}/trace/runs")
async def chat_trace_runs(thread_id: str):
    """列出该会话的执行链路 run（轻量，不含 spans）"""
    runs = await agent_loader.list_trace_runs(thread_id)
    return {"thread_id": thread_id, "runs": runs}


@router.get("/{thread_id}/trace")
async def chat_trace(thread_id: str, run_id: Optional[str] = None):
    """获取执行链路：谁调用了谁、每步耗时、失败点、token 归因

    run_id 为空时返回最近一次 run。
    """
    await agent_loader.initialize()
    trace = await agent_loader.get_trace(thread_id, run_id)
    if not trace:
        return {"thread_id": thread_id, "run_id": run_id, "spans": [], "stats": None}
    return trace
