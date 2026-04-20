"""Unit tests for tool parsers — guard against LLM output schema drift.

Covers the four tools listed in LLM Task 10 D:
- score_jd_match: structured output via _Breakdown schema
- company_research: pure DuckDuckGo wrapper, no LLM — skipped
- cover_letter: llm_service.call passthrough, tested for empty-resume safety
- duckduckgo_search: thin re-export of langchain DuckDuckGoSearchResults — skipped
"""

import sys
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from langchain_core.messages import AIMessage
from pydantic import ValidationError

# NOTE: `from app.core.langgraph.tools.score_jd_match import score_jd_match` returns the
# @tool-wrapped StructuredTool, because the module attribute `score_jd_match` is rebound
# by the decorator. For monkeypatching internal helpers, grab the module itself via
# sys.modules (plain `import ... as m` ends up resolving to the tools package attribute,
# which is overridden to the StructuredTool in tools/__init__.py).
import app.core.langgraph.tools.score_jd_match  # noqa: F401 — ensure loaded
import app.core.langgraph.tools.cover_letter  # noqa: F401

score_jd_match_mod = sys.modules["app.core.langgraph.tools.score_jd_match"]
cover_letter_mod = sys.modules["app.core.langgraph.tools.cover_letter"]

from app.core.langgraph.tools.cover_letter import cover_letter_tool  # noqa: E402
from app.core.langgraph.tools.score_jd_match import (  # noqa: E402
    _Breakdown,
    _Dim,
    score_jd_match,
)


# === score_jd_match ===================================================


@pytest.mark.asyncio
async def test_score_jd_match_valid_schema(monkeypatch):
    """structured_llm returns a valid _Breakdown → tool computes weighted total and writes it."""
    # Build a valid _Breakdown instance. Scores are 0-10 ints.
    valid_breakdown = _Breakdown(
        skills=_Dim(score=8, reason="强匹配"),
        experience=_Dim(score=7, reason="够用"),
        domain=_Dim(score=6, reason="相关"),
        soft=_Dim(score=9, reason="出色"),
    )
    # Expected total (rounded):
    # 8*10*0.4 + 7*10*0.25 + 6*10*0.2 + 9*10*0.15 = 32 + 17.5 + 12 + 13.5 = 75
    expected_total = 75

    # Fake structured LLM: .ainvoke returns the valid pydantic instance directly.
    structured_mock = AsyncMock()
    structured_mock.ainvoke = AsyncMock(return_value=valid_breakdown)
    monkeypatch.setattr(
        score_jd_match_mod, "structured_llm", lambda schema: structured_mock
    )

    # Fake application + resume loader.
    fake_app = SimpleNamespace(
        company="Acme",
        title="SWE",
        snippet="Python, async, distributed systems",
        url="https://acme.example/jobs/1",
        notes=None,
    )
    monkeypatch.setattr(
        score_jd_match_mod,
        "load_jd_and_resume",
        AsyncMock(return_value=(fake_app, "resume text here")),
    )

    # Capture the DB write and return success.
    captured = {}

    async def fake_update(user_id, application_id, updates):
        captured["user_id"] = user_id
        captured["application_id"] = application_id
        captured["updates"] = updates
        return True

    monkeypatch.setattr(
        score_jd_match_mod.job_service,
        "update_application_artifacts",
        fake_update,
    )
    # Prompt loader — avoid filesystem dependency in case path drifts.
    monkeypatch.setattr(
        score_jd_match_mod,
        "load_prompt",
        lambda name: "JD:\n{jd}\nResume:\n{resume}",
    )

    config = {"configurable": {"user_id": 42}}
    # @tool-decorated: .ainvoke(input, config=...). `config` is a RunnableConfig
    # passed separately — not part of the tool's input dict.
    result = await score_jd_match.ainvoke({"application_id": 7}, config=config)

    assert f"{expected_total}/100" in result, f"total missing in result: {result}"
    assert captured["user_id"] == 42
    assert captured["application_id"] == 7
    assert captured["updates"]["match_score"] == expected_total
    # breakdown_json should be the model_dump_json of the _Breakdown
    assert "skills" in captured["updates"]["match_breakdown"]


def test_score_jd_match_missing_required_field_raises():
    """Pydantic raises ValidationError when required fields are omitted from _Breakdown."""
    with pytest.raises(ValidationError):
        _Breakdown()  # all four dim fields are required

    # Also verify _Dim rejects a score out of range (0-10 constraint).
    with pytest.raises(ValidationError):
        _Dim(score=15, reason="too high")


# === company_research =================================================


@pytest.mark.skip(
    reason="company_research has no LLM parser logic — it's a pure DuckDuckGo "
    "aggregator that json.dumps the raw search results. Testing it would just "
    "mock DDG and assert json shape, which is already covered by the DDG wrapper."
)
def test_company_research_markdown_extraction():
    pass


# === cover_letter =====================================================


@pytest.mark.asyncio
async def test_cover_letter_handles_empty_resume(monkeypatch):
    """Empty long_term_memory ("" default) must not crash — tool substitutes a placeholder."""
    # llm_service.call returns an AIMessage; tool reads .content.
    fake_call = AsyncMock(return_value=AIMessage(content="**Subject:** Canned\n\n**Body:** hi"))
    monkeypatch.setattr(cover_letter_mod.llm_service, "call", fake_call)

    # @tool → invoke via .ainvoke. long_term_memory defaults to "" so omit it.
    result = await cover_letter_tool.ainvoke(
        {
            "job_title": "SWE",
            "company": "Acme",
            "job_description": "Build things",
        }
    )

    assert "Canned" in result
    # Verify the tool actually substituted the "no profile" placeholder into the prompt,
    # rather than leaking an empty string that might break downstream prompts.
    called_args = fake_call.await_args
    assert called_args is not None, "llm_service.call was never awaited"
    messages_arg = called_args.args[0]
    assert len(messages_arg) == 1
    prompt_text = messages_arg[0].content
    assert "No user profile available yet." in prompt_text


# === duckduckgo_search ================================================


@pytest.mark.skip(
    reason="duckduckgo_search is a 1-line re-export of langchain_community's "
    "DuckDuckGoSearchResults — no local parser logic. Testing would be testing "
    "langchain, not our code."
)
def test_duckduckgo_search_transforms_ddg_output():
    pass
