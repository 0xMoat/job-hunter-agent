"""Job listing model for storing daily search results."""

from datetime import UTC, date, datetime
from typing import Optional

from sqlmodel import Field, UniqueConstraint

from app.models.base import BaseModel


class JobListing(BaseModel, table=True):
    """Stores a job listing found by the daily scheduler.

    Attributes:
        id: Primary key
        user_id: FK to User.id (int)
        title: Job title
        company: Company name
        location: Job location
        url: Source URL (composite unique with user_id)
        snippet: Short description from search result
        found_date: Date scheduler found this listing
        is_read: Whether the user has viewed this listing
    """

    __tablename__ = "job_listings"
    __table_args__ = (UniqueConstraint("user_id", "url", name="uq_job_listings_user_url"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    title: str
    company: str = Field(default="")
    location: str = Field(default="")
    url: str
    snippet: str = Field(default="")
    found_date: date = Field(default_factory=lambda: datetime.now(UTC).date())
    is_read: bool = Field(default=False)
