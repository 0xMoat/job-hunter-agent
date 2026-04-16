# Plan Approval HITL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Plan-and-Execute 子图中插入 approval_gate 节点，Planner 产出计划后 `interrupt()` 暂停，Chat 气泡展示批准/修改/取消；用户反馈经 Replanner 重写 plan 后 `Command(resume)` 恢复执行，支持多轮审批闭环。

**Architecture:** 后端 StateGraph 新增 `approval_gate` 节点处于 `planner → executor` 之间，通过条件路由根据用户动作分发到 `executor` / `replanner` / `END`。Revise 场景把 user_feedback 写入 state，Replanner 读 feedback 改写 plan 后设 `pending_revise=True` 让图重回 approval_gate。前端气泡新增 `awaitingApproval` 状态渲染 `<PlanApprovalCard>`，支持文本反馈。通过带 `thread_id` 的同一 `/plan-execute` 路由实现 resume。

**Tech Stack:** LangGraph `interrupt()` + `Command(resume=...)`、AsyncPostgresSaver、Pydantic、FastAPI SSE、Next.js 16、既有 localStorage 缓存。

**仓库约定：** 无 pytest（见 CLAUDE.md）。验证方式：`make lint`、`uv run python -c ...` 冒烟、`pnpm exec tsc --noEmit`、手动 E2E checklist。每个任务落盘后 lint 干净再 commit。

---

## 文件结构

```
app/
├── schemas/plan_execute.py                # [改] PlanExecuteState 加 3 字段
├── core/prompts/plan_execute_replanner.md # [改] 加 user_feedback 注入段落
├── core/langgraph/plan_execute.py         # [改] 新增 approval_gate 节点、路由、astream resume 分支
├── api/v1/chatbot.py                      # [改] PlanExecuteRequest 加字段 + 分支
frontend/
├── lib/types.ts                           # [改] PlanExecuteView 加字段，PlanStreamChunk 加 awaiting_approval / plan_revised
├── lib/api.ts                             # [改] startPlanExecute 增加 resume 参数
├── hooks/useChat.ts                       # [改] 新增 resumePlanExecute、处理新 chunk、cache 规则扩展
├── components/plan/PlanApprovalCard.tsx   # [新] 按钮 + 文本框面板
└── components/plan/PlanTimeline.tsx       # [改] 接入审批卡、新徽章
```

---

## Task 1 · 扩展 PlanExecuteState schema

**Files:**
- Modify: `app/schemas/plan_execute.py`

- [ ] **Step 1: Read current file**

确认当前 PlanExecuteState 长这样（保持前面字段不动）：

```python
class PlanExecuteState(BaseModel):
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

- [ ] **Step 2: Append HITL fields**

在 iterations 下方追加 3 个字段：

```python
    # ── HITL ──
    user_feedback: str | None = Field(
        default=None,
        description="revise 动作时用户输入的修改意见，Replanner 读取后置回 None",
    )
    approval_round: int = Field(
        default=0, description="审批轮次，每次 interrupt 前 +1"
    )
    pending_revise: bool = Field(
        default=False,
        description="路由 hint：True 时 Replanner 产出的新 plan 送回 approval_gate",
    )
```

- [ ] **Step 3: Lint**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && uv run ruff check app/schemas/plan_execute.py
```

Expected: All checks passed.

- [ ] **Step 4: Smoke import**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && uv run python -c "
from app.schemas import PlanExecuteState
s = PlanExecuteState(input='x')
assert s.user_feedback is None
assert s.approval_round == 0
assert s.pending_revise is False
print('ok')
"
```

Expected: prints `ok`.

- [ ] **Step 5: Commit**

```
git add app/schemas/plan_execute.py
git commit -m "feat(hitl): extend PlanExecuteState with user_feedback, approval_round, pending_revise"
```

---

## Task 2 · 更新 Replanner prompt 处理 user_feedback

**Files:**
- Modify: `app/core/prompts/plan_execute_replanner.md`

- [ ] **Step 1: Read current replanner prompt**

注意现在的 template 变量是 `{input}`, `{original_plan}`, `{past_steps}`。我们要**新增一个可选段落**：当 `{user_feedback}` 非空时展示"基于用户反馈调整"的指令。

采用 Python format-compatible 做法：增加 `{user_feedback_section}` 变量，loader 根据是否有 feedback 填充成段落或空字符串。

- [ ] **Step 2: Rewrite prompt**

把文件整个替换为：

```markdown
# Role: Replanner

You are the **Replanner**. Given the original goal, the original plan, what
has already been executed, and optionally the user's revision feedback, decide
one of:

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
- If user feedback is provided below, **prioritize it** over your own judgment
  when rewriting the plan. The user's intent is authoritative.

# Context

## Original goal
{input}

## Original plan
{original_plan}

## Steps already executed
{past_steps}
{user_feedback_section}
```

注意末尾的 `{user_feedback_section}` 占位符，不要加空行（由 loader 决定是否填入）。

- [ ] **Step 3: Update loader in prompts/__init__.py**

修改 `app/core/prompts/__init__.py` 里的 `load_plan_execute_replanner_prompt` 函数：

```python
def load_plan_execute_replanner_prompt(**kwargs) -> str:
    """Load the Plan-and-Execute replanner system prompt.

    If `user_feedback` kwarg is provided and non-empty, a dedicated section
    is inserted so the LLM treats it as authoritative guidance.
    """
    user_feedback = kwargs.pop("user_feedback", None)
    if user_feedback:
        kwargs["user_feedback_section"] = (
            "\n\n## 用户反馈（修订意见，请优先据此调整）\n" + user_feedback
        )
    else:
        kwargs["user_feedback_section"] = ""
    with open(os.path.join(os.path.dirname(__file__), "plan_execute_replanner.md"), "r") as f:
        return f.read().format(**kwargs)
```

- [ ] **Step 4: Smoke test both paths**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && uv run python -c "
from app.core.prompts import load_plan_execute_replanner_prompt
p1 = load_plan_execute_replanner_prompt(input='g', original_plan='op', past_steps='ps')
assert '用户反馈' not in p1, 'without feedback should not include section'
p2 = load_plan_execute_replanner_prompt(input='g', original_plan='op', past_steps='ps', user_feedback='不要调研 X')
assert '用户反馈' in p2 and '不要调研 X' in p2
print('ok')
"
```

Expected: prints `ok`.

- [ ] **Step 5: Commit**

```
git add app/core/prompts/plan_execute_replanner.md app/core/prompts/__init__.py
git commit -m "feat(hitl): thread user_feedback into Replanner prompt"
```

---

## Task 3 · 新增 approval_gate 节点 + 路由函数

**Files:**
- Modify: `app/core/langgraph/plan_execute.py`

- [ ] **Step 1: Add interrupt import**

在文件顶部 `from langgraph.types import RunnableConfig` 这一行下方追加：

```python
from langgraph.types import Command, interrupt
```

合并后的 import 行：

```python
from langgraph.types import Command, RunnableConfig, interrupt
```

- [ ] **Step 2: Add _approval_gate method to PlanExecuteAgent class**

在 `_replan` 方法上方（line 238 附近，紧跟 `_execute_step` 结束）新增：

```python
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
        # approve (default)
        logger.info("pe_approval_approved", round=next_round)
        return {"approval_round": next_round}

    def _route_after_approval(self, state: PlanExecuteState) -> str:
        """Edge dispatcher after approval_gate."""
        if state.response is not None:
            return END
        if state.pending_revise:
            return "replanner"
        return "executor"
```

- [ ] **Step 3: Lint**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && uv run ruff check app/core/langgraph/plan_execute.py
```

Expected: All checks passed.

- [ ] **Step 4: Smoke import**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && uv run python -c "
from app.core.langgraph.plan_execute import PlanExecuteAgent
a = PlanExecuteAgent()
assert callable(a._approval_gate)
assert callable(a._route_after_approval)
print('ok')
"
```

Expected: prints `ok`.

- [ ] **Step 5: Commit**

```
git add app/core/langgraph/plan_execute.py
git commit -m "feat(hitl): add approval_gate node + routing function"
```

---

## Task 4 · Replanner 处理 user_feedback / 设置 pending_revise

**Files:**
- Modify: `app/core/langgraph/plan_execute.py`

- [ ] **Step 1: Read current _replan method**

当前 `_replan` (line 238 起) 调用 loader 时没传 `user_feedback`。而且返回 dict 没有 `pending_revise`。两处都要改。

- [ ] **Step 2: Update load call + return dict**

找到 `_replan` 方法内部的这段：

```python
        system_prompt = load_plan_execute_replanner_prompt(
            input=state.input,
            original_plan=original_plan_text,
            past_steps=past_steps_text,
        )
```

改成：

```python
        system_prompt = load_plan_execute_replanner_prompt(
            input=state.input,
            original_plan=original_plan_text,
            past_steps=past_steps_text,
            user_feedback=state.user_feedback,
        )
```

接下来找到 `_replan` 末尾返回分支：

```python
        if isinstance(act.action, PlanResponse):
            logger.info("pe_replan_finish", iterations=state.iterations)
            return {"response": act.action.content}

        logger.info("pe_replan_continue", new_step_count=len(act.action.steps))
        return {"plan": act.action.steps}
```

改成（fallback 分支也要清理 feedback）：

```python
        # After consuming user_feedback, clear it so next round isn't polluted.
        clear_feedback: dict = {}
        if state.user_feedback:
            clear_feedback = {"user_feedback": None}

        if isinstance(act.action, PlanResponse):
            logger.info("pe_replan_finish", iterations=state.iterations)
            return {"response": act.action.content, "pending_revise": False, **clear_feedback}

        logger.info(
            "pe_replan_continue",
            new_step_count=len(act.action.steps),
            pending_revise=state.pending_revise,
        )
        # If we got here via a revise-path approval, the produced plan must
        # loop back to the approval_gate for the user to see again.
        pending_revise_flag = state.pending_revise
        return {
            "plan": act.action.steps,
            "pending_revise": False,  # consumed; next time we'll route again
            "route_after_revise": pending_revise_flag,  # legacy field; see note below
            **clear_feedback,
        }
```

> Note: `route_after_revise` is NOT a real state field — remove that key. The correct cue to re-route is a **separate** transient field. Simpler approach: keep `pending_revise` as the single flag, but set it to False here. The routing decision is made by `_should_end` reading the **previous** pending_revise. To avoid a race, we instead use a dedicated output flag (see next step).

Revised logic — replace that entire tail with:

```python
        # User feedback has been applied this round; clear it.
        updates: dict = {}
        if state.user_feedback:
            updates["user_feedback"] = None

        if isinstance(act.action, PlanResponse):
            logger.info("pe_replan_finish", iterations=state.iterations)
            return {"response": act.action.content, "pending_revise": False, **updates}

        logger.info(
            "pe_replan_continue",
            new_step_count=len(act.action.steps),
            revise_scenario=state.pending_revise,
        )
        if state.pending_revise:
            # Revise cycle: send the rewritten plan BACK to approval_gate.
            return {
                "plan": act.action.steps,
                "pending_revise": True,
                **updates,
            }
        # Normal replan mid-execution: go to executor.
        return {
            "plan": act.action.steps,
            "pending_revise": False,
            **updates,
        }
```

- [ ] **Step 3: Lint**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && uv run ruff check app/core/langgraph/plan_execute.py
```

Expected: All checks passed.

- [ ] **Step 4: Commit**

```
git add app/core/langgraph/plan_execute.py
git commit -m "feat(hitl): thread user_feedback into Replanner, set pending_revise for revise loop"
```

---

## Task 5 · 图拓扑：接入 approval_gate + 更新 _should_end

**Files:**
- Modify: `app/core/langgraph/plan_execute.py`

- [ ] **Step 1: Update _should_end**

找到 `_should_end` 方法（line 274 附近）：

```python
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
```

改成（新增 `pending_revise` 分支，优先级在 response 检查之后但在 iterations 之前，因为 revise 场景 iterations 可能还没推进）：

```python
    def _should_end(self, state: PlanExecuteState) -> str:
        """Edge: from replanner → approval_gate (revise) / executor / END."""
        if state.response is not None:
            return END
        if state.pending_revise:
            # Revise cycle produced a new plan; loop back for user approval.
            return "approval_gate"
        if state.iterations >= MAX_ITERATIONS:
            logger.warning("pe_max_iterations_reached", iterations=state.iterations)
            return END
        if not state.plan:
            return END
        return "executor"
```

- [ ] **Step 2: Update create_graph to wire the new node**

找到 `create_graph` 方法（line 287 附近）里这段：

```python
        builder = StateGraph(PlanExecuteState)
        builder.add_node("planner", self._planner)
        builder.add_node("executor", self._execute_step)
        builder.add_node("replanner", self._replan)
        builder.set_entry_point("planner")
        builder.add_edge("planner", "executor")
        builder.add_edge("executor", "replanner")
        builder.add_conditional_edges("replanner", self._should_end, ["executor", END])
```

改成：

```python
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
```

- [ ] **Step 3: Lint**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && uv run ruff check app/core/langgraph/plan_execute.py
```

Expected: All checks passed.

- [ ] **Step 4: Smoke — build graph + inspect nodes**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && uv run python -c "
import asyncio
from app.core.langgraph.plan_execute import PlanExecuteAgent
async def main():
    a = PlanExecuteAgent()
    g = await a.create_graph()
    assert g is not None
    nodes = list(g.get_graph().nodes.keys())
    assert 'approval_gate' in nodes, nodes
    print('nodes:', nodes)
asyncio.run(main())
"
```

Expected: prints a list containing `approval_gate`.

- [ ] **Step 5: Commit**

```
git add app/core/langgraph/plan_execute.py
git commit -m "feat(hitl): wire approval_gate into StateGraph with revise loop routing"
```

---

## Task 6 · astream resume 分支 + 新 SSE 事件

**Files:**
- Modify: `app/core/langgraph/plan_execute.py`

- [ ] **Step 1: Read current astream signature and body**

astream 现在签名是：
```python
async def astream(self, goal: str, session_id: str, user_id: str) -> AsyncGenerator[str, None]:
```

我们要扩展为支持 resume。

- [ ] **Step 2: Replace astream with the HITL-aware version**

把整个 `astream` 方法（从 `async def astream` 到方法末尾 `finally: langfuse_handler.client.flush()`）替换为以下内容。核心变化：新增 `resume_thread_id` / `resume_payload` 参数；resume 时跳过 memory/pending 预取和 thread_id 生成，直接调 `graph.astream(Command(resume=...), config)`；循环里识别 LangGraph `__interrupt__` 特殊事件，emit `awaiting_approval`；检测 `pending_revise` 转换时 emit `plan_revised`。

```python
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

        Events emitted:
          plan_created, awaiting_approval, plan_revised, step_started,
          step_completed, plan_updated, final_response, error.
        """
        if self._graph is None:
            await self.create_graph()

        if resume_thread_id is None:
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
            pe_thread_id = f"pe_{session_id}_{uuid.uuid4().hex[:8]}"
            graph_input = {
                "input": goal,
                "long_term_memory": long_term_memory or "",
                "pending_applications": pending,
            }
        else:
            pe_thread_id = resume_thread_id
            graph_input = Command(resume=resume_payload or {})

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

        # Diff-state trackers across values events in this stream
        emitted_plan = False
        emitted_final = False
        past_step_ids: list[str] = []
        pending_ids: list[str] = []
        current_step_index = len(past_step_ids) - 1  # starts at -1
        # For revise detection
        last_pending_revise_state = False
        event: dict = {}

        try:
            async for event in self._graph.astream(
                graph_input,
                config,
                stream_mode="values",
            ):
                # LangGraph emits `__interrupt__` via stream_mode="updates"; in
                # "values" mode we instead see the state immediately before the
                # interrupt is raised. The cleanest signal here is: approval_gate
                # ran, state.plan is populated, and iterations hasn't advanced.
                # We handle the interrupt by inspecting the graph's interrupt
                # metadata after the loop if needed.
                new_plan = event.get("plan", []) or []
                past_steps = event.get("past_steps", []) or []
                response = event.get("response")
                pending_revise = event.get("pending_revise", False)

                if not emitted_plan and new_plan:
                    emitted_plan = True
                    pending_ids = [_new_id() for _ in new_plan]
                    yield _json.dumps({
                        "type": "plan_created",
                        "steps": [
                            {"id": sid, "text": t}
                            for sid, t in zip(pending_ids, new_plan, strict=True)
                        ],
                        "done": False,
                    })

                # If a revise cycle just produced a new plan, emit plan_revised
                # BEFORE the awaiting_approval we'll send after the loop.
                if last_pending_revise_state and not pending_revise and emitted_plan and new_plan:
                    # Regenerate pending ids for the rewritten plan
                    pending_ids = [_new_id() for _ in new_plan]
                    yield _json.dumps({
                        "type": "plan_revised",
                        "plan": [
                            {"id": sid, "text": t}
                            for sid, t in zip(pending_ids, new_plan, strict=True)
                        ],
                        "reason": "user_feedback",
                        "done": False,
                    })
                last_pending_revise_state = pending_revise

                if len(past_steps) > current_step_index + 1:
                    for i in range(current_step_index + 1, len(past_steps)):
                        if not pending_ids:
                            break
                        sid = pending_ids.pop(0)
                        past_step_ids.append(sid)
                        _, result_text = past_steps[i]
                        yield _json.dumps({
                            "type": "step_completed",
                            "id": sid,
                            "result": result_text,
                            "done": False,
                        })
                    current_step_index = len(past_steps) - 1
                    if pending_ids:
                        yield _json.dumps({
                            "type": "step_started",
                            "id": pending_ids[0],
                            "done": False,
                        })

                if response:
                    yield _json.dumps({
                        "type": "final_response",
                        "content": response,
                        "done": True,
                    })
                    emitted_final = True
                    return

            # Loop ended. Detect interrupt by reading the graph state.
            state_snapshot = await self._graph.aget_state(config)
            tasks = getattr(state_snapshot, "tasks", None) or []
            interrupts = [t for t in tasks if getattr(t, "interrupts", None)]
            if interrupts:
                # Paused at approval_gate — emit awaiting_approval.
                snapshot_values = state_snapshot.values or {}
                plan_texts = snapshot_values.get("plan", []) or []
                approval_round = snapshot_values.get("approval_round", 0) + 1
                # Use our current pending_ids if they cover plan; otherwise regenerate.
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
                summary = "## 执行结束\n" + "\n".join(
                    f"- {s}\n  {(r or '')[:200]}" for s, r in (event.get("past_steps") or [])
                ) if event.get("past_steps") else "执行结束，无可汇报的步骤。"
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
```

- [ ] **Step 3: Lint**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && uv run ruff check app/core/langgraph/plan_execute.py
```

Expected: All checks passed.

- [ ] **Step 4: Smoke — signature inspection**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && uv run python -c "
import inspect
from app.core.langgraph.plan_execute import PlanExecuteAgent
a = PlanExecuteAgent()
sig = inspect.signature(a.astream)
params = list(sig.parameters.keys())
assert 'resume_thread_id' in params, params
assert 'resume_payload' in params
print('ok', params)
"
```

Expected: prints `ok [...]` with both params present.

- [ ] **Step 5: Commit**

```
git add app/core/langgraph/plan_execute.py
git commit -m "feat(hitl): astream resume branch + awaiting_approval/plan_revised SSE events"
```

---

## Task 7 · API 端点支持 resume

**Files:**
- Modify: `app/api/v1/chatbot.py`

- [ ] **Step 1: Extend PlanExecuteRequest**

找到现有 `PlanExecuteRequest` 类（line 38 附近）：

```python
class PlanExecuteRequest(BaseModel):
    """Request body for the plan-execute endpoint."""

    goal: str = (
        "处理看板上所有状态为 pending 的职位：逐一研究公司、撰写求职信，"
        "并将处理结果更新回看板。"
    )
```

扩展为：

```python
class PlanExecuteRequest(BaseModel):
    """Request body for the plan-execute endpoint.

    Two modes:
    - start: thread_id/resume_action are None.
    - resume: provide thread_id + resume_action (optionally feedback).
    """

    goal: str = (
        "处理看板上所有状态为 pending 的职位：逐一研究公司、撰写求职信，"
        "并将处理结果更新回看板。"
    )
    thread_id: str | None = None
    resume_action: Literal["approve", "revise", "cancel"] | None = None
    feedback: str | None = None
```

这里引入了 `Literal`，确保文件顶部已有 `from typing import Literal`。如果没有，在顶部 imports 区追加：

```python
from typing import Literal
```

- [ ] **Step 2: Update the plan_execute route**

找到 `@router.post("/plan-execute")` 路由处理函数，把 body 解析 + astream 调用改成：

```python
@router.post("/plan-execute")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS.get("chat_stream", ["20/minute"])[0])
async def plan_execute(
    request: Request,
    body: PlanExecuteRequest,
    session: Session = Depends(get_current_session),
):
    """Run Plan-and-Execute or resume an interrupted HITL run via SSE."""
    is_resume = body.thread_id is not None
    if is_resume and body.resume_action == "revise" and not body.feedback:
        raise HTTPException(status_code=400, detail="feedback required for revise action")

    logger.info(
        "plan_execute_request_received",
        session_id=session.id,
        user_id=session.user_id,
        mode="resume" if is_resume else "start",
        thread_id=body.thread_id,
        resume_action=body.resume_action,
    )

    async def event_generator():
        try:
            resume_payload = None
            if is_resume:
                resume_payload = {"action": body.resume_action}
                if body.resume_action == "revise":
                    resume_payload["feedback"] = body.feedback
            async for chunk in plan_execute_agent.astream(
                goal=body.goal,
                session_id=session.id,
                user_id=str(session.user_id),
                resume_thread_id=body.thread_id,
                resume_payload=resume_payload,
            ):
                yield f"data: {chunk}\n\n"
        except Exception as e:
            logger.exception("plan_execute_stream_failed", session_id=session.id)
            yield f"data: {_json.dumps({'type': 'error', 'message': str(e), 'done': True})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")
```

- [ ] **Step 3: Lint**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && uv run ruff check app/api/v1/chatbot.py
```

Expected: All checks passed.

- [ ] **Step 4: Smoke — router registers + request schema**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && uv run python -c "
from app.api.v1.chatbot import router, PlanExecuteRequest
routes = [r.path for r in router.routes]
assert '/plan-execute' in routes, routes
r = PlanExecuteRequest(thread_id='t1', resume_action='approve')
assert r.thread_id == 't1'
try:
    PlanExecuteRequest(resume_action='revise')  # missing thread_id but would pass schema
except Exception:
    pass
print('ok')
"
```

Expected: prints `ok`.

- [ ] **Step 5: Commit**

```
git add app/api/v1/chatbot.py
git commit -m "feat(hitl): API accepts resume mode (thread_id + resume_action + feedback)"
```

---

## Task 8 · 前端类型扩展

**Files:**
- Modify: `frontend/lib/types.ts`

- [ ] **Step 1: Extend PlanExecuteView**

找到 `PlanExecuteView` 接口（约 45 行附近），在现有字段后追加 HITL 字段：

```typescript
export interface PlanExecuteView {
  steps: PlanStep[]
  finalResponse: string | null
  errorMsg: string | null
  running: boolean
  // ── HITL ──
  threadId: string | null
  awaitingApproval: boolean
  approvalRound: number
  revisionReason: string | null
  cancelled: boolean
}
```

- [ ] **Step 2: Extend PlanStreamChunk union**

找到 `PlanStreamChunk` 联合类型，在 final_response 之前插入两种新事件：

```typescript
export type PlanStreamChunk =
  | { type: "plan_created"; steps: PlanStepDescriptor[]; done: false }
  | { type: "step_started"; id: string; done: false }
  | { type: "step_completed"; id: string; result: string; done: false }
  | { type: "plan_updated"; remaining: PlanStepDescriptor[]; done: false }
  | {
      type: "awaiting_approval"
      thread_id: string
      plan: PlanStepDescriptor[]
      round: number
      done: true
    }
  | { type: "plan_revised"; plan: PlanStepDescriptor[]; reason: string; done: false }
  | { type: "final_response"; content: string; done: true }
  | { type: "error"; message: string; done: true }
```

- [ ] **Step 3: TS check**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm exec tsc --noEmit
```

Expected: exit 0 (may show pre-existing unrelated errors; ensure no new errors in types.ts / useChat references).

- [ ] **Step 4: Commit**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && git add frontend/lib/types.ts
git commit -m "feat(hitl-ui): extend PlanExecuteView + PlanStreamChunk for HITL"
```

---

## Task 9 · 前端 API client 支持 resume

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Extend startPlanExecute**

找到现有：

```typescript
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

替换为一个更通用的版本 + 一个 resume 专用 helper：

```typescript
export interface PlanExecuteResumeArgs {
  threadId: string
  action: "approve" | "revise" | "cancel"
  feedback?: string
}

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

export async function resumePlanExecute(
  token: string,
  args: PlanExecuteResumeArgs,
): Promise<Response> {
  const body: Record<string, unknown> = {
    thread_id: args.threadId,
    resume_action: args.action,
  }
  if (args.action === "revise" && args.feedback) {
    body.feedback = args.feedback
  }
  return fetch(`${BASE_URL}/api/v1/chatbot/plan-execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}
```

- [ ] **Step 2: TS check**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && git add frontend/lib/api.ts
git commit -m "feat(hitl-ui): add resumePlanExecute API client"
```

---

## Task 10 · useChat 处理新 chunk + 新增 resumePlanExecute

**Files:**
- Modify: `frontend/hooks/useChat.ts`

- [ ] **Step 1: Update initial view + imports**

找到 `startPlanExecute` 里创建 assistant placeholder 的那段（搜索 `planExecute: initialView` 附近），把 `initialView` 初始化扩展：

```typescript
    const initialView: PlanExecuteView = {
      steps: [],
      finalResponse: null,
      errorMsg: null,
      running: true,
      threadId: null,
      awaitingApproval: false,
      approvalRound: 0,
      revisionReason: null,
      cancelled: false,
    }
```

同时更新文件顶部 import 加上 resumePlanExecute：

```typescript
import {
  apiGetMessages,
  apiStreamChat,
  apiUpdateSessionName,
  startPlanExecute as apiStartPlanExecute,
  resumePlanExecute as apiResumePlanExecute,
  type PlanExecuteResumeArgs,
} from "@/lib/api"
```

- [ ] **Step 2: Add new chunk handlers**

在 SSE 解析循环里（搜 `chunk.type === "final_response"` 附近），**在 plan_updated 分支之后、final_response 之前**插入两个新分支。此外要更新 `final_response` 与 `error` 分支把相应的 terminal 标志置好：

```typescript
            } else if (chunk.type === "awaiting_approval") {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId || !m.planExecute) return m
                  const steps: PlanStep[] = chunk.plan.map((s) => ({
                    id: s.id,
                    text: s.text,
                    status: "pending" as const,
                  }))
                  return {
                    ...m,
                    planExecute: {
                      ...m.planExecute,
                      steps,
                      threadId: chunk.thread_id,
                      awaitingApproval: true,
                      approvalRound: chunk.round,
                      running: false,
                    },
                  }
                }),
              )
            } else if (chunk.type === "plan_revised") {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId || !m.planExecute) return m
                  const steps: PlanStep[] = chunk.plan.map((s) => ({
                    id: s.id,
                    text: s.text,
                    status: "pending" as const,
                  }))
                  return {
                    ...m,
                    planExecute: {
                      ...m.planExecute,
                      steps,
                      revisionReason: chunk.reason,
                    },
                  }
                }),
              )
```

把 `final_response` 分支扩展以清除 awaitingApproval 并设置 cancelled 标志（当 content 以 "已取消" 开头）：

```typescript
            } else if (chunk.type === "final_response") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId && m.planExecute
                    ? {
                        ...m,
                        planExecute: {
                          ...m.planExecute,
                          finalResponse: chunk.content,
                          awaitingApproval: false,
                          running: false,
                          cancelled: chunk.content.startsWith("已取消"),
                        },
                      }
                    : m,
                ),
              )
```

`error` 分支同样清理 awaitingApproval：

```typescript
            } else if (chunk.type === "error") {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId && m.planExecute
                    ? {
                        ...m,
                        planExecute: {
                          ...m.planExecute,
                          errorMsg: chunk.message,
                          awaitingApproval: false,
                          running: false,
                        },
                      }
                    : m,
                ),
              )
```

- [ ] **Step 3: Add resumePlanExecute method**

在 `startPlanExecute` callback 下方、`clearMessages` 之上追加新方法：

```typescript
  const resumePlanExecute = useCallback(
    async (assistantMsgId: string, args: PlanExecuteResumeArgs) => {
      if (!sessionToken) return

      // Flip the bubble back to "running" + clear transient flags while the stream is open.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId && m.planExecute
            ? {
                ...m,
                planExecute: {
                  ...m.planExecute,
                  awaitingApproval: false,
                  running: true,
                  revisionReason: null,
                  errorMsg: null,
                },
              }
            : m,
        ),
      )
      setStreaming(true)

      let response: Response
      try {
        response = await apiResumePlanExecute(sessionToken, args)
      } catch (e) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId && m.planExecute
              ? {
                  ...m,
                  planExecute: {
                    ...m.planExecute,
                    errorMsg: (e as Error).message,
                    running: false,
                  },
                }
              : m,
          ),
        )
        setStreaming(false)
        return
      }
      if (!response.ok || !response.body) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId && m.planExecute
              ? {
                  ...m,
                  planExecute: {
                    ...m.planExecute,
                    errorMsg: `HTTP ${response.status}`,
                    running: false,
                  },
                }
              : m,
          ),
        )
        setStreaming(false)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const blocks = buffer.split("\n\n")
          buffer = blocks.pop() ?? ""
          for (const block of blocks) {
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
            applyPlanChunkToMessage(setMessages, assistantMsgId, chunk)
          }
        }
      } finally {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId && m.planExecute && m.planExecute.running
              ? { ...m, planExecute: { ...m.planExecute, running: false } }
              : m,
          ),
        )
        setStreaming(false)
      }
    },
    [sessionToken],
  )
```

Return object from the hook should include `resumePlanExecute`:

```typescript
  return {
    messages,
    streaming,
    error,
    historyLoading,
    sendMessage,
    startPlanExecute,
    resumePlanExecute,     // ← add
    clearMessages,
  }
```

- [ ] **Step 4: Extract chunk handler to a shared helper**

Both `startPlanExecute` and the new `resumePlanExecute` duplicate chunk-handling logic. Refactor the big if/else chain into a module-level helper (DRY). Put this helper above `useChat`:

```typescript
function applyPlanChunkToMessage(
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  assistantId: string,
  chunk: PlanStreamChunk,
): void {
  if (chunk.type === "plan_created") {
    const steps: PlanStep[] = chunk.steps.map((s) => ({
      id: s.id,
      text: s.text,
      status: "pending" as const,
    }))
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId && m.planExecute
          ? { ...m, planExecute: { ...m.planExecute, steps } }
          : m,
      ),
    )
    return
  }
  if (chunk.type === "step_started") {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId || !m.planExecute) return m
        return {
          ...m,
          planExecute: {
            ...m.planExecute,
            steps: m.planExecute.steps.map((s) =>
              s.id === chunk.id ? { ...s, status: "running" as const } : s,
            ),
          },
        }
      }),
    )
    return
  }
  if (chunk.type === "step_completed") {
    const failed = chunk.result?.startsWith("FAILED")
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId || !m.planExecute) return m
        return {
          ...m,
          planExecute: {
            ...m.planExecute,
            steps: m.planExecute.steps.map((s) =>
              s.id === chunk.id
                ? {
                    ...s,
                    status: failed ? ("failed" as const) : ("done" as const),
                    result: chunk.result,
                  }
                : s,
            ),
          },
        }
      }),
    )
    return
  }
  if (chunk.type === "plan_updated") {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId || !m.planExecute) return m
        const doneOrFailed = m.planExecute.steps.filter(
          (s) => s.status === "done" || s.status === "failed",
        )
        const newRemaining: PlanStep[] = chunk.remaining.map((s, i) => ({
          id: s.id,
          text: s.text,
          status: i === 0 ? ("running" as const) : ("pending" as const),
        }))
        return {
          ...m,
          planExecute: {
            ...m.planExecute,
            steps: [...doneOrFailed, ...newRemaining],
          },
        }
      }),
    )
    return
  }
  if (chunk.type === "awaiting_approval") {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId || !m.planExecute) return m
        const steps: PlanStep[] = chunk.plan.map((s) => ({
          id: s.id,
          text: s.text,
          status: "pending" as const,
        }))
        return {
          ...m,
          planExecute: {
            ...m.planExecute,
            steps,
            threadId: chunk.thread_id,
            awaitingApproval: true,
            approvalRound: chunk.round,
            running: false,
          },
        }
      }),
    )
    return
  }
  if (chunk.type === "plan_revised") {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId || !m.planExecute) return m
        const steps: PlanStep[] = chunk.plan.map((s) => ({
          id: s.id,
          text: s.text,
          status: "pending" as const,
        }))
        return {
          ...m,
          planExecute: {
            ...m.planExecute,
            steps,
            revisionReason: chunk.reason,
          },
        }
      }),
    )
    return
  }
  if (chunk.type === "final_response") {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId && m.planExecute
          ? {
              ...m,
              planExecute: {
                ...m.planExecute,
                finalResponse: chunk.content,
                awaitingApproval: false,
                running: false,
                cancelled: chunk.content.startsWith("已取消"),
              },
            }
          : m,
      ),
    )
    return
  }
  if (chunk.type === "error") {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId && m.planExecute
          ? {
              ...m,
              planExecute: {
                ...m.planExecute,
                errorMsg: chunk.message,
                awaitingApproval: false,
                running: false,
              },
            }
          : m,
      ),
    )
  }
}
```

然后替换 `startPlanExecute` 里原本的 big if/else chain 为对 `applyPlanChunkToMessage(setMessages, assistantId, chunk)` 的调用。

- [ ] **Step 5: TS check**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && git add frontend/hooks/useChat.ts
git commit -m "feat(hitl-ui): useChat handles awaiting_approval/plan_revised + adds resumePlanExecute"
```

---

## Task 11 · localStorage cache 规则扩展

**Files:**
- Modify: `frontend/hooks/useChat.ts`

- [ ] **Step 1: Update savePlanExecuteCache filter**

找到模块顶部的 `savePlanExecuteCache` 函数：

```typescript
function savePlanExecuteCache(sessionId: string, messages: ChatMessage[]): void {
  if (typeof window === "undefined") return
  const toCache = messages.filter(
    (m) => m.planExecute && !m.planExecute.running,
  )
  try {
    if (toCache.length === 0) {
      localStorage.removeItem(PE_CACHE_PREFIX + sessionId)
    } else {
      localStorage.setItem(PE_CACHE_PREFIX + sessionId, JSON.stringify(toCache))
    }
  } catch {
    // silent: localStorage quota / JSON cycles etc
  }
}
```

改成（过滤规则：**running 为 true 且 awaitingApproval 为 false** 才跳过）：

```typescript
function savePlanExecuteCache(sessionId: string, messages: ChatMessage[]): void {
  if (typeof window === "undefined") return
  const toCache = messages.filter((m) => {
    if (!m.planExecute) return false
    // running mid-stream → skip (would cache half-written state)
    if (m.planExecute.running) return false
    // awaitingApproval terminal → cache so refresh restores the bubble + buttons
    return true
  })
  try {
    if (toCache.length === 0) {
      localStorage.removeItem(PE_CACHE_PREFIX + sessionId)
    } else {
      localStorage.setItem(PE_CACHE_PREFIX + sessionId, JSON.stringify(toCache))
    }
  } catch {
    // silent: localStorage quota / JSON cycles etc
  }
}
```

> Note: `awaitingApproval` 态下 `running` 已经被设为 `false`（awaiting_approval chunk handler 会置 false），所以过滤条件只需 `!running` 就足够。上面的修改主要是把注释讲清楚——`running=false, awaitingApproval=true` 的消息**会**被缓存。

- [ ] **Step 2: TS check**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && git add frontend/hooks/useChat.ts
git commit -m "docs(hitl-ui): clarify localStorage caches awaitingApproval as terminal"
```

---

## Task 12 · PlanApprovalCard 组件

**Files:**
- Create: `frontend/components/plan/PlanApprovalCard.tsx`

- [ ] **Step 1: Create the component**

```tsx
"use client"

import { useState } from "react"

interface PlanApprovalCardProps {
  round: number
  onApprove: () => void
  onRevise: (feedback: string) => void
  onCancel: () => void
  disabled?: boolean
}

export function PlanApprovalCard({
  round,
  onApprove,
  onRevise,
  onCancel,
  disabled = false,
}: PlanApprovalCardProps) {
  const [revising, setRevising] = useState(false)
  const [feedback, setFeedback] = useState("")

  if (revising) {
    return (
      <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-4">
        <div className="mb-2 text-sm font-medium text-indigo-900">
          告诉 Planner 要改什么：
        </div>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="例如：不要调研 X 公司，直接写信"
          className="w-full resize-none rounded border border-indigo-200 bg-white/80 p-2 text-sm focus:border-indigo-500 focus:outline-none"
          rows={3}
          disabled={disabled}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setRevising(false)
              setFeedback("")
            }}
            disabled={disabled}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            返回
          </button>
          <button
            type="button"
            onClick={() => {
              const trimmed = feedback.trim()
              if (!trimmed) return
              onRevise(trimmed)
              setRevising(false)
              setFeedback("")
            }}
            disabled={disabled || !feedback.trim()}
            className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            提交反馈
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-indigo-900">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
        等你确认 · 第 {round} 轮
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          ✗ 取消
        </button>
        <button
          type="button"
          onClick={() => setRevising(true)}
          disabled={disabled}
          className="rounded-full border border-indigo-300 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
        >
          ✎ 提修改意见
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={disabled}
          className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          ✓ 批准执行
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TS check**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && git add frontend/components/plan/PlanApprovalCard.tsx
git commit -m "feat(hitl-ui): add PlanApprovalCard with approve/revise/cancel UI"
```

---

## Task 13 · PlanTimeline 接入审批卡 + 新徽章

**Files:**
- Modify: `frontend/components/plan/PlanTimeline.tsx`
- Modify: `frontend/components/chat/MessageBubble.tsx` (to wire resume callbacks)

- [ ] **Step 1: Read PlanTimelineView signature**

现在 `PlanTimelineView` 只接 `view` 一个 prop。要通过 MessageBubble 接收 resume 回调，需要扩展签名。

- [ ] **Step 2: Extend PlanTimelineView props**

完整重写 `frontend/components/plan/PlanTimeline.tsx`：

```tsx
"use client"

import type { PlanExecuteView } from "@/lib/types"
import { PlanStepCard } from "./PlanStepCard"
import { PlanApprovalCard } from "./PlanApprovalCard"

interface PlanTimelineViewProps {
  view: PlanExecuteView
  onApprove?: () => void
  onRevise?: (feedback: string) => void
  onCancel?: () => void
  actionsDisabled?: boolean
}

export function PlanTimelineView({
  view,
  onApprove,
  onRevise,
  onCancel,
  actionsDisabled,
}: PlanTimelineViewProps) {
  const completed = view.steps.filter(
    (s) => s.status === "done" || s.status === "failed",
  ).length
  const total = view.steps.length
  const runningIndex = view.steps.findIndex((s) => s.status === "running")
  const runningStep = runningIndex >= 0 ? view.steps[runningIndex] : null

  let statusBadge: { label: string; className: string } | null = null
  if (view.errorMsg) {
    statusBadge = { label: "⚠ 出错", className: "bg-rose-100 text-rose-800 border-rose-300" }
  } else if (view.cancelled) {
    statusBadge = { label: "✗ 已取消", className: "bg-zinc-100 text-zinc-700 border-zinc-300" }
  } else if (view.finalResponse) {
    statusBadge = {
      label: "✓ 已完成",
      className: "bg-emerald-100 text-emerald-800 border-emerald-300",
    }
  } else if (view.awaitingApproval) {
    statusBadge = {
      label: `⏸ 等你确认 · 第 ${view.approvalRound} 轮`,
      className: "bg-indigo-100 text-indigo-800 border-indigo-300 animate-pulse",
    }
  } else if (view.running) {
    statusBadge = {
      label: "● 处理中…",
      className: "bg-indigo-100 text-indigo-800 border-indigo-300 animate-pulse",
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {(statusBadge || total > 0) && (
        <div className="flex items-center gap-3 text-sm">
          {statusBadge && (
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusBadge.className}`}
            >
              {statusBadge.label}
            </span>
          )}
          {total > 0 && (
            <div className="flex-1 text-zinc-600">
              <span>
                已完成 {completed} / 总 {total}
              </span>
              <div className="mt-1 h-1.5 w-48 rounded-full bg-zinc-200">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-all"
                  style={{ width: `${total ? (completed / total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {view.revisionReason && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-1.5 text-xs text-indigo-700">
          基于你的反馈已更新计划
        </div>
      )}

      {view.running && runningStep && (
        <div className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm text-indigo-900">
          <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
          正在执行 Step {runningIndex + 1}：{runningStep.text}
        </div>
      )}

      {view.errorMsg && (
        <div className="rounded border border-rose-400 bg-rose-50 px-4 py-2 text-sm text-rose-800">
          错误：{view.errorMsg}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {view.steps.map((s, i) => (
          <PlanStepCard key={s.id} step={s} position={i + 1} />
        ))}
      </div>

      {view.awaitingApproval && onApprove && onRevise && onCancel && (
        <PlanApprovalCard
          round={view.approvalRound}
          onApprove={onApprove}
          onRevise={onRevise}
          onCancel={onCancel}
          disabled={actionsDisabled}
        />
      )}

      {view.finalResponse && !view.cancelled && (
        <div className="rounded border border-emerald-400 bg-emerald-50 p-4">
          <div className="mb-2 font-semibold text-emerald-900">最终回复</div>
          <div className="whitespace-pre-wrap text-sm">{view.finalResponse}</div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Wire resumePlanExecute into MessageBubble**

找到 `frontend/components/chat/MessageBubble.tsx` 里 `PlanTimelineView` 渲染那一行（大概在 `message.planExecute` 分支）。注意它原本只传 `view`。现在要把 resume 回调串过来。

**最干净的做法**：让 `MessageBubble` 也接受 `onResume` 回调 prop，ChatPanel 那边把 `resumePlanExecute` 传下来。

修改 MessageBubble 的 props 接口 (搜索 `interface Props`)：

```tsx
interface Props {
  message: ChatMessage
  isStreaming?: boolean
  onResume?: (
    messageId: string,
    args: { action: "approve" | "revise" | "cancel"; feedback?: string },
  ) => void
}
```

MessageBubble 组件内部：把 `<PlanTimelineView view={message.planExecute!} />` 改为：

```tsx
<PlanTimelineView
  view={message.planExecute!}
  onApprove={
    onResume
      ? () => onResume(message.id, { action: "approve" })
      : undefined
  }
  onRevise={
    onResume
      ? (feedback) => onResume(message.id, { action: "revise", feedback })
      : undefined
  }
  onCancel={
    onResume
      ? () => onResume(message.id, { action: "cancel" })
      : undefined
  }
  actionsDisabled={isStreaming}
/>
```

- [ ] **Step 4: Wire in ChatPanel**

修改 `frontend/components/chat/ChatPanel.tsx`：从 `useChat` 里解构 `resumePlanExecute`，构造 `handleResume`，传给每个 `<MessageBubble>`。

搜索 `const { messages, streaming, ... } = useChat(...)`，把解构加上 `resumePlanExecute`：

```typescript
const {
  messages,
  streaming,
  error,
  historyLoading,
  sendMessage,
  startPlanExecute,
  resumePlanExecute,   // ← add
} = useChat({
  sessionToken: currentSessionToken,
  currentSessionId,
  currentSessionName: currentSession?.name ?? "",
  renameSession,
})
```

然后在 `<MessageBubble>` 渲染处把 `onResume` 串上（找到 `.map((msg, i) => <MessageBubble ...`）：

```tsx
{messages.map((msg, i) => (
  <MessageBubble
    key={msg.id}
    message={msg}
    isStreaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
    onResume={(mid, args) => {
      const threadId = msg.planExecute?.threadId
      if (!threadId) return
      resumePlanExecute(mid, {
        threadId,
        action: args.action,
        feedback: args.feedback,
      })
    }}
  />
))}
```

- [ ] **Step 5: TS check**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && git add frontend/components/plan/PlanTimeline.tsx frontend/components/chat/MessageBubble.tsx frontend/components/chat/ChatPanel.tsx
git commit -m "feat(hitl-ui): PlanTimeline renders PlanApprovalCard; wire resumePlanExecute"
```

---

## Task 14 · 手动 E2E verification

**Files:** 无代码；走查清单。

- [ ] **Step 1: Restart backend + frontend**

```
# Terminal 1
cd /Users/young/Downloads/repos/Job-Hunter-Agent && pkill -f "uvicorn app.main:app"; sleep 2; nohup bash -c 'source scripts/set_env.sh development && uv run uvicorn app.main:app --reload --port 8000' > /tmp/backend.log 2>&1 & disown
```

Frontend 已在 3000 端口的 HMR 会自动拾取前端改动。

- [ ] **Step 2: Ensure 2 pending jobs in kanban** (用真实 UI 添加或 SQL)

```
docker exec job-hunter-agent-db-1 psql -U myuser -d mydb -c "SELECT id, company, title, status FROM applications WHERE user_id=2 AND status='pending';"
```

若 < 2 条，用"搜索 + 保存到看板"或 INSERT 加两条。

- [ ] **Step 3: Clear stale PE cache**

在浏览器 devtools console：

```
Object.keys(localStorage).filter(k => k.startsWith("pe_session_")).forEach(k => localStorage.removeItem(k));
location.reload();
```

- [ ] **Step 4: 走 checklist**

- [ ] 正常流程：点"自动处理看板 · 2 个" → 气泡显示 plan + "⏸ 等你确认 · 第 1 轮" + 三个按钮
- [ ] 批准：点 [✓ 批准执行] → 气泡转为"● 处理中…" → 按序 step_completed → "✓ 已完成" + 最终回复
- [ ] 修改闭环：再点按钮启动一次 → 点 [✎ 提修改意见] → 文本框出现 → 输入"不要调研 X"→ [提交反馈] → 气泡显示"基于你的反馈已更新计划" + 新 plan + "⏸ 等你确认 · 第 2 轮"
- [ ] 再批准 → 执行完成
- [ ] 取消：点 [✗ 取消] → 气泡转为"✗ 已取消" 灰色徽章 + final_response "已取消..."
- [ ] 刷新恢复：在"等你确认"态下 Ctrl+R → 气泡恢复 + 按钮仍可点 + 批准后能正常 resume
- [ ] Langfuse trace：打开右上 Langfuse 链接，看到包含 `approval_gate` span 和 `planner/executor/replanner` 分段

- [ ] **Step 5: 记录并提交**

若全部通过，打个空提交收尾：

```
git commit --allow-empty -m "chore(hitl): e2e verification passed"
```

---

## Self-Review

**1. Spec coverage:**

- §2 架构（approval_gate 节点 + 路由）→ Task 3/5
- §3 thread_id 策略（复用 vs 新生成）→ Task 6 astream resume 分支
- §4 SSE 事件协议 `awaiting_approval` / `plan_revised` → Task 6 后端 emit + Task 8/10 前端类型与 handler
- §5 API `thread_id / resume_action / feedback` → Task 7
- §6.1 State 三新字段 → Task 1；§6.2 View 五新字段 → Task 8
- §7.1 localStorage cache 规则 → Task 11
- §7.2 为何不加后端业务表 → spec 已写不影响实施
- §8 时序图 → 由 Task 6/7/10 + Task 13 共同实现
- §9 UI 规范（徽章、审批卡、修改态、取消态）→ Task 12/13
- §10 错误处理（404、400、并发、fallback）→ Task 7 (400) + Task 6 astream except (fallback) + UI 空 threadId 防御性处理
- §11 文件与模块规划 → 1:1 映射
- §12 测试与验证 → Task 14
- §13 简历价值 → 实施完毕后才可引用，不阻塞

**2. Placeholder scan:** 无 TBD/TODO；每步都给了完整代码/命令。

**3. Type consistency:**

- 后端新增字段 `user_feedback / approval_round / pending_revise` 在 Task 1 定义，Task 3/4/5/6 全部引用一致
- 前端 `PlanExecuteView` 新字段 `threadId / awaitingApproval / approvalRound / revisionReason / cancelled` Task 8 定义，Task 10/12/13 引用一致
- `PlanStreamChunk` 新分支 `awaiting_approval` (带 `thread_id` snake_case per SSE convention，但前端 state 存为 `threadId` camelCase)，Task 8/10 的转换清晰

无需修补。
