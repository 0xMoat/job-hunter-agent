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

    # ---------- executor node ----------

    def _get_executor(self):
        """Build (lazily) the ReAct sub-agent used to execute a single step."""
        if self._executor is None:
            # Bind tools at the LLMService level to reuse retry/fallback
            llm_service.bind_tools(tools)
            self._executor = create_react_agent(
                llm_service.get_llm(),
                tools=tools,
            )
        return self._executor

    async def _execute_step(self, state: PlanExecuteState, config: RunnableConfig) -> dict:
        """Execute the first step in state.plan with a ReAct sub-agent."""
        if not state.plan:
            logger.warning("pe_executor_called_with_empty_plan")
            return {"iterations": state.iterations + 1}

        step_text = state.plan[0]
        step_index = len(state.past_steps)
        step_prompt = (
            f"You are executing step {step_index + 1} of a larger plan.\n\n"
            f"Your task now: {step_text}\n\n"
            f"User profile (use when helpful):\n{state.long_term_memory or '(none)'}\n\n"
            f"Pending jobs snapshot:\n{state.pending_applications or '(none)'}"
        )

        executor = self._get_executor()
        try:
            result = await executor.ainvoke(
                {"messages": [HumanMessage(content=step_prompt)]},
                config=config,
            )
            final_msg = result["messages"][-1]
            result_text = final_msg.content if isinstance(final_msg.content, str) else str(final_msg.content)
            logger.info("pe_step_executed", step_index=step_index, step_text=step_text)
        except Exception as e:
            result_text = f"FAILED: {e!s}"
            logger.exception("pe_step_failed", step_index=step_index, step_text=step_text)

        return {
            "past_steps": state.past_steps + [(step_text, result_text)],
            "plan": state.plan[1:],
            "iterations": state.iterations + 1,
        }

    # ---------- replanner node ----------

    async def _replan(self, state: PlanExecuteState, config: RunnableConfig) -> dict:
        """Decide whether to finish with a Response or continue with a new Plan."""
        past_steps_text = "\n".join(
            f"{i + 1}. {step}\n   → {result}" for i, (step, result) in enumerate(state.past_steps)
        ) or "（尚无）"
        original_plan_text = "\n".join(
            f"{i + 1}. {s}" for i, s in enumerate([s for s, _ in state.past_steps] + state.plan)
        ) if (state.past_steps or state.plan) else "（无）"

        system_prompt = load_plan_execute_replanner_prompt(
            input=state.input,
            original_plan=original_plan_text,
            past_steps=past_steps_text,
        )
        replanner_llm = llm_service.get_llm().with_structured_output(Act)
        try:
            act: Act = await replanner_llm.ainvoke(
                [SystemMessage(content=system_prompt)],
                config=config,
            )
        except Exception:
            logger.exception("pe_replanner_failed_fallback_to_summary")
            summary = "## 已完成\n" + "\n".join(
                f"- {s}\n  {r[:200]}" for s, r in state.past_steps
            )
            return {"response": summary}

        if isinstance(act.action, PlanResponse):
            logger.info("pe_replan_finish", iterations=state.iterations)
            return {"response": act.action.content}

        logger.info("pe_replan_continue", new_step_count=len(act.action.steps))
        return {"plan": act.action.steps}

    # ---------- routing ----------

    def _should_end(self, state: PlanExecuteState) -> str:
        """Edge: from replanner → executor (continue) or END (finish)."""
        if state.response is not None:
            return END
        if state.iterations >= MAX_ITERATIONS:
            logger.warning("pe_max_iterations_reached", iterations=state.iterations)
            return END
        if not state.plan:
            return END
        return "executor"

    # ---------- graph construction ----------

    async def create_graph(self) -> Optional[CompiledStateGraph]:
        """Build and cache the Plan-Execute StateGraph with checkpointer."""
        if self._graph is not None:
            return self._graph

        builder = StateGraph(PlanExecuteState)
        builder.add_node("planner", self._planner)
        builder.add_node("executor", self._execute_step)
        builder.add_node("replanner", self._replan)
        builder.set_entry_point("planner")
        builder.add_edge("planner", "executor")
        builder.add_edge("executor", "replanner")
        builder.add_conditional_edges("replanner", self._should_end, ["executor", END])

        pool = await self._get_connection_pool()
        checkpointer = AsyncPostgresSaver(pool) if pool else None
        if checkpointer:
            await checkpointer.setup()

        self._graph = builder.compile(
            checkpointer=checkpointer,
            name=f"{settings.PROJECT_NAME} PE ({settings.ENVIRONMENT.value})",
        )
        logger.info("pe_graph_created", environment=settings.ENVIRONMENT.value)
        return self._graph
