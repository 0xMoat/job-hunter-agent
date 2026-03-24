"""Job search preferences endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.api.v1.auth import get_current_session
from app.core.limiter import limiter
from app.core.logging import logger
from app.models.session import Session
from app.services.job_service import job_service

router = APIRouter()


class PreferenceRequest(BaseModel):
    """Request body for updating job preferences."""

    keywords: str
    location: str
    job_type: str = "fulltime"


@router.get("/preferences")
@limiter.limit("30/minute")
async def get_preferences(request: Request, session: Session = Depends(get_current_session)):
    """Get the current user's job search preferences."""
    pref = await job_service.get_preference(session.user_id)
    if not pref:
        raise HTTPException(status_code=404, detail="No preferences set yet")
    return pref


@router.put("/preferences")
@limiter.limit("30/minute")
async def set_preferences(
    request: Request,
    body: PreferenceRequest,
    session: Session = Depends(get_current_session),
):
    """Create or update job search preferences."""
    pref = await job_service.upsert_preference(
        session.user_id, body.keywords, body.location, body.job_type
    )
    logger.info("preferences_updated_via_api", user_id=session.user_id)
    return pref
