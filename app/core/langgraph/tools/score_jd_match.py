"""Tool for scoring candidate-JD match across 4 weighted dimensions."""

from langchain_core.runnables.config import RunnableConfig
from langchain_core.tools import tool
from pydantic import BaseModel, Field

from app.core.langgraph.tools._analysis_common import (
    load_jd_and_resume,
    load_prompt,
    structured_llm,
)
from app.core.logging import logger
from app.services.job_service import job_service


class _Dim(BaseModel):
    score: int = Field(ge=0, le=10, description="0-10 integer score")
    reason: str = Field(description="short one-sentence justification in Chinese")


class _Breakdown(BaseModel):
    skills: _Dim
    experience: _Dim
    domain: _Dim
    soft: _Dim


_WEIGHTS = {"skills": 0.4, "experience": 0.25, "domain": 0.2, "soft": 0.15}


@tool
async def score_jd_match(application_id: int, config: RunnableConfig) -> str:
    """Score how well the user's resume matches a JD card (0-100 total, 4 dims).

    Call when the user asks "我和这个岗位的匹配度是多少", or when the
    Plan-Execute agent is building a profile for a target card.

    Args:
        application_id: Target kanban card id. JD/company/title are read from it,
            and the user's resume is read from their profile.
        config: LangGraph runnable config (injected automatically by the runtime).
    """
    user_id = config.get("configurable", {}).get("user_id")
    if not user_id:
        return "Error: user_id not found in execution config."

    try:
        app, resume_text = await load_jd_and_resume(user_id, application_id)
    except ValueError as e:
        return f"Error: {e}"

    jd_text = _build_jd_text(app)
    prompt = load_prompt("match_scoring.md").format(jd=jd_text, resume=resume_text)

    try:
        result: _Breakdown = await structured_llm(_Breakdown).ainvoke(prompt)
    except Exception as e:
        logger.exception("score_jd_match_llm_failed", application_id=application_id)
        return f"Error: LLM call failed — {e}"

    total = round(
        result.skills.score * 10 * _WEIGHTS["skills"]
        + result.experience.score * 10 * _WEIGHTS["experience"]
        + result.domain.score * 10 * _WEIGHTS["domain"]
        + result.soft.score * 10 * _WEIGHTS["soft"]
    )
    breakdown_json = result.model_dump_json()

    ok = await job_service.update_application_artifacts(
        user_id=user_id,
        application_id=application_id,
        updates={"match_score": total, "match_breakdown": breakdown_json},
    )
    if not ok:
        return f"Error: application {application_id} disappeared before write."

    logger.info(
        "jd_match_scored",
        user_id=user_id,
        application_id=application_id,
        total=total,
    )
    return (
        f"Match score for application {application_id}: {total}/100. "
        f"Breakdown: {breakdown_json}"
    )


def _build_jd_text(app) -> str:
    parts = [f"Company: {app.company}", f"Title: {app.title}"]
    if app.snippet:
        parts.append(f"JD snippet:\n{app.snippet}")
    if app.url:
        parts.append(f"URL: {app.url}")
    if app.notes:
        parts.append(f"Notes: {app.notes}")
    return "\n\n".join(parts)
