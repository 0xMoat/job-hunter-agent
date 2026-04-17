"""Tool for generating likely interview questions for a JD."""

import json

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


class _Question(BaseModel):
    question: str = Field(description="中文面试题目")
    focus: str = Field(description="一句话考察点")


class _Questions(BaseModel):
    questions: list[_Question] = Field(min_length=8, max_length=12)


@tool
async def generate_interview_questions(application_id: int, config: RunnableConfig) -> str:
    """Generate 8-12 likely interview questions tailored to a JD + resume.

    Call when the user asks "这个岗位面试可能会问什么" or "帮我准备面试题".

    Args:
        application_id: Target kanban card id.
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
    prompt = load_prompt("interview_questions.md").format(jd=jd_text, resume=resume_text)

    try:
        result: _Questions = await structured_llm(_Questions).ainvoke(prompt)
    except Exception as e:
        logger.exception("interview_questions_llm_failed", application_id=application_id)
        return f"Error: LLM call failed — {e}"

    questions_json = json.dumps(
        [q.model_dump() for q in result.questions],
        ensure_ascii=False,
    )

    ok = await job_service.update_application_artifacts(
        user_id=user_id,
        application_id=application_id,
        updates={"interview_questions_json": questions_json},
    )
    if not ok:
        return f"Error: application {application_id} disappeared before write."

    logger.info(
        "interview_questions_generated",
        user_id=user_id,
        application_id=application_id,
        count=len(result.questions),
    )
    return (
        f"Generated {len(result.questions)} interview questions for application {application_id}. "
        f"Saved to card."
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
