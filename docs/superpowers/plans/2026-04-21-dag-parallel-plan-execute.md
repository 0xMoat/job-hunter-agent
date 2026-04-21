# DAG Parallel Plan-Execute Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the Plan-Execute subsystem from flat-list serial execution to DAG-based parallel execution using LangGraph's `Send()` primitive.

**Architecture:** Planner LLM outputs steps with explicit `depends_on` edges. A DAG validator checks/fixes the graph. A scheduler dispatches ready steps in parallel via `Send()`, a collector gathers results and propagates failures, and replanner runs once after the full DAG completes.

**Tech Stack:** LangGraph (StateGraph, Send, Command), Pydantic v2, DeepSeek structured output, React/TypeScript (frontend), pytest

**Spec:** `docs/superpowers/specs/2026-04-21-dag-parallel-plan-execute-design.md`

---

## File Map

### Backend — New Files
| File | Responsibility |
|------|---------------|
| `app/core/langgraph/dag.py` | DAG validation, auto-fix, topological sort, serial degradation |

### Backend — Modified Files
| File | What Changes |
|------|-------------|
| `app/schemas/plan_execute.py` | Add `PlanStep`, `StepStatus`; change `Plan.steps` type; replace `past_steps` with `step_results`/`step_status` in `PlanExecuteState` |
| `app/schemas/__init__.py` | Export new symbols |
| `app/core/langgraph/plan_execute.py` | Replace graph topology; add `dag_validator`, `scheduler`, `collector` nodes; rewrite `_planner`, `_execute_step`, `_replan`, `_should_end`, `create_graph`, `astream` |
| `app/core/prompts/plan_execute_planner.md` | DAG-aware step format + JSON example |
| `app/core/prompts/plan_execute_replanner.md` | DAG-aware remaining plan display + rules for remedy DAG |
| `frontend/lib/types.ts` | Add `dependsOn` to `PlanStep`/`PlanStepDescriptor`; add `"skipped"` to `PlanStepStatus`; add `wave_started`/`step_skipped` to `PlanStreamChunk` |
| `frontend/hooks/useChat.ts` | Handle `wave_started` and `step_skipped` SSE events |
| `frontend/components/plan/PlanTimeline.tsx` | Wave-grouped layout with SVG dependency edges |
| `frontend/components/plan/PlanApprovalCard.tsx` | Show DAG structure in approval view |

### Tests — New/Modified Files
| File | What Changes |
|------|-------------|
| `tests/unit/test_dag.py` | New — unit tests for `dag.py` |
| `tests/unit/test_plan_execute_nodes.py` | Update `_make_state` helper + routing tests for new topology |
| `tests/integration/test_plan_execute_graph.py` | Rewrite for DAG topology: parallel happy path, cascade skip, validation fallback |

---

## Task 1: Schema Changes

**Files:**
- Modify: `app/schemas/plan_execute.py` (lines 1–58)
- Modify: `app/schemas/__init__.py` (lines 14–34)
- Test: `tests/unit/test_dag.py` (new file, schema validation only)

- [ ] **Step 1: Write tests for new schema**

Create `tests/unit/test_dag.py` with schema-level tests:

```python
"""Tests for DAG schemas and validation utilities."""

import pytest
from app.schemas.plan_execute import PlanStep, StepStatus, Plan, PlanExecuteState


class TestPlanStepSchema:
    def test_plan_step_minimal(self):
        step = PlanStep(id="A1", text="do something")
        assert step.id == "A1"
        assert step.text == "do something"
        assert step.depends_on == []

    def test_plan_step_with_deps(self):
        step = PlanStep(id="A2", text="score", depends_on=["A1"])
        assert step.depends_on == ["A1"]

    def test_plan_with_plan_steps(self):
        plan = Plan(steps=[
            PlanStep(id="A1", text="research", depends_on=[]),
            PlanStep(id="A2", text="score", depends_on=["A1"]),
        ])
        assert len(plan.steps) == 2
        assert plan.steps[0].id == "A1"

    def test_step_status_values(self):
        assert StepStatus.PENDING == "pending"
        assert StepStatus.RUNNING == "running"
        assert StepStatus.DONE == "done"
        assert StepStatus.FAILED == "failed"
        assert StepStatus.SKIPPED == "skipped"

    def test_plan_execute_state_defaults(self):
        state = PlanExecuteState(input="test goal")
        assert state.plan == []
        assert state.step_results == {}
        assert state.step_status == {}
        assert state.response is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/unit/test_dag.py -v`
Expected: ImportError — `PlanStep`, `StepStatus` not found

- [ ] **Step 3: Implement schema changes**

Replace the full contents of `app/schemas/plan_execute.py`:

```python
"""Schemas for the Plan-and-Execute subgraph."""

from enum import Enum
from typing import Annotated

from pydantic import BaseModel, Field


def _merge_dicts(left: dict, right: dict) -> dict:
    """LangGraph state reducer: merge two dicts (right wins on key collision)."""
    merged = left.copy()
    merged.update(right)
    return merged


class StepStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"
    SKIPPED = "skipped"


class PlanStep(BaseModel):
    """A single step in a DAG plan with explicit dependencies."""

    id: str = Field(..., description="唯一步骤 id，如 'A1', 'B2'")
    text: str = Field(..., description="自然语言指令")
    depends_on: list[str] = Field(default_factory=list, description="前置步骤 id 列表")


class Plan(BaseModel):
    """A DAG of steps to execute."""

    steps: list[PlanStep] = Field(
        ...,
        description="DAG 步骤列表，每步声明自身 id 和依赖。",
    )


class Response(BaseModel):
    """The final answer to return to the user, ending the loop."""

    content: str = Field(..., description="给用户的最终答复（Markdown 可选）")


class Act(BaseModel):
    """Replanner output: either continue with a new plan or finish with a response."""

    action: Response | Plan = Field(
        ...,
        description="返回 Response 以结束；返回 Plan 以替换剩余待执行步骤。",
    )


class PlanExecuteState(BaseModel):
    """Runtime state for the Plan-and-Execute subgraph."""

    input: str = Field(..., description="用户目标")
    plan: list[PlanStep] = Field(default_factory=list, description="完整 DAG 定义（执行期间不弹出）")
    step_results: Annotated[dict[str, str], _merge_dicts] = Field(
        default_factory=dict, description="step_id → result text"
    )
    step_status: Annotated[dict[str, str], _merge_dicts] = Field(
        default_factory=dict, description="step_id → StepStatus value"
    )
    response: str | None = Field(default=None, description="最终答复，由 Replanner 设置")
    long_term_memory: str = Field(default="", description="mem0 检索的用户画像")
    pending_applications: str = Field(default="", description="进入子图前快照")
    target_application_ids: list[int] = Field(
        default_factory=list,
        description="PE 启动时快照的目标卡片 id 列表",
    )
    iterations: int = Field(default=0, description="scheduler→collector 循环次数（硬护栏）")
    # ── HITL ──
    user_feedback: str | None = Field(
        default=None,
        description="revise 动作时用户输入的修改意见",
    )
    approval_round: int = Field(default=0, description="审批轮次")
    pending_revise: bool = Field(
        default=False,
        description="路由 hint：True 时 Replanner 产出的新 plan 送回 approval_gate",
    )
```

- [ ] **Step 4: Update exports in `app/schemas/__init__.py`**

Add `PlanStep` and `StepStatus` to the import block (around line 14–19) and `__all__` list (around line 31–34):

In the import block, change:
```python
from app.schemas.plan_execute import (
    Act,
    Plan,
    PlanExecuteState,
    Response as PlanResponse,
)
```
to:
```python
from app.schemas.plan_execute import (
    Act,
    Plan,
    PlanExecuteState,
    PlanStep,
    Response as PlanResponse,
    StepStatus,
)
```

Add `"PlanStep"` and `"StepStatus"` to the `__all__` list.

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/unit/test_dag.py -v`
Expected: All 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add app/schemas/plan_execute.py app/schemas/__init__.py tests/unit/test_dag.py
git commit -m "feat(pe): add PlanStep/StepStatus schemas for DAG execution"
```

---

## Task 2: DAG Validation & Utilities

**Files:**
- Create: `app/core/langgraph/dag.py`
- Test: `tests/unit/test_dag.py` (append)

- [ ] **Step 1: Write failing tests for DAG utilities**

Append to `tests/unit/test_dag.py`:

```python
from app.core.langgraph.dag import (
    DAGError,
    validate_dag,
    auto_fix_dag,
    topological_sort,
    degrade_to_serial,
)


class TestValidateDAG:
    def test_valid_dag_no_errors(self):
        steps = [
            PlanStep(id="A1", text="research", depends_on=[]),
            PlanStep(id="A2", text="score", depends_on=["A1"]),
        ]
        assert validate_dag(steps) == []

    def test_empty_dag(self):
        errors = validate_dag([])
        assert len(errors) == 1
        assert errors[0].error_type == "empty"

    def test_duplicate_id(self):
        steps = [
            PlanStep(id="A1", text="step 1"),
            PlanStep(id="A1", text="step 2"),
        ]
        errors = validate_dag(steps)
        assert any(e.error_type == "duplicate_id" for e in errors)

    def test_invalid_ref(self):
        steps = [
            PlanStep(id="A1", text="step 1", depends_on=["NONEXIST"]),
        ]
        errors = validate_dag(steps)
        assert any(e.error_type == "invalid_ref" for e in errors)

    def test_self_ref(self):
        steps = [
            PlanStep(id="A1", text="step 1", depends_on=["A1"]),
        ]
        errors = validate_dag(steps)
        assert any(e.error_type == "self_ref" for e in errors)

    def test_cycle(self):
        steps = [
            PlanStep(id="A1", text="step 1", depends_on=["A2"]),
            PlanStep(id="A2", text="step 2", depends_on=["A1"]),
        ]
        errors = validate_dag(steps)
        assert any(e.error_type == "cycle" for e in errors)


class TestAutoFixDAG:
    def test_fix_invalid_ref(self):
        steps = [PlanStep(id="A1", text="step 1", depends_on=["GONE"])]
        errors = validate_dag(steps)
        fixed = auto_fix_dag(steps, errors)
        assert fixed[0].depends_on == []
        assert validate_dag(fixed) == []

    def test_fix_self_ref(self):
        steps = [PlanStep(id="A1", text="step 1", depends_on=["A1"])]
        errors = validate_dag(steps)
        fixed = auto_fix_dag(steps, errors)
        assert "A1" not in fixed[0].depends_on
        assert validate_dag(fixed) == []

    def test_fix_duplicate_id(self):
        steps = [
            PlanStep(id="A1", text="step 1"),
            PlanStep(id="A1", text="step 2"),
        ]
        errors = validate_dag(steps)
        fixed = auto_fix_dag(steps, errors)
        ids = [s.id for s in fixed]
        assert len(ids) == len(set(ids))
        assert validate_dag(fixed) == []

    def test_fix_cycle_breaks_back_edge(self):
        steps = [
            PlanStep(id="A1", text="step 1", depends_on=["A2"]),
            PlanStep(id="A2", text="step 2", depends_on=["A1"]),
        ]
        errors = validate_dag(steps)
        fixed = auto_fix_dag(steps, errors)
        assert validate_dag(fixed) == []


class TestTopologicalSort:
    def test_linear_chain(self):
        steps = [
            PlanStep(id="A1", text="s1"),
            PlanStep(id="A2", text="s2", depends_on=["A1"]),
            PlanStep(id="A3", text="s3", depends_on=["A2"]),
        ]
        waves = topological_sort(steps)
        assert waves == [["A1"], ["A2"], ["A3"]]

    def test_parallel_fan_out(self):
        steps = [
            PlanStep(id="A1", text="root"),
            PlanStep(id="A2", text="branch1", depends_on=["A1"]),
            PlanStep(id="A3", text="branch2", depends_on=["A1"]),
            PlanStep(id="A4", text="branch3", depends_on=["A1"]),
        ]
        waves = topological_sort(steps)
        assert waves[0] == ["A1"]
        assert set(waves[1]) == {"A2", "A3", "A4"}

    def test_diamond(self):
        steps = [
            PlanStep(id="A1", text="root"),
            PlanStep(id="A2", text="left", depends_on=["A1"]),
            PlanStep(id="A3", text="right", depends_on=["A1"]),
            PlanStep(id="A4", text="join", depends_on=["A2", "A3"]),
        ]
        waves = topological_sort(steps)
        assert waves[0] == ["A1"]
        assert set(waves[1]) == {"A2", "A3"}
        assert waves[2] == ["A4"]

    def test_two_independent_chains(self):
        steps = [
            PlanStep(id="A1", text="a1"),
            PlanStep(id="A2", text="a2", depends_on=["A1"]),
            PlanStep(id="B1", text="b1"),
            PlanStep(id="B2", text="b2", depends_on=["B1"]),
        ]
        waves = topological_sort(steps)
        assert set(waves[0]) == {"A1", "B1"}
        assert set(waves[1]) == {"A2", "B2"}


class TestDegradeToSerial:
    def test_chains_into_linear(self):
        steps = [
            PlanStep(id="A1", text="s1"),
            PlanStep(id="A2", text="s2", depends_on=["A1"]),
            PlanStep(id="B1", text="s3"),
        ]
        serial = degrade_to_serial(steps)
        assert serial[0].depends_on == []
        assert serial[1].depends_on == ["A1"]
        assert serial[2].depends_on == ["A2"]
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/unit/test_dag.py::TestValidateDAG -v`
Expected: ImportError — `dag` module not found

- [ ] **Step 3: Implement `app/core/langgraph/dag.py`**

```python
"""DAG validation, auto-fix, topological sort, and serial degradation.

Used by the Plan-Execute subgraph to validate planner output before execution.
"""

from collections import defaultdict, deque
from copy import deepcopy
from dataclasses import dataclass, field

from app.schemas.plan_execute import PlanStep


@dataclass
class DAGError:
    error_type: str  # "duplicate_id" | "invalid_ref" | "self_ref" | "cycle" | "empty"
    step_id: str | None
    detail: str


def validate_dag(steps: list[PlanStep]) -> list[DAGError]:
    """Validate a list of PlanStep for DAG correctness.

    Returns an empty list if valid, otherwise a list of DAGError.
    """
    errors: list[DAGError] = []

    if not steps:
        errors.append(DAGError(error_type="empty", step_id=None, detail="DAG has no steps"))
        return errors

    all_ids = [s.id for s in steps]
    id_set = set()

    # Check duplicate ids
    for step_id in all_ids:
        if step_id in id_set:
            errors.append(DAGError(
                error_type="duplicate_id", step_id=step_id,
                detail=f"Duplicate step id: {step_id}",
            ))
        id_set.add(step_id)

    # Check invalid refs and self refs
    for step in steps:
        for dep in step.depends_on:
            if dep == step.id:
                errors.append(DAGError(
                    error_type="self_ref", step_id=step.id,
                    detail=f"Step {step.id} depends on itself",
                ))
            elif dep not in id_set:
                errors.append(DAGError(
                    error_type="invalid_ref", step_id=step.id,
                    detail=f"Step {step.id} depends on non-existent {dep}",
                ))

    # Check for cycles using Kahn's algorithm (only if no duplicate ids)
    if not any(e.error_type == "duplicate_id" for e in errors):
        in_degree: dict[str, int] = {s.id: 0 for s in steps}
        adj: dict[str, list[str]] = {s.id: [] for s in steps}
        for step in steps:
            for dep in step.depends_on:
                if dep in adj:  # skip invalid refs
                    adj[dep].append(step.id)
                    in_degree[step.id] += 1

        queue = deque(sid for sid, deg in in_degree.items() if deg == 0)
        visited = 0
        while queue:
            node = queue.popleft()
            visited += 1
            for neighbor in adj[node]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if visited < len(steps):
            cycle_members = [sid for sid, deg in in_degree.items() if deg > 0]
            errors.append(DAGError(
                error_type="cycle", step_id=cycle_members[0] if cycle_members else None,
                detail=f"Cycle detected involving: {', '.join(cycle_members)}",
            ))

    return errors


def auto_fix_dag(steps: list[PlanStep], errors: list[DAGError]) -> list[PlanStep]:
    """Attempt to fix DAG errors automatically.

    Returns a new list of PlanStep with fixes applied.
    """
    fixed = deepcopy(steps)
    all_ids = {s.id for s in fixed}

    # Fix duplicate ids: rename later occurrences
    seen: set[str] = set()
    for step in fixed:
        original = step.id
        suffix = 2
        while step.id in seen:
            step.id = f"{original}_{suffix}"
            suffix += 1
        seen.add(step.id)
    # Rebuild id set after renames
    all_ids = {s.id for s in fixed}

    # Fix invalid refs and self refs
    for step in fixed:
        step.depends_on = [
            dep for dep in step.depends_on
            if dep != step.id and dep in all_ids
        ]

    # Fix cycles: remove back edges iteratively until Kahn's succeeds
    for _ in range(len(fixed)):  # at most N iterations
        in_degree: dict[str, int] = {s.id: 0 for s in fixed}
        adj: dict[str, list[str]] = {s.id: [] for s in fixed}
        for step in fixed:
            for dep in step.depends_on:
                if dep in adj:
                    adj[dep].append(step.id)
                    in_degree[step.id] += 1

        queue = deque(sid for sid, deg in in_degree.items() if deg == 0)
        visited: set[str] = set()
        while queue:
            node = queue.popleft()
            visited.add(node)
            for neighbor in adj[node]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    queue.append(neighbor)

        if len(visited) == len(fixed):
            break  # no cycle

        # Find a back edge and remove it
        cycle_nodes = [s for s in fixed if s.id not in visited]
        if cycle_nodes:
            # Remove last dependency from the first cycle node
            cycle_nodes[0].depends_on = cycle_nodes[0].depends_on[:-1]

    return fixed


def topological_sort(steps: list[PlanStep]) -> list[list[str]]:
    """Sort steps into parallel execution waves (layers).

    Returns a list of waves, each wave is a list of step ids that can
    run in parallel. Assumes the DAG has been validated (no cycles).
    """
    if not steps:
        return []

    step_map = {s.id: s for s in steps}
    in_degree: dict[str, int] = {s.id: 0 for s in steps}
    adj: dict[str, list[str]] = defaultdict(list)

    for step in steps:
        for dep in step.depends_on:
            if dep in step_map:
                adj[dep].append(step.id)
                in_degree[step.id] += 1

    waves: list[list[str]] = []
    current_wave = [sid for sid, deg in in_degree.items() if deg == 0]

    while current_wave:
        # Sort for deterministic output in tests
        current_wave.sort()
        waves.append(current_wave)
        next_wave = []
        for node in current_wave:
            for neighbor in adj[node]:
                in_degree[neighbor] -= 1
                if in_degree[neighbor] == 0:
                    next_wave.append(neighbor)
        current_wave = next_wave

    return waves


def degrade_to_serial(steps: list[PlanStep]) -> list[PlanStep]:
    """Convert any DAG into a strict serial chain.

    Each step depends on the previous one. Original depends_on is discarded.
    Used as the final fallback when DAG validation and LLM retry both fail.
    """
    result = deepcopy(steps)
    for i, step in enumerate(result):
        step.depends_on = [result[i - 1].id] if i > 0 else []
    return result
```

- [ ] **Step 4: Run all dag tests**

Run: `uv run pytest tests/unit/test_dag.py -v`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add app/core/langgraph/dag.py tests/unit/test_dag.py
git commit -m "feat(pe): DAG validation, auto-fix, topological sort, serial degradation"
```

---

## Task 3: Planner & Replanner Prompt Changes

**Files:**
- Modify: `app/core/prompts/plan_execute_planner.md` (lines 37–68)
- Modify: `app/core/prompts/plan_execute_replanner.md` (lines 1–68)

- [ ] **Step 1: Rewrite planner prompt step format section**

In `app/core/prompts/plan_execute_planner.md`, replace lines 37–68 (from `# Step format` through `## Current date`) with:

```markdown
# Step format — DAG with dependencies

Each step is a JSON object with `id`, `text`, and `depends_on`. The executor runs
steps in parallel when their dependencies allow.

1. **id**: unique identifier per step. Use card letter + sequence number (A1, A2, B1, ...).
   The final summary step uses "Z".
2. **text**: one atomic action as a short natural-language instruction embedding the
   concrete `application_id` when the tool requires it.
3. **depends_on**: list of step ids that must complete before this step can start.
   Empty list `[]` means the step has no prerequisites and can start immediately.

## Dependency rules

- `company_research` + `save_company_research` → no dependencies (entry point per card)
- `score_jd_match` / `analyze_jd_gap` / `generate_interview_questions` → depends on
  that card's research step only
- 定制简历+PDF (ONE step — `trigger_resume_studio_skill` → `save_tailored_resume` →
  `generate_resume_pdf`) → depends on that card's score + gap + interview steps
- Cross-card steps have NO dependencies on each other (unless the user explicitly
  requires ordering)
- Final summary step depends on every card's last step

## HARD RULE — 简历定制流水线绝不可拆分

Step (e) 的三个 tool（`trigger_resume_studio_skill` / `save_tailored_resume` /
`generate_resume_pdf`）**必须**写在同一个 step 里。

## Example output (2 cards)

```json
{
  "steps": [
    {"id": "A1", "text": "company_research(card=10) 并 save_company_research(application_id=10, content=...)", "depends_on": []},
    {"id": "B1", "text": "company_research(card=11) 并 save_company_research(application_id=11, content=...)", "depends_on": []},
    {"id": "A2", "text": "score_jd_match(application_id=10)", "depends_on": ["A1"]},
    {"id": "A3", "text": "analyze_jd_gap(application_id=10)", "depends_on": ["A1"]},
    {"id": "A4", "text": "generate_interview_questions(application_id=10)", "depends_on": ["A1"]},
    {"id": "B2", "text": "score_jd_match(application_id=11)", "depends_on": ["B1"]},
    {"id": "B3", "text": "analyze_jd_gap(application_id=11)", "depends_on": ["B1"]},
    {"id": "B4", "text": "generate_interview_questions(application_id=11)", "depends_on": ["B1"]},
    {"id": "A5", "text": "为 application_id=10 定制简历+PDF", "depends_on": ["A2", "A3", "A4"]},
    {"id": "B5", "text": "为 application_id=11 定制简历+PDF", "depends_on": ["B2", "B3", "B4"]},
    {"id": "Z", "text": "汇总本次处理结果并提交最终回复", "depends_on": ["A5", "B5"]}
  ]
}
```

For single-card runs, use steps (a)-(e) as needed by the user's goal; skip the
stages the user didn't ask for. Still use id + depends_on format.

# Output

Output ONLY the structured Plan (no prose, no markdown).

# Context

## User goal
{input}

## What you know about the user (for personalizing resume tailoring)
{long_term_memory}

## Pending applications (the EXACT jobs to process — do not substitute)
{pending_applications}

**Target application ids (用于 tool 调用)：**
{target_application_ids}

规划涉及具体看板卡片的 tool 时，步骤文字里要明确指定 `application_id`，从上面的列表中选。

## Current date
{current_date_and_time}
```

- [ ] **Step 2: Update replanner prompt for DAG format**

In `app/core/prompts/plan_execute_replanner.md`, make these changes:

1. In the "Context" section (around line 43), change `## Original plan` and `## Remaining steps` descriptions to note they now use DAG format with `id` and `depends_on`.

2. Replace `## 可用 tools（重新规划时参考）` section (around line 56) with:

```markdown
## 可用 tools（重新规划时参考）

若生成新的 Plan，可用 tools 与 `plan_execute_planner.md` 一致。
**重要**：新 Plan 的每个 step 必须包含 `id`、`text`、`depends_on` 三个字段。
`depends_on` 只能引用已完成步骤的 id（见 "Steps already executed"）或本次新 Plan 内部步骤的 id。
不要引用已失败或已跳过步骤的 id 作为依赖。
```

- [ ] **Step 3: Commit**

```bash
git add app/core/prompts/plan_execute_planner.md app/core/prompts/plan_execute_replanner.md
git commit -m "feat(pe): DAG-aware planner and replanner prompts"
```

---

## Task 4: Graph Topology Rewrite — Nodes & Wiring

This is the core backend task. Rewrite `app/core/langgraph/plan_execute.py` to use the new DAG-based topology.

**Files:**
- Modify: `app/core/langgraph/plan_execute.py` (major rewrite of nodes + graph wiring)

- [ ] **Step 1: Write integration test for DAG happy path**

Replace contents of `tests/integration/test_plan_execute_graph.py` with a test that verifies the new topology. This test uses `MemorySaver` and fake LLMs:

```python
"""Integration tests for the DAG Plan-Execute graph."""

import json
import pytest
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.types import Command, Send, interrupt

from app.schemas.plan_execute import (
    Act,
    Plan,
    PlanExecuteState,
    PlanStep,
    Response,
    StepStatus,
)


def _make_dag_plan() -> Plan:
    """Two-card DAG plan for testing."""
    return Plan(steps=[
        PlanStep(id="A1", text="research card 10", depends_on=[]),
        PlanStep(id="B1", text="research card 11", depends_on=[]),
        PlanStep(id="A2", text="score card 10", depends_on=["A1"]),
        PlanStep(id="B2", text="score card 11", depends_on=["B1"]),
        PlanStep(id="Z", text="summarize", depends_on=["A2", "B2"]),
    ])


class TestDAGGraphTopology:
    """Test that the DAG graph nodes and routing work correctly."""

    def test_topological_sort_gives_correct_waves(self):
        from app.core.langgraph.dag import topological_sort
        plan = _make_dag_plan()
        waves = topological_sort(plan.steps)
        assert set(waves[0]) == {"A1", "B1"}
        assert set(waves[1]) == {"A2", "B2"}
        assert waves[2] == ["Z"]

    def test_cascade_skip_on_failure(self):
        """When A1 fails, A2 and Z (which depends on A2) should be skipped."""
        from app.core.langgraph.dag import topological_sort
        plan = _make_dag_plan()
        # Simulate: A1 failed, B1 done
        step_status = {
            "A1": StepStatus.FAILED,
            "B1": StepStatus.DONE,
            "A2": StepStatus.PENDING,
            "B2": StepStatus.PENDING,
            "Z": StepStatus.PENDING,
        }

        # A2 depends on A1 (failed) → should be skipped
        a2 = next(s for s in plan.steps if s.id == "A2")
        a2_deps_failed = any(step_status.get(d) == StepStatus.FAILED for d in a2.depends_on)
        assert a2_deps_failed is True

        # B2 depends on B1 (done) → should be ready
        b2 = next(s for s in plan.steps if s.id == "B2")
        b2_deps_met = all(
            step_status.get(d) in (StepStatus.DONE, StepStatus.SKIPPED)
            for d in b2.depends_on
        )
        assert b2_deps_met is True
```

- [ ] **Step 2: Run tests to verify they pass (these test utility logic, not graph runtime)**

Run: `uv run pytest tests/integration/test_plan_execute_graph.py -v`
Expected: PASS (these test the DAG utilities and logic, not the full compiled graph yet)

- [ ] **Step 3: Rewrite `_planner` node to use PlanStep structured output**

In `app/core/langgraph/plan_execute.py`, replace the `_planner` method (lines 226–249):

```python
async def _planner(self, state: PlanExecuteState, config: RunnableConfig) -> dict:
    """Generate the initial DAG plan using structured output."""
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
    # Initialize step_status for all steps
    initial_status = {step.id: StepStatus.PENDING.value for step in result.steps}
    logger.info(
        "pe_plan_generated",
        step_count=len(result.steps),
        session_id=config.get("configurable", {}).get("thread_id"),
    )
    return {"plan": result.steps, "step_status": initial_status}
```

- [ ] **Step 4: Add `_dag_validator` node**

Add this new method to `PlanExecuteAgent` class, after `_planner`:

```python
async def _dag_validator(self, state: PlanExecuteState, config: RunnableConfig) -> dict:
    """Validate and fix the DAG from planner output.

    Three-layer defense:
    1. auto_fix_dag — code-level repair
    2. LLM retry — send errors back to planner (max 2 attempts)
    3. degrade_to_serial — fallback to serial chain
    """
    from app.core.langgraph.dag import (
        auto_fix_dag,
        degrade_to_serial,
        validate_dag,
    )

    steps = list(state.plan)
    errors = validate_dag(steps)

    if not errors:
        return {}  # DAG is valid, no changes

    # Layer 1: auto fix
    logger.warning("pe_dag_validation_errors", error_count=len(errors),
                   errors=[e.detail for e in errors])
    steps = auto_fix_dag(steps, errors)
    errors = validate_dag(steps)

    if not errors:
        logger.info("pe_dag_auto_fixed")
        initial_status = {s.id: StepStatus.PENDING.value for s in steps}
        return {"plan": steps, "step_status": initial_status}

    # Layer 2: LLM retry (max 2 attempts)
    for attempt in range(2):
        error_msg = "\n".join(f"- {e.detail}" for e in errors)
        logger.warning("pe_dag_llm_retry", attempt=attempt + 1, errors=error_msg)
        system_prompt = load_plan_execute_planner_prompt(
            input=state.input + f"\n\n## DAG 校验失败，请修正以下问题：\n{error_msg}",
            long_term_memory=state.long_term_memory or "（无）",
            pending_applications=state.pending_applications or "（无）",
            target_application_ids=", ".join(str(i) for i in state.target_application_ids) or "（无）",
        )
        planner_llm = self._structured_llm(Plan)
        try:
            result: Plan = await planner_llm.ainvoke(
                [SystemMessage(content=system_prompt)],
                config=config,
            )
            steps = result.steps
            errors = validate_dag(steps)
            if not errors:
                logger.info("pe_dag_llm_retry_fixed", attempt=attempt + 1)
                initial_status = {s.id: StepStatus.PENDING.value for s in steps}
                return {"plan": steps, "step_status": initial_status}
        except Exception:
            logger.exception("pe_dag_llm_retry_failed", attempt=attempt + 1)

    # Layer 3: degrade to serial
    logger.warning("pe_dag_degraded_to_serial")
    steps = degrade_to_serial(state.plan)
    initial_status = {s.id: StepStatus.PENDING.value for s in steps}
    return {"plan": steps, "step_status": initial_status}
```

- [ ] **Step 5: Add `_scheduler` node**

Add this method to `PlanExecuteAgent`:

```python
def _scheduler(self, state: PlanExecuteState) -> list[Send]:
    """Find all DAG steps whose dependencies are satisfied and dispatch them in parallel."""
    from app.core.langgraph.dag import topological_sort  # noqa: F811

    ready: list[Send] = []
    for step in state.plan:
        status = state.step_status.get(step.id, StepStatus.PENDING.value)
        if status != StepStatus.PENDING.value:
            continue

        deps_failed = any(
            state.step_status.get(d) in (StepStatus.FAILED.value, StepStatus.SKIPPED.value)
            for d in step.depends_on
        )
        if deps_failed:
            continue  # collector will cascade-skip

        deps_met = all(
            state.step_status.get(d) == StepStatus.DONE.value
            for d in step.depends_on
        ) if step.depends_on else True

        if deps_met:
            ready.append(Send("executor", {
                "step": step,
                "long_term_memory": state.long_term_memory,
                "pending_applications": state.pending_applications,
            }))

    if not ready:
        # No steps ready — cascade skip remaining pending steps and go to collector
        ready.append(Send("collector", {}))

    logger.info("pe_scheduler_dispatched", ready_count=len(ready),
                ready_ids=[getattr(r, 'arg', {}).get('step', {}) for r in ready if hasattr(r, 'arg')])
    return ready
```

- [ ] **Step 6: Rewrite `_execute_step` to accept a single step from Send()**

Replace `_execute_step` (lines 274–357):

```python
async def _execute_step(self, state: dict, config: RunnableConfig) -> dict:
    """Execute a single step dispatched by scheduler via Send().

    `state` here is the Send payload: {"step": PlanStep, "long_term_memory": str, "pending_applications": str}
    """
    step: PlanStep = state["step"]
    step_prompt = (
        f"You are executing one step of a larger plan.\n\n"
        f"Your task: {step.text}\n\n"
        f"HARD RULE — if this step involves saving / persisting / 定制 / 生成 PDF, "
        f"you MUST invoke the corresponding tool with the actual content.\n\n"
        f"LOOP GUARDRAIL — do not invoke the same tool with the same arguments more "
        f"than twice.\n\n"
        f"User profile:\n{state.get('long_term_memory') or '(none)'}\n\n"
        f"Pending jobs:\n{state.get('pending_applications') or '(none)'}"
    )

    child_config = dict(config or {})
    child_config["recursion_limit"] = EXECUTOR_RECURSION_LIMIT

    executor = self._get_executor()
    try:
        result = await asyncio.wait_for(
            executor.ainvoke(
                {
                    "messages": [HumanMessage(content=step_prompt)],
                    "long_term_memory": state.get("long_term_memory", ""),
                    "pending_applications": state.get("pending_applications", ""),
                },
                config=child_config,
            ),
            timeout=EXECUTOR_STEP_TIMEOUT_SECONDS,
        )
        messages = result.get("messages", [])
        loop_offender = _detect_repeated_tool_call(messages)
        if loop_offender:
            result_text = (
                f"LOOP_DETECTED: 工具 {loop_offender} 被反复调用，已中止。"
            )
            success = False
        else:
            final_msg = messages[-1] if messages else None
            result_text = (
                final_msg.content if final_msg and isinstance(final_msg.content, str)
                else str(final_msg.content) if final_msg else "FAILED: no messages"
            )
            success = True
        logger.info("pe_step_executed", step_id=step.id, success=success)
    except asyncio.TimeoutError:
        result_text = f"TIMEOUT: 超过 {EXECUTOR_STEP_TIMEOUT_SECONDS}s"
        success = False
        logger.warning("pe_step_timed_out", step_id=step.id)
    except Exception as e:
        result_text = f"FAILED: {e!s}"
        success = False
        logger.exception("pe_step_failed", step_id=step.id)

    status = StepStatus.DONE.value if success else StepStatus.FAILED.value
    return {
        "step_results": {step.id: result_text},
        "step_status": {step.id: status},
    }
```

- [ ] **Step 7: Add `_collector` node**

```python
def _collector(self, state: PlanExecuteState) -> dict:
    """Collect results from parallel executors and cascade-skip failed dependencies."""
    updates: dict[str, str] = {}

    # Cascade skip: any PENDING step whose dependency FAILED or was SKIPPED
    changed = True
    while changed:
        changed = False
        for step in state.plan:
            current = state.step_status.get(step.id, StepStatus.PENDING.value)
            if current != StepStatus.PENDING.value:
                continue
            if current in updates:
                continue
            deps_failed = any(
                state.step_status.get(d) in (StepStatus.FAILED.value, StepStatus.SKIPPED.value)
                or updates.get(d) == StepStatus.SKIPPED.value
                for d in step.depends_on
            )
            if deps_failed:
                updates[step.id] = StepStatus.SKIPPED.value
                changed = True

    if updates:
        logger.info("pe_cascade_skipped", skipped_ids=list(updates.keys()))

    return {
        "step_status": updates,
        "iterations": state.iterations + 1,
    }
```

- [ ] **Step 8: Rewrite `_replan` for DAG state**

Replace the `_replan` method (lines 428–518). Key changes: use `step_results`/`step_status` instead of `past_steps`, format remaining steps with `id + depends_on`:

```python
async def _replan(self, state: PlanExecuteState, config: RunnableConfig) -> dict:
    """Decide whether to finish with a Response or continue with a new Plan."""
    # Format executed steps
    executed_lines = []
    for step in state.plan:
        status = state.step_status.get(step.id, StepStatus.PENDING.value)
        if status in (StepStatus.DONE.value, StepStatus.FAILED.value, StepStatus.SKIPPED.value):
            result = state.step_results.get(step.id, "(no result)")
            executed_lines.append(f"- [{status}] {step.id}: {step.text}\n  → {result[:200]}")
    past_steps_text = "\n".join(executed_lines) or "（尚无）"

    # Format remaining (pending) steps
    remaining = [s for s in state.plan if state.step_status.get(s.id) == StepStatus.PENDING.value]
    if remaining:
        remaining_text = "\n".join(
            f"- {s.id}: {s.text} (depends_on: {s.depends_on})" for s in remaining
        )
    else:
        remaining_text = "（空 — 所有步骤都已执行完毕）"

    # Original plan
    original_plan_text = "\n".join(
        f"- {s.id}: {s.text} (depends_on: {s.depends_on})" for s in state.plan
    ) or "（无）"

    system_prompt = load_plan_execute_replanner_prompt(
        input=state.input,
        original_plan=original_plan_text,
        past_steps=past_steps_text,
        remaining_plan=remaining_text,
        user_feedback=state.user_feedback,
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
            f"- {s.id}: {state.step_results.get(s.id, '')[:200]}" for s in state.plan
            if state.step_status.get(s.id) == StepStatus.DONE.value
        )
        return {"response": summary, "pending_revise": False, "user_feedback": None}

    updates: dict = {}
    if state.user_feedback:
        updates["user_feedback"] = None

    if isinstance(act.action, PlanResponse):
        # Check if there are truly remaining steps
        if remaining:
            logger.warning("pe_replan_response_rejected_plan_not_empty", remaining=len(remaining))
            return {"pending_revise": False, **updates}
        logger.info("pe_replan_finish", iterations=state.iterations)
        return {"response": act.action.content, "pending_revise": False, **updates}

    # New remedy DAG
    new_steps = act.action.steps
    new_status = {s.id: StepStatus.PENDING.value for s in new_steps}
    logger.info("pe_replan_continue", new_step_count=len(new_steps))

    if state.pending_revise:
        return {
            "plan": new_steps,
            "step_status": new_status,
            "step_results": {},
            "pending_revise": True,
            **updates,
        }
    return {
        "plan": new_steps,
        "step_status": new_status,
        "step_results": {},
        "pending_revise": False,
        **updates,
    }
```

- [ ] **Step 9: Rewrite `_should_end` routing for DAG**

```python
def _should_end(self, state: PlanExecuteState) -> str:
    """Edge: from replanner → dag_validator (remedy) / approval_gate (revise) / END."""
    if state.response is not None:
        return END
    if state.pending_revise:
        return "approval_gate"
    if state.iterations >= MAX_ITERATIONS:
        logger.warning("pe_max_iterations_reached", iterations=state.iterations)
        return END
    # If replanner emitted a new plan with pending steps, validate and re-execute
    has_pending = any(
        state.step_status.get(s.id) == StepStatus.PENDING.value for s in state.plan
    )
    if has_pending:
        return "dag_validator"
    return END
```

- [ ] **Step 10: Rewrite `_route_after_collector` routing**

Add new routing method:

```python
def _route_after_collector(self, state: PlanExecuteState) -> str:
    """Edge: from collector → scheduler (more ready steps) / replanner (all done)."""
    has_ready = False
    for step in state.plan:
        status = state.step_status.get(step.id, StepStatus.PENDING.value)
        if status != StepStatus.PENDING.value:
            continue
        deps_failed = any(
            state.step_status.get(d) in (StepStatus.FAILED.value, StepStatus.SKIPPED.value)
            for d in step.depends_on
        )
        if deps_failed:
            continue
        deps_met = all(
            state.step_status.get(d) == StepStatus.DONE.value
            for d in step.depends_on
        ) if step.depends_on else True
        if deps_met:
            has_ready = True
            break

    if has_ready:
        return "scheduler"
    return "replanner"
```

- [ ] **Step 11: Rewrite `create_graph` with new topology**

Replace `create_graph` (lines 549–583):

```python
async def create_graph(self) -> Optional[CompiledStateGraph]:
    """Build and cache the DAG Plan-Execute StateGraph with checkpointer."""
    if self._graph is not None:
        return self._graph

    builder = StateGraph(PlanExecuteState)
    builder.add_node("planner", self._planner)
    builder.add_node("dag_validator", self._dag_validator)
    builder.add_node("approval_gate", self._approval_gate)
    builder.add_node("scheduler", self._scheduler)
    builder.add_node("executor", self._execute_step)
    builder.add_node("collector", self._collector)
    builder.add_node("replanner", self._replan)

    builder.set_entry_point("planner")
    builder.add_edge("planner", "dag_validator")
    builder.add_edge("dag_validator", "approval_gate")
    builder.add_conditional_edges(
        "approval_gate",
        self._route_after_approval,
        ["scheduler", "replanner", END],
    )
    # scheduler uses Send() — edges are dynamic
    builder.add_edge("executor", "collector")
    builder.add_conditional_edges(
        "collector",
        self._route_after_collector,
        ["scheduler", "replanner"],
    )
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
```

- [ ] **Step 12: Update `_route_after_approval` to go to `scheduler` instead of `executor`**

```python
def _route_after_approval(self, state: PlanExecuteState) -> str:
    """Edge dispatcher after approval_gate."""
    if state.response is not None:
        return END
    if state.pending_revise:
        return "replanner"
    return "scheduler"
```

- [ ] **Step 13: Add necessary imports at top of plan_execute.py**

Add to the import block:

```python
from app.schemas.plan_execute import StepStatus, PlanStep
from app.core.langgraph.dag import validate_dag, auto_fix_dag, degrade_to_serial, topological_sort
```

And update the `from app.schemas import` line to include the new symbols.

- [ ] **Step 14: Run existing tests to check for regressions**

Run: `uv run pytest tests/unit/test_plan_execute_nodes.py tests/unit/test_dag.py tests/integration/test_plan_execute_graph.py -v`
Expected: dag tests pass; unit/integration PE tests may need `_make_state` helper updates (fix in next step)

- [ ] **Step 15: Update unit test helper `_make_state` for new schema**

In `tests/unit/test_plan_execute_nodes.py`, update the `_make_state` helper to use the new fields (`step_results`, `step_status` instead of `past_steps`, and `plan: list[PlanStep]` instead of `list[str]`). Update routing tests to match new edge names (`scheduler` instead of `executor`).

- [ ] **Step 16: Run all tests**

Run: `uv run pytest tests/unit/ tests/integration/ -v`
Expected: All PASS

- [ ] **Step 17: Commit**

```bash
git add app/core/langgraph/plan_execute.py app/core/langgraph/dag.py tests/
git commit -m "feat(pe): DAG parallel execution engine with scheduler/collector/validator"
```

---

## Task 5: SSE Streaming Rewrite (`astream`)

**Files:**
- Modify: `app/core/langgraph/plan_execute.py` — the `astream` method (lines 656–1013) and `_emit_step_event` inner function (lines 745–825)

- [ ] **Step 1: Rewrite `_emit_step_event` for DAG state**

The inner function inside `astream` needs to emit events based on `step_status` dict instead of `past_steps` list. Replace the `_emit_step_event` function and surrounding state tracking variables with DAG-aware logic:

Key changes:
- `plan_created` emits `depends_on` for each step
- Track `step_status` changes to emit `step_started`, `step_completed`, `step_skipped`
- Emit `wave_started` when a new batch of steps begins (track via scheduler dispatches)
- `awaiting_approval` includes `depends_on`

The `_emit_step_event` function should:
1. On first `plan` appearance → emit `plan_created` with `depends_on` fields
2. Compare previous vs current `step_status` → emit `step_started` for newly `running` steps, `step_completed` for newly `done`/`failed`, `step_skipped` for newly `skipped`
3. Detect wave transitions (multiple `step_started` in one batch → `wave_started` before them)

- [ ] **Step 2: Update `awaiting_approval` event emission**

Where the interrupt is detected (around line 936–955), include `depends_on` in the plan step descriptors:

```python
yield _json.dumps({
    "type": "awaiting_approval",
    "thread_id": pe_thread_id,
    "plan": [
        {"id": s.id, "text": s.text, "depends_on": s.depends_on}
        for s in plan_steps
    ],
    "round": approval_round,
    "done": True,
})
```

- [ ] **Step 3: Verify streaming works with manual test**

Start dev server: `make dev`
Trigger a PE run via the frontend or API. Confirm SSE events include `depends_on` and `wave_started`.

- [ ] **Step 4: Commit**

```bash
git add app/core/langgraph/plan_execute.py
git commit -m "feat(pe): DAG-aware SSE streaming with wave_started and step_skipped events"
```

---

## Task 6: Frontend Type Updates

**Files:**
- Modify: `frontend/lib/types.ts` (lines 127–191)
- Modify: `frontend/hooks/useChat.ts` (lines 64, 79, 187, 234, 258)

- [ ] **Step 1: Update TypeScript types**

In `frontend/lib/types.ts`:

1. Add `"skipped"` to `PlanStepStatus` (line 127):
```typescript
type PlanStepStatus = "pending" | "running" | "done" | "failed" | "skipped"
```

2. Add `dependsOn` to `PlanStep` interface (around line 138):
```typescript
interface PlanStep {
    id: string
    text: string
    status: PlanStepStatus
    result?: string
    liveText?: string
    toolCalls?: PlanLiveToolCall[]
    startedAt?: number
    dependsOn?: string[]   // NEW
}
```

3. Add `depends_on` to `PlanStepDescriptor` (around line 152):
```typescript
interface PlanStepDescriptor {
    id: string
    text: string
    depends_on?: string[]   // NEW
}
```

4. Add new event types to `PlanStreamChunk` union (around line 157):
```typescript
| { type: "wave_started"; wave: number; step_ids: string[]; done: false }
| { type: "step_skipped"; id: string; reason: string; done: false }
```

- [ ] **Step 2: Update `useChat.ts` event handler**

In `frontend/hooks/useChat.ts`, in the `applyPlanChunkToMessage` function:

1. Update `plan_created` handler (around line 64) to store `depends_on`:
```typescript
case "plan_created":
    return {
        ...view,
        steps: chunk.steps.map(s => ({
            id: s.id,
            text: s.text,
            status: "pending" as PlanStepStatus,
            dependsOn: s.depends_on || [],  // NEW
        })),
    }
```

2. Add `wave_started` handler (no-op for now, frontend uses `step_started` for timing):
```typescript
case "wave_started":
    return view  // Wave info is implicit from parallel step_started events
```

3. Add `step_skipped` handler:
```typescript
case "step_skipped":
    return {
        ...view,
        steps: view.steps.map(s =>
            s.id === chunk.id
                ? { ...s, status: "skipped" as PlanStepStatus, result: chunk.reason }
                : s
        ),
    }
```

4. Update `awaiting_approval` handler (around line 234) to store `depends_on`:
```typescript
// In the steps mapping, add dependsOn
dependsOn: s.depends_on || [],
```

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/types.ts frontend/hooks/useChat.ts
git commit -m "feat(pe): frontend types and event handlers for DAG execution"
```

---

## Task 7: Frontend Timeline with Wave Layout & Dependency Edges

**Files:**
- Modify: `frontend/components/plan/PlanTimeline.tsx` (full rewrite, 192 lines)
- Modify: `frontend/components/plan/PlanApprovalCard.tsx` (minor — show DAG in approval)

- [ ] **Step 1: Implement wave-grouped timeline layout**

Rewrite `PlanTimeline.tsx` to:
1. Compute waves from `dependsOn` using a frontend topological sort
2. Render waves vertically, steps within a wave horizontally
3. Draw SVG dependency edges between steps

The component should:
- Group steps by wave (topological layer)
- Render each wave as a labeled section (`WAVE 1`, `WAVE 2`, ...)
- Steps within a wave are displayed as horizontal cards
- Each card shows status icon (spinner/checkmark/x/skip), step text, duration
- SVG overlay draws arrows from source step to dependent step
- Arrow color follows the rule: green (done), gray dashed (pending), red dashed (failed→skipped)

Use `useRef` + `useEffect` to measure step card positions and draw SVG lines between them. Use `ResizeObserver` to handle layout changes.

- [ ] **Step 2: Add "skipped" status styling to PlanStepCard**

In the step card component (may be in `PlanStepCard.tsx` or inline in `PlanTimeline.tsx`), add a skipped state:
- Icon: ⊘ with amber/yellow color
- Text: strikethrough
- Background: muted

- [ ] **Step 3: Update PlanApprovalCard to show DAG structure**

In `PlanApprovalCard.tsx`, when displaying the plan for approval, use the same wave-grouped layout (simplified — no status icons needed, just the structure with edges to show parallelism).

- [ ] **Step 4: Visual test in browser**

Start dev: `make dev`
Trigger a PE run. Verify:
- Steps appear grouped by wave
- Dependency arrows render between steps
- Parallel steps within a wave show side by side
- Skipped steps show strikethrough with amber icon
- Approval card shows DAG structure

- [ ] **Step 5: Commit**

```bash
git add frontend/components/plan/
git commit -m "feat(pe): wave-grouped DAG timeline with dependency edges"
```

---

## Task 8: Final Integration Test & Cleanup

**Files:**
- Modify: `tests/unit/test_plan_execute_nodes.py`
- Modify: `tests/integration/test_plan_execute_graph.py`

- [ ] **Step 1: Finalize unit tests for new routing methods**

Update `tests/unit/test_plan_execute_nodes.py` to test:
- `_route_after_approval` → returns `"scheduler"` (not `"executor"`)
- `_route_after_collector` → returns `"scheduler"` when ready steps exist, `"replanner"` when all done
- `_should_end` → returns `"dag_validator"` when remedy plan has pending steps

- [ ] **Step 2: Finalize integration tests**

Ensure `tests/integration/test_plan_execute_graph.py` covers:
- DAG happy path with parallel steps
- Cascade skip scenario
- DAG validation fallback to serial

- [ ] **Step 3: Run full test suite**

Run: `uv run pytest tests/ -v`
Expected: All PASS

- [ ] **Step 4: Run linter**

Run: `make lint && make format`
Expected: Clean

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "test(pe): comprehensive DAG plan-execute test coverage"
```
