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


def test_route_after_approval_default_approve_dispatches_sends():
    from app.schemas import PlanStep

    agent = PlanExecuteAgent()
    steps = [PlanStep(id="A1", text="step1", depends_on=[])]
    state = _make_state(
        plan=steps,
        step_status={"A1": "pending"},
        pending_revise=False,
    )
    result = agent._route_after_approval(state)
    # Should return a list of Send objects for fan-out
    assert isinstance(result, list)
    assert len(result) == 1


# ============================================================================
# Part 2: plan_execute node tests (planner, replanner, should_end)
# ============================================================================

from app.schemas import Act, Plan, PlanResponse
from tests.support.fake_llm import make_structured_fake


def test_should_end_no_pending_steps_ends():
    """_should_end returns END when no pending steps remain."""
    from app.schemas import PlanStep

    agent = PlanExecuteAgent()
    steps = [PlanStep(id="A1", text="s1", depends_on=[])]
    state = _make_state(
        plan=steps,
        step_status={"A1": "done"},
        step_results={"A1": "ok"},
        iterations=0,
        pending_revise=False,
        response=None,
    )
    assert agent._should_end(state) == END


async def test_planner_generates_plan_from_input(monkeypatch):
    """_planner mocks _structured_llm to return a Plan and produces {"plan": steps, "step_status": ...}."""
    from app.schemas import PlanStep

    agent = PlanExecuteAgent()
    plan_steps = [
        PlanStep(id="A1", text="step one", depends_on=[]),
        PlanStep(id="A2", text="step two", depends_on=["A1"]),
    ]
    fake_plan = Plan(steps=plan_steps)
    fake_llm = make_structured_fake(Plan, fake_plan)

    def _factory(schema):
        assert schema is Plan, f"planner must request Plan, got {schema}"
        return fake_llm

    monkeypatch.setattr(agent, "_structured_llm", _factory, raising=False)
    # Bypass prompt loading (which chokes on JSON braces in the template)
    monkeypatch.setattr(
        "app.core.langgraph.plan_execute.load_plan_execute_planner_prompt",
        lambda **kw: "fake planner prompt",
    )

    state = _make_state(input="do stuff")
    result = await agent._planner(state, config={"configurable": {"thread_id": "t1"}})

    assert result["plan"] == plan_steps
    assert result["step_status"] == {"A1": "pending", "A2": "pending"}


async def test_replan_returns_final_response_when_all_done(monkeypatch):
    """_replan returns Act with PlanResponse when all steps are done."""
    from app.schemas import PlanStep

    agent = PlanExecuteAgent()
    act = Act(action=PlanResponse(content="all done"))
    fake_llm = make_structured_fake(Act, act)

    def _factory(schema):
        assert schema is Act, f"replanner must request Act, got {schema}"
        return fake_llm

    monkeypatch.setattr(agent, "_structured_llm", _factory, raising=False)

    steps = [PlanStep(id="A1", text="step one", depends_on=[])]
    state = _make_state(
        input="do stuff",
        plan=steps,
        step_status={"A1": "done"},
        step_results={"A1": "ok"},
    )
    result = await agent._replan(state, config={"configurable": {"thread_id": "t1"}})

    assert result.get("response") == "all done"
    assert result.get("pending_revise") is False


# ============================================================================
# Part 3: executor loop detection
# ============================================================================

from types import SimpleNamespace

from app.core.langgraph.plan_execute import (
    MAX_REPEATED_TOOL_CALLS,
    _detect_repeated_tool_call,
)


def _fake_ai_msg(calls):
    return SimpleNamespace(tool_calls=calls)


def test_detect_repeated_tool_call_none_when_varied_args():
    messages = [
        _fake_ai_msg([{"name": "generate_resume_pdf", "args": {"application_id": 1}}]),
        _fake_ai_msg([{"name": "generate_resume_pdf", "args": {"application_id": 2}}]),
        _fake_ai_msg([{"name": "generate_resume_pdf", "args": {"application_id": 3}}]),
        _fake_ai_msg([{"name": "generate_resume_pdf", "args": {"application_id": 4}}]),
    ]
    assert _detect_repeated_tool_call(messages) is None


def test_detect_repeated_tool_call_fires_after_threshold():
    same_args = {"application_id": 2, "resume_json": "{}"}
    # One more than MAX_REPEATED_TOOL_CALLS — triggers the guardrail.
    messages = [
        _fake_ai_msg([{"name": "generate_resume_pdf", "args": same_args}])
        for _ in range(MAX_REPEATED_TOOL_CALLS + 1)
    ]
    assert _detect_repeated_tool_call(messages) == "generate_resume_pdf"


def test_detect_repeated_tool_call_ignores_non_ai_messages():
    messages = [_fake_ai_msg(None), SimpleNamespace()]
    assert _detect_repeated_tool_call(messages) is None


def test_detect_repeated_tool_call_arg_order_insensitive():
    """Key order changes in tool args must still count as identical calls."""
    msgs = [
        _fake_ai_msg([{"name": "save_tailored_resume", "args": {"a": 1, "b": 2}}]),
        _fake_ai_msg([{"name": "save_tailored_resume", "args": {"b": 2, "a": 1}}]),
        _fake_ai_msg([{"name": "save_tailored_resume", "args": {"a": 1, "b": 2}}]),
        _fake_ai_msg([{"name": "save_tailored_resume", "args": {"b": 2, "a": 1}}]),
    ]
    assert _detect_repeated_tool_call(msgs) == "save_tailored_resume"
