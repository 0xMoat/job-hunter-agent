"""Search configuration and manual trigger endpoints."""

from apscheduler.triggers.cron import CronTrigger
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from app.api.v1.auth import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.core.scheduler import _scheduled_search_for_user, _search_for_user, scheduler
from app.models.user import User
from app.services.job_service import job_service

router = APIRouter()


class SearchConfigResponse(BaseModel):
    target_sites: str
    schedule_enabled: bool
    schedule_cron: str


class SearchConfigUpdate(BaseModel):
    target_sites: str = Field(default="")
    schedule_enabled: bool = Field(default=False)
    schedule_cron: str = Field(default="0 9 * * *")


class SearchRunResponse(BaseModel):
    inserted: int
    skipped: int


@router.get("/config", response_model=SearchConfigResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["search"][0])
async def get_search_config(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> SearchConfigResponse:
    """Return the current user's search config (defaults if not set)."""
    config = await job_service.get_search_config(current_user.id)
    if config is None:
        return SearchConfigResponse(
            target_sites="",
            schedule_enabled=False,
            schedule_cron="0 9 * * *",
        )
    return SearchConfigResponse(
        target_sites=config.target_sites,
        schedule_enabled=config.schedule_enabled,
        schedule_cron=config.schedule_cron,
    )


@router.put("/config", response_model=SearchConfigResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["search"][0])
async def update_search_config(
    body: SearchConfigUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
) -> SearchConfigResponse:
    """Upsert the current user's search config and sync APScheduler."""
    # Validate cron expression
    try:
        CronTrigger.from_crontab(body.schedule_cron)
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=422, detail=f"Invalid cron expression: {e}")

    # Guard: scheduling requires a JobPreference to exist
    if body.schedule_enabled:
        pref = await job_service.get_preference(current_user.id)
        if pref is None:
            raise HTTPException(
                status_code=400,
                detail="Cannot enable scheduling without a job preference configured.",
            )

    config = await job_service.upsert_search_config(
        user_id=current_user.id,
        target_sites=body.target_sites,
        schedule_enabled=body.schedule_enabled,
        schedule_cron=body.schedule_cron,
    )

    # Sync APScheduler
    job_id = f"job_search_{current_user.id}"
    if config.schedule_enabled:
        trigger = CronTrigger.from_crontab(config.schedule_cron)
        if scheduler.get_job(job_id):
            scheduler.reschedule_job(job_id, trigger=trigger)
        else:
            scheduler.add_job(
                _scheduled_search_for_user,
                trigger,
                args=[current_user.id],
                id=job_id,
                replace_existing=True,
            )
        logger.info("scheduler_job_updated", user_id=current_user.id, cron=config.schedule_cron)
    else:
        if scheduler.get_job(job_id):
            scheduler.remove_job(job_id)
            logger.info("scheduler_job_removed", user_id=current_user.id)

    return SearchConfigResponse(
        target_sites=config.target_sites,
        schedule_enabled=config.schedule_enabled,
        schedule_cron=config.schedule_cron,
    )


@router.post("/run", response_model=SearchRunResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["search"][0])
async def run_search(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> SearchRunResponse:
    """Manually trigger a job search for the current user."""
    pref = await job_service.get_preference(current_user.id)
    config = await job_service.get_search_config(current_user.id)
    resume_text = current_user.resume_text

    result = await _search_for_user(current_user.id, pref, config, resume_text)
    logger.info("manual_search_run", user_id=current_user.id, result=result)
    return SearchRunResponse(inserted=result.get("inserted", 0), skipped=result.get("skipped", 0))
