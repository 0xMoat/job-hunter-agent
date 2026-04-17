"""Job application tracking endpoints."""

from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

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
    status: Optional[Literal["pending", "applied", "interviewing", "completed", "not_a_match"]] = "pending"


class ApplicationUpdate(BaseModel):
    """Request body for updating an application."""

    status: Optional[Literal["pending", "applied", "interviewing", "completed", "not_a_match"]] = None
    notes: Optional[str] = None
    # Artifact fields (all optional, updated by internal tools)
    company_research_json: Optional[str] = None
    tailored_resume_text: Optional[str] = None
    pdf_token: Optional[str] = None
    pdf_created_at: Optional[datetime] = None
    match_score: Optional[int] = Field(default=None, ge=0, le=100)
    match_breakdown: Optional[str] = None
    gap_analysis_text: Optional[str] = None
    interview_questions_json: Optional[str] = None
    artifacts_updated_at: Optional[datetime] = None


class BatchListingItem(BaseModel):
    """A single listing item for batch creation."""

    title: str
    company: str = ""
    url: str = Field(min_length=1)
    snippet: str = ""
    found_date: Optional[str] = None
    source: str = "scheduler"


class BatchCreate(BaseModel):
    """Request body for batch creating pending cards from scheduler."""

    listings: list[BatchListingItem]


@router.get("/applications")
@limiter.limit("60/minute")
async def list_applications(request: Request, session: Session = Depends(get_current_session)):
    """List all job applications for the current user."""
    apps = await job_service.list_applications(session.user_id)
    archived_count = await job_service.count_archived_pending(session.user_id)
    return {"applications": apps, "count": len(apps), "archived_count": archived_count}


@router.post("/applications", status_code=201)
@limiter.limit("30/minute")
async def add_application(
    request: Request,
    body: ApplicationCreate,
    session: Session = Depends(get_current_session),
):
    """Record a new job application."""
    app = await job_service.add_application(
        session.user_id, body.company, body.title, body.url, body.notes, body.status or "pending"
    )
    logger.info("application_added_via_api", user_id=session.user_id, company=body.company)
    return app


@router.post("/applications/batch", status_code=201)
@limiter.limit("10/minute")
async def batch_create_applications(
    request: Request,
    body: BatchCreate,
    session: Session = Depends(get_current_session),
):
    """Batch-create pending kanban cards from scheduler results."""
    listings = [item.model_dump() for item in body.listings]
    result = await job_service.batch_create_pending(session.user_id, listings)
    logger.info(
        "batch_applications_created",
        user_id=session.user_id,
        inserted=result["inserted"],
        skipped=result["skipped"],
    )
    return result


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
