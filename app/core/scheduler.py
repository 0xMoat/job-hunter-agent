"""APScheduler setup for daily automated job search."""

import asyncio
import functools

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from langchain_community.utilities import DuckDuckGoSearchAPIWrapper

from app.core.logging import logger
from app.services.job_service import job_service

scheduler = AsyncIOScheduler()

_wrapper = DuckDuckGoSearchAPIWrapper(num_results=10)


async def _daily_job_search() -> None:
    """Run job search for all users who have preferences configured.

    Calls DuckDuckGoSearchAPIWrapper directly (not through LangGraph agent)
    to get structured results with real URLs for deduplication.
    Note: get_all_preferences() loads all records — suitable for demo scale.
    Production use requires pagination or active-user filtering.
    CronTrigger uses server local timezone — set tz= if deploying to UTC servers.
    """
    logger.info("daily_job_search_started")
    prefs = await job_service.get_all_preferences()
    if not prefs:
        logger.info("daily_job_search_no_preferences")
        return

    for pref in prefs:
        try:
            query = f"{pref.keywords} job {pref.location} {pref.job_type}"
            # DuckDuckGoSearchAPIWrapper.results() is synchronous — run in executor
            # to avoid blocking the async event loop during the scheduled window.
            raw_results = await asyncio.get_event_loop().run_in_executor(
                None, functools.partial(_wrapper.results, query, num_results=10)
            )
            listings = [
                {
                    "title": r.get("title", ""),
                    "company": "",  # DDG doesn't always provide company separately
                    "location": pref.location,
                    "url": r.get("link", ""),
                    "snippet": r.get("snippet", ""),
                }
                for r in raw_results
                if r.get("link")  # only include results with a real URL
            ]
            inserted = await job_service.upsert_listings(pref.user_id, listings)
            logger.info(
                "daily_job_search_user_done",
                user_id=pref.user_id,
                keywords=pref.keywords,
                inserted=inserted,
            )
        except Exception as e:
            logger.exception("daily_job_search_user_failed", user_id=pref.user_id, error=str(e))

    logger.info("daily_job_search_completed", user_count=len(prefs))


def setup_scheduler() -> AsyncIOScheduler:
    """Register all scheduled jobs and return the scheduler."""
    scheduler.add_job(
        _daily_job_search,
        CronTrigger(hour=8, minute=0),
        id="daily_job_search",
        replace_existing=True,
    )
    return scheduler
