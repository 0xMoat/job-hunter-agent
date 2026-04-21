"""Job search tool — searches Boss 直聘 job listings via DuckDuckGo.

Boss 直聘 indexes many non-JD pages under zhipin.com (wiki entries, company
home pages, SEO long-tail aggregators like 「X 是做什么的」). We require every
candidate URL to match the real ``/job_detail/<id>.html`` shape — both in the
strict pass and in the loose fallback — and then let the LLM apply a second
pass to reject SEO article titles that slip past DDG's ranking.
"""

import asyncio
import json
import re

import httpx
from langchain_community.tools import DuckDuckGoSearchResults
from langchain_core.tools import tool

from app.core.config import settings
from app.core.logging import logger

_search = DuckDuckGoSearchResults(num_results=12, handle_tool_error=True)

# Real JD page on Boss 直聘.
_JD_URL_RE = re.compile(r"^https://www\.zhipin\.com/job_detail/[A-Za-z0-9]+\.html")

# Title substrings typical of BOSS 直聘 SEO long-tail articles — they mimic a
# job title but answer "is-this-role-like / how-much-does-it-pay" rather than
# being a real JD. DDG sometimes ranks these ahead of real listings.
_SEO_TITLE_MARKERS = (
    "是做什么的",
    "是什么",
    "怎么样",
    "工资多少",
    "薪资多少",
    "月薪多少",
    "岗位职责是什么",
    "招聘要求简介",
    "有前途吗",
)

# Below this count we fall back to a looser query. DDG's index of Boss 直聘
# JD pages is thin, so keep this modestly generous.
_MIN_STRICT_RESULTS = 5


def _url_of(result: dict) -> str:
    return result.get("link") or result.get("url") or ""


def _is_real_jd(result: dict) -> bool:
    return bool(_JD_URL_RE.match(_url_of(result)))


def _is_seo_article(result: dict) -> bool:
    """Reject BOSS 直聘 SEO long-tail articles by title heuristics.

    Real JD titles on BOSS look like ``「X 招聘」_Y-BOSS直聘``. SEO pages end
    in 「...是做什么的」/「...怎么样」and the like. We belt-and-suspender this
    alongside the URL check because DDG has been observed returning the SEO
    HTML under the ``/job_detail/`` prefix when the article is cross-linked.
    """
    title = (result.get("title") or "")
    return any(marker in title for marker in _SEO_TITLE_MARKERS)


async def _ddg(query: str) -> list[dict]:
    return await asyncio.to_thread(
        _search.api_wrapper.results, query, _search.max_results
    )


_JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)


async def _rerank_and_intro(
    results: list[dict], keywords: str, location: str
) -> tuple[list[dict], str]:
    """LLM rerank + 1-sentence Chinese intro for the filtered hits.

    Uses plain text completion (no `with_structured_output`) to avoid leaking
    a function_calling tool_call event to the chat stream — the previous
    implementation surfaced a `_RerankDecision` bubble in the UI. We prompt
    the LLM to return raw JSON, then parse it.

    Returns (kept_results, intro_text). On LLM failure, returns the original
    list + an empty intro so the tool degrades gracefully.
    """
    if not results:
        return results, ""
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
        + "\n\nDo TWO things:\n"
        "1. For each hit that is a real job posting AND semantically matches "
        "the keywords (e.g. 'Agent Engineer' → LLM agent / AI agent "
        "developer, NOT 'data operations' or 'frontend'), emit a pick. "
        "Location must match the same city. Exclude login/register/"
        "company-profile pages. "
        "REJECT BOSS 直聘 SEO article pages whose title asks or answers "
        "questions about a role instead of posting one — signals include "
        "'是做什么的', '是什么', '怎么样', '工资多少', '月薪多少', "
        "'有前途吗', '岗位职责是什么', '招聘要求简介', or any title that "
        "reads like an encyclopedia entry rather than a direct hiring notice. "
        "Real JD titles start with 「…招聘」 and end with -BOSS直聘. "
        "Keep at most 10 picks.\n"
        "   For each pick also extract:\n"
        "   - `company`: the hiring company's short name (e.g. \"元聚\", "
        "\"字节跳动\"). Strip suffixes like \"招聘\"/\"有限公司\"/\"-BOSS直聘\". "
        "Boss 直聘 title format is commonly 「职位招聘」_公司-BOSS直聘.\n"
        "   - `role`: the job title in clean form (e.g. \"Agent 工程师\", "
        "\"后端开发\"). Strip the 「」 brackets and the \"招聘\" suffix.\n"
        "   Leave either field as an empty string if the title is ambiguous.\n"
        "2. Write a SHORT one-sentence Chinese intro (≤40 字) previewing the "
        "filtered list for the user, naming at most two standout jobs by index "
        "with a reason (e.g. 薪资最高 / 福利最全 / 经验要求低). Skip the "
        "sentence if no hit is worth highlighting.\n\n"
        "Return ONLY a JSON object, no prose, no markdown fences:\n"
        '{\"picks\": [{\"index\": 0, \"company\": \"元聚\", \"role\": \"Agent 工程师\"}, '
        '{\"index\": 2, \"company\": \"字节跳动\", \"role\": \"后端开发\"}], '
        '\"intro\": \"找到 N 条匹配，#2 元聚薪资最高。\"}'
    )
    # Call DeepSeek HTTP API directly. We deliberately bypass LangChain here
    # because a `ChatDeepSeek.ainvoke` inside a LangGraph tool silently
    # inherits the parent callback context (Langfuse + SSE stream handlers),
    # which would leak the rerank LLM's raw JSON content into the chat
    # assistant's outgoing stream. A plain httpx POST has no such coupling.
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                "https://api.deepseek.com/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.DEEPSEEK_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "deepseek-chat",
                    "messages": [{"role": "user", "content": prompt}],
                    "temperature": 0,
                },
            )
            resp.raise_for_status()
            content = resp.json()["choices"][0]["message"]["content"] or ""
        match = _JSON_BLOCK_RE.search(content)
        if not match:
            raise ValueError(f"no JSON block in rerank response: {content[:200]!r}")
        payload = json.loads(match.group(0))
        picks = payload.get("picks") or []
        intro = (payload.get("intro") or "").strip()
    except Exception:
        logger.exception("job_search_rerank_failed", hit_count=len(results))
        return results, ""
    kept: list[dict] = []
    kept_indices: list[int] = []
    for p in picks:
        if not isinstance(p, dict):
            continue
        idx = p.get("index")
        if not isinstance(idx, int) or not (0 <= idx < len(results)):
            continue
        hit = {**results[idx]}
        company = (p.get("company") or "").strip()
        role = (p.get("role") or "").strip()
        if company:
            hit["company"] = company
        if role:
            hit["role"] = role
        kept.append(hit)
        kept_indices.append(idx)
    logger.info(
        "job_search_reranked",
        before=len(results),
        after=len(kept),
        kept_indices=kept_indices,
        intro_len=len(intro),
    )
    return kept, intro


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
        filtered = [
            r for r in raw_strict if _is_real_jd(r) and not _is_seo_article(r)
        ]
        strategy = "strict"

        if len(filtered) < _MIN_STRICT_RESULTS:
            logger.info(
                "job_search_strict_under_threshold",
                strict_hits=len(filtered),
                threshold=_MIN_STRICT_RESULTS,
            )
            raw_loose = await _ddg(loose_query)
            seen = {_url_of(r) for r in filtered}
            # Loose fallback now also requires the real-JD URL shape — BOSS
            # SEO aggregators live at paths like /shanghai/zp<id>.html and
            # /?ka=..., which pass a naive ``zhipin.com`` prefix check but
            # never contain a real JD. Keeping the URL bar high here avoids
            # depending on the LLM as the sole gate.
            for r in raw_loose:
                url = _url_of(r)
                if url in seen or not _is_real_jd(r) or _is_seo_article(r):
                    continue
                filtered.append(r)
                seen.add(url)
            strategy = "loose_fallback"

        # LLM rerank + intro: strip URL-safe-but-irrelevant hits (e.g. "data
        # operations" when the user searched "agent engineer") AND produce a
        # one-sentence intro that the frontend renders INSIDE the result card
        # header. The chat agent should NOT repeat this intro in its reply.
        filtered, intro = await _rerank_and_intro(filtered, keywords, location)

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
                "intro_text": intro,
                "results": filtered,
            },
            ensure_ascii=False,
        )
    except Exception as e:
        logger.exception("job_search_failed", keywords=keywords, error=str(e))
        return json.dumps({"error": str(e)})
