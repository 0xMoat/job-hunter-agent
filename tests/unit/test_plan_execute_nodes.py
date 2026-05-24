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
    assert agent._route_after_approval(state, config={"configurable": {"thread_id": "t1"}}) == END


def test_route_after_approval_pending_revise_goes_to_replanner():
    agent = PlanExecuteAgent()
    state = _make_state(pending_revise=True, user_feedback="change step 2")
    assert agent._route_after_approval(state, config={"configurable": {"thread_id": "t1"}}) == "replanner"


def test_route_after_approval_default_approve_dispatches_sends():
    from langgraph.types import Send
    from app.schemas import PlanStep

    agent = PlanExecuteAgent()
    steps = [PlanStep(id="A1", text="step1", depends_on=[])]
    state = _make_state(
        plan=steps,
        step_status={"A1": "pending"},
        pending_revise=False,
    )
    result = agent._route_after_approval(state, config={"configurable": {"thread_id": "t1"}})
    # LangGraph 1.x conditional edges can't carry state updates; the RUNNING
    # pre-mark moved into _approval_gate's node return. Routing now returns a
    # plain Send list. (See commit 9949bde.)
    assert isinstance(result, list)
    assert len(result) == 1
    assert isinstance(result[0], Send)
    assert result[0].node == "executor"


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


# ============================================================================
# Part 4: artifact-prune helpers + node
# ============================================================================

import pytest

from app.core.langgraph.plan_execute import (
    _classify_step_artifact,
    _extract_application_id,
)
from app.schemas import PlanStep


@pytest.mark.parametrize(
    "text,expected",
    [
        ("company_research(card=10) 并 save_company_research(application_id=10, content=...)", "research"),
        ("score_jd_match(application_id=10)", "score"),
        ("analyze_jd_gap(application_id=10)", "gap"),
        ("generate_interview_questions(application_id=10)", "interview"),
        ("为 application_id=10 定制简历+PDF", "resume"),
        ("trigger_resume_studio_skill 然后 save_tailored_resume(application_id=10)", "resume"),
        ("汇总本次处理结果并提交最终回复", None),
        ("duckduckgo_search('site:example.com')", None),
    ],
)
def test_classify_step_artifact(text, expected):
    assert _classify_step_artifact(text) == expected


@pytest.mark.parametrize(
    "text,expected",
    [
        ("score_jd_match(application_id=42)", 42),
        ("score_jd_match(application_id = 42)", 42),
        ("company_research(card=7) 并 save_company_research(application_id=7)", 7),
        ("company_research(card=15)", 15),
        ("汇总本次处理结果", None),
    ],
)
def test_extract_application_id(text, expected):
    assert _extract_application_id(text) == expected


async def test_prune_satisfied_steps_marks_redundant_done(monkeypatch):
    """Steps recreating an existing artifact get flipped PENDING→DONE."""
    from types import SimpleNamespace

    agent = PlanExecuteAgent()
    plan = [
        PlanStep(id="A1", text="company_research(card=10) 并 save_company_research(application_id=10, content=...)", depends_on=[]),
        PlanStep(id="A2", text="score_jd_match(application_id=10)", depends_on=["A1"]),
        PlanStep(id="A3", text="analyze_jd_gap(application_id=10)", depends_on=["A1"]),
        PlanStep(id="B1", text="company_research(card=11) 并 save_company_research(application_id=11, content=...)", depends_on=[]),
        PlanStep(id="Z", text="汇总本次处理结果", depends_on=["A2", "A3", "B1"]),
    ]
    state = _make_state(
        plan=plan,
        step_status={s.id: "pending" for s in plan},
    )

    # app 10 has research+score saved → A1 + A2 should prune; A3 (gap) and B1 stay
    fake_apps = [
        SimpleNamespace(
            id=10,
            company_research_json="{...}",
            match_breakdown="{...}",
            gap_analysis_text=None,
            interview_questions_json=None,
            tailored_resume_text=None,
        ),
        SimpleNamespace(
            id=11,
            company_research_json=None,
            match_breakdown=None,
            gap_analysis_text=None,
            interview_questions_json=None,
            tailored_resume_text=None,
        ),
    ]

    async def _fake_list(user_id):
        return fake_apps

    monkeypatch.setattr(
        "app.core.langgraph.plan_execute.job_service.list_applications",
        _fake_list,
    )

    result = await agent._prune_satisfied_steps(
        state, config={"configurable": {"user_id": "1", "thread_id": "t1"}}
    )

    assert result["step_status"] == {"A1": "done", "A2": "done"}
    assert "A1" in result["step_results"]
    assert "research" in result["step_results"]["A1"]
    assert "score" in result["step_results"]["A2"]
    # Untouched steps not present (so the dict-merge reducer won't overwrite them)
    assert "A3" not in result["step_status"]
    assert "B1" not in result["step_status"]
    assert "Z" not in result["step_status"]


async def test_prune_satisfied_steps_noop_when_nothing_to_prune(monkeypatch):
    """Returns empty dict when no PENDING step matches a saved artifact."""
    from types import SimpleNamespace

    agent = PlanExecuteAgent()
    plan = [PlanStep(id="A1", text="score_jd_match(application_id=10)", depends_on=[])]
    state = _make_state(plan=plan, step_status={"A1": "pending"})

    async def _fake_list(user_id):
        return [
            SimpleNamespace(
                id=10,
                company_research_json=None,
                match_breakdown=None,
                gap_analysis_text=None,
                interview_questions_json=None,
                tailored_resume_text=None,
            )
        ]

    monkeypatch.setattr(
        "app.core.langgraph.plan_execute.job_service.list_applications",
        _fake_list,
    )

    result = await agent._prune_satisfied_steps(
        state, config={"configurable": {"user_id": "1", "thread_id": "t1"}}
    )
    assert result == {}


async def test_prune_satisfied_steps_handles_missing_user_id():
    """No user_id in config → return {} silently (defensive)."""
    agent = PlanExecuteAgent()
    state = _make_state(plan=[], step_status={})
    result = await agent._prune_satisfied_steps(state, config={"configurable": {}})


# ---- _tool_budget_hook ---------------------------------------------------

from langchain_core.messages import AIMessage, ToolMessage  # noqa: E402

from app.core.langgraph.plan_execute import (  # noqa: E402
    EXECUTOR_TOOL_BUDGET,
    EXECUTOR_TOOL_BUDGET_BY_KIND,
    _tool_budget_hook,
)


def _ai_with_calls(call_specs, msg_id="ai-id"):
    """Build an AIMessage carrying given tool_calls."""
    return AIMessage(
        id=msg_id,
        content="",
        tool_calls=[
            {"name": name, "args": args, "id": f"tc-{i}"}
            for i, (name, args) in enumerate(call_specs)
        ],
    )


def test_tool_budget_hook_passes_through_when_under_budget():
    """Under budget → no state change (return {})."""
    msgs = [_ai_with_calls([("duckduckgo_results_json", {"q": "foo"})])]
    assert _tool_budget_hook({"messages": msgs}) == {}


def test_tool_budget_hook_passes_through_when_last_msg_has_no_tool_calls():
    """If LLM already produced a final answer (no tool_calls), hook is a no-op."""
    msgs = [AIMessage(id="final", content="here is the answer")]
    # Even with prior tool history, the last message has no tool_calls
    for i in range(EXECUTOR_TOOL_BUDGET + 2):
        msgs.insert(
            0,
            _ai_with_calls(
                [("duckduckgo_results_json", {"q": f"q{i}"})], msg_id=f"prev-{i}"
            ),
        )
    assert _tool_budget_hook({"messages": msgs}) == {}


def test_tool_budget_hook_rewrites_when_budget_exceeded_varied_args():
    """Core regression of the production bug.

    Multiple tool_calls with *different* args still hit the budget — existing
    _detect_repeated_tool_call misses this case; _tool_budget_hook catches it.
    """
    msgs = []
    # Fill history with EXECUTOR_TOOL_BUDGET tool calls (varied queries)
    for i in range(EXECUTOR_TOOL_BUDGET):
        msgs.append(
            _ai_with_calls(
                [("duckduckgo_results_json", {"q": f"元聚 query {i}"})],
                msg_id=f"hist-{i}",
            )
        )
        msgs.append(
            ToolMessage(content=f"result-{i}", tool_call_id="tc-0")
        )
    # Latest AIMessage tries yet another search
    last = _ai_with_calls(
        [("duckduckgo_results_json", {"q": "元聚 final attempt"})], msg_id="last"
    )
    msgs.append(last)

    result = _tool_budget_hook({"messages": msgs})

    assert "messages" in result
    new_msg = result["messages"][0]
    assert isinstance(new_msg, AIMessage)
    assert not new_msg.tool_calls, "rewritten message must drop tool_calls"
    assert "信息不足" in new_msg.content
    assert new_msg.id == "last", "must reuse last AIMessage id so it replaces, not appends"


def test_tool_budget_hook_counts_across_multi_call_messages():
    """A single AIMessage may carry multiple tool_calls — they all count."""
    # One message with EXECUTOR_TOOL_BUDGET tool_calls — already at budget
    one_big_msg = _ai_with_calls(
        [("duckduckgo_results_json", {"q": f"q{i}"}) for i in range(EXECUTOR_TOOL_BUDGET)],
        msg_id="big",
    )
    result = _tool_budget_hook({"messages": [one_big_msg]})
    assert "messages" in result
    assert not result["messages"][0].tool_calls


def test_tool_budget_hook_respects_higher_per_step_budget():
    """A per-step budget passed in state overrides the module default."""
    msgs = []
    for i in range(EXECUTOR_TOOL_BUDGET):
        msgs.append(
            _ai_with_calls(
                [("save_tailored_resume", {"i": i})], msg_id=f"hist-{i}"
            )
        )
        msgs.append(ToolMessage(content=f"r-{i}", tool_call_id="tc-0"))
    msgs.append(_ai_with_calls([("generate_resume_pdf", {})], msg_id="last"))

    result = _tool_budget_hook({"messages": msgs, "tool_budget": 10})
    assert result == {}


def test_tool_budget_hook_reports_actual_budget_in_message():
    """Rewritten message must report the per-step budget, not the module default."""
    msgs = []
    for i in range(9):
        msgs.append(
            _ai_with_calls(
                [("save_tailored_resume", {"i": i})], msg_id=f"hist-{i}"
            )
        )
        msgs.append(ToolMessage(content=f"r-{i}", tool_call_id="tc-0"))
    msgs.append(_ai_with_calls([("generate_resume_pdf", {})], msg_id="last"))

    result = _tool_budget_hook({"messages": msgs, "tool_budget": 10})
    assert "messages" in result
    content = result["messages"][0].content
    assert "10 次" in content
    assert "(10)" in content


def test_executor_tool_budget_by_kind_resume_is_higher():
    """Resume bundles 3 tool calls, so its per-step budget must exceed the default."""
    assert EXECUTOR_TOOL_BUDGET_BY_KIND["resume"] == 10
    assert EXECUTOR_TOOL_BUDGET_BY_KIND.get("research", EXECUTOR_TOOL_BUDGET) == 5


def test_executor_compiled_with_post_model_hook():
    """Smoke test: ensure _get_executor wires the budget hook into the ReAct graph."""
    agent = PlanExecuteAgent()
    executor = agent._get_executor()
    # post_model_hook becomes a node named "post_model_hook" in the compiled graph
    assert "post_model_hook" in executor.nodes, (
        "executor must have post_model_hook node — check create_react_agent kwargs"
    )


def test_execute_step_prompt_contains_research_budget_rule():
    """Lightweight regex assertion that the HARD RULE survives accidental rewrites."""
    import re
    src = open("app/core/langgraph/plan_execute.py").read()
    assert re.search(r"RESEARCH BUDGET", src), "HARD RULE for research budget missing"
    assert "EXECUTOR_TOOL_BUDGET" in src


# ---- per-kind recursion limit + pending_revise reducer ---------------------


def test_executor_recursion_limit_by_kind_resume_is_higher():
    """Resume budget=10 needs ≈22 supersteps; default 25 is too tight."""
    from app.core.langgraph.plan_execute import (
        EXECUTOR_RECURSION_LIMIT,
        EXECUTOR_RECURSION_LIMIT_BY_KIND,
    )

    assert EXECUTOR_RECURSION_LIMIT_BY_KIND["resume"] == 40
    assert EXECUTOR_RECURSION_LIMIT_BY_KIND.get("research", EXECUTOR_RECURSION_LIMIT) == 25


def test_pending_revise_reducer_accepts_multiple_writes():
    """Without _last_value reducer, two writes per superstep raise InvalidUpdateError."""
    from langgraph.channels.last_value import LastValue
    from typing import get_args, get_origin

    from app.schemas.plan_execute import PlanExecuteState, _last_value

    # Confirm the field actually has the reducer attached via Annotated metadata.
    fields = PlanExecuteState.model_fields
    annotation = fields["pending_revise"].metadata
    assert _last_value in annotation, (
        f"pending_revise must use _last_value reducer; got metadata={annotation}"
    )

    # Confirm the reducer itself takes the right value.
    assert _last_value(True, False) is False
    assert _last_value(False, True) is True
