"""This file contains the prompts for the agent."""

import os
from datetime import datetime

from app.core.config import settings


def load_system_prompt(**kwargs):
    """Load the system prompt from the file."""
    with open(os.path.join(os.path.dirname(__file__), "system.md"), "r") as f:
        return f.read().format(
            agent_name=settings.PROJECT_NAME + " Agent",
            current_date_and_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            **kwargs,
        )


def load_fact_extraction_prompt():
    """Load the fact extraction prompt from the file."""
    with open(os.path.join(os.path.dirname(__file__), "fact_extraction.md"), "r") as f:
        return f.read()


def load_plan_execute_planner_prompt(**kwargs) -> str:
    """Load the Plan-and-Execute planner system prompt."""
    with open(os.path.join(os.path.dirname(__file__), "plan_execute_planner.md"), "r") as f:
        return f.read().format(
            current_date_and_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            **kwargs,
        )


def load_plan_execute_replanner_prompt(**kwargs) -> str:
    """Load the Plan-and-Execute replanner system prompt.

    If ``user_feedback`` is provided and non-empty, a dedicated section is
    inserted so the LLM treats it as authoritative guidance. Otherwise the
    placeholder resolves to an empty string.
    """
    user_feedback = kwargs.pop("user_feedback", None)
    if user_feedback:
        kwargs["user_feedback_section"] = (
            "\n\n## 用户反馈（修订意见，请优先据此调整）\n" + user_feedback
        )
    else:
        kwargs["user_feedback_section"] = ""
    with open(os.path.join(os.path.dirname(__file__), "plan_execute_replanner.md"), "r") as f:
        return f.read().format(**kwargs)
