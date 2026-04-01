"""Authentication schemas for the application."""

import re
from datetime import datetime
from typing import Optional

from pydantic import (
    BaseModel,
    Field,
)


class Token(BaseModel):
    """Token model for authentication."""

    access_token: str = Field(..., description="The JWT access token")
    token_type: str = Field(default="bearer", description="The type of token")
    expires_at: datetime = Field(..., description="The token expiration timestamp")


class GoogleLoginRequest(BaseModel):
    """Request model for Google OAuth login."""

    credential: str = Field(..., description="Google ID token JWT from frontend")


class GoogleLoginUser(BaseModel):
    """User info returned after Google login."""

    id: int
    email: str
    name: str
    avatar_url: str


class GoogleLoginResponse(BaseModel):
    """Response model for Google OAuth login."""

    user: GoogleLoginUser
    token: Token


class SessionResponse(BaseModel):
    """Response model for session creation."""

    session_id: str = Field(..., description="The unique identifier for the chat session")
    name: str = Field(default="", description="Name of the session", max_length=100)
    token: Token = Field(..., description="The authentication token for the session")
    created_at: Optional[datetime] = Field(default=None, description="When the session was created")

    @classmethod
    def sanitize_name(cls, v: str) -> str:
        """Sanitize the session name."""
        sanitized = re.sub(r'[<>{}[\]()\'"`]', "", v)
        return sanitized
