"""Cover letter tool — generates personalized cover letters using user profile from memory."""

from typing import Annotated

from langchain_core.messages import HumanMessage
from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from app.core.logging import logger
from app.services.llm import llm_service


@tool
async def cover_letter_tool(
    job_title: str,
    company: str,
    job_description: str,
    tone: str = "professional",
    long_term_memory: Annotated[str, InjectedState("long_term_memory")] = "",
) -> str:
    """Generate a personalized cover letter or cold email for a job application.

    Use this when the user asks to write a cover letter, application email, or
    outreach message for a specific position.

    Args:
        job_title: The job title being applied for
        company: The company name
        job_description: Key requirements or description from the job posting
        tone: Writing style — "professional", "casual", or "formal". Defaults to "professional".
        long_term_memory: User profile from long-term memory, injected from graph state.

    Returns:
        A structured cover letter with subject line and body.
    """
    user_profile = long_term_memory or "No user profile available yet."

    prompt = f"""Write a {tone} cover letter for the following job.

Job Title: {job_title}
Company: {company}
Job Description: {job_description}

User Profile (use this to personalize):
{user_profile}

Format your response as:
**Subject:** <email subject line>

**Body:**
<cover letter body>

**Key Highlights:**
- <highlight 1>
- <highlight 2>
- <highlight 3>

Keep it concise (under 300 words). Focus on matching the user's actual experience to the job requirements."""

    logger.info("cover_letter_generation_started", job_title=job_title, company=company)
    try:
        response = await llm_service.call([HumanMessage(content=prompt)])
        logger.info("cover_letter_generated", job_title=job_title, company=company)
        return response.content if hasattr(response, "content") else str(response)
    except Exception as e:
        logger.exception("cover_letter_generation_failed", job_title=job_title, error=str(e))
        return f"Failed to generate cover letter: {str(e)}"
