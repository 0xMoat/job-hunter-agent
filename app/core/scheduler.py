"""APScheduler setup for per-user automated job search."""

import asyncio
import functools
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from langchain_community.utilities import DuckDuckGoSearchAPIWrapper

from app.core.logging import logger
from app.models.job_preference import JobPreference
from app.models.search_config import SearchConfig
from app.services.database import database_service
from app.services.job_service import job_service
from app.services.llm import LLMService
from app.services.scoring_service import score_job

scheduler = AsyncIOScheduler()
_wrapper = DuckDuckGoSearchAPIWrapper()


async def _search_for_user(
    user_id: int,
    pref: Optional[JobPreference],
    config: Optional[SearchConfig],
    resume_text: Optional[str],
) -> dict:
    """Run job search for one user and create pending kanban cards.

    Args:
        user_id: The user to search for.
        pref: The user's job preference (keywords, location, job_type).
        config: The user's search config (target_sites, schedule settings).
        resume_text: The user's plain-text resume for scoring, or None.

    Returns:
        dict with keys "inserted" and "skipped".
    """
    if pref is None:
        logger.warning("job_search_skipped_no_pref", user_id=user_id)
        return {"inserted": 0, "skipped": 0}

    base_query = f"{pref.keywords} job {pref.location} {pref.job_type}"
    queries = []

    if config and config.target_sites:
        sites = [s.strip() for s in config.target_sites.split(",") if s.strip()]
        for site in sites:
            queries.append(f"{base_query} site:{site}")

    if not queries:
        queries = [base_query]

    num_results = 5 if len(queries) > 1 else 10
    all_results: list[dict] = []
    seen_urls: set[str] = set()

    for query in queries:
        try:
            raw = await asyncio.get_running_loop().run_in_executor(
                None,
                functools.partial(_wrapper.results, query, num_results=num_results),
            )
            for r in raw:
                url = r.get("link", "")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    all_results.append(
                        {
                            "title": r.get("title", ""),
                            "company": "",
                            "location": pref.location,
                            "url": url,
                            "snippet": r.get("snippet", ""),
                        }
                    )
        except Exception:
            logger.exception("job_search_query_failed", user_id=user_id, query=query)

    # Score each result against the resume (one LLMService per batch)
    if resume_text and all_results:
        llm = LLMService()
        for item in all_results:
            item["match_score"] = await score_job(
                item["title"], item["snippet"], resume_text, llm
            )

    result = await job_service.batch_create_pending(user_id, all_results)
    # archive_stale_pending() operates globally across all users — this is acceptable
    # for scheduled runs, but when called from POST /search/run it archives cards
    # for all users, not just the triggering user. This matches the existing behavior
    # and is intentional at the current scale.
    await job_service.archive_stale_pending()

    logger.info(
        "job_search_user_done",
        user_id=user_id,
        keywords=pref.keywords,
        inserted=result.get("inserted", 0),
        skipped=result.get("skipped", 0),
        num_queries=len(queries),
    )
    return result


async def _scheduled_search_for_user(user_id: int) -> None:
    """APScheduler job entry point for one user's scheduled search."""
    logger.info("scheduled_job_search_started", user_id=user_id)
    try:
        pref = await job_service.get_preference(user_id)
        config = await job_service.get_search_config(user_id)
        user = await database_service.get_user_by_id(user_id)
        resume_text = user.resume_text if user else None
        await _search_for_user(user_id, pref, config, resume_text)
    except Exception:
        logger.exception("scheduled_job_search_failed", user_id=user_id)


async def setup_scheduler() -> AsyncIOScheduler:
    """Register per-user scheduled jobs and return the configured scheduler."""
    configs = await job_service.get_all_search_configs()
    for config in configs:
        scheduler.add_job(
            _scheduled_search_for_user,
            CronTrigger.from_crontab(config.schedule_cron),
            args=[config.user_id],
            id=f"job_search_{config.user_id}",
            replace_existing=True,
        )
        logger.info(
            "scheduler_job_registered",
            user_id=config.user_id,
            cron=config.schedule_cron,
        )
    return scheduler
