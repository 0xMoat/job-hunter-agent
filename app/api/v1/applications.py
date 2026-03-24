"""Job application tracking endpoints."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.api.v1.auth import get_current_session
from app.core.limiter import limiter
from app.core.logging import logger
from app.models.session import Session
from app.services.job_service import job_service

router = APIRouter()


class ApplicationCreate(BaseModel):
    """Request body for creating a new application record."""

    company: str
    title: str
    url: Optional[str] = None
    notes: Optional[str] = None


class ApplicationUpdate(BaseModel):
    """Request body for updating an application."""

    status: Optional[str] = None
    notes: Optional[str] = None


@router.get("/applications")
@limiter.limit("60/minute")
async def list_applications(request: Request, session: Session = Depends(get_current_session)):
    """List all job applications for the current user."""
    apps = await job_service.list_applications(session.user_id)
    return {"applications": apps, "count": len(apps)}


@router.post("/applications", status_code=201)
@limiter.limit("30/minute")
async def add_application(
    request: Request,
    body: ApplicationCreate,
    session: Session = Depends(get_current_session),
):
    """Record a new job application."""
    app = await job_service.add_application(
        session.user_id, body.company, body.title, body.url, body.notes
    )
    logger.info("application_added_via_api", user_id=session.user_id, company=body.company)
    return app


@router.patch("/applications/{application_id}")
@limiter.limit("30/minute")
async def update_application(
    request: Request,
    application_id: int,
    body: ApplicationUpdate,
    session: Session = Depends(get_current_session),
):
    """Update an application's status or notes."""
    updated = await job_service.update_application(
        application_id, session.user_id, body.status, body.notes
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Application not found")
    return updated


@router.delete("/applications/{application_id}")
@limiter.limit("30/minute")
async def delete_application(
    request: Request,
    application_id: int,
    session: Session = Depends(get_current_session),
):
    """Delete an application record."""
    deleted = await job_service.delete_application(application_id, session.user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Application not found")
    return {"message": "Application deleted"}
