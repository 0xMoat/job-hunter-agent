"""User settings endpoints — system prompt management."""

import os
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.v1.auth import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.models.user import User
from app.services.database import DatabaseService

router = APIRouter()
db_service = DatabaseService()

_SYSTEM_MD_PATH = os.path.join(
    os.path.dirname(__file__), "..", "..", "core", "prompts", "system.md"
)
_ALLOWED_VARS = {"agent_name", "long_term_memory", "current_date_and_time"}
_REQUIRED_VARS = {"long_term_memory", "current_date_and_time"}


def _read_default_prompt() -> str:
    """Read system.md raw (no formatting)."""
    with open(_SYSTEM_MD_PATH, "r") as f:
        return f.read()


def _validate_prompt(prompt: str) -> Optional[str]:
    """Return an error string if prompt is invalid, else None."""
    found = set(re.findall(r"\{(\w+)\}", prompt))
    missing = _REQUIRED_VARS - found
    if missing:
        return f"Missing required variable(s): {', '.join('{' + v + '}' for v in sorted(missing))}"
    unknown = found - _ALLOWED_VARS
    if unknown:
        return (
            f"Unknown variable(s): {', '.join('{' + v + '}' for v in sorted(unknown))}. "
            f"Allowed: {', '.join('{' + v + '}' for v in sorted(_ALLOWED_VARS))}"
        )
    return None


class SystemPromptRequest(BaseModel):
    prompt: str = Field(..., max_length=10000)


class SystemPromptResponse(BaseModel):
    prompt: str
    is_default: bool


@router.get("/system-prompt", response_model=SystemPromptResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def get_system_prompt(
    request: Request,
    user: User = Depends(get_current_user),
):
    """Get the current user's system prompt."""
    if user.system_prompt is not None:
        return SystemPromptResponse(prompt=user.system_prompt, is_default=False)
    return SystemPromptResponse(prompt=_read_default_prompt(), is_default=True)


@router.put("/system-prompt", response_model=SystemPromptResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def save_system_prompt(
    request: Request,
    body: SystemPromptRequest,
    user: User = Depends(get_current_user),
):
    """Save a custom system prompt for the current user."""
    error = _validate_prompt(body.prompt)
    if error:
        raise HTTPException(status_code=422, detail=error)
    updated = await db_service.update_user_system_prompt(user.id, body.prompt)
    logger.info("system_prompt_saved", user_id=user.id)
    return SystemPromptResponse(prompt=updated.system_prompt, is_default=False)


@router.delete("/system-prompt", response_model=SystemPromptResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def reset_system_prompt(
    request: Request,
    user: User = Depends(get_current_user),
):
    """Reset the current user's system prompt to the default."""
    await db_service.update_user_system_prompt(user.id, None)
    logger.info("system_prompt_reset", user_id=user.id)
    return SystemPromptResponse(prompt=_read_default_prompt(), is_default=True)
