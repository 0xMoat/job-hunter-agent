"""Tool for saving a tailored resume (Markdown) onto a kanban card."""

from langchain_core.runnables.config import RunnableConfig
from langchain_core.tools import tool

from app.core.logging import logger
from app.services.job_service import job_service


@tool
async def save_tailored_resume(
    application_id: int,
    content: str,
    config: RunnableConfig,
) -> str:
    """Persist the tailored resume (Markdown text) onto a kanban JD card.

    Call this AFTER the Resume Studio skill has produced a tailored resume
    and the user has agreed with / finalized the content. Stores the full
    Markdown text so the user can review it from the kanban card detail.

    Args:
        application_id: The target card's id. Must belong to the current user.
        content: The full tailored resume text in Markdown format.
        config: LangGraph runnable config (injected automatically by the runtime).

    Returns:
        Confirmation message, or an error if the card was not found.
    """
    user_id = config.get("configurable", {}).get("user_id")
    if not user_id:
        logger.warning("save_tailored_resume_missing_user_id")
        return "Error: user_id not found in execution config."

    ok = await job_service.update_application_artifacts(
        user_id=user_id,
        application_id=application_id,
        updates={"tailored_resume_text": content},
    )
    if not ok:
        return f"Error: application {application_id} not found or not owned by current user."
    logger.info("tailored_resume_saved", user_id=user_id, application_id=application_id)
    return f"Saved tailored resume to application {application_id}."
