"""Resume Studio tool — loads the progressive disclosure skill for resume tailoring."""

import os
from langchain_core.tools import tool
from langchain_core.runnables.config import RunnableConfig

from app.core.logging import logger
from app.services.database import DatabaseService


@tool
async def trigger_resume_studio_skill(config: RunnableConfig) -> str:
    """Trigger the Resume Studio skill to tailor and polish the user's resume for a specific job description.

    Call this tool ONLY when the user explicitly agrees or asks to tailor/polish their resume for a job description.
    Do NOT call this tool if the user just wants to see the job description.

    Returns:
        Instructions and context for the AI to become a Resume Expert, OR a guiding message if the user's resume is missing.
    """
    user_id = config.get("configurable", {}).get("user_id")
    if not user_id:
        return "Error: user_id not found in execution config."

    db_service = DatabaseService()
    user = await db_service.get_user(user_id)

    # Progressive disclosure interception: check if resume_text exists
    if not user or not user.resume_text or not user.resume_text.strip():
        logger.info("resume_studio_skill_missing_resume", user_id=user_id)
        return (
            "System Instruction: The user has NOT provided their resume text yet. "
            "You MUST reply to the user telling them to go to '设置 -> 简历' (Settings -> Resume) "
            "to paste their resume text and save it. Ask them to let you know when they are done so you can continue."
        )

    # Resolve absolute path to the skill markdown safely
    root_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
    skill_path = os.path.join(root_dir, ".agents", "skills", "resume-studio", "SKILL.md")

    try:
        with open(skill_path, "r", encoding="utf-8") as f:
            skill_content = f.read()
    except Exception as e:
        logger.exception("failed_to_load_resume_studio_skill", user_id=user_id, error=str(e), path=skill_path)
        return f"Error loading Resume Studio skill file: {e}"

    logger.info("resume_studio_skill_loaded", user_id=user_id)
    
    return f"""===== USER'S BASE RESUME =====
{user.resume_text}
===== END USER'S RESUME =====

===== RESUME STUDIO SKILL INSTRUCTIONS =====
{skill_content}
"""
