"""
中间件: 停摆熔断器（StallBreaker）—— 把「次数上限」升级为「进度护栏」

为什么需要
----------
系统只有三个计数闸（模型 50 / 工具 30 / 评审 3），没有「进度」概念。实测出现：
- e2e-report-6：99 次模型调用 / 104 次工具 / 2.77M tokens（子 Agent 无上限空转）
- probe-p1-grader-001：56 次模型调用 / 0 次工具 / 216s（grader 空转）
- harness_config.yaml 注释：「minimax-m3 …导致 grader 内部空转数十轮（实测 55 轮 / 210s）」

「一直规划执行不推进」的本质 = 每步模型调用后，工具要么被拒（error）、要么返回重复数据，
这两者都能从 ToolMessage 客观判读。本中间件在每次模型调用前（abefore_model）检查上一步：
连续 N 步「无任何新信息」→ 强制 jump_to=end 结束，而不是撞次数上限。

判定（abefore_model，读 state["messages"] 尾部）：
- 取最后一条带 tool_calls 的 AIMessage 之后的所有 ToolMessage；
- 全部是 error（status=="error" / {"error"…} / 纯[路由拦截]提示）→ 无进度，streak+1；
- 有成功结果，但内容与「本轮已见」完全相同（sha1 去重）→ 无新信息，streak+1；
- 至少一条成功且新内容 → 清零 streak，记入已见集合；
- 该步没调工具（纯文本/首步）→ 跳过，不累计。

轮次边界取「最近一条 user 消息 id」（复用 tool_dedup._last_human_id），
不要用 before_agent 清零：实测 before_agent 同一轮会触发多次，会把 streak 冲掉。

与其它中间件协同：
- ToolDedupMiddleware 把重复调用返回缓存（内容相同）→ 这里判为无新信息；
- BrowserRouteGuardMiddleware 改派成功=新数据（清零），回纯提示=error 类（streak+1）；
- 换参数重试成功拿到新数据 → 立即清零，合法慢任务不误伤。
"""
from __future__ import annotations

import hashlib
from typing import Any

from langchain_core.messages import AIMessage, ToolMessage
from langchain.agents.middleware import AgentMiddleware, Runtime, hook_config

from ..log_utils import middleware_logger
from .tool_dedup import _last_human_id


def _content_hash(content: str) -> str:
    return hashlib.sha1(content.encode("utf-8", errors="replace")).hexdigest()


def _is_error_message(msg: Any) -> bool:
    """error 类结果：error 状态 / 结构化错误 JSON / 纯[路由拦截]提示（无数据）。"""
    if getattr(msg, "status", None) == "error":
        return True
    content = getattr(msg, "content", None)
    if not isinstance(content, str) or not content.strip():
        return False
    head = content.lstrip()[:40]
    if head.startswith('{"error') or head.startswith("{'error"):
        return True
    # 浏览器路由守卫的「纯提示」形如 "[路由拦截] 未执行浏览器访问 X。{提示}"（无数据块）；
    # 改派成功形如 "[路由拦截] …\n\n{API数据}"（有 \n\n 分隔的数据块）。仅前者算无进度。
    if head.startswith("[路由拦截]") and "\n\n" not in content:
        return True
    return False


class StallBreakerMiddleware(AgentMiddleware):
    """连续 N 步无新信息时强制结束 agent，防止空转。"""

    def __init__(self, threshold: int = 3):
        self._threshold = max(1, int(threshold))
        self._streak = 0
        self._epoch = ""
        self._seen: set[str] = set()
        self.tools = []

    @property
    def name(self) -> str:
        return "StallBreakerMiddleware"

    def before_agent(self, state: Any, runtime: Runtime) -> dict[str, Any] | None:
        # 仅当取不到轮次标识（极少数 resume 场景）时退化为每周期清零，避免跨轮误累计
        if not _last_human_id(state):
            self._streak = 0
            self._seen.clear()
        return None

    def _sync_epoch(self, state: Any) -> None:
        epoch = _last_human_id(state)
        if epoch and epoch != self._epoch:
            self._epoch = epoch
            self._streak = 0
            self._seen.clear()

    def _classify_step(self, state: Any) -> str:
        """返回 'progress' / 'no_progress' / 'skip'。"""
        messages = state.get("messages") or []
        if not messages:
            return "skip"

        # 从尾部收集连续的 ToolMessage
        i = len(messages) - 1
        tool_msgs: list = []
        while i >= 0 and isinstance(messages[i], ToolMessage):
            tool_msgs.append(messages[i])
            i -= 1
        if not tool_msgs:
            return "skip"  # 该步未调工具（纯文本/首步），不计停摆

        # 找这些 ToolMessage 之前的 AIMessage，须带 tool_calls
        aim = None
        while i >= 0:
            if isinstance(messages[i], AIMessage):
                aim = messages[i]
                break
            i -= 1
        if aim is None or not getattr(aim, "tool_calls", None):
            return "skip"

        any_new = False
        for m in tool_msgs:
            if _is_error_message(m):
                continue
            content = getattr(m, "content", None)
            if not isinstance(content, str) or not content.strip():
                continue
            h = _content_hash(content)
            if h in self._seen:
                continue
            self._seen.add(h)
            any_new = True
        return "progress" if any_new else "no_progress"

    @hook_config(can_jump_to=["end"])
    def before_model(self, state: Any, runtime: Runtime) -> dict[str, Any] | None:
        self._sync_epoch(state)
        result = self._classify_step(state)
        if result == "progress":
            self._streak = 0
        elif result == "no_progress":
            self._streak += 1

        if self._streak >= self._threshold:
            middleware_logger.warning(
                f"StallBreaker: 连续 {self._streak} 步无新信息，强制结束（jump_to=end）"
            )
            return {
                "jump_to": "end",
                "messages": [
                    AIMessage(
                        content=(
                            f"[停摆熔断] 连续 {self._streak} 步未取得任何新信息，"
                            f"为避免空转已停止本轮执行。已取得的中间结果如下，"
                            f"请直接基于它们给出当前能得到的最佳回答，或换个思路重新提问。"
                        )
                    )
                ],
            }
        return None

    @hook_config(can_jump_to=["end"])
    async def abefore_model(self, state: Any, runtime: Runtime) -> dict[str, Any] | None:
        return self.before_model(state, runtime)
