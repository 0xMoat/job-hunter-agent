# Plan-and-Execute Subgraph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增独立的 Plan-and-Execute 子图通道，承载"一键处理今日推荐职位"场景，作为面试可讲解的技术亮点。ReAct 主对话保持不变。

**Architecture:** 独立 `PlanExecuteAgent` 管理 `planner → executor → replanner` 子图；Executor 内部用 `create_react_agent` 复用现有 8 个工具；通过新 API `/chatbot/plan-execute` 以 SSE 推送 `plan_created / step_started / step_completed / plan_updated / final_response` 事件；前端新增 `/auto-process` 页面 + `<PlanTimeline>` 组件。

**Tech Stack:** LangGraph (StateGraph + `create_react_agent`)、LangChain `with_structured_output`、Pydantic、FastAPI SSE、Next.js 15（App Router）、既有 mem0 / PG checkpointer / Langfuse。

**仓库约定：** 无 pytest（CLAUDE.md 明确 "There are no automated tests"）。本计划用 **CLI 验证脚本 + 手动 E2E checklist + Langfuse eval 指标** 替代 TDD。每个后端任务落盘后用 `make lint` 做静态验证，用脚本跑一条端到端链路做行为验证。

---

## 文件结构

```
app/
├── schemas/plan_execute.py                   # [新] Plan/Response/Act/PlanExecuteState
├── schemas/__init__.py                        # [改] 导出新 schema
├── core/prompts/plan_execute_planner.md       # [新] Planner system prompt
├── core/prompts/plan_execute_replanner.md     # [新] Replanner system prompt
├── core/prompts/__init__.py                   # [改] 新增 loader
├── core/langgraph/plan_execute.py             # [新] PlanExecuteAgent 主类
├── api/v1/chatbot.py                          # [改] 新增 /plan-execute 路由
evals/metrics/prompts/
├── plan_quality.md                            # [新] Plan 质量评分
├── replan_decision.md                         # [新] Replan 决策评分
scripts/
└── verify_plan_execute.py                     # [新] CLI 端到端验证
frontend/
├── lib/types.ts                               # [改] 新增 PlanStreamChunk / PlanStep
├── lib/api.ts                                 # [改] 新增 startPlanExecute()
├── app/auto-process/page.tsx                  # [新] 页面
├── components/plan/PlanTimeline.tsx           # [新] 时间线容器
├── components/plan/PlanStepCard.tsx           # [新] 单步卡片
└── components/chat/ChatHeader.tsx（或等价位置）# [改] 新增入口按钮
```

---

## Task 1 · 定义 P&E schemas

**Files:**
- Create: `app/schemas/plan_execute.py`
- Modify: `app/schemas/__init__.py`

- [ ] **Step 1: 创建 schema 文件**

写入 `app/schemas/plan_execute.py`：

```python
"""Schemas for the Plan-and-Execute subgraph."""

from typing import Union

from pydantic import BaseModel, Field


class Plan(BaseModel):
    """An ordered list of natural-language steps to execute."""

    steps: list[str] = Field(
        ...,
        description="按顺序执行的步骤，每步一句自然语言指令，原子化且可独立执行。",
    )


class Response(BaseModel):
    """The final answer to return to the user, ending the loop."""

    content: str = Field(..., description="给用户的最终答复（Markdown 可选）")


class Act(BaseModel):
    """Replanner output: either continue with a new plan or finish with a response."""

    action: Union[Response, Plan] = Field(
        ...,
        description="返回 Response 以结束；返回 Plan 以替换剩余待执行步骤。",
    )


class PlanExecuteState(BaseModel):
    """Runtime state for the Plan-and-Execute subgraph."""

    input: str = Field(..., description="用户目标（固定模板或自由文本）")
    plan: list[str] = Field(default_factory=list, description="待执行的剩余步骤")
    past_steps: list[tuple[str, str]] = Field(
        default_factory=list, description="已执行步骤的 (step_text, result) 历史"
    )
    response: str | None = Field(default=None, description="最终答复，由 Replanner 设置")
    long_term_memory: str = Field(default="", description="mem0 检索的用户画像")
    pending_applications: str = Field(default="", description="进入子图前快照")
    iterations: int = Field(default=0, description="循环次数（硬护栏）")
```

- [ ] **Step 2: 在包入口导出**

修改 `app/schemas/__init__.py`，在既有 imports 之后追加：

```python
from app.schemas.plan_execute import (
    Act,
    Plan,
    PlanExecuteState,
    Response as PlanResponse,
)
```

并把 `"Act"`, `"Plan"`, `"PlanExecuteState"`, `"PlanResponse"` 追加进 `__all__`。

> 说明：用 `PlanResponse` 作为导出别名，避免与 FastAPI/stdlib 中常见的 `Response` 名冲突。

- [ ] **Step 3: Lint**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent && make lint
```

Expected: 通过，无 error。

- [ ] **Step 4: Commit**

```bash
git add app/schemas/plan_execute.py app/schemas/__init__.py
git commit -m "feat(pe): add Plan-and-Execute schemas"
```

---

## Task 2 · 添加 planner/replanner prompts + loader

**Files:**
- Create: `app/core/prompts/plan_execute_planner.md`
- Create: `app/core/prompts/plan_execute_replanner.md`
- Modify: `app/core/prompts/__init__.py`

- [ ] **Step 1: Planner prompt**

写入 `app/core/prompts/plan_execute_planner.md`：

````markdown
# Role: Task Planner

You are the **Planner** of a job-hunting assistant. Given a user goal and context,
produce an ordered plan to accomplish the goal. Each step must be:

1. A single atomic action expressible as a short natural-language instruction.
2. Executable by a downstream ReAct agent that has access to these tools:
   `job_search`, `company_research`, `cover_letter`, `application_tracker`,
   `job_preferences`, `duckduckgo_search`, `resume_studio`, `resume_pdf`.
3. Self-contained: the step text must name the specific company/role, not "the one above".

# Rules

- Output ONLY the structured Plan (no prose, no markdown).
- Do NOT include steps for actions not supported by the tools.
- Prefer 3–8 steps total. If the goal needs more, split into phases; if fewer, that is fine.
- The final step should be a summary/reporting step (e.g., "汇总本次处理结果并提交最终回复").

# Context

## User goal
{input}

## What you know about the user
{long_term_memory}

## Pending applications (today's picks)
{pending_applications}

## Current date
{current_date_and_time}
````

- [ ] **Step 2: Replanner prompt**

写入 `app/core/prompts/plan_execute_replanner.md`：

````markdown
# Role: Replanner

You are the **Replanner**. Given the original goal, the original plan, and what
has already been executed, decide one of:

- **Finish** (return `Response`): when the user's goal is fully met OR cannot
  reasonably progress further. The `content` should be a user-facing Markdown
  summary of what was accomplished and any skipped items (with reasons).
- **Continue** (return `Plan`): return the REMAINING steps only. Do NOT repeat
  steps already completed. You MAY modify, drop, or add steps based on what
  just happened (e.g., a company research revealed a red flag → drop its
  cover-letter step and add an "标记为 not_a_match" step).

# Rules

- Output ONLY the structured `Act` (action is either `Response` or `Plan`).
- If a prior step failed, DO NOT retry it blindly — decide whether to skip,
  replace, or terminate.
- Keep the plan minimal — do not pad with unnecessary steps.

# Context

## Original goal
{input}

## Original plan
{original_plan}

## Steps already executed
{past_steps}
````

- [ ] **Step 3: Loader**

修改 `app/core/prompts/__init__.py`，追加：

```python
def load_plan_execute_planner_prompt(**kwargs) -> str:
    """Load the Plan-and-Execute planner system prompt."""
    with open(os.path.join(os.path.dirname(__file__), "plan_execute_planner.md"), "r") as f:
        return f.read().format(
            current_date_and_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            **kwargs,
        )


def load_plan_execute_replanner_prompt(**kwargs) -> str:
    """Load the Plan-and-Execute replanner system prompt."""
    with open(os.path.join(os.path.dirname(__file__), "plan_execute_replanner.md"), "r") as f:
        return f.read().format(**kwargs)
```

- [ ] **Step 4: Lint**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent && make lint
```

Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add app/core/prompts/plan_execute_planner.md app/core/prompts/plan_execute_replanner.md app/core/prompts/__init__.py
git commit -m "feat(pe): add planner and replanner prompts"
```

---

## Task 3 · PlanExecuteAgent 骨架（planner 节点）

**Files:**
- Create: `app/core/langgraph/plan_execute.py`

- [ ] **Step 1: 文件骨架 + planner 节点**

写入 `app/core/langgraph/plan_execute.py`：

```python
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
```

> 说明：`_executor` / `_replanner` 节点在 Task 4/5 加入；此处先验证 Planner 能独立工作。

- [ ] **Step 2: Lint**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent && make lint
```

Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add app/core/langgraph/plan_execute.py
git commit -m "feat(pe): add PlanExecuteAgent skeleton with planner node"
```

---

## Task 4 · Executor 节点

**Files:**
- Modify: `app/core/langgraph/plan_execute.py`

- [ ] **Step 1: 在 PlanExecuteAgent 类末尾追加 executor 节点**

```python
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
```

- [ ] **Step 2: Lint**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent && make lint
```

Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add app/core/langgraph/plan_execute.py
git commit -m "feat(pe): add executor node using create_react_agent"
```

---

## Task 5 · Replanner 节点 + 图组装

**Files:**
- Modify: `app/core/langgraph/plan_execute.py`

- [ ] **Step 1: 在类末尾追加 replanner 节点 + 路由 + create_graph**

```python
    # ---------- replanner node ----------

    async def _replan(self, state: PlanExecuteState, config: RunnableConfig) -> dict:
        """Decide whether to finish with a Response or continue with a new Plan."""
        past_steps_text = "\n".join(
            f"{i + 1}. {step}\n   → {result}" for i, (step, result) in enumerate(state.past_steps)
        ) or "（尚无）"
        original_plan_text = "\n".join(
            f"{i + 1}. {s}" for i, s in enumerate(state.past_steps + [(s, "") for s in state.plan])
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
```

- [ ] **Step 2: Lint**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent && make lint
```

Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add app/core/langgraph/plan_execute.py
git commit -m "feat(pe): add replanner node and wire StateGraph"
```

---

## Task 6 · astream SSE 序列化

**Files:**
- Modify: `app/core/langgraph/plan_execute.py`

- [ ] **Step 1: 在类末尾追加 stream 方法**

```python
    # ---------- public streaming API ----------

    async def astream(
        self,
        goal: str,
        session_id: str,
        user_id: str,
    ) -> AsyncGenerator[str, None]:
        """Stream SSE JSON chunks for a Plan-and-Execute run.

        Emits (in order):
          plan_created → [step_started → tool_* (from executor) → step_completed
                          → plan_updated?]* → final_response
        """
        if self._graph is None:
            await self.create_graph()

        long_term_memory, pending = await asyncio.gather(
            self._get_relevant_memory(user_id, goal),
            self._get_pending_applications(user_id),
        )

        if not pending:
            yield _json.dumps({
                "type": "final_response",
                "content": "暂无待处理的职位。请先在看板中添加职位后再运行一键处理。",
                "done": True,
            })
            return

        langfuse_handler = CallbackHandler()
        config: RunnableConfig = {
            "configurable": {"thread_id": session_id, "user_id": user_id},
            "callbacks": [langfuse_handler],
            "metadata": {
                "user_id": user_id,
                "session_id": session_id,
                "langfuse_session_id": session_id,
                "langfuse_user_id": str(user_id),
                "environment": settings.ENVIRONMENT.value,
                "pipeline": "plan_execute",
            },
            "recursion_limit": 50,
        }

        initial_state = {
            "input": goal,
            "long_term_memory": long_term_memory or "",
            "pending_applications": pending,
        }

        emitted_plan = False
        current_plan: list[str] = []
        current_step_index = -1

        try:
            async for event in self._graph.astream(initial_state, config, stream_mode="values"):
                # "values" mode emits full state after every node — diff to get events
                new_plan = event.get("plan", [])
                past_steps = event.get("past_steps", [])
                response = event.get("response")

                # plan_created: first time we see a non-empty plan
                if not emitted_plan and new_plan:
                    emitted_plan = True
                    current_plan = list(new_plan)
                    yield _json.dumps({
                        "type": "plan_created",
                        "steps": current_plan,
                        "done": False,
                    })

                # step_completed: past_steps grew
                if len(past_steps) > current_step_index + 1:
                    # emit step_started then step_completed for each new past step
                    for i in range(current_step_index + 1, len(past_steps)):
                        step_text, result_text = past_steps[i]
                        yield _json.dumps({
                            "type": "step_started",
                            "index": i,
                            "text": step_text,
                            "total": i + 1 + len(new_plan),
                            "done": False,
                        })
                        yield _json.dumps({
                            "type": "step_completed",
                            "index": i,
                            "text": step_text,
                            "result": result_text,
                            "done": False,
                        })
                    current_step_index = len(past_steps) - 1

                # plan_updated: replanner changed remaining plan
                if emitted_plan and new_plan and new_plan != current_plan[len(past_steps):]:
                    current_plan = list(past_steps_texts := [s for s, _ in past_steps]) + list(new_plan)
                    yield _json.dumps({
                        "type": "plan_updated",
                        "remaining": list(new_plan),
                        "done": False,
                    })

                # final_response
                if response:
                    yield _json.dumps({
                        "type": "final_response",
                        "content": response,
                        "done": True,
                    })
                    return
        except Exception as e:
            logger.exception("pe_astream_failed", session_id=session_id)
            yield _json.dumps({
                "type": "error",
                "message": str(e),
                "done": True,
            })
        finally:
            langfuse_handler.client.flush()
```

> 说明：`stream_mode="values"` 在每个节点完成后发完整 state，差分简单可靠；不用 `messages` 模式是因为 Executor 内部的 token 流对顶层 P&E 视角不重要（步骤级粒度即可）。

- [ ] **Step 2: Lint**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent && make lint
```

Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add app/core/langgraph/plan_execute.py
git commit -m "feat(pe): add astream SSE serializer"
```

---

## Task 7 · API 路由 `/chatbot/plan-execute`

**Files:**
- Modify: `app/api/v1/chatbot.py`

- [ ] **Step 1: 在既有 imports 处追加**

在 `app/api/v1/chatbot.py` 的 imports 块追加：

```python
from pydantic import BaseModel

from app.core.langgraph.plan_execute import PlanExecuteAgent
```

- [ ] **Step 2: 在模块级单例处追加**

紧接着 `agent = LangGraphAgent()` 下一行：

```python
plan_execute_agent = PlanExecuteAgent()


class PlanExecuteRequest(BaseModel):
    goal: str = "处理用户的今日推荐职位：按匹配度筛选、研究公司、撰写求职信、并更新看板状态。"
```

- [ ] **Step 3: 追加路由（文件末尾即可）**

```python
@router.post("/plan-execute")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS.get("chat_stream", ["20/minute"])[0])
async def plan_execute(
    request: Request,
    body: PlanExecuteRequest,
    session: Session = Depends(get_current_session),
):
    """Run the Plan-and-Execute subgraph and stream SSE chunks.

    Distinct from /chat/stream — this runs a multi-step batch pipeline.
    """
    logger.info(
        "plan_execute_request_received",
        session_id=session.id,
        user_id=session.user_id,
    )

    async def event_generator():
        try:
            async for chunk in plan_execute_agent.astream(
                goal=body.goal,
                session_id=session.id,
                user_id=str(session.user_id),
            ):
                yield f"data: {chunk}\n\n"
        except Exception as e:
            logger.exception("plan_execute_stream_failed", session_id=session.id)
            yield f"data: {_json.dumps({'type': 'error', 'message': str(e), 'done': True})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

- [ ] **Step 4: Lint + 启动服务冒烟**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent && make lint
```

Expected: 通过。

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent && make dev &
sleep 8
curl -s http://localhost:8000/api/v1/health || echo "health not exposed; ok"
kill %1
```

Expected: 服务起来不抛 import error（看日志里不应出现 traceback）。

- [ ] **Step 5: Commit**

```bash
git add app/api/v1/chatbot.py
git commit -m "feat(pe): add /chatbot/plan-execute SSE endpoint"
```

---

## Task 8 · CLI 验证脚本

**Files:**
- Create: `scripts/verify_plan_execute.py`

- [ ] **Step 1: 写脚本**

```python
"""End-to-end verification for the Plan-and-Execute subgraph.

Usage:
    uv run python scripts/verify_plan_execute.py <user_id>

Runs the agent against a real user's pending applications, prints every SSE
chunk, and exits non-zero on any error event.
"""

import asyncio
import json
import sys
import uuid

from app.core.langgraph.plan_execute import PlanExecuteAgent


async def main(user_id: str) -> int:
    agent = PlanExecuteAgent()
    session_id = str(uuid.uuid4())
    goal = (
        "处理用户的今日推荐职位：按匹配度筛选 Top 3，逐个做公司简短调研、"
        "为 Top 1 撰写求职信，并把处理结果存入看板。最后给出汇总报告。"
    )
    error_seen = False
    step_count = 0
    final = None

    print(f"[verify] session_id={session_id} user_id={user_id}")
    async for raw in agent.astream(goal=goal, session_id=session_id, user_id=user_id):
        event = json.loads(raw)
        etype = event.get("type")
        if etype == "plan_created":
            print(f"\n[plan_created] {len(event['steps'])} 步:")
            for i, s in enumerate(event["steps"], 1):
                print(f"  {i}. {s}")
        elif etype == "step_started":
            step_count += 1
            print(f"\n[step_started #{event['index']}] {event['text']}")
        elif etype == "step_completed":
            result = (event.get("result") or "")[:200]
            failed = result.startswith("FAILED")
            marker = "❌" if failed else "✅"
            print(f"[step_completed #{event['index']}] {marker} {result}")
            if failed:
                error_seen = True
        elif etype == "plan_updated":
            print(f"\n[plan_updated] remaining={len(event['remaining'])} 步")
            for i, s in enumerate(event["remaining"], 1):
                print(f"  {i}. {s}")
        elif etype == "final_response":
            final = event["content"]
        elif etype == "error":
            print(f"\n[error] {event.get('message')}")
            error_seen = True
        else:
            print(f"[unknown] {event}")

    print("\n" + "=" * 60)
    print(f"steps executed: {step_count}")
    print(f"final_response:\n{final}")
    return 1 if error_seen else 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: uv run python scripts/verify_plan_execute.py <user_id>")
        sys.exit(2)
    sys.exit(asyncio.run(main(sys.argv[1])))
```

- [ ] **Step 2: 运行脚本验证（要求目标用户有 pending 职位）**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent && uv run python scripts/verify_plan_execute.py 1
```

Expected: 控制台依次输出 `plan_created` → N 对 `step_started/step_completed` → 可选 `plan_updated` → `final_response`；退出码 0（若所有步骤成功）或 1（若有失败步骤——这本身是合法场景，说明 Replanner 未跳过失败）。

> 若用户 id=1 没有 pending，换一个有 pending 的 id；或先用前端在看板添加一条。

- [ ] **Step 3: Commit**

```bash
git add scripts/verify_plan_execute.py
git commit -m "feat(pe): add verify_plan_execute CLI script"
```

---

## Task 9 · Langfuse Eval 指标

**Files:**
- Create: `evals/metrics/prompts/plan_quality.md`
- Create: `evals/metrics/prompts/replan_decision.md`

- [ ] **Step 1: plan_quality.md**

写入：

````markdown
# Plan Quality

评估 Plan-and-Execute Agent 生成的**初始 plan** 的质量。仅关注 Planner 节点的
输出（即 trace 中第一次出现的 `plan` 字段），不评估后续执行结果。

## 评分维度

- 步骤是否覆盖了用户目标所需的所有关键动作
- 步骤是否原子化（一步一个明确动作）
- 是否避免了无效步骤（重复、冗余、与工具能力不符）
- 步骤顺序是否合理（先研究后写信、先写信后存档等）

## 打分

- **5**：完全覆盖，步骤原子化，顺序合理，无冗余
- **4**：覆盖充分，个别步骤粒度略粗或可合并
- **3**：基本覆盖，有 1–2 个明显冗余或顺序问题
- **2**：遗漏关键动作或顺序混乱
- **1**：几乎不可执行，与目标脱节

请输出 JSON：`{"score": 1-5, "reasoning": "一句话解释"}`
````

- [ ] **Step 2: replan_decision.md**

写入：

````markdown
# Replan Decision Quality

评估 Plan-and-Execute Agent 中 **Replanner 节点每次决策**的合理性。聚焦 trace
中 `replanner` span 的输出（`Response` 或 `Plan`），参考其前的 `past_steps`。

## 评分维度

- 决策是否与 past_steps 的实际进展匹配（已完成目标就 Response；尚未完成就 Plan）
- 若返回 Plan：是否避免重复已完成步骤、是否基于失败/新信息做了合理调整
- 若返回 Response：总结是否准确涵盖了已完成/跳过的步骤

## 打分

- **5**：每次决策都恰当，失败处理得体，无冗余
- **4**：大部分决策合理，偶有 1 次可优化
- **3**：决策基本可用，但出现过"已完成却继续规划"或"未完成却过早结束"
- **2**：明显决策失误，如重复执行同一步骤
- **1**：决策严重错误，导致任务无法推进

请输出 JSON：`{"score": 1-5, "reasoning": "一句话解释"}`
````

- [ ] **Step 3: Commit**

```bash
git add evals/metrics/prompts/plan_quality.md evals/metrics/prompts/replan_decision.md
git commit -m "feat(pe): add plan_quality and replan_decision eval metrics"
```

---

## Task 10 · 前端：扩展类型 + API client

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: types.ts 追加**

在 `frontend/lib/types.ts` 末尾追加：

```typescript
// ── Plan-and-Execute ───────────────────────────────────────────────────────

export type PlanStepStatus = "pending" | "running" | "done" | "failed"

export interface PlanStep {
  index: number
  text: string
  status: PlanStepStatus
  result?: string
}

export type PlanStreamChunk =
  | { type: "plan_created"; steps: string[]; done: false }
  | { type: "step_started"; index: number; text: string; total: number; done: false }
  | { type: "step_completed"; index: number; text: string; result: string; done: false }
  | { type: "plan_updated"; remaining: string[]; reason?: string; done: false }
  | { type: "final_response"; content: string; done: true }
  | { type: "error"; message: string; step_index?: number; done: true }
```

- [ ] **Step 2: api.ts 追加 fetch helper**

在 `frontend/lib/api.ts` 末尾追加：

```typescript
// ── Plan-and-Execute ─────────────────────────────────────────────────────

export async function startPlanExecute(
  token: string,
  goal?: string,
): Promise<Response> {
  const body = goal ? JSON.stringify({ goal }) : JSON.stringify({})
  return fetch(`${BASE_URL}/api/v1/chatbot/plan-execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body,
  })
}
```

> 注意：直接返回 `Response`，由页面侧用 `getReader()` 解析 SSE 流。

- [ ] **Step 3: Lint（前端）**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm lint
```

Expected: 通过。

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/api.ts
git commit -m "feat(pe-ui): add PlanStreamChunk types and API client"
```

---

## Task 11 · 前端：`<PlanStepCard>` 组件

**Files:**
- Create: `frontend/components/plan/PlanStepCard.tsx`

- [ ] **Step 1: 创建组件**

```tsx
"use client"

import { cn } from "@/lib/utils"
import type { PlanStep } from "@/lib/types"

const STATUS_STYLES: Record<PlanStep["status"], string> = {
  pending: "border-zinc-300 bg-zinc-50 text-zinc-500",
  running: "border-blue-400 bg-blue-50 text-blue-700 animate-pulse",
  done: "border-emerald-500 bg-emerald-50 text-emerald-800",
  failed: "border-rose-500 bg-rose-50 text-rose-800",
}

const STATUS_ICON: Record<PlanStep["status"], string> = {
  pending: "○",
  running: "◐",
  done: "✓",
  failed: "✗",
}

export function PlanStepCard({ step }: { step: PlanStep }) {
  return (
    <div
      className={cn(
        "rounded-lg border px-4 py-3 transition-colors",
        STATUS_STYLES[step.status],
      )}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 font-mono text-lg leading-none">
          {STATUS_ICON[step.status]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">
            Step {step.index + 1}
          </div>
          <div className="mt-1 text-sm opacity-90">{step.text}</div>
          {step.result && (
            <pre className="mt-2 max-h-32 overflow-auto rounded bg-white/60 p-2 text-xs whitespace-pre-wrap">
              {step.result}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
```

> 若项目未提供 `cn` util，用 `clsx` 或手写字符串拼接替代。

- [ ] **Step 2: Lint**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm lint
```

Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add frontend/components/plan/PlanStepCard.tsx
git commit -m "feat(pe-ui): add PlanStepCard component"
```

---

## Task 12 · 前端：`<PlanTimeline>` 容器组件

**Files:**
- Create: `frontend/components/plan/PlanTimeline.tsx`

- [ ] **Step 1: 组件实现**

```tsx
"use client"

import { useState } from "react"
import { startPlanExecute } from "@/lib/api"
import type { PlanStep, PlanStreamChunk } from "@/lib/types"
import { PlanStepCard } from "./PlanStepCard"

interface PlanTimelineProps {
  token: string
  goal?: string
}

export function PlanTimeline({ token, goal }: PlanTimelineProps) {
  const [steps, setSteps] = useState<PlanStep[]>([])
  const [finalResponse, setFinalResponse] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  async function run() {
    setSteps([])
    setFinalResponse(null)
    setErrorMsg(null)
    setRunning(true)

    let res: Response
    try {
      res = await startPlanExecute(token, goal)
    } catch (e) {
      setErrorMsg((e as Error).message)
      setRunning(false)
      return
    }
    if (!res.ok || !res.body) {
      setErrorMsg(`HTTP ${res.status}`)
      setRunning(false)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split("\n\n")
      buffer = lines.pop() ?? ""

      for (const block of lines) {
        const line = block.split("\n").find((l) => l.startsWith("data: "))
        if (!line) continue
        const payload = line.slice(6).trim()
        if (!payload) continue
        let chunk: PlanStreamChunk
        try {
          chunk = JSON.parse(payload) as PlanStreamChunk
        } catch {
          continue
        }
        handleChunk(chunk, setSteps, setFinalResponse, setErrorMsg)
      }
    }
    setRunning(false)
  }

  const completed = steps.filter((s) => s.status === "done" || s.status === "failed").length
  const total = steps.length || 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <button
          onClick={run}
          disabled={running}
          className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {running ? "运行中…" : "一键处理今日推荐"}
        </button>
        {total > 0 && (
          <div className="text-sm text-zinc-600">
            进度 {completed} / {total}
            <div className="mt-1 h-1.5 w-48 rounded-full bg-zinc-200">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all"
                style={{ width: `${total ? (completed / total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="rounded border border-rose-400 bg-rose-50 px-4 py-2 text-sm text-rose-800">
          错误：{errorMsg}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {steps.map((s) => (
          <PlanStepCard key={s.index} step={s} />
        ))}
      </div>

      {finalResponse && (
        <div className="rounded border border-emerald-400 bg-emerald-50 p-4">
          <div className="mb-2 font-semibold text-emerald-900">最终回复</div>
          <div className="whitespace-pre-wrap text-sm">{finalResponse}</div>
        </div>
      )}
    </div>
  )
}

function handleChunk(
  chunk: PlanStreamChunk,
  setSteps: React.Dispatch<React.SetStateAction<PlanStep[]>>,
  setFinal: (v: string) => void,
  setErr: (v: string) => void,
) {
  if (chunk.type === "plan_created") {
    setSteps(
      chunk.steps.map((text, i) => ({ index: i, text, status: "pending" as const })),
    )
    return
  }
  if (chunk.type === "step_started") {
    setSteps((prev) =>
      prev.map((s) => (s.index === chunk.index ? { ...s, status: "running" } : s)),
    )
    return
  }
  if (chunk.type === "step_completed") {
    const failed = chunk.result?.startsWith("FAILED")
    setSteps((prev) =>
      prev.map((s) =>
        s.index === chunk.index
          ? { ...s, status: failed ? "failed" : "done", result: chunk.result }
          : s,
      ),
    )
    return
  }
  if (chunk.type === "plan_updated") {
    setSteps((prev) => {
      const doneOrFailed = prev.filter(
        (s) => s.status === "done" || s.status === "failed",
      )
      const offset = doneOrFailed.length
      const newRemaining: PlanStep[] = chunk.remaining.map((text, i) => ({
        index: offset + i,
        text,
        status: "pending" as const,
      }))
      return [...doneOrFailed, ...newRemaining]
    })
    return
  }
  if (chunk.type === "final_response") {
    setFinal(chunk.content)
    return
  }
  if (chunk.type === "error") {
    setErr(chunk.message)
  }
}
```

- [ ] **Step 2: Lint**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm lint
```

Expected: 通过。

- [ ] **Step 3: Commit**

```bash
git add frontend/components/plan/PlanTimeline.tsx
git commit -m "feat(pe-ui): add PlanTimeline container with SSE parsing"
```

---

## Task 13 · 前端：`/auto-process` 页面 + 入口按钮

**Files:**
- Create: `frontend/app/auto-process/page.tsx`
- Modify: 对话页面 header（文件路径通过查找确认，见步骤 2）

- [ ] **Step 1: 新增页面**

写入 `frontend/app/auto-process/page.tsx`：

```tsx
"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PlanTimeline } from "@/components/plan/PlanTimeline"

export default function AutoProcessPage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    const raw = typeof window !== "undefined" ? localStorage.getItem("token") : null
    if (!raw) {
      router.replace("/login")
      return
    }
    setToken(raw)
  }, [router])

  if (!token) return null

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-2 text-2xl font-bold">自动处理今日推荐</h1>
      <p className="mb-6 text-sm text-zinc-600">
        由 Plan-and-Execute Agent 逐步完成：规划 → 研究 → 写信 → 存档 → 汇总。
      </p>
      <PlanTimeline token={token} />
    </main>
  )
}
```

> 若项目的 token 存储位置不同（例如放在 cookie/SessionContext），调整读取逻辑以匹配 `frontend/contexts/` 既有约定。

- [ ] **Step 2: 在对话页 header 加入口按钮**

先定位实际的 header 文件：

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && grep -rln "SessionContext\|useSession\|/chat" app/chat components/chat | head
```

在对话页 header（例如 `components/chat/ChatHeader.tsx` 或 `app/chat/page.tsx` 顶栏区域），追加一个按钮：

```tsx
<a
  href="/auto-process"
  className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-700"
>
  一键处理今日推荐
</a>
```

> 样式对齐已有的按钮风格（项目使用 Cool Blue 主题，可用 `bg-sky-600` 系列保持一致）。

- [ ] **Step 3: 本地冒烟**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent && make dev &
cd frontend && pnpm dev
```

打开 http://localhost:3000/auto-process，登录后点按钮。看到步骤卡片依次更新即可。

- [ ] **Step 4: Commit**

```bash
git add frontend/app/auto-process/page.tsx frontend/components/chat
git commit -m "feat(pe-ui): add /auto-process page and entry button"
```

---

## Task 14 · 手动 E2E Checklist

**Files:** 无代码改动，验证步骤落在 GitHub Issue / PR description 或 spec §11.2

- [ ] **Step 1: 逐项走查**

使用一个至少有 2 条 pending 职位的账号登录前端，依次勾选：

- [ ] 点击对话页的"一键处理今日推荐"按钮 → 跳转 `/auto-process`
- [ ] 点击页面主按钮后 3 秒内看到 `plan_created` 渲染的初始步骤清单
- [ ] 每个步骤从 `pending`（灰）→ `running`（蓝脉冲）→ `done`（绿）/`failed`（红）平滑切换
- [ ] 故意制造失败（临时在看板加一条公司名为 `!!不存在公司XYZ!!` 的 pending 职位）
  - Replanner 应产生 `plan_updated` 事件，页面上残余步骤列表被替换
- [ ] 最终显示 `final_response` Markdown 内容，进度条 100%
- [ ] 打开 Langfuse 面板，找到本次 trace，确认能看到 `planner` / `executor.step_0..N` / `replanner` span
- [ ] 用无 pending 职位的账号访问 `/auto-process` 点按钮 → 立即显示"暂无待处理的职位"

- [ ] **Step 2: 记录结果并提交**

如果全部通过，打一个小提交收尾：

```bash
git commit --allow-empty -m "chore(pe): e2e verification passed"
```

---

## Self-Review

执行过以下检查：

**1. Spec coverage**
- §1 背景与目的 / §2 架构总览 → 由 Task 3-7 落地（代码路径独立，与 ReAct 不冲突）
- §3 RAG 接入 → Task 6 `astream` 里先做一次 `_get_relevant_memory`，与 spec §3 所述"只在 Planner 入口检索一次"一致
- §4 ReAct 既有图 → 不动，✓
- §5 P&E 子图 → Task 3/4/5 对应 planner/executor/replanner；Schema ✓（Task 1）
- §6 SSE 事件协议 → Task 6（后端）+ Task 10/12（前端类型 + 渲染），6 种事件全覆盖
- §7 错误处理与护栏 → Task 5（Replanner 异常降级摘要）+ Task 4（Executor 单步失败记录 FAILED）+ Task 5 `_should_end`（MAX_ITERATIONS=10 护栏）+ Task 6 空 pending 短路
- §8 前端 `<PlanTimeline>` → Task 11/12/13
- §9 可观测性 → Task 6（Langfuse handler + metadata pipeline=plan_execute）+ 各 Task 的 `logger.info` 结构化事件名全是 `pe_*` lowercase_with_underscores，符合 AGENTS.md
- §10 文件与模块规划 → 映射一一对应
- §11 测试与验证三层 → Task 8 脚本、Task 14 checklist、Task 9 eval prompts

**2. Placeholder scan** — 无 TBD / TODO；每步都给了完整代码或命令。

**3. Type consistency**
- `Plan / Response / Act / PlanExecuteState` 全 Task 统一名字
- `PlanResponse` 仅为避免与 FastAPI/std 冲突的导出别名，Replanner 内部判断仍用这个名（Task 5 `isinstance(act.action, PlanResponse)`）
- 前端 `PlanStreamChunk` 联合类型 6 个分支与后端 Task 6 发的 6 种 type 一一对应
- `PlanStepStatus` 四值 `pending|running|done|failed` 在 StepCard / Timeline 两处保持一致

无需修补，可开始实施。
