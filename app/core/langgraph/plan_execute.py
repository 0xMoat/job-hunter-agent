"""Plan-and-Execute subgraph agent.

Distinct from the ReAct main agent in graph.py. Runs a classic
planner → executor → replanner loop with structured LLM outputs.
"""

import asyncio
import json as _json
import time
from datetime import datetime
from typing import AsyncGenerator, Optional
from urllib.parse import quote_plus

from langchain_core.messages import HumanMessage, SystemMessage
from langfuse.langchain import CallbackHandler
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import create_react_agent
from langgraph.types import RunnableConfig
from mem0 import AsyncMemory
from psycopg_pool import AsyncConnectionPool

from app.core.config import Environment, settings
from app.core.langgraph.tools import tools
from app.core.logging import logger
from app.core.prompts import (
    load_plan_execute_planner_prompt,
    load_plan_execute_replanner_prompt,
    load_fact_extraction_prompt,
)
from app.schemas import Act, Plan, PlanExecuteState, PlanResponse
from app.services.job_service import job_service
from app.services.llm import llm_service

MAX_ITERATIONS = 10


class PlanExecuteAgent:
    """Plan-and-Execute agent — independent subgraph, shares tools/memory/checkpointer."""

    def __init__(self):
        """Initialize the PlanExecuteAgent with lazy pool/graph/memory handles."""
        self._connection_pool: Optional[AsyncConnectionPool] = None
        self._graph: Optional[CompiledStateGraph] = None
        self._executor = None
        self.memory: Optional[AsyncMemory] = None
        logger.info("plan_execute_agent_initialized", environment=settings.ENVIRONMENT.value)

    # ---------- shared helpers (thin wrappers around services) ----------

    async def _long_term_memory(self) -> AsyncMemory:
        if self.memory is None:
            self.memory = await AsyncMemory.from_config(
                config_dict={
                    "vector_store": {
                        "provider": "pgvector",
                        "config": {
                            "collection_name": settings.LONG_TERM_MEMORY_COLLECTION_NAME,
                            "embedding_model_dims": 3072,
                            "hnsw": False,
                            "dbname": settings.POSTGRES_DB,
                            "user": settings.POSTGRES_USER,
                            "password": settings.POSTGRES_PASSWORD,
                            "host": settings.POSTGRES_HOST,
                            "port": settings.POSTGRES_PORT,
                        },
                    },
                    "llm": {
                        "provider": "openai",
                        "config": {
                            "model": settings.LONG_TERM_MEMORY_MODEL,
                            "api_key": settings.DEEPSEEK_API_KEY,
                            "openai_base_url": "https://api.deepseek.com",
                        },
                    },
                    "embedder": {
                        "provider": "openai",
                        "config": {
                            "model": settings.LONG_TERM_MEMORY_EMBEDDER_MODEL,
                            "api_key": settings.OPENAI_API_KEY,
                            "openai_base_url": settings.LLM_BASE_URL,
                            "embedding_dims": 3072,
                        },
                    },
                    "custom_fact_extraction_prompt": load_fact_extraction_prompt(),
                }
            )
        return self.memory

    async def _get_connection_pool(self) -> AsyncConnectionPool:
        if self._connection_pool is None:
            max_size = settings.POSTGRES_POOL_SIZE
            connection_url = (
                "postgresql://"
                f"{quote_plus(settings.POSTGRES_USER)}:{quote_plus(settings.POSTGRES_PASSWORD)}"
                f"@{settings.POSTGRES_HOST}:{settings.POSTGRES_PORT}/{settings.POSTGRES_DB}"
            )
            self._connection_pool = AsyncConnectionPool(
                connection_url,
                open=False,
                max_size=max_size,
                kwargs={"autocommit": True, "connect_timeout": 5, "prepare_threshold": None},
            )
            await self._connection_pool.open()
        return self._connection_pool

    async def _get_relevant_memory(self, user_id: str, query: str) -> str:
        try:
            memory = await self._long_term_memory()
            results = await memory.search(user_id=str(user_id), query=query)
            return "\n".join([f"* {r['memory']}" for r in results["results"]])
        except Exception:
            logger.exception("pe_memory_search_failed", user_id=user_id)
            return ""

    async def _get_pending_applications(self, user_id: str) -> str:
        try:
            apps = await job_service.list_applications(int(user_id))
            pending = [a for a in apps if a.status == "pending"]
            if not pending:
                return ""
            lines = []
            for i, app in enumerate(pending, 1):
                company = f" {app.company} —" if app.company else ""
                url = f" {app.url}" if app.url else ""
                lines.append(f"{i}. [{app.title}]{company}{url}")
            return "\n".join(lines)
        except Exception:
            logger.exception("pe_pending_apps_failed", user_id=user_id)
            return ""

    # ---------- planner node ----------

    async def _planner(self, state: PlanExecuteState, config: RunnableConfig) -> dict:
        """Generate the initial plan using structured output."""
        system_prompt = load_plan_execute_planner_prompt(
            input=state.input,
            long_term_memory=state.long_term_memory or "（无）",
            pending_applications=state.pending_applications or "（无）",
        )
        planner_llm = llm_service.get_llm().with_structured_output(Plan)
        result: Plan = await planner_llm.ainvoke(
            [SystemMessage(content=system_prompt)],
            config=config,
        )
        logger.info(
            "pe_plan_generated",
            step_count=len(result.steps),
            session_id=config.get("configurable", {}).get("thread_id"),
        )
        return {"plan": result.steps}
