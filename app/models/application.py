"""Application model for tracking job applications."""

from datetime import UTC, date, datetime
from typing import Optional

from sqlmodel import Field

from app.models.base import BaseModel


class Application(BaseModel, table=True):
    """Tracks a job application or discovered listing for the user.

    Status flow: pending → applied → interviewing → completed | not_a_match

    Attributes:
        id: Primary key
        user_id: FK to User.id (int)
        company: Company name
        title: Job title
        url: Job posting URL
        status: pending / applied / interviewing / completed / not_a_match
        applied_date: Date of application (null for pending cards)
        notes: Free-form notes
        snippet: JD summary snippet (from scheduler search results)
        found_date: Date scheduler found this listing (null for manual cards)
        source: "scheduler" or "manual"
        archived_at: Set when card is auto-archived; null = active
        updated_at: Last update timestamp
        company_research_json: JSON string from company_research_tool output
        tailored_resume_text: Polished resume full text (Markdown)
        pdf_token: PDF tracking token (max 64 chars; URL signed on read)
        pdf_created_at: Timestamp PDF was created (for retention tracking)
        match_breakdown: JSON breakdown of match score (skills/experience/domain/soft)
        gap_analysis_text: Gap analysis (Markdown)
        interview_questions_json: JSON array of {question, focus} objects
        artifacts_updated_at: Timestamp of last artifact write (distinct from updated_at)
    """

    __tablename__ = "applications"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    company: str
    title: str
    url: Optional[str] = Field(default=None)
    status: str = Field(default="pending")
    applied_date: Optional[date] = Field(default=None)
    notes: Optional[str] = Field(default=None)
    snippet: Optional[str] = Field(default=None)
    match_score: Optional[int] = Field(default=None, ge=0, le=100)
    found_date: Optional[date] = Field(default=None)
    source: str = Field(default="manual")
    archived_at: Optional[datetime] = Field(default=None)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
    # Artifact fields — written by Plan-Execute agent tools
    company_research_json: Optional[str] = Field(default=None)
    tailored_resume_text: Optional[str] = Field(default=None)
    pdf_token: Optional[str] = Field(default=None, max_length=64)
    pdf_created_at: Optional[datetime] = Field(default=None)
    match_breakdown: Optional[str] = Field(default=None)
    gap_analysis_text: Optional[str] = Field(default=None)
    interview_questions_json: Optional[str] = Field(default=None)
    artifacts_updated_at: Optional[datetime] = Field(default=None)
