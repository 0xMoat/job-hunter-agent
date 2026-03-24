"""Company research tool — gathers background, culture, and news about a company."""

from langchain_community.tools import DuckDuckGoSearchResults
from langchain_core.tools import tool

from app.core.logging import logger

_search = DuckDuckGoSearchResults(num_results=5, handle_tool_error=True)

_QUERIES = {
    "overview": "{company} company overview business model products",
    "culture": "{company} company culture employee review Glassdoor work life balance",
    "news": "{company} latest news 2024 2025",
    "funding": "{company} funding valuation investors series",
}


@tool
async def company_research_tool(company_name: str, aspects: str = "overview,culture,news") -> str:
    """Research a company's background, culture, and recent news.

    Use this when the user asks to investigate, research, or learn about a company
    before applying or in preparation for an interview.

    Args:
        company_name: Name of the company to research, e.g. "字节跳动", "Anthropic"
        aspects: Comma-separated aspects to research.
                 Available: overview, culture, news, funding.
                 Defaults to "overview,culture,news".

    Returns:
        Formatted research report combining results from multiple searches.
    """
    aspect_list = [a.strip() for a in aspects.split(",") if a.strip() in _QUERIES]
    logger.info("company_research_started", company=company_name, aspects=aspect_list)

    sections = []
    for aspect in aspect_list:
        query = _QUERIES[aspect].format(company=company_name)
        try:
            result = await _search.arun(query)
            sections.append(f"## {aspect.capitalize()}\n{result}")
        except Exception as e:
            logger.exception("company_research_aspect_failed", company=company_name, aspect=aspect, error=str(e))
            sections.append(f"## {aspect.capitalize()}\nSearch failed: {str(e)}")

    logger.info("company_research_completed", company=company_name)
    return f"# Company Research: {company_name}\n\n" + "\n\n".join(sections)
