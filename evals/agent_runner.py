"""Lightweight agent runner for offline evaluation.

Calls the LLM with the production system prompt and tool schemas
(without executing tools) to generate responses for golden dataset items.
"""

import asyncio
import os
import sys
from datetime import datetime

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_deepseek import ChatDeepSeek

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.core.config import settings
from app.core.langgraph.tools import tools


def _load_system_prompt() -> str:
    """Load the system prompt template with empty dynamic fields."""
    prompts_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "app", "core", "prompts",
    )
    with open(os.path.join(prompts_dir, "system.md"), "r") as f:
        return f.read().format(
            agent_name=settings.PROJECT_NAME + " Agent",
            long_term_memory="No prior information about this user.",
            pending_applications="No pending applications.",
            current_date_and_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        )


def _create_llm():
    """Create a ChatDeepSeek instance with tool schemas bound."""
    llm = ChatDeepSeek(
        model=settings.DEFAULT_LLM_MODEL,
        api_key=settings.DEEPSEEK_API_KEY,
        temperature=settings.DEFAULT_LLM_TEMPERATURE,
    )
    return llm.bind_tools(tools)


_system_prompt = None
_llm = None


def _get_system_prompt():
    global _system_prompt
    if _system_prompt is None:
        _system_prompt = _load_system_prompt()
    return _system_prompt


def _get_llm():
    global _llm
    if _llm is None:
        _llm = _create_llm()
    return _llm


async def agent_task(*, item, **kwargs):
    """Task function for Langfuse run_experiment.

    Takes a dataset item, calls the LLM with system prompt + tools,
    returns structured output with text and tool_calls.

    Args:
        item: DatasetItemClient (from Langfuse) or dict with "input" key.

    Returns:
        Dict with "text" (response content) and "tool_calls" (list of tool names).
    """
    # DatasetItemClient uses attribute access; plain dicts use subscript
    raw_input = item.input if hasattr(item, "input") else item
    user_input = raw_input["input"]
    messages = [
        SystemMessage(content=_get_system_prompt()),
        HumanMessage(content=user_input),
    ]
    response = await _get_llm().ainvoke(messages)
    tool_calls = [tc["name"] for tc in response.tool_calls] if response.tool_calls else []
    text = response.content or ""
    return {"text": text, "tool_calls": tool_calls}
