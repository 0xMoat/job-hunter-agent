"""Schemas for the Plan-and-Execute subgraph."""

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

    action: Response | Plan = Field(
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
