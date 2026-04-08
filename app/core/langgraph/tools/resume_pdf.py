"""LangGraph tool for generating tailored resume PDFs."""

from langchain_core.runnables.config import RunnableConfig
from langchain_core.tools import tool

from app.core.logging import logger
from app.schemas.resume import ResumeData
from app.services.resume_pdf_service import ResumePDFService

_pdf_service = ResumePDFService()


@tool
async def generate_resume_pdf(resume_json: str, config: RunnableConfig) -> str:
    """Generate a tailored resume PDF from structured JSON data.

    Call this tool ONLY after you have produced the complete structured JSON resume
    following the schema specified in the Resume Studio skill instructions.
    Pass the full JSON string as resume_json.

    Args:
        resume_json: A JSON string conforming to the resume data schema.

    Returns:
        A message containing the download URL for the generated PDF.
    """
    try:
        data = ResumeData.model_validate_json(resume_json)
    except Exception as e:
        logger.warning("resume_pdf_invalid_json", error=str(e))
        return f"Error: Invalid resume JSON. Please check the schema and try again. Details: {e}"

    try:
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
