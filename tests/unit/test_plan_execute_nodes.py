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


# ============================================================================
# Part 2: plan_execute node tests (planner, replanner, should_end)
# ============================================================================

from app.schemas import Act, Plan, PlanResponse
from tests.support.fake_llm import make_structured_fake


def test_should_end_empty_plan_ends():
    """_should_end returns END when plan is empty and no response set."""
    agent = PlanExecuteAgent()
    state = _make_state(plan=[], past_steps=[("s1", "ok")], iterations=0, pending_revise=False, response=None)
    assert agent._should_end(state) == END


async def test_planner_generates_plan_from_input(monkeypatch):
    """_planner mocks _structured_llm to return a Plan and produces {"plan": steps}."""
    agent = PlanExecuteAgent()
    fake_plan = Plan(steps=["step one", "step two"])
    fake_llm = make_structured_fake(Plan, fake_plan)

    def _factory(schema):
        assert schema is Plan, f"planner must request Plan, got {schema}"
        return fake_llm

    monkeypatch.setattr(agent, "_structured_llm", _factory, raising=False)

    state = _make_state(input="do stuff")
    result = await agent._planner(state, config={"configurable": {"thread_id": "t1"}})

    assert result == {"plan": ["step one", "step two"]}


async def test_replan_returns_final_response_when_plan_empty(monkeypatch):
    """_replan mocks _structured_llm to return Act with PlanResponse when plan is empty."""
    agent = PlanExecuteAgent()
    act = Act(action=PlanResponse(content="all done"))
    fake_llm = make_structured_fake(Act, act)

    def _factory(schema):
        assert schema is Act, f"replanner must request Act, got {schema}"
        return fake_llm

    monkeypatch.setattr(agent, "_structured_llm", _factory, raising=False)

    state = _make_state(
        input="do stuff",
        plan=[],  # empty plan triggers the final-response branch
        past_steps=[("step one", "ok")],
    )
    result = await agent._replan(state, config={"configurable": {"thread_id": "t1"}})

    assert result.get("response") == "all done"
    assert result.get("pending_revise") is False
