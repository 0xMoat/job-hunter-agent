"""Unit tests for PlanExecuteAgent nodes and routes.

Part 1 (this task): three pure conditional routes of _route_after_approval.
Part 2 (next task): _should_end + _planner + _replan — each with own fake.
"""

from langgraph.graph import END

from app.core.langgraph.plan_execute import PlanExecuteAgent
from app.schemas import PlanExecuteState


def _make_state(**overrides) -> PlanExecuteState:
    """Build a minimal PlanExecuteState with sensible defaults, overriding fields as needed.

    `input` is the only required field.
    """
    defaults = dict(input="do something")
    defaults.update(overrides)
    return PlanExecuteState(**defaults)


def test_route_after_approval_with_response_set_ends():
    agent = PlanExecuteAgent()
    state = _make_state(response="cancelled by user")
    assert agent._route_after_approval(state) == END


def test_route_after_approval_pending_revise_goes_to_replanner():
    agent = PlanExecuteAgent()
    state = _make_state(pending_revise=True, user_feedback="change step 2")
    assert agent._route_after_approval(state) == "replanner"


def test_route_after_approval_default_approve_goes_to_executor():
    agent = PlanExecuteAgent()
    state = _make_state(plan=["step1"], pending_revise=False)
    assert agent._route_after_approval(state) == "executor"
