"""LangGraph tool for generating tailored resume PDFs."""

import json

from langchain_core.runnables.config import RunnableConfig
from langchain_core.tools import tool

from app.core.logging import logger
from app.schemas.resume import ResumeData
from app.services.resume_pdf_service import ResumePDFService

_pdf_service = ResumePDFService()


def _normalize_resume_data(data: dict) -> dict:
    """Normalize common LLM field-name variations before Pydantic validation.

    LLMs don't always follow the exact schema — they use synonyms like
    "category" for "domain", "period" for "dates", plain strings for skill items, etc.
    This function maps those variations to the canonical field names.
    """
    # Top-level aliases
    for alias, canonical in [("focus", "current_focus"), ("title", "current_focus")]:
        if canonical not in data and alias in data:
            data[canonical] = data.pop(alias)

    # Skills: category → domain, string items → {name, accent} objects
    for skill in data.get("skills", []):
        if "category" in skill and "domain" not in skill:
            skill["domain"] = skill.pop("category")
        if "items" in skill:
            skill["items"] = [
                {"name": item, "accent": False} if isinstance(item, str) else item
                for item in skill["items"]
            ]

    # Education: period → dates
    for edu in data.get("education", []):
        if "period" in edu and "dates" not in edu:
            edu["dates"] = edu.pop("period")

    # Projects: highlights → points, subtitle → status
    for proj in data.get("projects", []):
        if "highlights" in proj and "points" not in proj:
            proj["points"] = proj.pop("highlights")
        if "subtitle" in proj and "status" not in proj:
            proj["status"] = proj.pop("subtitle")

    # Experience: period → dates, position/title → role, projects → sub_projects
    for exp in data.get("experience", []):
        if "period" in exp and "dates" not in exp:
            exp["dates"] = exp.pop("period")
        for alias in ("position", "title", "job_title"):
            if alias in exp and "role" not in exp:
                exp["role"] = exp.pop(alias)
                break
        for alias in ("projects", "subprojects", "subProjects"):
            if alias in exp and "sub_projects" not in exp:
                exp["sub_projects"] = exp.pop(alias)
                break

    return data


@tool
async def generate_resume_pdf(resume_json: str | dict, config: RunnableConfig) -> str:
    """Generate a tailored resume PDF from structured JSON data.

    Call this tool ONLY after you have produced the complete structured JSON resume
    following the schema specified in the Resume Studio skill instructions.
    Pass the JSON as resume_json.

    Args:
        resume_json: Resume data as a JSON string or dict.
        config: LangGraph runnable config (injected automatically).

    Returns:
        A message containing the download URL for the generated PDF.
    """
    logger.info("resume_pdf_tool_started")

    try:
        raw = resume_json if isinstance(resume_json, dict) else json.loads(resume_json)
        normalized = _normalize_resume_data(raw)
        data = ResumeData.model_validate(normalized)
        logger.info("resume_pdf_json_validated")
    except Exception as e:
        logger.warning("resume_pdf_invalid_json", error=str(e))
        return f"Error: Invalid resume JSON. Please check the schema and try again. Details: {e}"

    try:
        logger.info("resume_pdf_rendering_started")
        download_url = _pdf_service.generate(data)
    except Exception as e:
        logger.exception("resume_pdf_generation_failed")
        return f"Error: Failed to generate PDF. Details: {e}"

    user_id = config.get("configurable", {}).get("user_id")
    logger.info("resume_pdf_tool_success", user_id=user_id)

    return (
        f"Resume PDF generated successfully!\n"
        f"Download link: {download_url}\n"
        f"This link expires in 10 minutes."
    )
