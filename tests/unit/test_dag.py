"""Tests for DAG schemas and validation utilities."""

import pytest
from app.schemas.plan_execute import PlanStep, StepStatus, Plan, PlanExecuteState
from app.core.langgraph.dag import (
    DAGError,
    validate_dag,
    auto_fix_dag,
    topological_sort,
    degrade_to_serial,
)


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
