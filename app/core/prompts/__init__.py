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
    """Load the Plan-and-Execute replanner system prompt."""
    with open(os.path.join(os.path.dirname(__file__), "plan_execute_replanner.md"), "r") as f:
        return f.read().format(**kwargs)
