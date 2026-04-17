"""Tool for analyzing skill/knowledge gaps between candidate resume and JD."""

from langchain_core.runnables.config import RunnableConfig
from langchain_core.tools import tool
from langchain_deepseek import ChatDeepSeek

from app.core.config import settings
from app.core.langgraph.tools._analysis_common import (
    load_jd_and_resume,
    load_prompt,
)
from app.core.logging import logger
from app.services.job_service import job_service


@tool
async def analyze_jd_gap(application_id: int, config: RunnableConfig) -> str:
    """Produce a short Markdown list of 3-5 skill/knowledge gaps for a JD card.

    Call when the user asks "我离这个岗位还差什么" or similar.

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
    prompt = load_prompt("gap_analysis.md").format(jd=jd_text, resume=resume_text)

    try:
        fresh = ChatDeepSeek(
            model="deepseek-chat",
            api_key=settings.DEEPSEEK_API_KEY,
            temperature=settings.DEFAULT_LLM_TEMPERATURE,
        )
        response = await fresh.ainvoke(prompt)
        markdown = response.content if hasattr(response, "content") else str(response)
    except Exception as e:
        logger.exception("analyze_jd_gap_llm_failed", application_id=application_id)
        return f"Error: LLM call failed — {e}"

    ok = await job_service.update_application_artifacts(
        user_id=user_id,
        application_id=application_id,
        updates={"gap_analysis_text": markdown},
    )
    if not ok:
        return f"Error: application {application_id} disappeared before write."

    logger.info("jd_gap_analyzed", user_id=user_id, application_id=application_id)
    return f"Gap analysis saved to application {application_id}.\n\n{markdown}"


def _build_jd_text(app) -> str:
    parts = [f"Company: {app.company}", f"Title: {app.title}"]
    if app.snippet:
        parts.append(f"JD snippet:\n{app.snippet}")
    if app.url:
        parts.append(f"URL: {app.url}")
    if app.notes:
        parts.append(f"Notes: {app.notes}")
    return "\n\n".join(parts)
