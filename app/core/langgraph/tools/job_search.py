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

import instructor
from langchain_community.tools import DuckDuckGoSearchResults
from langchain_core.tools import tool
from openai import AsyncOpenAI
from pydantic import BaseModel, Field, field_validator

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


# Platform / noise tokens the LLM occasionally puts in `company` — almost
# always a sign the real company name was ambiguous. Fall back to empty so
# downstream uses the original title.
_PLATFORM_COMPANY_TOKENS = frozenset({
    "boss直聘", "boss 直聘", "boss", "招聘", "boss直聘招聘",
    "zhipin", "zhipin.com", "",
})


class Pick(BaseModel):
    """One surviving search hit, with company/role extracted from the title."""

    index: int = Field(ge=0, description="Zero-based index into the input hits list.")
    company: str = Field(
        description=(
            "The hiring company's short name, e.g. '元聚', '字节跳动'. "
            "Strip platform suffixes (招聘 / 有限公司 / -BOSS直聘). "
            "Return empty string if the title is ambiguous."
        ),
    )
    role: str = Field(
        description=(
            "The job title in clean form, e.g. 'Agent 工程师', '后端开发'. "
            "Strip 「」 brackets and '招聘' suffix. "
            "Return empty string if the title is ambiguous."
        ),
    )
    is_seo_article: bool = Field(
        default=False,
        description=(
            "True iff this hit is a BOSS 直聘 SEO aggregator article "
            "(title asks or answers '是做什么的 / 怎么样 / 工资多少' instead "
            "of posting a job). The server drops picks with this flag set."
        ),
    )

    @field_validator("company", mode="after")
    @classmethod
    def _strip_platform(cls, v: str) -> str:
        cleaned = v.strip()
        # Strip known platform suffixes iteratively — `removesuffix` is
        # exact-substring, unlike `rstrip` which is character-set-based and
        # would mangle e.g. '元聚招' by treating '招聘' as {'招','聘'}.
        for suffix in ("-BOSS直聘", "-boss直聘", "有限公司", "招聘"):
            if cleaned.endswith(suffix):
                cleaned = cleaned.removesuffix(suffix).strip("-").strip()
        if cleaned.lower() in _PLATFORM_COMPANY_TOKENS:
            return ""
        return cleaned

    @field_validator("role", mode="after")
    @classmethod
    def _strip_role(cls, v: str) -> str:
        cleaned = v.strip().strip("「」").strip()
        for suffix in ("招聘",):
            if cleaned.endswith(suffix):
                cleaned = cleaned.removesuffix(suffix).strip()
        return cleaned


class RerankResult(BaseModel):
    """Full response schema — picks + a short preview intro."""

    picks: list[Pick] = Field(
        default_factory=list,
        max_length=10,
        description="Filtered hits, in the order you want them shown to the user.",
    )
    intro: str = Field(
        default="",
        max_length=80,
        description=(
            "≤40 字 Chinese one-sentence preview naming at most two standout "
            "jobs by index with a reason (e.g. 薪资最高 / 经验要求低). Empty "
            "if nothing is worth highlighting."
        ),
    )


_RERANK_CLIENT: instructor.AsyncInstructor | None = None


def _get_rerank_client() -> instructor.AsyncInstructor:
    """Lazy-singleton AsyncOpenAI client wrapped with Instructor.

    Deliberately uses the raw OpenAI SDK against DeepSeek's OpenAI-compatible
    endpoint — LangChain's ``ChatDeepSeek`` would inherit the parent
    LangGraph callback context and leak the rerank response into the chat
    SSE stream, which is not what we want for an internal tool helper.
    """
    global _RERANK_CLIENT
    if _RERANK_CLIENT is None:
        _RERANK_CLIENT = instructor.from_openai(
            AsyncOpenAI(
                api_key=settings.DEEPSEEK_API_KEY,
                base_url="https://api.deepseek.com",
            ),
            mode=instructor.Mode.TOOLS,
        )
    return _RERANK_CLIENT


async def _rerank_and_intro(
    results: list[dict], keywords: str, location: str
) -> tuple[list[dict], str]:
    """LLM rerank + 1-sentence Chinese intro for the filtered hits.

    Uses Instructor + Pydantic with DeepSeek tool-calling so the LLM response
    is schema-validated at the API layer and then semantically checked by
    ``Pick`` validators. Format errors no longer happen; semantic errors
    (e.g. ``company='BOSS直聘'``) get one retry via Instructor's
    ``max_retries``.

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
        + "\n\nFor each hit that is a real job posting AND semantically "
        "matches the keywords (e.g. 'Agent Engineer' → LLM agent / AI agent "
        "developer, NOT 'data operations' or 'frontend'), emit a Pick. "
        "Location must match the same city. Exclude login/register/"
        "company-profile pages. Mark `is_seo_article=true` for BOSS 直聘 "
        "SEO article pages whose title asks or answers questions about a "
        "role ('是做什么的', '怎么样', '工资多少', '有前途吗', "
        "'岗位职责是什么', '招聘要求简介') — the server drops those. Real JD "
        "titles start with 「…招聘」 and end with -BOSS直聘.\n\n"
        "Also write a short Chinese intro (≤40 字) naming at most two "
        "standout jobs by index with a reason. Leave intro empty if nothing "
        "stands out."
    )
    try:
        client = _get_rerank_client()
        response: RerankResult = await client.chat.completions.create(
            model="deepseek-chat",
            response_model=RerankResult,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_retries=2,
        )
    except Exception:
        logger.exception("job_search_rerank_failed", hit_count=len(results))
        return results, ""

    kept: list[dict] = []
    kept_indices: list[int] = []
    dropped_seo: list[int] = []
    for p in response.picks:
        if p.is_seo_article:
            dropped_seo.append(p.index)
            continue
        if not (0 <= p.index < len(results)):
            continue
        hit = {**results[p.index]}
        if p.company:
            hit["company"] = p.company
        if p.role:
            hit["role"] = p.role
        kept.append(hit)
        kept_indices.append(p.index)
    logger.info(
        "job_search_reranked",
        before=len(results),
        after=len(kept),
        kept_indices=kept_indices,
        dropped_seo=dropped_seo,
        intro_len=len(response.intro),
    )
    return kept, response.intro


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
