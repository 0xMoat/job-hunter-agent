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
