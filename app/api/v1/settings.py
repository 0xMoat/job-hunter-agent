"""User settings endpoints — system prompt management."""

import base64
import os
import re
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.v1.auth import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.models.user import User
from app.services.database import database_service as db_service

router = APIRouter()

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


class LangfuseUrlResponse(BaseModel):
    url_base: Optional[str] = None


_langfuse_url_base_cache: Optional[str] = None


async def _resolve_langfuse_url_base() -> Optional[str]:
    global _langfuse_url_base_cache
    if _langfuse_url_base_cache is not None:
        return _langfuse_url_base_cache
    if not settings.LANGFUSE_PUBLIC_KEY or not settings.LANGFUSE_SECRET_KEY:
        return None
    creds = base64.b64encode(
        f"{settings.LANGFUSE_PUBLIC_KEY}:{settings.LANGFUSE_SECRET_KEY}".encode()
    ).decode()
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(
                f"{settings.LANGFUSE_HOST}/api/public/projects",
                headers={"Authorization": f"Basic {creds}"},
            )
            resp.raise_for_status()
            projects = resp.json().get("data", [])
            if projects:
                project_id = projects[0]["id"]
                _langfuse_url_base_cache = f"{settings.LANGFUSE_HOST}/project/{project_id}"
                return _langfuse_url_base_cache
    except Exception:
        logger.warning("langfuse_project_id_fetch_failed")
    return None


class SystemPromptRequest(BaseModel):
    prompt: str = Field(..., max_length=10000)


class SystemPromptResponse(BaseModel):
    prompt: str
    is_default: bool


class ResumeRequest(BaseModel):
    resume_text: Optional[str] = Field(default=None, max_length=50000)


class ResumeResponse(BaseModel):
    resume_text: Optional[str]


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


@router.get("/resume", response_model=ResumeResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def get_resume(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> ResumeResponse:
    """Return the current user's resume text."""
    return ResumeResponse(resume_text=current_user.resume_text)


@router.put("/resume", response_model=ResumeResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def update_resume(
    body: ResumeRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
) -> ResumeResponse:
    """Save the current user's plain-text resume."""
    user = await db_service.update_user_resume(current_user.id, body.resume_text)
    logger.info("resume_updated", user_id=current_user.id)
    return ResumeResponse(resume_text=user.resume_text)


@router.get("/langfuse-url", response_model=LangfuseUrlResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def get_langfuse_url(
    request: Request,
    user: User = Depends(get_current_user),
):
    """Return the Langfuse project base URL for session trace links."""
    url_base = await _resolve_langfuse_url_base()
    return LangfuseUrlResponse(url_base=url_base)
