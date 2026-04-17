"""Job search tool — searches Boss 直聘 job listings via DuckDuckGo.

Boss 直聘 indexes many non-JD pages under zhipin.com (wiki entries, company
home pages, SEO long-tail aggregators). We apply two-layer filtering so only
real `/job_detail/<id>.html` links reach the LLM.
"""

import asyncio
import json
import re

from langchain_community.tools import DuckDuckGoSearchResults
from langchain_core.tools import tool

from app.core.logging import logger

_search = DuckDuckGoSearchResults(num_results=12, handle_tool_error=True)

# Real JD page on Boss 直聘.
_JD_URL_RE = re.compile(r"^https://www\.zhipin\.com/job_detail/[A-Za-z0-9]+\.html")

# Path fragments known to be non-JD (company home, wiki, SEO aggregators).
_NON_JD_FRAGMENTS = (
    "/wiki/",
    "/gongsi/",
    "/hot-jobs",
    "/web/common/position/",
    "/z_",
)

# Below this count we fall back to a looser query. DDG's index of Boss 直聘
# JD pages is thin, so keep this modestly generous.
_MIN_STRICT_RESULTS = 5


def _url_of(result: dict) -> str:
    return result.get("link") or result.get("url") or ""


def _is_real_jd(result: dict) -> bool:
    return bool(_JD_URL_RE.match(_url_of(result)))


def _is_plausible_zhipin(result: dict) -> bool:
    """Loose filter: zhipin.com URL excluding obvious non-JD paths."""
    url = _url_of(result)
    if not url.startswith("https://www.zhipin.com"):
        return False
    return not any(frag in url for frag in _NON_JD_FRAGMENTS)


async def _ddg(query: str) -> list[dict]:
    return await asyncio.to_thread(
        _search.api_wrapper.results, query, _search.max_results
    )


@tool
async def job_search_tool(keywords: str, location: str, job_type: str = "fulltime") -> str:
    """Search Boss 直聘 for job listings matching the given criteria.

    ONLY call this tool when the user explicitly asks to search or find jobs
    (e.g. "帮我找工作", "搜索 Python 职位", "find me a job").
    Do NOT call this for greetings, chitchat, questions, or any message that
    is not an explicit job search request.

    Args:
        keywords: Job title or skills to search for, e.g. "agent engineer", "backend python"
        location: Target location, e.g. "上海", "Beijing", "remote"
        job_type: One of: fulltime, remote, contract. Defaults to fulltime.

    Returns:
        JSON string with structured job listing results from Boss 直聘.
    """
    strict_query = f"{keywords} {location} site:zhipin.com/job_detail"
    loose_query = f"{keywords} {location} site:zhipin.com"
    logger.info(
        "job_search_started",
        keywords=keywords,
        location=location,
        job_type=job_type,
    )

    try:
        raw_strict = await _ddg(strict_query)
        filtered = [r for r in raw_strict if _is_real_jd(r)]
        strategy = "strict"

        if len(filtered) < _MIN_STRICT_RESULTS:
            logger.info(
                "job_search_strict_under_threshold",
                strict_hits=len(filtered),
                threshold=_MIN_STRICT_RESULTS,
            )
            raw_loose = await _ddg(loose_query)
            seen = {_url_of(r) for r in filtered}
            for r in raw_loose:
                url = _url_of(r)
                if url in seen or not _is_plausible_zhipin(r):
                    continue
                filtered.append(r)
                seen.add(url)
            strategy = "loose_fallback"

        logger.info(
            "job_search_completed",
            keywords=keywords,
            result_count=len(filtered),
            strategy=strategy,
        )
        return json.dumps(
            {
                "keywords": keywords,
                "location": location,
                "job_type": job_type,
                "source": "zhipin.com",
                "strategy": strategy,
                "results": filtered,
            },
            ensure_ascii=False,
        )
    except Exception as e:
        logger.exception("job_search_failed", keywords=keywords, error=str(e))
        return json.dumps({"error": str(e)})
