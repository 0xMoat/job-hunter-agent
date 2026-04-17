"""Meta-tool: hand the conversation off to the Plan-Execute agent.

The ReAct chat agent calls this tool when the user's request is obviously
multi-step (e.g. "研究这 5 家公司并为每家针对性润色简历"). We set
`return_direct=True` so the ReAct loop terminates as soon as this tool
returns — the returned JSON marker is streamed out via the existing
`tool_result` SSE event, and the frontend detects it to start a PE run.
"""

import json

from langchain_core.tools import tool

from app.core.logging import logger

HANDOFF_MARKER_KEY = "__plan_execute_handoff__"


@tool(return_direct=True)
async def start_plan_execute(goal: str, reason: str) -> str:
    """Hand the current turn off to the Plan-and-Execute agent.

    Call this tool ONLY when the user's request clearly requires multiple
    sequential sub-tasks that depend on each other (e.g. research several
    companies AND tailor a resume per company AND update the kanban).

    DO NOT call for single-step tool work (one job search, one company
    research, one resume tailor). Those run faster directly via the chat
    agent without the planning overhead.

    Args:
        goal: A self-contained one-sentence restatement of the user's
            intent, in the user's language. The PE planner will use this
            as its top-level objective.
        reason: Short justification for why PE is needed, in the
            conversation's language (logged only; not shown to user).

    Returns:
        JSON string carrying a handoff marker + goal; the frontend
        reroutes to the PE stream on receipt.
    """
    logger.info("start_plan_execute_handoff", goal=goal, reason=reason)
    return json.dumps(
        {HANDOFF_MARKER_KEY: True, "goal": goal, "reason": reason},
        ensure_ascii=False,
    )
