"""Job preferences tool — saves user's daily job search criteria."""

from typing import Annotated

from langchain_core.tools import InjectedToolArg, tool
from langgraph.types import RunnableConfig

from app.core.logging import logger
from app.services.job_service import job_service


@tool
async def job_preferences_tool(
    keywords: str,
    location: str,
    job_type: str = "fulltime",
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Save the user's job search preferences for daily automated search.

    Use this when the user tells you what kind of jobs to search for daily,
    or asks to update their job search settings.

    Args:
        keywords: Job title or skills, e.g. "agent engineer", "fullstack python"
        location: Target location, e.g. "上海", "remote", "Beijing"
        job_type: One of: fulltime, remote, contract. Defaults to fulltime.
        config: LangGraph RunnableConfig injected by framework (excluded from LLM schema)

    Returns:
        Confirmation that preferences were saved.
    """
    user_id = (config or {}).get("configurable", {}).get("user_id")
    if not user_id:
        return "Error: user_id not available. Cannot save preferences."

    await job_service.upsert_preference(user_id, keywords, location, job_type)
    logger.info("job_preferences_saved", user_id=user_id, keywords=keywords, location=location)
    return (
        f"✅ Daily search configured: '{keywords}' in '{location}' ({job_type}). "
        f"The scheduler will search every day at 08:00."
    )
