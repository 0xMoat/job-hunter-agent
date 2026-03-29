"""LLM-based job-resume match scoring (0–100)."""

import json
from typing import Optional

from langchain_core.messages import HumanMessage, SystemMessage

from app.core.logging import logger
from app.services.llm import LLMService

_SYSTEM_PROMPT = (
    "You are a job-resume matching expert. "
    "Given a job listing and a resume, output ONLY a JSON object: {\"score\": N} "
    "where N is an integer from 0 to 100. "
    "100 means perfect match, 0 means completely irrelevant. "
    "Output only the JSON object, no markdown, no explanation."
)


async def score_job(
    job_title: str,
    snippet: str,
    resume_text: str,
    llm: LLMService,
) -> Optional[int]:
    """Score how well a job listing matches the user's resume.

    Args:
        job_title: Job title from search result.
        snippet: Short job description snippet.
        resume_text: User's plain-text resume.
        llm: LLMService instance owned by the caller (one per batch, not per call).

    Returns:
        Integer score 0–100, or None if scoring fails (non-blocking).
    """
    user_content = (
        f"Job Title: {job_title}\n"
        f"Job Description: {snippet}\n\n"
        f"Resume:\n{resume_text[:3000]}"
    )
    try:
        messages = [
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=user_content),
        ]
        response = await llm.call(messages)
        text = response.content.strip()
        # Strip markdown code fences if the model wraps the JSON
        if text.startswith("```"):
            parts = text.split("```")
            text = parts[1].lstrip("json").strip() if len(parts) > 1 else text
        data = json.loads(text)
        score = int(data["score"])
        return max(0, min(100, score))
    except Exception as e:
        logger.warning("job_scoring_failed", job_title=job_title, error=str(e))
        return None
