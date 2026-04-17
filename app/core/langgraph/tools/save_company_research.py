"""Tool for saving company research results onto a kanban card."""

from langchain_core.runnables.config import RunnableConfig
from langchain_core.tools import tool

from app.core.logging import logger
from app.services.job_service import job_service


@tool
async def save_company_research(
    application_id: int,
    content: str,
    config: RunnableConfig,
) -> str:
    """Persist a company background research result onto a kanban JD card.

    Call this AFTER company_research_tool returns, so the user can see the
    research content in the kanban card detail view.

    Args:
        application_id: The target card's id. Must belong to the current user.
        content: The research content — typically the JSON output from
            company_research_tool, or a Markdown summary. Stored as-is.
        config: LangGraph runnable config (injected automatically by the runtime).

    Returns:
        Confirmation message, or an error if the card was not found.
    """
    user_id = config.get("configurable", {}).get("user_id")
    if not user_id:
        logger.warning("save_company_research_missing_user_id")
        return "Error: user_id not found in execution config."

    ok = await job_service.update_application_artifacts(
        user_id=user_id,
        application_id=application_id,
        updates={"company_research_json": content},
    )
    if not ok:
        return f"Error: application {application_id} not found or not owned by current user."
    logger.info("company_research_saved", user_id=user_id, application_id=application_id)
    return f"Saved company research to application {application_id}."
