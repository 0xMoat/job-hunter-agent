"""Unit tests for LLMService retry + circular fallback resilience.

Pure unit tests — no FastAPI, no graph. Fresh LLMService() per test with
LLMRegistry.LLMS monkey-patched to a list of AsyncMock models whose .ainvoke
behavior is driven by side_effect queues.
"""

import httpx
import pytest
from langchain_core.messages import AIMessage, HumanMessage
from openai import APIError, RateLimitError

from app.services.llm import LLMService
from tests.support.fake_llm import (
    disable_tenacity_sleep,
    make_flaky_chat_model,
    patch_registry,
)


def _rate_limit() -> RateLimitError:
    """Construct a RateLimitError for the installed openai SDK version."""
    return RateLimitError(
        message="rate limited",
        response=httpx.Response(429, request=httpx.Request("POST", "http://test")),
        body=None,
    )


def _api_error() -> APIError:
    """Construct a generic APIError for the installed openai SDK version."""
    return APIError(
        message="api error",
        request=httpx.Request("POST", "http://test"),
        body=None,
    )


@pytest.fixture(autouse=True)
def no_tenacity_sleep(monkeypatch):
    """Make tenacity retries instant in every test in this module."""
    disable_tenacity_sleep(monkeypatch)


async def test_retry_succeeds_after_transient_rate_limit(monkeypatch):
    """Model A fails twice with RateLimitError, succeeds third time. No fallback."""
    flaky = make_flaky_chat_model(
        [_rate_limit(), _rate_limit(), AIMessage(content="ok")]
    )
    patch_registry(monkeypatch, [("A", flaky)])

    svc = LLMService()
    svc._llm = flaky
    svc._current_model_index = 0

    result = await svc.call([HumanMessage(content="hi")])

    assert isinstance(result, AIMessage)
    assert result.content == "ok"
    assert svc._current_model_index == 0  # no model switch


async def test_fallback_to_second_model_after_first_exhausts_retries(monkeypatch):
    """Model A fails all its retries; fallback to model B which succeeds."""
    flaky_a = make_flaky_chat_model([_api_error(), _api_error(), _api_error()])
    flaky_b = make_flaky_chat_model([AIMessage(content="from b")])
    patch_registry(monkeypatch, [("A", flaky_a), ("B", flaky_b)])

    svc = LLMService()
    svc._llm = flaky_a
    svc._current_model_index = 0

    result = await svc.call([HumanMessage(content="hi")])

    assert result.content == "from b"
    assert svc._current_model_index == 1, (
        f"expected fallback to index 1, got {svc._current_model_index}"
    )


async def test_fallback_through_all_models(monkeypatch):
    """A and B both exhaust retries; C succeeds."""
    flaky_a = make_flaky_chat_model([_api_error()] * 3)
    flaky_b = make_flaky_chat_model([_api_error()] * 3)
    flaky_c = make_flaky_chat_model([AIMessage(content="from c")])
    patch_registry(
        monkeypatch,
        [("A", flaky_a), ("B", flaky_b), ("C", flaky_c)],
    )

    svc = LLMService()
    svc._llm = flaky_a
    svc._current_model_index = 0

    result = await svc.call([HumanMessage(content="hi")])

    assert result.content == "from c"
    assert svc._current_model_index == 2


async def test_all_models_fail_raises_runtime_error(monkeypatch):
    """All three models exhaust retries — LLMService raises RuntimeError."""
    flaky_a = make_flaky_chat_model([_api_error()] * 3)
    flaky_b = make_flaky_chat_model([_api_error()] * 3)
    flaky_c = make_flaky_chat_model([_api_error()] * 3)
    patch_registry(
        monkeypatch,
        [("A", flaky_a), ("B", flaky_b), ("C", flaky_c)],
    )

    svc = LLMService()
    svc._llm = flaky_a
    svc._current_model_index = 0

    with pytest.raises(RuntimeError, match="after trying 3 models"):
        await svc.call([HumanMessage(content="hi")])
