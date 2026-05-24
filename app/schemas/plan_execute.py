"""Schemas for the Plan-and-Execute subgraph."""

from enum import Enum
from typing import Annotated

from pydantic import BaseModel, Field


def _merge_dicts(left: dict, right: dict) -> dict:
    """LangGraph state reducer: merge two dicts (right wins on key collision)."""
    merged = left.copy()
    merged.update(right)
    return merged


def _last_value(left, right):
    """LangGraph state reducer: accept multiple writes per superstep, last wins.

    For control-flag fields (pending_revise) that LangGraph routing can write
    from more than one node in the same superstep — without this reducer the
    default LastValue channel raises INVALID_CONCURRENT_GRAPH_UPDATE.
    """
    return right


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
    step_duration_ms: Annotated[dict[str, int], _merge_dicts] = Field(
        default_factory=dict, description="step_id → execution duration in milliseconds"
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
    pending_revise: Annotated[bool, _last_value] = Field(
        default=False,
        description="路由 hint：True 时 Replanner 产出的新 plan 送回 approval_gate",
    )
