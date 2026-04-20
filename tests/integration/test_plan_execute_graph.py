"""Integration tests for the compiled plan-execute graph with HITL interrupt/resume.

Uses MemorySaver (not Postgres). Executor's internal ReAct sub-agent picks up
llm_service._llm via inject_main_llm — a plain FakeChatModel that returns
"step done" is enough to terminate the sub-agent with no tool calls.
"""

from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph
from langgraph.types import Command

from app.api.v1.chatbot import plan_execute_agent as pe_agent
from app.schemas import Act, Plan, PlanExecuteState, PlanResponse
from tests.support.fake_llm import (
    inject_main_llm,
    make_fake_chat_model,
    make_structured_fake,
)


def _make_structured_factory(plan_return, act_return):
    plan_fake = make_structured_fake(Plan, plan_return)
    act_fake = make_structured_fake(Act, act_return)

    def _factory(schema):
        if schema is Plan:
            return plan_fake
        if schema is Act:
            return act_fake
        raise ValueError(f"unexpected schema: {schema}")

    return _factory


def _build_pe_graph_with_memsaver():
    builder = StateGraph(PlanExecuteState)
    builder.add_node("planner", pe_agent._planner)
    builder.add_node("approval_gate", pe_agent._approval_gate)
    builder.add_node("executor", pe_agent._execute_step)
    builder.add_node("replanner", pe_agent._replan)
    builder.set_entry_point("planner")
    builder.add_edge("planner", "approval_gate")
    builder.add_conditional_edges(
        "approval_gate", pe_agent._route_after_approval, ["executor", "replanner", END]
    )
    builder.add_edge("executor", "replanner")
    builder.add_conditional_edges(
        "replanner", pe_agent._should_end, ["executor", "approval_gate", END]
    )
    return builder.compile(checkpointer=MemorySaver())


async def test_happy_path_plan_approve_execute_end(monkeypatch):
    """planner returns [step1] → interrupt → approve → executor runs step1 →
    replanner returns final Response → END."""
    factory = _make_structured_factory(
        plan_return=Plan(steps=["step one"]),
        act_return=Act(action=PlanResponse(content="all done")),
    )
    monkeypatch.setattr(pe_agent, "_structured_llm", factory, raising=False)

    # Executor sub-agent LLM — returns a plain text response with no tool calls
    exec_llm = make_fake_chat_model([AIMessage(content="step done")])
    inject_main_llm(monkeypatch, exec_llm)
    # Clear the cached executor so it rebuilds with the injected LLM
    monkeypatch.setattr(pe_agent, "_executor", None, raising=False)

    graph = _build_pe_graph_with_memsaver()
    config = {"configurable": {"thread_id": "test-happy-path"}}

    # Run until interrupt
    await graph.ainvoke({"input": "do thing"}, config=config)

    # Resume with approve
    await graph.ainvoke(Command(resume={"action": "approve"}), config=config)

    snapshot = await graph.aget_state(config)
    assert snapshot.values.get("response") == "all done", (
        f"expected final response 'all done', got {snapshot.values!r}"
    )


async def test_revise_loops_back_to_replanner_and_increments_approval_round(monkeypatch):
    """planner returns [step1] → interrupt → revise → replanner (pending_revise path)
    returns new Plan → should_end sees pending_revise → approval_gate interrupts again."""

    # First Plan (from planner) and second Plan (from replanner on revise)
    plan_fake = make_structured_fake(Plan, Plan(steps=["original step"]))
    act_fake = make_structured_fake(Act, Act(action=Plan(steps=["revised step"])))

    def _factory(schema):
        if schema is Plan:
            return plan_fake
        if schema is Act:
            return act_fake
        raise ValueError(f"unexpected schema: {schema}")

    monkeypatch.setattr(pe_agent, "_structured_llm", _factory, raising=False)

    graph = _build_pe_graph_with_memsaver()
    config = {"configurable": {"thread_id": "test-revise-loop"}}

    # Run until first interrupt (after planner)
    await graph.ainvoke({"input": "do thing"}, config=config)
    snapshot1 = await graph.aget_state(config)
    round_after_first = snapshot1.values.get("approval_round", 0)

    # Resume with revise — should go to replanner, then back to approval_gate
    await graph.ainvoke(
        Command(resume={"action": "revise", "feedback": "not good enough"}),
        config=config,
    )

    snapshot2 = await graph.aget_state(config)
    round_after_revise = snapshot2.values.get("approval_round", 0)

    assert round_after_revise > round_after_first, (
        f"approval_round should advance past {round_after_first} after revise, "
        f"got {round_after_revise}"
    )
    # The revised plan should now be staged for the next approval
    assert snapshot2.values.get("plan") == ["revised step"], (
        f"expected revised plan, got {snapshot2.values.get('plan')!r}"
    )
    # pending_revise should be True at this point (the replanner stashed it,
    # approval_gate hasn't yet consumed it)
    assert snapshot2.values.get("pending_revise") is True, (
        f"pending_revise should be True after replan-before-approval, got "
        f"{snapshot2.values.get('pending_revise')}"
    )
