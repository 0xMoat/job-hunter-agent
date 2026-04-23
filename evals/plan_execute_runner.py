"""Plan-and-Execute runner for offline evaluation.

Drives the compiled PlanExecuteAgent graph with an injected pending list
(bypassing the DB-backed _get_pending_applications), captures each values
event and executor sub-graph tool calls, and returns a structured output
suitable for plan_quality, replan_decision, and tool_appropriateness evaluators.
"""

import os
import sys
import uuid

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core.langgraph.plan_execute import PlanExecuteAgent

_agent: PlanExecuteAgent | None = None


def _get_agent() -> PlanExecuteAgent:
    global _agent
    if _agent is None:
        _agent = PlanExecuteAgent()
    return _agent


def _format_pending(pendings: list[dict]) -> str:
    lines = []
    for i, p in enumerate(pendings, 1):
        company = p.get("company", "")
        title = p.get("title", "")
        lines.append(f"{i}. [{title}] {company}".strip())
    return "\n".join(lines)


async def plan_execute_task(*, item, **kwargs) -> dict:
    """Run a P&E item against the real graph and capture plan history."""
    raw_input = item.input if hasattr(item, "input") else item
    metadata = item.metadata if hasattr(item, "metadata") else {}
    goal = raw_input["input"]
    pendings = metadata.get("pending_applications") or []
    pending_text = _format_pending(pendings) or "（无 pending 职位）"

    from langgraph.checkpoint.memory import MemorySaver
    from langgraph.types import Command

    agent = _get_agent()
    graph = await agent.create_graph()
    if graph is None:
        return {
            "text": "graph_unavailable",
            "plan": [],
            "past_steps": [],
            "final_response": "",
            "replan_count": 0,
        }

    # interrupt() requires a checkpointer to persist state between stream calls.
    # The production graph uses AsyncPostgresSaver, which may not be available in
    # eval context. Recompile with MemorySaver when the checkpointer is absent.
    if graph.checkpointer is None:
        graph = graph.builder.compile(
            checkpointer=MemorySaver(),
            name=graph.name,
        )

    initial_state = {
        "input": goal,
        "long_term_memory": "",
        "pending_applications": pending_text,
    }
    config = {
        "configurable": {
            "thread_id": f"pe_eval_{uuid.uuid4().hex[:8]}",
            "user_id": "eval",
        },
        "metadata": {"pipeline": "plan_execute_eval"},
        "recursion_limit": 50,
    }

    initial_plan: list[str] = []
    past_steps: list[tuple[str, str]] = []
    final_response: str = ""
    plan_snapshots: list[list[str]] = []
    tool_calls_seen: set[str] = set()

    # The P&E graph uses interrupt() for HITL approval. In eval mode we
    # auto-approve by looping: stream → detect interrupt → resume.
    graph_input = initial_state
    max_approval_rounds = 10  # safety cap

    for _round in range(max_approval_rounds):
        async for stream_event in graph.astream(
            graph_input,
            config,
            stream_mode=["values", "messages"],
            subgraphs=True,
        ):
            ns, event_mode, payload = stream_event

            if event_mode == "values" and not ns:
                # Outer graph state snapshots
                event = payload
                plan = list(event.get("plan") or [])
                past_steps = list(event.get("past_steps") or [])
                if plan and not initial_plan:
                    initial_plan = list(plan)
                plan_snapshots.append(plan)
                response = event.get("response")
                if response:
                    final_response = response

            elif event_mode == "messages" and ns:
                # Executor sub-graph messages — extract tool call names
                token, _metadata = payload
                if hasattr(token, "tool_calls") and token.tool_calls:
                    for tc in token.tool_calls:
                        tool_calls_seen.add(tc["name"])

        # If we got a final_response, the graph completed normally
        if final_response:
            break

        # Otherwise the graph was interrupted at approval_gate. Auto-approve and resume.
        graph_input = Command(resume={"action": "approve"})

    # Count genuine replanner rewrites: the head of current plan no longer
    # matches what we'd expect from a simple pop-from-front of the previous.
    replan_count = 0
    for i in range(1, len(plan_snapshots)):
        prev = plan_snapshots[i - 1]
        curr = plan_snapshots[i]
        if not prev:
            continue
        # Expected continuation would be prev[1:]; anything else means replanner changed it.
        if curr != prev[1:]:
            replan_count += 1

    return {
        "text": final_response,
        "plan": initial_plan,
        "past_steps": past_steps,
        "final_response": final_response,
        "replan_count": replan_count,
        "tool_calls": sorted(tool_calls_seen),
    }
