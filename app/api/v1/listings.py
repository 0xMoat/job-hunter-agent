"""Job listings endpoints — daily search results."""

from fastapi import APIRouter, Depends, Request

from app.api.v1.auth import get_current_session
from app.core.limiter import limiter
from app.models.session import Session
from app.services.job_service import job_service

router = APIRouter()


@router.get("/listings")
@limiter.limit("60/minute")
async def get_listings(request: Request, session: Session = Depends(get_current_session)):
    """Get the latest job listings found by the daily scheduler."""
    listings = await job_service.get_listings(session.user_id)
    return {"listings": listings, "count": len(listings)}
