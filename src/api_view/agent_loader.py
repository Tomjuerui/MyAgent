"""
AgentLoader 单例
持有 agent 实例、MongoDB 连接、create_config、save/get_display_messages
"""
import uuid
from typing import Optional
from datetime import datetime

from ..agent.log_utils import web_logger
from ..agent.schema import ProcurementContext
from .web_config import get_db


class AgentLoader:
    """Agent 加载器单例 - 管理 Agent 生命周期."""

    _instance: Optional['AgentLoader'] = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self.agent = None
        self._checkpointer = None
        self._store = None
        web_logger.info("AgentLoader initialized")

    async def initialize(self):
        """初始化 Agent（延迟加载）"""
        if self.agent is not None:
            return

        web_logger.info("Initializing agent...")
        try:
            from langgraph.checkpoint.mongodb import MongoDBSaver
            from .mongodb_store import MongoDBStore
            from .web_config import MONGODB_URI, MONGODB_DB_NAME

            # 生产级存储：MongoDB 持久化
            from pymongo import MongoClient
            mongo_client = MongoClient(MONGODB_URI)
            self._checkpointer = MongoDBSaver(mongo_client)
            self._mongo_client = mongo_client
            self._store = MongoDBStore(
                uri=MONGODB_URI,
                db_name=MONGODB_DB_NAME,
                collection_name="langgraph_store",
            )

            from ..agent.main_agent import create_main_agent
            context = ProcurementContext()
            self.agent = create_main_agent(
                user_context=context,
                checkpointer=self._checkpointer,
                store=self._store,
            )
            web_logger.info("Agent initialized successfully")
        except Exception as e:
            web_logger.error(f"Failed to initialize agent: {e}")
            raise

    def create_config(self, thread_id: str) -> dict:
        """创建 LangGraph 运行配置"""
        return {
            "configurable": {
                "thread_id": thread_id,
            }
        }

    def generate_thread_id(self) -> str:
        """生成新的会话线程ID"""
        return str(uuid.uuid4())

    async def save_display_messages(self, thread_id: str, messages: list):
        """保存前端展示消息到 MongoDB"""
        db = get_db()
        await db.display_messages.update_one(
            {"thread_id": thread_id},
            {"$set": {"messages": messages, "updated_at": datetime.now().isoformat()}},
            upsert=True,
        )

    async def get_display_messages(self, thread_id: str) -> list:
        """获取前端展示消息"""
        db = get_db()
        doc = await db.display_messages.find_one({"thread_id": thread_id})
        return doc.get("messages", []) if doc else []

    async def save_conversation(self, thread_id: str, user_id: str, title: str = "新对话"):
        """保存/更新会话记录"""
        db = get_db()
        await db.conversations.update_one(
            {"thread_id": thread_id},
            {"$set": {"user_id": user_id, "title": title, "updated_at": datetime.now().isoformat()},
             "$setOnInsert": {"created_at": datetime.now().isoformat()}},
            upsert=True,
        )

    async def get_conversations(self, user_id: str) -> list:
        """获取用户的会话列表"""
        db = get_db()
        cursor = db.conversations.find({"user_id": user_id}).sort("updated_at", -1)
        conversations = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            conversations.append(doc)
        return conversations

    async def delete_conversation(self, thread_id: str):
        """删除会话（连带清理展示消息 / harness trace / 执行链路 trace / 采集事实）"""
        db = get_db()
        await db.conversations.delete_one({"thread_id": thread_id})
        await db.display_messages.delete_one({"thread_id": thread_id})
        await db.harness_traces.delete_one({"thread_id": thread_id})
        await db.agent_traces.delete_many({"thread_id": thread_id})
        await db.agent_facts.delete_many({"thread_id": thread_id})

    async def save_harness_trace(self, thread_id: str, trace: list):
        """保存 Harness 阶段流转 trace 到 MongoDB（可观测/审计）

        记录 Planning → Executing → Review → Result 各阶段的流转时间线，
        以及评审器的结构化判定结果，支持事后审计"哪一步卡住了"。
        """
        db = get_db()
        await db.harness_traces.update_one(
            {"thread_id": thread_id},
            {"$set": {"trace": trace, "updated_at": datetime.now().isoformat()}},
            upsert=True,
        )

    async def save_facts(self, thread_id: str, facts: list):
        """保存本轮采集事实（Harness 确定性审计的信源比对依据）"""
        db = get_db()
        await db.agent_facts.update_one(
            {"thread_id": thread_id},
            {"$set": {"facts": facts, "updated_at": datetime.now().isoformat()}},
            upsert=True,
        )

    # ===== 执行链路 Trace（谁调用了谁 / 耗时 / 失败 / token）=====

    async def save_trace(self, thread_id: str, run_id: str, payload: dict):
        """保存一次 turn 的执行链路（一 run 一文档）"""
        db = get_db()
        await db.agent_traces.update_one(
            {"run_id": run_id},
            {"$set": {**payload, "updated_at": datetime.now().isoformat()}},
            upsert=True,
        )

    async def get_trace(self, thread_id: str, run_id: Optional[str] = None):
        """获取执行链路；run_id 为空时返回该会话最近一次 run"""
        db = get_db()
        if run_id:
            doc = await db.agent_traces.find_one({"run_id": run_id, "thread_id": thread_id})
        else:
            docs = await (
                db.agent_traces.find({"thread_id": thread_id})
                .sort("started_at", -1)
                .limit(1)
                .to_list(length=1)
            )
            doc = docs[0] if docs else None
        if not doc:
            return None
        doc["_id"] = str(doc["_id"])
        return doc

    async def list_trace_runs(self, thread_id: str, limit: int = 50) -> list:
        """列出该会话的所有 run（轻量，不含 spans）"""
        db = get_db()
        cursor = (
            db.agent_traces.find(
                {"thread_id": thread_id},
                {"run_id": 1, "started_at": 1, "ended_at": 1, "status": 1, "stats": 1},
            )
            .sort("started_at", -1)
            .limit(limit)
        )
        runs = []
        async for doc in cursor:
            doc["_id"] = str(doc["_id"])
            runs.append(doc)
        return runs


# 全局单例
agent_loader = AgentLoader()
