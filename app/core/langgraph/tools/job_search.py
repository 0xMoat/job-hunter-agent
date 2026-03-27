"""Job search tool — searches for job listings via DuckDuckGo."""

import asyncio
import json

from langchain_community.tools import DuckDuckGoSearchResults
from langchain_core.tools import tool

from app.core.logging import logger

_search = DuckDuckGoSearchResults(num_results=8, handle_tool_error=True)


@tool
async def job_search_tool(keywords: str, location: str, job_type: str = "fulltime") -> str:
    """Search for job listings matching the given criteria.

    Use this when the user asks to find jobs, search positions, or look for openings.

    Args:
        keywords: Job title or skills to search for, e.g. "agent engineer", "backend python"
        location: Target location, e.g. "上海", "Beijing", "remote"
        job_type: One of: fulltime, remote, contract. Defaults to fulltime.

    Returns:
        JSON string with structured job listing results.
    """
    query = (
        f"{keywords} {job_type} job {location} "
        f"site:linkedin.com OR site:lagou.com OR site:zhipin.com OR site:indeed.com"
    )
    logger.info("job_search_started", keywords=keywords, location=location, job_type=job_type)
    try:
        results = await asyncio.to_thread(
            _search.api_wrapper.results, query, _search.max_results
        )
        logger.info("job_search_completed", keywords=keywords, result_count=len(results))
        return json.dumps(
            {"keywords": keywords, "location": location, "job_type": job_type, "results": results},
            ensure_ascii=False,
        )
    except Exception as e:
        logger.exception("job_search_failed", keywords=keywords, error=str(e))
        return json.dumps({"error": str(e)})
