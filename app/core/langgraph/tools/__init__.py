"""LangGraph tools for the job-hunting agent."""

from langchain_core.tools.base import BaseTool

from .analyze_jd_gap import analyze_jd_gap
from .application_tracker import application_tracker_tool
from .company_research import company_research_tool
from .duckduckgo_search import duckduckgo_search_tool
from .generate_interview_questions import generate_interview_questions
from .job_preferences import job_preferences_tool
from .job_search import job_search_tool
from .resume_pdf import generate_resume_pdf
from .resume_studio import trigger_resume_studio_skill
from .save_company_research import save_company_research
from .save_tailored_resume import save_tailored_resume
from .score_jd_match import score_jd_match
from .start_plan_execute import start_plan_execute

tools: list[BaseTool] = [
    job_search_tool,
    company_research_tool,
    application_tracker_tool,
    job_preferences_tool,
    duckduckgo_search_tool,
    trigger_resume_studio_skill,
    generate_resume_pdf,
    save_company_research,
    save_tailored_resume,
    start_plan_execute,
    score_jd_match,
    analyze_jd_gap,
    generate_interview_questions,
]
