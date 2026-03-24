"""Application model for tracking job applications."""

from datetime import UTC, date, datetime
from typing import Optional

from sqlmodel import Field

from app.models.base import BaseModel


class Application(BaseModel, table=True):
    """Tracks a job application submitted by the user.

    Attributes:
        id: Primary key
        user_id: FK to User.id (int)
        company: Company name
        title: Job title
        url: Job posting URL
        status: applied / interviewing / rejected / offer
        applied_date: Date of application
        notes: Free-form notes
        updated_at: Last update timestamp
    """

    __tablename__ = "applications"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    company: str
    title: str
    url: Optional[str] = Field(default=None)
    status: str = Field(default="applied")
    applied_date: date = Field(default_factory=lambda: datetime.now(UTC).date())
    notes: Optional[str] = Field(default=None)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
