"""LangGraph tools for the job-hunting agent."""

from langchain_core.tools.base import BaseTool

from .application_tracker import application_tracker_tool
from .company_research import company_research_tool
from .cover_letter import cover_letter_tool
from .duckduckgo_search import duckduckgo_search_tool
from .job_preferences import job_preferences_tool
from .job_search import job_search_tool
from .resume_pdf import generate_resume_pdf
from .resume_studio import trigger_resume_studio_skill

tools: list[BaseTool] = [
    job_search_tool,
    company_research_tool,
    cover_letter_tool,
    application_tracker_tool,
    job_preferences_tool,
    duckduckgo_search_tool,
    trigger_resume_studio_skill,
    generate_resume_pdf,
]
