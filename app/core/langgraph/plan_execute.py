"""Plan-and-Execute subgraph agent.

Distinct from the ReAct main agent in graph.py. Runs a classic
planner → executor → replanner loop with structured LLM outputs.
"""

import asyncio
import json as _json
import time
import uuid
from datetime import datetime
from typing import Any, AsyncGenerator, Optional
from urllib.parse import quote_plus

from langchain_core.messages import AIMessageChunk, HumanMessage, SystemMessage, ToolMessage
from langchain_deepseek import ChatDeepSeek
from langfuse.langchain import CallbackHandler
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import create_react_agent
from langgraph.prebuilt.chat_agent_executor import AgentState
from langgraph.types import Command, RunnableConfig, interrupt
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

MAX_ITERATIONS = 50


class _ExecutorState(AgentState):
    """Extended state for the executor sub-agent.

    Adds `long_term_memory` and `pending_applications` so tools using
    `InjectedState(...)` (e.g. trigger_resume_studio_skill) can read them
    from graph state.
    """

    long_term_memory: str
    pending_applications: str


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

    async def _get_pending_application_ids(self, user_id: str) -> list[int]:
        """Snapshot pending application ids at PE start. Used as target card list."""
        try:
            apps = await job_service.list_applications(int(user_id))
            return [a.id for a in apps if a.status == "pending" and a.id is not None]
        except Exception:
            logger.exception("pe_pending_ids_failed", user_id=user_id)
            return []

    # ---------- planner node ----------

    def _structured_llm(self, schema):
        """Build an LLM instance suitable for structured output.

        The global `llm_service.get_llm()` is bind_tools'd by the main chat
        agent at startup, and `with_structured_output` would then layer its
        own `tool_choice` on top — which breaks things. Construct a fresh,
        untouched ChatDeepSeek instance here so structured output works.
        """
        fresh = ChatDeepSeek(
            model="deepseek-chat",
            api_key=settings.DEEPSEEK_API_KEY,
            temperature=settings.DEFAULT_LLM_TEMPERATURE,
        )
        return fresh.with_structured_output(schema)

    async def _planner(self, state: PlanExecuteState, config: RunnableConfig) -> dict:
        """Generate the initial plan using structured output."""
        target_ids_str = (
            ", ".join(str(i) for i in state.target_application_ids)
            if state.target_application_ids
            else "（无）"
        )
        system_prompt = load_plan_execute_planner_prompt(
            input=state.input,
            long_term_memory=state.long_term_memory or "（无）",
            pending_applications=state.pending_applications or "（无）",
            target_application_ids=target_ids_str,
        )
        planner_llm = self._structured_llm(Plan)
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
        """Build (lazily) the ReAct sub-agent used to execute a single step.

        Uses a dedicated non-thinking DeepSeek instance: ReAct steps are mostly
        tool dispatch where thinking tokens add latency without much quality
        gain. We deliberately avoid `llm_service.get_llm()` + `bind_tools` to
        sidestep the global side-effect of mutating the shared chat agent LLM.
        """
        if self._executor is None:
            executor_llm = ChatDeepSeek(
                model="deepseek-chat",
                api_key=settings.DEEPSEEK_API_KEY,
                temperature=settings.DEFAULT_LLM_TEMPERATURE,
            )
            self._executor = create_react_agent(
                executor_llm,
                tools=tools,
                state_schema=_ExecutorState,
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
                {
                    "messages": [HumanMessage(content=step_prompt)],
                    "long_term_memory": state.long_term_memory or "",
                    "pending_applications": state.pending_applications or "",
                },
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

    # ---------- approval gate (HITL) ----------

    async def _approval_gate(self, state: PlanExecuteState, config: RunnableConfig) -> dict:
        """Pause the graph before executor and wait for user approval.

        The astream layer emits an `awaiting_approval` SSE event with the
        current plan and bumps approval_round; when the user resumes with
        Command(resume={action, feedback}) LangGraph injects the payload
        as interrupt() return value.
        """
        next_round = state.approval_round + 1
        payload = interrupt(
            {
                "round": next_round,
                "plan": list(state.plan),
            }
        )

        # Normalize the resume payload — defensive in case callers send strings
        action = (payload or {}).get("action") if isinstance(payload, dict) else None
        feedback = (payload or {}).get("feedback") if isinstance(payload, dict) else None

        logger.debug(
            "pe_approval_gate_resumed",
            round=next_round,
            payload_type=type(payload).__name__,
            action=action,
            state_pending_revise=state.pending_revise,
            state_plan_len=len(state.plan),
            state_past_steps_len=len(state.past_steps),
        )
        if action == "cancel":
            logger.info("pe_approval_cancelled", round=next_round)
            return {
                "response": "已取消自动处理。未执行任何步骤。",
                "approval_round": next_round,
            }
        if action == "revise":
            logger.info("pe_approval_revise", round=next_round, feedback_len=len(feedback or ""))
            return {
                "user_feedback": feedback or "",
                "approval_round": next_round,
                "pending_revise": True,
            }
        # default: user approved
        logger.info("pe_approval_approved", round=next_round)
        return {"approval_round": next_round, "pending_revise": False}

    def _route_after_approval(self, state: PlanExecuteState) -> str:
        """Edge dispatcher after approval_gate."""
        if state.response is not None:
            decision = END
        elif state.pending_revise:
            decision = "replanner"
        else:
            decision = "executor"
        logger.debug(
            "pe_route_after_approval",
            decision=decision,
            pending_revise=state.pending_revise,
            has_response=state.response is not None,
            plan_len=len(state.plan),
            past_steps_len=len(state.past_steps),
            approval_round=state.approval_round,
        )
        return decision

    # ---------- replanner node ----------

    async def _replan(self, state: PlanExecuteState, config: RunnableConfig) -> dict:
        """Decide whether to finish with a Response or continue with a new Plan."""
        past_steps_text = "\n".join(
            f"{i + 1}. {step}\n   → {result}" for i, (step, result) in enumerate(state.past_steps)
        ) or "（尚无）"
        done_count = len(state.past_steps)
        original_plan_text = "\n".join(
            f"{i + 1}. {s}" for i, s in enumerate([s for s, _ in state.past_steps] + state.plan)
        ) if (state.past_steps or state.plan) else "（无）"
        remaining_plan_text = "\n".join(
            f"{done_count + i + 1}. {s}" for i, s in enumerate(state.plan)
        ) or "（空 — 所有步骤都已执行完毕）"

        system_prompt = load_plan_execute_replanner_prompt(
            input=state.input,
            original_plan=original_plan_text,
            past_steps=past_steps_text,
            remaining_plan=remaining_plan_text,
            user_feedback=state.user_feedback,
        )
        logger.debug(
            "pe_replan_entered",
            pending_revise=state.pending_revise,
            has_user_feedback=bool(state.user_feedback),
            plan_len=len(state.plan),
            past_steps_len=len(state.past_steps),
            iterations=state.iterations,
        )
        replanner_llm = self._structured_llm(Act)
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
            return {"response": summary, "pending_revise": False, "user_feedback": None}

        # After consuming user_feedback (if any), clear it so the next round
        # isn't polluted by stale input.
        updates: dict = {}
        if state.user_feedback:
            updates["user_feedback"] = None

        logger.debug(
            "pe_replan_act_decided",
            action_type=type(act.action).__name__,
            state_pending_revise=state.pending_revise,
        )
        if isinstance(act.action, PlanResponse):
            # Hard guardrail — the replanner LLM sometimes ignores the prompt and
            # returns a Response while plan steps remain (observed: ~17-step
            # plan terminated after step 11). Force-continue with the remaining
            # plan so the user's goal actually completes.
            if state.plan:
                logger.warning(
                    "pe_replan_response_rejected_plan_not_empty",
                    remaining=len(state.plan),
                    past_steps=len(state.past_steps),
                    ignored_content_preview=(act.action.content or "")[:200],
                )
                return {
                    "plan": state.plan,
                    "pending_revise": False,
                    **updates,
                }
            logger.info("pe_replan_finish", iterations=state.iterations)
            return {"response": act.action.content, "pending_revise": False, **updates}

        logger.info(
            "pe_replan_continue",
            new_step_count=len(act.action.steps),
            revise_scenario=state.pending_revise,
        )
        if state.pending_revise:
            # Revise cycle: the rewritten plan must go BACK to approval_gate
            # so the user can see the revision before execution.
            return {
                "plan": act.action.steps,
                "pending_revise": True,
                **updates,
            }
        # Normal mid-execution replan: straight to executor.
        return {
            "plan": act.action.steps,
            "pending_revise": False,
            **updates,
        }

    # ---------- routing ----------

    def _should_end(self, state: PlanExecuteState) -> str:
        """Edge: from replanner → approval_gate (revise) / executor / END."""
        if state.response is not None:
            decision = END
        elif state.pending_revise:
            decision = "approval_gate"
        elif state.iterations >= MAX_ITERATIONS:
            logger.warning("pe_max_iterations_reached", iterations=state.iterations)
            decision = END
        elif not state.plan:
            decision = END
        else:
            decision = "executor"
        logger.debug(
            "pe_should_end",
            decision=decision,
            pending_revise=state.pending_revise,
            has_response=state.response is not None,
            plan_len=len(state.plan),
            past_steps_len=len(state.past_steps),
            iterations=state.iterations,
            approval_round=state.approval_round,
        )
        return decision

    # ---------- graph construction ----------

    async def create_graph(self) -> Optional[CompiledStateGraph]:
        """Build and cache the Plan-Execute StateGraph with checkpointer."""
        if self._graph is not None:
            return self._graph

        builder = StateGraph(PlanExecuteState)
        builder.add_node("planner", self._planner)
        builder.add_node("approval_gate", self._approval_gate)
        builder.add_node("executor", self._execute_step)
        builder.add_node("replanner", self._replan)
        builder.set_entry_point("planner")
        builder.add_edge("planner", "approval_gate")
        builder.add_conditional_edges(
            "approval_gate",
            self._route_after_approval,
            ["executor", "replanner", END],
        )
        builder.add_edge("executor", "replanner")
        builder.add_conditional_edges(
            "replanner",
            self._should_end,
            ["executor", "approval_gate", END],
        )

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

    # ---------- public streaming API ----------

    async def astream(
        self,
        goal: str,
        session_id: str,
        user_id: str,
        resume_thread_id: str | None = None,
        resume_payload: dict | None = None,
    ) -> AsyncGenerator[str, None]:
        """Stream SSE JSON chunks for a Plan-and-Execute run.

        Two modes:
        - start:  resume_thread_id is None — generate a new thread id, prefetch
          memory/pending, run from the top.
        - resume: resume_thread_id is given — skip prefetch, call astream with
          Command(resume=payload) on the existing checkpoint.

        Events emitted (in order, per stream):
          plan_created, step_started, step_completed, plan_updated,
          awaiting_approval (terminal), plan_revised, final_response (terminal),
          error (terminal).
        """
        if self._graph is None:
            await self.create_graph()

        if resume_thread_id is None:
            long_term_memory, pending, target_ids = await asyncio.gather(
                self._get_relevant_memory(user_id, goal),
                self._get_pending_applications(user_id),
                self._get_pending_application_ids(user_id),
            )
            if not pending:
                yield _json.dumps({
                    "type": "final_response",
                    "content": "暂无待处理的职位。请先在看板中添加职位后再运行一键处理。",
                    "done": True,
                })
                return
            pe_thread_id = f"pe_{session_id}_{uuid.uuid4().hex[:8]}"
            graph_input: Any = {
                "input": goal,
                "long_term_memory": long_term_memory or "",
                "pending_applications": pending,
                "target_application_ids": target_ids,
            }
        else:
            pe_thread_id = resume_thread_id
            graph_input = Command(resume=resume_payload or {})
            logger.info(
                "pe_astream_resume_entry",
                pe_thread_id=pe_thread_id,
                action=(resume_payload or {}).get("action"),
                has_feedback=bool((resume_payload or {}).get("feedback")),
            )

        langfuse_handler = CallbackHandler()
        config: RunnableConfig = {
            "configurable": {"thread_id": pe_thread_id, "user_id": user_id},
            "callbacks": [langfuse_handler],
            "metadata": {
                "user_id": user_id,
                "session_id": session_id,
                "langfuse_session_id": session_id,
                "langfuse_user_id": str(user_id),
                "environment": settings.ENVIRONMENT.value,
                "pipeline": "plan_execute",
                "pe_thread_id": pe_thread_id,
            },
            "recursion_limit": 50,
        }

        def _new_id() -> str:
            return uuid.uuid4().hex[:12]

        emitted_plan = False
        emitted_final = False
        past_step_ids: list[str] = []
        pending_ids: list[str] = []
        current_step_index = -1
        last_pending_revise_state = False
        # Track the step id whose executor is currently running so we can
        # attach sub-graph LLM / tool messages to the right card.
        active_step_id: str | None = None
        # Accumulate tool call args per id across streaming AIMessageChunk
        # fragments. Mirrors the pattern in graph.py::get_stream_response.
        tool_call_args: dict[str, str] = {}
        event: dict = {}

        def _emit_step_event(
            values_event: dict,
        ) -> list[str]:
            """Produce SSE payloads from a top-level `values` state snapshot.

            Nonlocal: mutates emitted_plan / pending_ids / past_step_ids /
            current_step_index / last_pending_revise_state / active_step_id.
            Returning a list keeps the async-generator yield in one place.
            """
            nonlocal emitted_plan, pending_ids, past_step_ids
            nonlocal current_step_index, last_pending_revise_state
            nonlocal active_step_id
            out: list[str] = []

            new_plan = values_event.get("plan", []) or []
            past_steps = values_event.get("past_steps", []) or []
            pending_revise_local = values_event.get("pending_revise", False)

            if not emitted_plan and new_plan:
                emitted_plan = True
                pending_ids = [_new_id() for _ in new_plan]
                out.append(_json.dumps({
                    "type": "plan_created",
                    "steps": [
                        {"id": sid, "text": t}
                        for sid, t in zip(pending_ids, new_plan, strict=True)
                    ],
                    "done": False,
                }))

            # Revise-cycle transition: was pending_revise, no longer; this
            # values event carries the rewritten plan from Replanner.
            if (
                last_pending_revise_state
                and not pending_revise_local
                and emitted_plan
                and new_plan
            ):
                pending_ids = [_new_id() for _ in new_plan]
                active_step_id = None
                out.append(_json.dumps({
                    "type": "plan_revised",
                    "plan": [
                        {"id": sid, "text": t}
                        for sid, t in zip(pending_ids, new_plan, strict=True)
                    ],
                    "reason": "user_feedback",
                    "done": False,
                }))
            last_pending_revise_state = pending_revise_local

            if len(past_steps) > current_step_index + 1:
                for i in range(current_step_index + 1, len(past_steps)):
                    if not pending_ids:
                        break
                    sid = pending_ids.pop(0)
                    past_step_ids.append(sid)
                    _, result_text = past_steps[i]
                    out.append(_json.dumps({
                        "type": "step_completed",
                        "id": sid,
                        "result": result_text,
                        "done": False,
                    }))
                    # The step we were streaming tokens into just finished.
                    if active_step_id == sid:
                        active_step_id = None
                current_step_index = len(past_steps) - 1
                if pending_ids:
                    active_step_id = pending_ids[0]
                    out.append(_json.dumps({
                        "type": "step_started",
                        "id": active_step_id,
                        "done": False,
                    }))

            return out

        try:
            event_counter = 0
            async for stream_event in self._graph.astream(
                graph_input,
                config,
                stream_mode=["values", "messages"],
                subgraphs=True,
            ):
                # With subgraphs=True + multi-mode, every event is a
                # (namespace, mode, payload) triple. Top-level graph has ns=();
                # the ReAct executor sub-graph has ns=("executor:<uid>",).
                ns, event_mode, payload = stream_event

                if event_mode == "values":
                    # Only the outer graph publishes values we care about.
                    if ns:
                        continue
                    event = payload
                    event_counter += 1
                    logger.debug(
                        "pe_astream_event",
                        idx=event_counter,
                        pe_thread_id=pe_thread_id,
                        plan_len=len(event.get("plan", []) or []),
                        past_steps_len=len(event.get("past_steps", []) or []),
                        pending_revise=event.get("pending_revise", False),
                        has_response=event.get("response") is not None,
                        approval_round=event.get("approval_round", 0),
                        iterations=event.get("iterations", 0),
                    )

                    for out_chunk in _emit_step_event(event):
                        yield out_chunk

                    response = event.get("response")
                    if response:
                        yield _json.dumps({
                            "type": "final_response",
                            "content": response,
                            "done": True,
                        })
                        emitted_final = True
                        return
                    continue

                if event_mode == "messages":
                    # We only want messages originating from the ReAct
                    # executor sub-graph — that's the LLM work user is
                    # waiting on. Top-level planner / replanner use
                    # structured output which doesn't stream tokens.
                    if not ns:
                        continue
                    if active_step_id is None:
                        continue

                    token, metadata = payload

                    if isinstance(token, AIMessageChunk):
                        # Tool call chunks — DeepSeek emits the `name` on the
                        # first chunk and streams `args` JSON fragments after.
                        if token.tool_call_chunks:
                            for tc in token.tool_call_chunks:
                                tc_id = tc.get("id") or ""
                                if tc.get("name"):
                                    tool_call_args[tc_id] = tc.get("args", "") or ""
                                    yield _json.dumps({
                                        "type": "step_tool_call",
                                        "step_id": active_step_id,
                                        "tool_call_id": tc_id,
                                        "tool_name": tc["name"],
                                        "args_delta": tc.get("args", "") or "",
                                        "done": False,
                                    })
                                elif tc_id in tool_call_args:
                                    tool_call_args[tc_id] += tc.get("args", "") or ""
                                    # Forward deltas so the UI can show args
                                    # streaming in; harmless if UI ignores.
                                    yield _json.dumps({
                                        "type": "step_tool_call",
                                        "step_id": active_step_id,
                                        "tool_call_id": tc_id,
                                        "args_delta": tc.get("args", "") or "",
                                        "done": False,
                                    })
                        elif token.content:
                            # Plain text delta — the ReAct agent's final
                            # answer for this step, streamed character by
                            # character.
                            content = token.content
                            if not isinstance(content, str):
                                content = str(content)
                            yield _json.dumps({
                                "type": "step_text_delta",
                                "step_id": active_step_id,
                                "delta": content,
                                "done": False,
                            })
                    elif isinstance(token, ToolMessage):
                        yield _json.dumps({
                            "type": "step_tool_result",
                            "step_id": active_step_id,
                            "tool_call_id": token.tool_call_id,
                            "tool_name": token.name,
                            "content": str(token.content),
                            "done": False,
                        })
                    continue

            # Stream loop ended — inspect the graph state to detect an interrupt.
            state_snapshot = await self._graph.aget_state(config)
            tasks = getattr(state_snapshot, "tasks", None) or []
            interrupts = [t for t in tasks if getattr(t, "interrupts", None)]
            if interrupts:
                snapshot_values = state_snapshot.values or {}
                plan_texts = snapshot_values.get("plan", []) or []
                approval_round = (snapshot_values.get("approval_round") or 0) + 1
                if len(pending_ids) != len(plan_texts):
                    pending_ids = [_new_id() for _ in plan_texts]
                yield _json.dumps({
                    "type": "awaiting_approval",
                    "thread_id": pe_thread_id,
                    "plan": [
                        {"id": sid, "text": t}
                        for sid, t in zip(pending_ids, plan_texts, strict=True)
                    ],
                    "round": approval_round,
                    "done": True,
                })
                return

            if not emitted_final:
                # Fallback summary — only reached when the graph ends WITHOUT the
                # replanner having set state.response (e.g. recursion_limit hit
                # or MAX_ITERATIONS guardrail fired mid-plan). Label the state
                # clearly so the user doesn't mistake a forced-END for a
                # graceful completion.
                final_state = event if isinstance(event, dict) else {}
                past = final_state.get("past_steps") or []
                remaining_plan = final_state.get("plan") or []
                if past and remaining_plan:
                    summary = (
                        f"⚠ 已执行 {len(past)} 步，但还有 {len(remaining_plan)} 步未完成就被硬护栏终止"
                        "（可能触及最大迭代次数）。已完成部分的结果已写回对应卡片。\n\n## 已完成\n"
                        + "\n".join(f"- {s}" for s, _ in past)
                        + "\n\n## 未完成\n"
                        + "\n".join(f"- {s}" for s in remaining_plan)
                    )
                elif past:
                    summary = "## 执行结束\n" + "\n".join(
                        f"- {s}\n  {(r or '')[:200]}" for s, r in past
                    )
                else:
                    summary = "执行结束，无可汇报的步骤。"
                yield _json.dumps({
                    "type": "final_response",
                    "content": summary,
                    "done": True,
                })
        except Exception as e:
            logger.exception("pe_astream_failed", session_id=session_id)
            yield _json.dumps({
                "type": "error",
                "message": str(e),
                "done": True,
            })
        finally:
            langfuse_handler.client.flush()
