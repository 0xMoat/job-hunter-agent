"""Application tracker tool — records and queries the user's job applications."""

from typing import Annotated, Optional

from langchain_core.tools import InjectedToolArg, tool
from langgraph.types import RunnableConfig

from app.core.logging import logger
from app.services.job_service import job_service


@tool
async def application_tracker_tool(
    action: str,
    company: str = "",
    title: str = "",
    url: Optional[str] = None,
    status: Optional[str] = None,
    application_id: Optional[int] = None,
    notes: Optional[str] = None,
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Track job applications — add, update status, list, or delete records.

    ONLY call this tool when the user explicitly asks to record an application,
    update a status, or view their application list.
    Do NOT call this for general conversation or when the user has not mentioned
    a specific application action.

    Args:
        action: One of: "add", "list", "update", "delete"
        company: Company name (required for add)
        title: Job title (required for add)
        url: Job posting URL (optional for add)
        status: Application status for update: pending / applied / interviewing / completed / not_a_match
        application_id: Application ID (required for update/delete)
        notes: Free-form notes (optional)
        config: LangGraph RunnableConfig injected by framework (excluded from LLM schema)

    Returns:
        Confirmation message or formatted list of applications.
    """
    user_id = (config or {}).get("configurable", {}).get("user_id")
    if not user_id:
        return "Error: user_id not available. Cannot track application."

    logger.info("application_tracker_called", action=action, user_id=user_id)

    if action == "add":
        if not company or not title:
            return "Error: 'company' and 'title' are required to add an application."
        app = await job_service.add_application(user_id, company, title, url, notes)
        return f"✅ Recorded application to {company} ({title}). Application ID: {app.id}"

    elif action == "list":
        apps = await job_service.list_applications(user_id)
        if not apps:
            return "No applications recorded yet."
        lines = [
            f"- [{a.status.upper()}] {a.company} — {a.title} (ID: {a.id}, {a.applied_date})"
            for a in apps
        ]
        return "Your applications:\n" + "\n".join(lines)

    elif action == "update":
        if not application_id:
            return "Error: 'application_id' is required to update."
        updated = await job_service.update_application(application_id, user_id, status, notes)
        if not updated:
            return f"Application ID {application_id} not found."
        return f"✅ Updated application {application_id}: status={updated.status}"

    elif action == "delete":
        if not application_id:
            return "Error: 'application_id' is required to delete."
        deleted = await job_service.delete_application(application_id, user_id)
        return (
            f"✅ Deleted application {application_id}"
            if deleted
            else f"Application {application_id} not found."
        )

    return f"Unknown action: {action}. Use: add, list, update, delete."
