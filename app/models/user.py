"""User model for the application."""

from datetime import datetime
from typing import (
    TYPE_CHECKING,
    List,
    Optional,
)

from sqlmodel import (
    Field,
    Relationship,
)

from app.models.base import BaseModel

if TYPE_CHECKING:
    from app.models.session import Session


class User(BaseModel, table=True):
    """User model for storing user accounts via Google OAuth.

    Attributes:
        id: The primary key
        google_id: Google account unique identifier (sub claim)
        email: User's email from Google
        name: User's display name from Google
        avatar_url: User's profile picture URL from Google
        system_prompt: Custom system prompt override (None = use default)
        resume_text: User's resume text
        sessions: Relationship to user's chat sessions
    """

    id: int = Field(default=None, primary_key=True)
    google_id: str = Field(unique=True, index=True)
    email: str = Field(index=True)
    name: str = Field(default="")
    avatar_url: str = Field(default="")
    system_prompt: Optional[str] = Field(default=None)
    resume_text: Optional[str] = Field(default=None)
    resume_is_default: bool = Field(default=False)
    tutorial_completed_at: Optional[datetime] = Field(default=None)
    sessions: List["Session"] = Relationship(back_populates="user")


# Avoid circular imports
from app.models.session import Session  # noqa: E402
