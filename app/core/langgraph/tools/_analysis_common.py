"""Shared helpers for analysis tools (match/gap/interview)."""

from pathlib import Path

from langchain_deepseek import ChatDeepSeek

from app.core.config import settings
from app.models.application import Application
from app.services.database import database_service
from app.services.job_service import job_service

_PROMPTS_DIR = Path(__file__).resolve().parent.parent.parent / "prompts"


def structured_llm(schema):
    """Build a fresh ChatDeepSeek bound to structured-output schema.

    llm_service.get_llm() is already bind_tools'd by the chat agent, so
    with_structured_output on top conflicts. Use this fresh instance instead.
    """
    fresh = ChatDeepSeek(
        model="deepseek-chat",
        api_key=settings.DEEPSEEK_API_KEY,
        temperature=settings.DEFAULT_LLM_TEMPERATURE,
    )
    return fresh.with_structured_output(schema)


def load_prompt(name: str) -> str:
    """Load a prompt markdown file from app/core/prompts/."""
    return (_PROMPTS_DIR / name).read_text(encoding="utf-8")


async def load_jd_and_resume(
    user_id: int, application_id: int
) -> tuple[Application, str]:
    """Load the target application + user resume text.

    Raises ValueError if the application is missing or resume is blank.
    Returns (application, resume_text).
    """
    app = await job_service.get_application_for_user(user_id, application_id)
    if not app:
        raise ValueError(
            f"application {application_id} not found or not owned by user {user_id}"
        )

    user = await database_service.get_user(user_id)
    if not user or not user.resume_text or not user.resume_text.strip():
        raise ValueError(
            "user has not saved a resume yet — ask them to paste it in Settings → Resume first"
        )

    return app, user.resume_text
