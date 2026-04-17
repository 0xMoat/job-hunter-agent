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
from langchain_deepseek import ChatDeepSeek
from pydantic import BaseModel, Field

from app.core.config import settings
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


class _RerankDecision(BaseModel):
    """LLM rerank output — which search hits are genuine, relevant JDs."""

    relevant_indices: list[int] = Field(
        description=(
            "0-based indices of results that are GENUINE job postings AND "
            "match the user's keywords+location. Exclude login/register pages, "
            "company wikis, unrelated roles, and postings in wrong locations. "
            "Return at most 10."
        )
    )


async def _rerank_by_llm(
    results: list[dict], keywords: str, location: str
) -> list[dict]:
    """Filter search hits down to the ones that genuinely match keywords+location.

    On LLM failure, return the input unchanged so the tool degrades gracefully.
    """
    if not results:
        return results
    summaries = []
    for i, r in enumerate(results):
        title = (r.get("title") or "").strip()
        snippet = (r.get("snippet") or "").strip()
        link = _url_of(r)
        summaries.append(f"[{i}] title={title!r} snippet={snippet[:180]!r} link={link}")
    prompt = (
        f"User is searching Boss 直聘 for jobs matching:\n"
        f"  keywords: {keywords}\n"
        f"  location: {location}\n\n"
        f"Raw search hits (some are non-JD pages or unrelated roles):\n"
        + "\n".join(summaries)
        + "\n\nReturn the indices of ONLY the hits that are real job postings "
        "AND semantically match the keywords (e.g. 'Agent Engineer' → LLM agent / "
        "AI agent developer roles, NOT 'data operations' or 'frontend'). The "
        "location must also match (same city). Exclude login/register pages and "
        "company profile pages."
    )
    try:
        llm = ChatDeepSeek(
            model="deepseek-chat",
            api_key=settings.DEEPSEEK_API_KEY,
            temperature=0,
        ).with_structured_output(_RerankDecision)
        decision: _RerankDecision = await llm.ainvoke(prompt)
    except Exception:
        logger.exception("job_search_rerank_failed", hit_count=len(results))
        return results
    kept = [results[i] for i in decision.relevant_indices if 0 <= i < len(results)]
    logger.info(
        "job_search_reranked",
        before=len(results),
        after=len(kept),
        kept_indices=decision.relevant_indices,
    )
    return kept


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

        # LLM rerank: filter out results that are URL-safe (via regex) but
        # aren't actually relevant to the user's keywords/location — e.g.
        # "data operations" hits when the user searched for "agent engineer".
        filtered = await _rerank_by_llm(filtered, keywords, location)

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
