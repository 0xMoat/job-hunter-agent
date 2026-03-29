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
