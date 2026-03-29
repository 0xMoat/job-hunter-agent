"""SearchConfig model — per-user job search configuration."""

from datetime import UTC, datetime
from typing import Optional

from sqlmodel import Field, SQLModel, UniqueConstraint


class SearchConfig(SQLModel, table=True):
    """Stores per-user job search configuration: target sites and schedule."""

    __tablename__ = "search_configs"
    __table_args__ = (UniqueConstraint("user_id", name="uq_search_configs_user_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    target_sites: str = Field(default="")
    schedule_enabled: bool = Field(default=False)
    schedule_cron: str = Field(default="0 9 * * *")
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
