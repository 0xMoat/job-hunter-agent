"""Tutorial seeding and replay endpoints."""

import uuid

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.api.v1.auth import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.core.tutorial.content import (
    Locale,
    get_default_resume,
    get_tutorial_session_name,
    normalize_locale,
)
from app.models.user import User
from app.services.database import database_service as db_service

router = APIRouter()


class TutorialStatus(BaseModel):
    has_tutorial_session: bool
    tutorial_session_id: str | None
    tutorial_completed: bool
    resume_is_default: bool


class TutorialSeedRequest(BaseModel):
    locale: str = Field(default="en")


class TutorialSeedResponse(BaseModel):
    session_id: str
    name: str


@router.get("/status", response_model=TutorialStatus)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def get_tutorial_status(
    request: Request,
    user: User = Depends(get_current_user),
) -> TutorialStatus:
    """Return the current user's tutorial state."""
    session = await db_service.get_tutorial_session_for_user(user.id)
    return TutorialStatus(
        has_tutorial_session=session is not None,
        tutorial_session_id=session.id if session else None,
        tutorial_completed=user.tutorial_completed_at is not None,
        resume_is_default=user.resume_is_default,
    )


@router.post("/seed", response_model=TutorialSeedResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def seed_tutorial(
    request: Request,
    body: TutorialSeedRequest,
    user: User = Depends(get_current_user),
) -> TutorialSeedResponse:
    """Idempotently create the tutorial session and seed the default resume."""
    locale: Locale = normalize_locale(body.locale)
    tutorial = await db_service.seed_tutorial_for_user(
        user_id=user.id,
        locale=locale,
        session_id=str(uuid.uuid4()),
        session_name=get_tutorial_session_name(locale),
        default_resume=get_default_resume(locale),
    )
    logger.info("tutorial_seeded", user_id=user.id, session_id=tutorial.id, locale=locale)
    return TutorialSeedResponse(session_id=tutorial.id, name=tutorial.name)


@router.post("/replay", response_model=TutorialSeedResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def replay_tutorial(
    request: Request,
    body: TutorialSeedRequest,
    user: User = Depends(get_current_user),
) -> TutorialSeedResponse:
    """Reset tutorial_completed_at and ensure a tutorial session exists."""
    locale: Locale = normalize_locale(body.locale)
    await db_service.reset_tutorial_completion(user.id)
    tutorial = await db_service.seed_tutorial_for_user(
        user_id=user.id,
        locale=locale,
        session_id=str(uuid.uuid4()),
        session_name=get_tutorial_session_name(locale),
        default_resume=get_default_resume(locale),
    )
    logger.info("tutorial_replay", user_id=user.id, session_id=tutorial.id, locale=locale)
    return TutorialSeedResponse(session_id=tutorial.id, name=tutorial.name)


@router.post("/dismiss")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def dismiss_tutorial(
    request: Request,
    user: User = Depends(get_current_user),
) -> dict:
    """Mark the tutorial as completed for the current user."""
    await db_service.mark_tutorial_completed(user.id)
    logger.info("tutorial_dismissed", user_id=user.id)
    return {"ok": True}
