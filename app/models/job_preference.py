"""Job preference model for storing user's job search criteria."""

from datetime import UTC, datetime
from typing import Optional

from sqlmodel import Field, UniqueConstraint

from app.models.base import BaseModel


class JobPreference(BaseModel, table=True):
    """Stores a user's daily job search criteria.

    Attributes:
        id: Primary key
        user_id: FK to User.id (int)
        keywords: Job title / skill keywords
        location: Target location (city or 'remote')
        job_type: fulltime / remote / contract
        updated_at: Last updated timestamp
    """

    __tablename__ = "job_preferences"
    __table_args__ = (UniqueConstraint("user_id", name="uq_job_preferences_user_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    keywords: str
    location: str
    job_type: str = Field(default="fulltime")
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
