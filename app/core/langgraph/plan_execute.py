"""Plan-and-Execute subgraph agent.

Distinct from the ReAct main agent in graph.py. Runs a classic
planner → executor → replanner loop with structured LLM outputs.
"""

import asyncio
import json as _json
import re
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncGenerator, Optional
from urllib.parse import quote_plus

from langchain_core.messages import AIMessage, AIMessageChunk, HumanMessage, SystemMessage, ToolMessage
from langchain_deepseek import ChatDeepSeek
from langfuse.langchain import CallbackHandler
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.graph import END, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langgraph.prebuilt import create_react_agent
from langgraph.prebuilt.chat_agent_executor import AgentState
from langgraph.types import Command, RunnableConfig, Send, interrupt
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
from app.core.langgraph.dag import auto_fix_dag, degrade_to_serial, validate_dag
from app.schemas import Act, Plan, PlanExecuteState, PlanResponse, PlanStep, StepStatus
from app.services.job_service import job_service

MAX_ITERATIONS = 20

# Single-step wall clock cap. A step covers one ReAct agent run (plan step
# like "生成 PDF"), which normally finishes in <30 s. Anything longer is
# almost certainly an LLM self-correction loop or a hung upstream call.
EXECUTOR_STEP_TIMEOUT_SECONDS = 180

# Inner ReAct agent recursion budget. Sized generously enough for the
# planner, one tool call, and a final answer (≈6 node traversals per
# tool call), while staying well below anything that could spin overnight.
EXECUTOR_RECURSION_LIMIT = 25

# Max identical (tool_name, args_fingerprint) invocations per step before
# we call it a loop. LLMs can legitimately retry a tool once after a
# corrected arg, but not three times in a row with unchanged args.
MAX_REPEATED_TOOL_CALLS = 3

# Single-step tool-call budget. When the executor's ReAct loop accumulates
# this many tool_calls across all messages, _tool_budget_hook rewrites the
# next AIMessage to a final answer instead of letting the loop spiral into
# GraphRecursionError. Distinct from MAX_REPEATED_TOOL_CALLS — that one only
# catches *identical* (name+args) repeats, this one catches breadth-style
# loops on information-sparse targets (e.g. researching obscure companies).
EXECUTOR_TOOL_BUDGET = 5

# Module-level registry of PE thread ids with an active streaming generator.
# Read by the `/plan-execute/inflight` endpoint so the deploy pipeline can
# drain cleanly before restarting the container, and used by the graceful
# shutdown path to emit `interrupted` SSE events on SIGTERM.
ACTIVE_PE_THREADS: set[str] = set()


# Match the artifact-producing tool keyword in a plan step's text. Order
# matters — `tailored_resume` is checked first so a resume step's "+ score"
# mention can't be misclassified as a score step. Resume bundles three tool
# names in one step (trigger_resume_studio_skill / save_tailored_resume /
# generate_resume_pdf — see plan_execute_planner.md), so we match the bundle
# token "定制简历" too.
_ARTIFACT_KIND_PATTERNS: list[tuple[str, re.Pattern]] = [
    ("resume", re.compile(r"trigger_resume_studio_skill|save_tailored_resume|generate_resume_pdf|定制简历", re.I)),
    ("interview", re.compile(r"generate_interview_questions", re.I)),
    ("gap", re.compile(r"analyze_jd_gap", re.I)),
    ("score", re.compile(r"score_jd_match", re.I)),
    ("research", re.compile(r"company_research|save_company_research", re.I)),
]

_APP_ID_RE = re.compile(r"application_id\s*[=:]\s*(\d+)")
_CARD_ID_RE = re.compile(r"card\s*[=:]\s*(\d+)")


def _classify_step_artifact(text: str) -> Optional[str]:
    """Return which artifact kind a plan step produces, or None if unrelated.

    Matches by tool-name keyword in the step text. The summary step ("Z" /
    "汇总…") matches no kind, so it is never pruned.
    """
    for kind, pattern in _ARTIFACT_KIND_PATTERNS:
        if pattern.search(text):
            return kind
    return None


def _extract_application_id(text: str) -> Optional[int]:
    """Pull the target application_id out of a step's natural-language text."""
    m = _APP_ID_RE.search(text) or _CARD_ID_RE.search(text)
    return int(m.group(1)) if m else None


def _detect_repeated_tool_call(messages: list) -> Optional[str]:
    """Return tool name if one was invoked with identical args beyond the cap.

    Scans the ReAct message trace for any (tool_name, args-fingerprint) that
    appears more than ``MAX_REPEATED_TOOL_CALLS`` times. Args are canonicalized
    via ``json.dumps(sort_keys=True)`` so key-order noise from DeepSeek's
    streaming output doesn't defeat the check.
    """
    counts: dict[tuple[str, str], int] = {}
    for msg in messages:
        tool_calls = getattr(msg, "tool_calls", None) or []
        for tc in tool_calls:
            name = tc.get("name") if isinstance(tc, dict) else getattr(tc, "name", None)
            args = tc.get("args") if isinstance(tc, dict) else getattr(tc, "args", None)
            if not name:
                continue
            try:
                fingerprint = _json.dumps(args, sort_keys=True, default=str)
            except Exception:
                fingerprint = repr(args)
            key = (name, fingerprint)
            counts[key] = counts.get(key, 0) + 1
            if counts[key] > MAX_REPEATED_TOOL_CALLS:
                return name
    return None


def _tool_budget_hook(state: dict) -> dict:
    """In-flight tool-call budget guard for the executor ReAct subgraph.

    Runs as create_react_agent's post_model_hook. If the cumulative tool_calls
    across all messages reach EXECUTOR_TOOL_BUDGET *and* the latest AIMessage
    is asking for yet more tools, rewrite that AIMessage to a budget-exhausted
    final answer so should_continue routes the graph to END gracefully.

    Returns {} to leave state untouched, or {"messages": [<rewritten>]} so the
    add_messages reducer replaces the last AIMessage by id (graceful exit
    without raising GraphRecursionError).
    """
    messages = state.get("messages") or []
    if not messages:
        return {}
    last = messages[-1]
    last_tool_calls = getattr(last, "tool_calls", None) or []
    if not last_tool_calls:
        return {}

    total_calls = 0
    for msg in messages:
        total_calls += len(getattr(msg, "tool_calls", None) or [])
    if total_calls < EXECUTOR_TOOL_BUDGET:
        return {}

    return {
        "messages": [
            AIMessage(
                id=getattr(last, "id", None),
                content=(
                    f"BUDGET_EXHAUSTED: 工具调用累计 {total_calls} 次已达预算上限"
                    f" ({EXECUTOR_TOOL_BUDGET})。基于已收集信息收尾——信息不足，"
                    "已尝试多轮搜索但未获得足够公开资料。"
                ),
            )
        ]
    }


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

    @staticmethod
    def _artifact_tags(app) -> str:
        """Return compact artifact status tags for a card (e.g. 'research✓ score✓')."""
        mapping = [
            (app.company_research_json, "research"),
            (app.match_breakdown, "score"),
            (app.gap_analysis_text, "gap"),
            (app.interview_questions_json, "interview"),
            (app.tailored_resume_text, "resume"),
        ]
        tags = [f"{name}✓" for val, name in mapping if val]
        return " ".join(tags)

    async def _get_pending_applications(self, user_id: str) -> str:
        """Build a human-readable list of ALL pending cards with artifact status."""
        try:
            apps = await job_service.list_applications(int(user_id))
            pending = [a for a in apps if a.status == "pending"]
            if not pending:
                return ""
            lines = []
            for app in pending:
                company = f" · {app.company}" if app.company else ""
                url = f" · {app.url}" if app.url else ""
                # application_id first so the planner wires the correct id into
                # tool calls — positional numbering caused the executor to try
                # application_id=1 when the user said "第 1 个".
                artifact_str = self._artifact_tags(app)
                suffix = f"  ({artifact_str})" if artifact_str else ""
                lines.append(f"- application_id={app.id} · [{app.title}]{company}{url}{suffix}")
            return "\n".join(lines)
        except Exception:
            logger.exception("pe_pending_apps_failed", user_id=user_id)
            return ""

    async def _get_pending_application_ids(self, user_id: str) -> list[int]:
        """Snapshot ALL pending application ids at PE start."""
        try:
            apps = await job_service.list_applications(int(user_id))
            ids = [a.id for a in apps if a.status == "pending" and a.id is not None]
            logger.info(
                "pe_pending_ids",
                user_id=user_id,
                count=len(ids),
            )
            return ids
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
            ", ".join(str(i) for i in state.target_application_ids) if state.target_application_ids else "（无）"
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
        return {
            "plan": result.steps,
            "step_status": {step.id: StepStatus.PENDING.value for step in result.steps},
        }

    # ---------- DAG validator node ----------

    async def _dag_validator(self, state: PlanExecuteState, config: RunnableConfig) -> dict:
        """Validate the DAG plan, auto-fix if possible, degrade to serial as last resort.

        Three-layer defense:
        1. auto_fix_dag — strips invalid refs, renames duplicate ids, breaks cycles
        2. LLM retry (up to 2 attempts) — ask the planner to regenerate
        3. degrade_to_serial — chain all steps linearly
        """
        steps = state.plan
        errors = validate_dag(steps)
        if not errors:
            logger.info("pe_dag_valid", step_count=len(steps))
            return {}

        # Layer 1: auto-fix
        logger.warning("pe_dag_errors_detected", error_count=len(errors), errors=[e.detail for e in errors])
        fixed = auto_fix_dag(steps, errors)
        recheck = validate_dag(fixed)
        if not recheck:
            logger.info("pe_dag_auto_fixed", step_count=len(fixed))
            return {
                "plan": fixed,
                "step_status": {s.id: StepStatus.PENDING.value for s in fixed},
            }

        # Layer 2: LLM retry (max 2 attempts)
        for attempt in range(2):
            logger.warning("pe_dag_llm_retry", attempt=attempt + 1)
            try:
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
                retry_errors = validate_dag(result.steps)
                if not retry_errors:
                    logger.info("pe_dag_llm_retry_success", attempt=attempt + 1, step_count=len(result.steps))
                    return {
                        "plan": result.steps,
                        "step_status": {s.id: StepStatus.PENDING.value for s in result.steps},
                    }
            except Exception:
                logger.exception("pe_dag_llm_retry_failed", attempt=attempt + 1)

        # Layer 3: degrade to serial
        logger.warning("pe_dag_degrade_to_serial", step_count=len(steps))
        serial = degrade_to_serial(steps)
        return {
            "plan": serial,
            "step_status": {s.id: StepStatus.PENDING.value for s in serial},
        }

    # ---------- artifact-prune node ----------

    async def _prune_satisfied_steps(
        self, state: PlanExecuteState, config: RunnableConfig
    ) -> dict:
        """Mark plan steps that recreate already-saved artifacts as DONE.

        The planner prompt instructs the LLM to skip steps whose artifact is
        already present (e.g. a card tagged ``research✓`` shouldn't get a new
        ``company_research`` step). DeepSeek doesn't reliably honor this, so
        we apply the same rule deterministically here. Each pruned step is
        flipped from PENDING to DONE so downstream depends_on resolves and
        the step never reaches the executor.
        """
        user_id = config.get("configurable", {}).get("user_id")
        if not user_id:
            return {}
        try:
            apps = await job_service.list_applications(int(user_id))
        except Exception:
            logger.exception("pe_artifact_prune_list_failed", user_id=user_id)
            return {}

        artifacts = {
            a.id: {
                "research": bool(a.company_research_json),
                "score": bool(a.match_breakdown),
                "gap": bool(a.gap_analysis_text),
                "interview": bool(a.interview_questions_json),
                "resume": bool(a.tailored_resume_text),
            }
            for a in apps
            if a.id is not None
        }

        new_status: dict[str, str] = {}
        new_results: dict[str, str] = {}
        for step in state.plan:
            if state.step_status.get(step.id) != StepStatus.PENDING.value:
                continue
            kind = _classify_step_artifact(step.text)
            app_id = _extract_application_id(step.text)
            if kind is None or app_id is None:
                continue
            flags = artifacts.get(app_id)
            if flags and flags.get(kind):
                new_status[step.id] = StepStatus.DONE.value
                new_results[step.id] = f"(已存在 {kind} artifact，跳过执行)"

        if new_status:
            logger.info(
                "pe_artifact_prune_applied",
                pruned_count=len(new_status),
                step_ids=list(new_status.keys()),
            )
            return {"step_status": new_status, "step_results": new_results}
        return {}

    # ---------- scheduler helpers ----------

    def _get_ready_sends(self, state: PlanExecuteState) -> list[Send]:
        """Return Send objects for all PENDING steps whose deps are satisfied."""
        ready: list[Send] = []
        step_status = state.step_status
        for step in state.plan:
            if step_status.get(step.id) != StepStatus.PENDING.value:
                continue
            deps_met = all(step_status.get(dep) == StepStatus.DONE.value for dep in step.depends_on)
            if deps_met:
                ready.append(
                    Send(
                        "executor",
                        {
                            "step": step,
                            "long_term_memory": state.long_term_memory or "",
                            "pending_applications": state.pending_applications or "",
                        },
                    )
                )
        return ready

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
                post_model_hook=_tool_budget_hook,
                version="v2",
            )
        return self._executor

    async def _execute_step(self, state: dict, config: RunnableConfig) -> dict:
        """Execute a single plan step dispatched by Send().

        Receives a dict payload: {"step": PlanStep, "long_term_memory": str,
        "pending_applications": str}. Returns step_results and step_status
        updates keyed by the step's id.
        """
        step: PlanStep = state["step"]
        long_term_memory: str = state.get("long_term_memory", "")
        pending_applications: str = state.get("pending_applications", "")

        step_prompt = (
            f"You are executing step [{step.id}] of a larger plan.\n\n"
            f"Your task now: {step.text}\n\n"
            f"HARD RULE — if this step involves saving / persisting / 定制 / 生成 PDF, "
            f"you MUST invoke the corresponding tool (save_*, generate_resume_pdf, etc.) "
            f"with the actual content. Describing the action in your final reply without "
            f"calling the tool leaves the kanban card blank — the system verifies via tool "
            f"calls, not prose.\n\n"
            f"LOOP GUARDRAIL — do not invoke the same tool with the same arguments more "
            f"than twice. If a tool returns an error, adjust your args meaningfully or "
            f"give up the step with a brief explanation instead of retrying verbatim.\n\n"
            f"User profile (use when helpful):\n{long_term_memory or '(none)'}\n\n"
            f"Pending jobs snapshot:\n{pending_applications or '(none)'}"
        )

        # Give the ReAct sub-graph its own bounded recursion budget so a stuck
        # step can't consume the outer graph's allowance.
        child_config = dict(config or {})
        child_config["recursion_limit"] = EXECUTOR_RECURSION_LIMIT

        status = StepStatus.DONE.value
        step_start = time.time()
        executor = self._get_executor()
        try:
            result = await asyncio.wait_for(
                executor.ainvoke(
                    {
                        "messages": [HumanMessage(content=step_prompt)],
                        "long_term_memory": long_term_memory,
                        "pending_applications": pending_applications,
                    },
                    config=child_config,
                ),
                timeout=EXECUTOR_STEP_TIMEOUT_SECONDS,
            )
            messages = result.get("messages", [])
            loop_offender = _detect_repeated_tool_call(messages)
            if loop_offender:
                result_text = (
                    f"LOOP_DETECTED: 工具 {loop_offender} 在本步中以相同参数被反复调用超过"
                    f" {MAX_REPEATED_TOOL_CALLS} 次，已中止该步骤以避免死循环。"
                )
                status = StepStatus.FAILED.value
                logger.warning(
                    "pe_step_loop_detected",
                    step_id=step.id,
                    step_text=step.text,
                    tool_name=loop_offender,
                )
            else:
                final_msg = messages[-1] if messages else None
                if final_msg is None:
                    result_text = "FAILED: executor returned no messages"
                    status = StepStatus.FAILED.value
                else:
                    result_text = final_msg.content if isinstance(final_msg.content, str) else str(final_msg.content)
                logger.info("pe_step_executed", step_id=step.id, step_text=step.text)
        except asyncio.TimeoutError:
            result_text = f"TIMEOUT: 该步骤执行超过 {EXECUTOR_STEP_TIMEOUT_SECONDS} 秒未完成，已中止。"
            status = StepStatus.FAILED.value
            logger.warning(
                "pe_step_timed_out",
                step_id=step.id,
                step_text=step.text,
                timeout_seconds=EXECUTOR_STEP_TIMEOUT_SECONDS,
            )
        except Exception as e:
            result_text = f"FAILED: {e!s}"
            status = StepStatus.FAILED.value
            logger.exception("pe_step_failed", step_id=step.id, step_text=step.text)

        duration_ms = int((time.time() - step_start) * 1000)
        return {
            "step_results": {step.id: result_text},
            "step_status": {step.id: status},
            "step_duration_ms": {step.id: duration_ms},
        }

    # ---------- approval gate (HITL) ----------

    async def _approval_gate(self, state: PlanExecuteState, config: RunnableConfig) -> dict:
        """Pause the graph before executor and wait for user approval.

        The astream layer emits an `awaiting_approval` SSE event with the
        current plan and bumps approval_round; when the user resumes with
        Command(resume={action, feedback}) LangGraph injects the payload
        as interrupt() return value.

        In eval mode (pipeline=plan_execute_eval), skip the interrupt and
        auto-approve so the graph runs straight through.
        """
        next_round = state.approval_round + 1
        metadata = config.get("metadata") or {}

        # Cases where we skip the user-facing interrupt entirely:
        #   - Eval pipeline (no human in the loop).
        #   - Continuation re-entry: user already approved the initial DAG and
        #     this is just the replanner's next iteration. Asking again would
        #     defeat the "approve once, run to completion" UX.
        # Revise re-entry (state.pending_revise) still goes through interrupt
        # so the user can confirm the rewritten plan.
        is_eval = metadata.get("pipeline") == "plan_execute_eval"
        is_continuation = state.approval_round > 0 and not state.pending_revise
        if is_eval or is_continuation:
            logger.info(
                "pe_approval_auto_approved",
                round=next_round,
                reason="eval" if is_eval else "continuation",
            )
            return self._build_approve_dispatch(state, next_round)

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
            done_count=sum(1 for v in state.step_status.values() if v == StepStatus.DONE.value),
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
        return self._build_approve_dispatch(state, next_round)

    def _build_approve_dispatch(
        self, state: PlanExecuteState, next_round: int
    ) -> Command | dict:
        """Atomically mark ready steps RUNNING and fan-out to executors.

        We must dispatch + flip step_status in a single Command return because
        the conditional edge that follows re-scans PENDING steps via
        _get_ready_sends; if we updated step_status in a plain dict return,
        the conditional edge would observe RUNNING and skip the dispatch,
        causing approval_gate→collector→replanner to spin until the recursion
        limit fires.

        When no steps are ready (edge case after all dependencies failed or a
        replan produced nothing dispatchable), fall back to a plain dict so
        the conditional edge can route to collector / END as before.
        """
        ready_sends = self._get_ready_sends(state)
        if not ready_sends:
            return {"approval_round": next_round, "pending_revise": False}
        running_ids: list[str] = []
        for s in ready_sends:
            step = s.arg.get("step") if isinstance(s.arg, dict) else None
            if step:
                running_ids.append(step.id if hasattr(step, "id") else str(step))
        return Command(
            update={
                "approval_round": next_round,
                "pending_revise": False,
                "step_status": {sid: StepStatus.RUNNING.value for sid in running_ids},
            },
            goto=ready_sends,
        )

    def _dispatch_ready_steps(
        self, state: PlanExecuteState, config: RunnableConfig | None = None
    ) -> list[Send] | str:
        """Build Send() fan-out for parallel executor dispatch."""
        sends = self._get_ready_sends(state)
        if not sends:
            return "collector"
        logger.debug("pe_dispatch_ready", count=len(sends))
        return sends

    def _route_after_approval(self, state: PlanExecuteState, config: RunnableConfig) -> str | list[Send] | Command:
        """Edge dispatcher after approval_gate."""
        if state.response is not None:
            return END
        if state.pending_revise:
            return "replanner"
        return self._dispatch_ready_steps(state, config)

    # ---------- replanner node ----------

    async def _replan(self, state: PlanExecuteState, config: RunnableConfig) -> dict:
        """Decide whether to finish with a Response or continue with a new Plan."""
        # Build executed-steps text from step_results + step_status
        executed_lines: list[str] = []
        for step in state.plan:
            status = state.step_status.get(step.id)
            if status in (StepStatus.DONE.value, StepStatus.FAILED.value, StepStatus.SKIPPED.value):
                result = state.step_results.get(step.id, "（无结果）")
                executed_lines.append(f"- [{step.id}] ({status}) {step.text}\n  → {result}")
        past_steps_text = "\n".join(executed_lines) or "（尚无）"

        # Original plan text — full DAG
        original_plan_text = (
            "\n".join(f"- [{s.id}] {s.text} (depends_on: {s.depends_on})" for s in state.plan) or "（无）"
        )

        # Remaining = steps still PENDING
        remaining = [s for s in state.plan if state.step_status.get(s.id) == StepStatus.PENDING.value]
        remaining_plan_text = (
            "\n".join(f"- [{s.id}] {s.text} (depends_on: {s.depends_on})" for s in remaining)
            or "（空 — 所有步骤都已执行完毕）"
        )

        system_prompt = load_plan_execute_replanner_prompt(
            input=state.input,
            original_plan=original_plan_text,
            past_steps=past_steps_text,
            remaining_plan=remaining_plan_text,
            user_feedback=state.user_feedback,
        )
        done_count = sum(
            1
            for s in state.plan
            if state.step_status.get(s.id)
            in (StepStatus.DONE.value, StepStatus.FAILED.value, StepStatus.SKIPPED.value)
        )
        logger.debug(
            "pe_replan_entered",
            pending_revise=state.pending_revise,
            has_user_feedback=bool(state.user_feedback),
            plan_len=len(state.plan),
            done_count=done_count,
            remaining_count=len(remaining),
            iterations=state.iterations,
        )
        replanner_llm = self._structured_llm(Act)
        try:
            act: Act | None = await replanner_llm.ainvoke(
                [SystemMessage(content=system_prompt)],
                config=config,
            )
            # with_structured_output silently returns None when the LLM
            # produces output that fails schema parsing; treat that the
            # same as a thrown exception so we fall through to summary.
            if act is None or act.action is None:
                raise ValueError(f"replanner produced invalid structured output: act={act!r}")
        except Exception:
            logger.exception("pe_replanner_failed_fallback_to_summary")
            summary = "## 已完成\n" + "\n".join(
                f"- [{s.id}] {s.text}\n  {state.step_results.get(s.id, '')[:200]}"
                for s in state.plan
                if state.step_status.get(s.id) == StepStatus.DONE.value
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
            # returns a Response while plan steps remain. Force-continue with the
            # remaining plan so the user's goal actually completes.
            if remaining:
                logger.warning(
                    "pe_replan_response_rejected_plan_not_empty",
                    remaining=len(remaining),
                    done_count=done_count,
                    ignored_content_preview=(act.action.content or "")[:200],
                )
                return {
                    "pending_revise": False,
                    **updates,
                }
            logger.info("pe_replan_finish", iterations=state.iterations)
            return {"response": act.action.content, "pending_revise": False, **updates}

        # Replanner returned a new Plan — initialize fresh step_status/step_results
        new_steps = act.action.steps
        logger.info(
            "pe_replan_continue",
            new_step_count=len(new_steps),
            revise_scenario=state.pending_revise,
        )
        new_status = {s.id: StepStatus.PENDING.value for s in new_steps}
        new_results: dict[str, str] = {}
        if state.pending_revise:
            # Revise cycle: the rewritten plan must go BACK to approval_gate
            # so the user can see the revision before execution.
            return {
                "plan": new_steps,
                "step_status": new_status,
                "step_results": new_results,
                "pending_revise": True,
                **updates,
            }
        # Normal mid-execution replan: straight to dag_validator then executor.
        return {
            "plan": new_steps,
            "step_status": new_status,
            "step_results": new_results,
            "pending_revise": False,
            **updates,
        }

    # ---------- collector node ----------

    async def _collector(self, state: PlanExecuteState) -> dict:
        """Cascade-skip: mark PENDING steps whose deps FAILED/SKIPPED as SKIPPED."""
        skipped_updates: dict[str, str] = {}
        step_status = dict(state.step_status)  # working copy
        # Iterate until no more cascades
        changed = True
        while changed:
            changed = False
            for step in state.plan:
                if step_status.get(step.id) != StepStatus.PENDING.value:
                    continue
                for dep in step.depends_on:
                    dep_status = step_status.get(dep)
                    if dep_status in (StepStatus.FAILED.value, StepStatus.SKIPPED.value):
                        step_status[step.id] = StepStatus.SKIPPED.value
                        skipped_updates[step.id] = StepStatus.SKIPPED.value
                        changed = True
                        break
        if skipped_updates:
            logger.info("pe_collector_cascade_skip", skipped_ids=list(skipped_updates.keys()))
        return {
            "step_status": skipped_updates,
            "iterations": state.iterations + 1,
        }

    # ---------- routing ----------

    def _should_end(self, state: PlanExecuteState) -> str:
        """Edge: from replanner → dag_validator (new plan) / approval_gate (revise) / END."""
        if state.response is not None:
            decision = END
        elif state.pending_revise:
            decision = "approval_gate"
        elif state.iterations >= MAX_ITERATIONS:
            logger.warning("pe_max_iterations_reached", iterations=state.iterations)
            decision = END
        else:
            # Check if the new plan has any pending steps
            has_pending = any(state.step_status.get(s.id) == StepStatus.PENDING.value for s in state.plan)
            decision = "dag_validator" if has_pending else END
        logger.debug(
            "pe_should_end",
            decision=decision,
            pending_revise=state.pending_revise,
            has_response=state.response is not None,
            plan_len=len(state.plan),
            iterations=state.iterations,
            approval_round=state.approval_round,
        )
        return decision

    def _route_after_collector(self, state: PlanExecuteState, config: RunnableConfig) -> str | list[Send] | Command:
        """Route after collector: fan-out ready steps or go to replanner."""
        if state.iterations >= MAX_ITERATIONS:
            logger.warning("pe_max_iterations_after_collector", iterations=state.iterations)
            return "replanner"
        return self._dispatch_ready_steps(state, config) if self._get_ready_sends(state) else "replanner"

    # ---------- graph construction ----------

    async def create_graph(self) -> Optional[CompiledStateGraph]:
        """Build and cache the Plan-Execute StateGraph with checkpointer.

        Topology (DAG parallel):
          planner → dag_validator → artifact_prune → approval_gate →(fan-out)→ executor(s)
                                                                    → collector →(fan-out)→ executor(s)
                                                                    → collector → replanner → END
                                                                                  replanner → dag_validator (new plan)
                                                                                  replanner → approval_gate (revise)
        """
        if self._graph is not None:
            return self._graph

        builder = StateGraph(PlanExecuteState)
        builder.add_node("planner", self._planner)
        builder.add_node("dag_validator", self._dag_validator)
        builder.add_node("artifact_prune", self._prune_satisfied_steps)
        builder.add_node("approval_gate", self._approval_gate)
        builder.add_node("executor", self._execute_step)
        builder.add_node("collector", self._collector)
        builder.add_node("replanner", self._replan)

        builder.set_entry_point("planner")
        builder.add_edge("planner", "dag_validator")
        builder.add_edge("dag_validator", "artifact_prune")
        builder.add_edge("artifact_prune", "approval_gate")

        # approval_gate → fan-out to executor(s) | replanner | collector | END
        builder.add_conditional_edges(
            "approval_gate",
            self._route_after_approval,
            ["replanner", "collector", END],
        )

        # All executor outputs converge at collector
        builder.add_edge("executor", "collector")

        # collector → fan-out to executor(s) (next wave) | replanner
        builder.add_conditional_edges(
            "collector",
            self._route_after_collector,
            ["replanner"],
        )

        # replanner → dag_validator (new plan) | approval_gate (revise) | END
        builder.add_conditional_edges(
            "replanner",
            self._should_end,
            ["dag_validator", "approval_gate", END],
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

    async def reap_stale_pe_threads(self, older_than_hours: int = 24) -> int:
        """Drop LangGraph checkpoint rows for PE threads older than a cutoff.

        Deploys can restart the container mid-run, leaving PE threads frozen
        in postgres (no code advances them, no one can resume them because
        the frontend has long since lost the thread_id). Over time these
        accumulate. This runs at startup and removes rows whose thread_id
        starts with ``pe_`` and whose newest checkpoint was written more
        than ``older_than_hours`` ago.

        LangGraph's checkpoint_ids are UUIDv6 — the top 48 bits of a 60-bit
        timestamp (100ns-since-1582-10-15) live in the first 12 hex chars,
        so lexicographic comparison of the full UUID is also chronological.

        Returns the number of threads whose rows were deleted.
        """
        pool = await self._get_connection_pool()
        cutoff = datetime.now(timezone.utc) - timedelta(hours=older_than_hours)
        uuid6_epoch = datetime(1582, 10, 15, tzinfo=timezone.utc)
        cutoff_100ns = int((cutoff - uuid6_epoch).total_seconds() * 1e7)
        time_high = (cutoff_100ns >> 28) & 0xFFFFFFFF
        time_mid = (cutoff_100ns >> 12) & 0xFFFF
        time_low = cutoff_100ns & 0x0FFF
        cutoff_uuid = f"{time_high:08x}-{time_mid:04x}-6{time_low:03x}-0000-000000000000"

        deleted_threads = 0
        tables_with_thread_id = ("checkpoints", "checkpoint_writes", "checkpoint_blobs")
        async with pool.connection() as conn:
            async with conn.cursor() as cur:
                # Parameterize the LIKE pattern too — psycopg otherwise
                # misreads the `%'` in the literal 'pe_%' as a placeholder
                # prefix and refuses the query.
                await cur.execute(
                    """
                    SELECT thread_id FROM checkpoints
                    WHERE thread_id LIKE %s
                    GROUP BY thread_id
                    HAVING MAX(checkpoint_id) < %s
                    """,
                    ("pe_%", cutoff_uuid),
                )
                rows = await cur.fetchall()
                stale_ids = [r[0] for r in rows]

            for thread_id in stale_ids:
                for table in tables_with_thread_id:
                    async with conn.cursor() as cur:
                        try:
                            await cur.execute(
                                f"DELETE FROM {table} WHERE thread_id = %s",
                                (thread_id,),
                            )
                        except Exception:
                            logger.exception(
                                "pe_reap_delete_failed",
                                table=table,
                                thread_id=thread_id,
                            )
                deleted_threads += 1

        if deleted_threads:
            logger.info(
                "pe_reap_stale_threads",
                deleted_threads=deleted_threads,
                older_than_hours=older_than_hours,
                cutoff_uuid=cutoff_uuid,
            )
        return deleted_threads

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
          plan_created (with depends_on), wave_started, step_started,
          step_completed, step_skipped, plan_revised,
          awaiting_approval (terminal), final_response (terminal),
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
                yield _json.dumps(
                    {
                        "type": "final_response",
                        "content": "暂无待处理的职位。请先在看板中添加职位后再运行一键处理。",
                        "done": True,
                    }
                )
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

        ACTIVE_PE_THREADS.add(pe_thread_id)

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

        emitted_plan = False
        emitted_final = False
        last_pending_revise_state = False
        # Track previous step_status to detect transitions across snapshots.
        prev_step_status: dict[str, str] = {}
        wave_counter = 0
        # Accumulate tool call args per id across streaming AIMessageChunk
        # fragments. Mirrors the pattern in graph.py::get_stream_response.
        tool_call_args: dict[str, str] = {}
        event: dict = {}
        # Namespace → step_id mapping for parallel executor streaming.
        # When _emit_step_event emits step_started for a step, that id is
        # appended to running_but_unassigned. When the first message from a
        # new executor namespace arrives, it consumes one id from the list.
        running_but_unassigned: list[str] = []
        ns_to_step: dict[tuple, str] = {}

        def _emit_step_event(
            values_event: dict,
        ) -> list[str]:
            """Produce SSE payloads from a top-level `values` state snapshot.

            Detects step_status transitions by comparing the current snapshot
            against ``prev_step_status``. Emits plan_created, wave_started,
            step_started, step_completed, step_skipped, and plan_revised
            events.
            """
            nonlocal emitted_plan, prev_step_status, wave_counter
            nonlocal last_pending_revise_state, running_but_unassigned, ns_to_step
            out: list[str] = []

            plan_steps: list[PlanStep] = values_event.get("plan", []) or []
            current_status: dict[str, str] = values_event.get("step_status", {}) or {}
            current_results: dict[str, str] = values_event.get("step_results", {}) or {}
            pending_revise_local = values_event.get("pending_revise", False)

            # First time seeing a plan → emit plan_created with depends_on.
            if not emitted_plan and plan_steps:
                emitted_plan = True
                out.append(
                    _json.dumps(
                        {
                            "type": "plan_created",
                            "steps": [{"id": s.id, "text": s.text, "depends_on": s.depends_on} for s in plan_steps],
                            "done": False,
                        }
                    )
                )
                # Bootstrap prev_step_status from current or all-PENDING.
                prev_step_status = {s.id: current_status.get(s.id, StepStatus.PENDING.value) for s in plan_steps}

            # Revise-cycle transition: was pending_revise, no longer; the
            # replanner produced a rewritten plan.
            if last_pending_revise_state and not pending_revise_local and emitted_plan and plan_steps:
                # Reset tracking for the new plan.
                running_but_unassigned = []
                ns_to_step = {}
                prev_step_status = {s.id: current_status.get(s.id, StepStatus.PENDING.value) for s in plan_steps}
                out.append(
                    _json.dumps(
                        {
                            "type": "plan_revised",
                            "plan": [{"id": s.id, "text": s.text, "depends_on": s.depends_on} for s in plan_steps],
                            "reason": "user_feedback",
                            "done": False,
                        }
                    )
                )
            last_pending_revise_state = pending_revise_local

            # Detect status transitions.
            newly_running: list[str] = []
            for step_id, new_status in current_status.items():
                old_status = prev_step_status.get(step_id)
                if old_status == new_status:
                    continue

                if new_status == StepStatus.RUNNING.value and old_status != StepStatus.RUNNING.value:
                    newly_running.append(step_id)
                elif new_status in (StepStatus.DONE.value, StepStatus.FAILED.value):
                    result = current_results.get(step_id, "")
                    current_durations = values_event.get("step_duration_ms", {}) or {}
                    dur = current_durations.get(step_id)
                    evt: dict = {
                        "type": "step_completed",
                        "id": step_id,
                        "result": result,
                        "done": False,
                    }
                    if dur is not None:
                        evt["duration_ms"] = dur
                    out.append(_json.dumps(evt))
                elif new_status == StepStatus.SKIPPED.value:
                    out.append(
                        _json.dumps(
                            {
                                "type": "step_skipped",
                                "id": step_id,
                                "reason": "依赖的前置步骤失败",
                                "done": False,
                            }
                        )
                    )

            # Emit wave_started + step_started for newly running steps.
            if newly_running:
                wave_counter += 1
                out.append(
                    _json.dumps(
                        {
                            "type": "wave_started",
                            "wave": wave_counter,
                            "step_ids": newly_running,
                            "done": False,
                        }
                    )
                )
                for sid in newly_running:
                    running_but_unassigned.append(sid)
                    out.append(
                        _json.dumps(
                            {
                                "type": "step_started",
                                "id": sid,
                                "started_at_utc": datetime.now(timezone.utc).isoformat(),
                                "done": False,
                            }
                        )
                    )

            # Update tracking for next comparison.
            prev_step_status = dict(current_status)

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
                        step_status=event.get("step_status", {}),
                        pending_revise=event.get("pending_revise", False),
                        has_response=event.get("response") is not None,
                        approval_round=event.get("approval_round", 0),
                        iterations=event.get("iterations", 0),
                    )

                    for out_chunk in _emit_step_event(event):
                        yield out_chunk

                    response = event.get("response")
                    if response:
                        yield _json.dumps(
                            {
                                "type": "final_response",
                                "content": response,
                                "done": True,
                            }
                        )
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

                    # Map namespace → step_id. Each Send() creates a unique
                    # namespace ("executor:<uid>"). We assign the first unseen
                    # namespace to the oldest running-but-unassigned step_id.
                    if ns not in ns_to_step and running_but_unassigned:
                        ns_to_step[ns] = running_but_unassigned.pop(0)
                    active_step_id = ns_to_step.get(ns)
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
                                    yield _json.dumps(
                                        {
                                            "type": "step_tool_call",
                                            "step_id": active_step_id,
                                            "tool_call_id": tc_id,
                                            "tool_name": tc["name"],
                                            "args_delta": tc.get("args", "") or "",
                                            "done": False,
                                        }
                                    )
                                elif tc_id in tool_call_args:
                                    tool_call_args[tc_id] += tc.get("args", "") or ""
                                    # Forward deltas so the UI can show args
                                    # streaming in; harmless if UI ignores.
                                    yield _json.dumps(
                                        {
                                            "type": "step_tool_call",
                                            "step_id": active_step_id,
                                            "tool_call_id": tc_id,
                                            "args_delta": tc.get("args", "") or "",
                                            "done": False,
                                        }
                                    )
                        elif token.content:
                            # Plain text delta — the ReAct agent's final
                            # answer for this step, streamed character by
                            # character.
                            content = token.content
                            if not isinstance(content, str):
                                content = str(content)
                            yield _json.dumps(
                                {
                                    "type": "step_text_delta",
                                    "step_id": active_step_id,
                                    "delta": content,
                                    "done": False,
                                }
                            )
                    elif isinstance(token, ToolMessage):
                        yield _json.dumps(
                            {
                                "type": "step_tool_result",
                                "step_id": active_step_id,
                                "tool_call_id": token.tool_call_id,
                                "tool_name": token.name,
                                "content": str(token.content),
                                "done": False,
                            }
                        )
                    continue

            # Stream loop ended — inspect the graph state to detect an interrupt.
            state_snapshot = await self._graph.aget_state(config)
            tasks = getattr(state_snapshot, "tasks", None) or []
            interrupts = [t for t in tasks if getattr(t, "interrupts", None)]
            if interrupts:
                snapshot_values = state_snapshot.values or {}
                plan_steps: list[PlanStep] = snapshot_values.get("plan", []) or []
                approval_round = (snapshot_values.get("approval_round") or 0) + 1
                yield _json.dumps(
                    {
                        "type": "awaiting_approval",
                        "thread_id": pe_thread_id,
                        "plan": [{"id": s.id, "text": s.text, "depends_on": s.depends_on} for s in plan_steps],
                        "round": approval_round,
                        "done": True,
                    }
                )
                return

            if not emitted_final:
                # Fallback summary — only reached when the graph ends WITHOUT the
                # replanner having set state.response (e.g. recursion_limit hit
                # or MAX_ITERATIONS guardrail fired mid-plan). Label the state
                # clearly so the user doesn't mistake a forced-END for a
                # graceful completion.
                final_state = event if isinstance(event, dict) else {}
                f_plan: list[PlanStep] = final_state.get("plan") or []
                f_status: dict[str, str] = final_state.get("step_status") or {}
                f_results: dict[str, str] = final_state.get("step_results") or {}
                done_steps = [s for s in f_plan if f_status.get(s.id) == StepStatus.DONE.value]
                remaining = [
                    s for s in f_plan if f_status.get(s.id) in (StepStatus.PENDING.value, StepStatus.RUNNING.value)
                ]
                if done_steps and remaining:
                    summary = (
                        f"⚠ 已执行 {len(done_steps)} 步，但还有 {len(remaining)} 步未完成就被硬护栏终止"
                        "（可能触及最大迭代次数）。已完成部分的结果已写回对应卡片。\n\n## 已完成\n"
                        + "\n".join(f"- [{s.id}] {s.text}" for s in done_steps)
                        + "\n\n## 未完成\n"
                        + "\n".join(f"- [{s.id}] {s.text}" for s in remaining)
                    )
                elif done_steps:
                    summary = "## 执行结束\n" + "\n".join(
                        f"- [{s.id}] {s.text}\n  {(f_results.get(s.id) or '')[:200]}" for s in done_steps
                    )
                else:
                    summary = "执行结束，无可汇报的步骤。"
                yield _json.dumps(
                    {
                        "type": "final_response",
                        "content": summary,
                        "done": True,
                    }
                )
        except asyncio.CancelledError:
            # Container is shutting down (SIGTERM) or the client disconnected
            # mid-stream. Emit a tombstone so the UI can transition the in-
            # flight step out of "running" cleanly, then re-raise so the
            # ASGI runtime can finish the cancellation.
            logger.info(
                "pe_astream_cancelled",
                session_id=session_id,
                pe_thread_id=pe_thread_id,
            )
            try:
                yield _json.dumps(
                    {
                        "type": "interrupted",
                        "message": "服务正在重启或连接已断开，本次处理已中止。请稍后重新发起。",
                        "done": True,
                    }
                )
            except Exception:
                pass
            raise
        except Exception as e:
            logger.exception("pe_astream_failed", session_id=session_id)
            yield _json.dumps(
                {
                    "type": "error",
                    "message": str(e),
                    "done": True,
                }
            )
        finally:
            ACTIVE_PE_THREADS.discard(pe_thread_id)
            langfuse_handler.client.flush()
