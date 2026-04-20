"""Shared fake LLM helpers for backend tests.

All mocking happens at the BaseChatModel boundary — the stable LangChain public
contract that every downstream LLM call (LLMService, LangGraph agents, tools)
ultimately bottoms out at.

Exports:
    make_fake_chat_model  — scripted message outputs (C, B, most of E)
    make_flaky_chat_model — exception side-effects (A, some E)
    make_structured_fake  — .with_structured_output(Model) chains (E planner/replanner, D)
    inject_main_llm       — swap llm_service._llm + invalidate agent graph caches
    patch_registry        — replace LLMRegistry.LLMS for fallback testing
    disable_tenacity_sleep — make @retry loops not actually sleep in tests
"""

from __future__ import annotations

from typing import Any, List, Tuple
from unittest.mock import AsyncMock

from langchain_core.language_models.chat_models import BaseChatModel
from langchain_core.language_models.fake_chat_models import GenericFakeChatModel
from langchain_core.messages import BaseMessage
from pydantic import BaseModel


def make_fake_chat_model(responses: List[BaseMessage]) -> GenericFakeChatModel:
    """Return a GenericFakeChatModel pre-loaded with scripted responses.

    Each .ainvoke call pulls the next response from the iterator. Crucially,
    GenericFakeChatModel implements `_stream` that splits content into
    AIMessageChunks and fires `on_llm_new_token`, which is what LangGraph's
    `stream_mode="messages"` consumes — so scripted text actually appears in
    the SSE stream (FakeMessagesListChatModel does not emit chunks).

    Each entry should be an AIMessage (optionally with tool_calls) or similar
    BaseMessage subclass.
    """
    return GenericFakeChatModel(messages=iter(responses))


def make_flaky_chat_model(side_effects: List[Any]) -> AsyncMock:
    """Return an AsyncMock shaped like BaseChatModel whose .ainvoke follows a side_effect queue.

    side_effects can mix Exception instances (will be raised) and BaseMessage
    instances (will be returned).
    """
    m = AsyncMock(spec=BaseChatModel)
    m.ainvoke = AsyncMock(side_effect=side_effects)
    return m


def make_structured_fake(schema: type[BaseModel], return_value: BaseModel) -> AsyncMock:
    """Return an AsyncMock mimicking BaseChatModel.with_structured_output(schema).

    The returned mock's .with_structured_output is a plain lambda that returns
    the mock itself, so the `_structured_llm(Plan).ainvoke(...)` chain works.
    .ainvoke returns the given pydantic return_value.
    """
    m = AsyncMock(spec=BaseChatModel)
    # Non-async .with_structured_output returning self preserves the real chain
    m.with_structured_output = lambda _schema, **_kwargs: m
    m.ainvoke = AsyncMock(return_value=return_value)
    return m


def inject_main_llm(monkeypatch, fake) -> None:
    """Swap llm_service._llm with fake and invalidate any cached compiled graphs.

    LangGraphAgent and PlanExecuteAgent both cache `self._graph`; we null those
    so the next invocation rebuilds with the new LLM.
    """
    from app.services.llm import llm_service

    monkeypatch.setattr(llm_service, "_llm", fake)

    # Invalidate main agent graph cache if the module has been imported
    try:
        from app.core.langgraph.graph import agent as main_agent

        monkeypatch.setattr(main_agent, "_llm", fake, raising=False)
        monkeypatch.setattr(main_agent, "_graph", None, raising=False)
    except (ImportError, AttributeError):
        pass

    # Invalidate PE agent graph cache
    try:
        from app.core.langgraph.plan_execute import plan_execute_agent as pe_agent

        monkeypatch.setattr(pe_agent, "_llm", fake, raising=False)
        monkeypatch.setattr(pe_agent, "_graph", None, raising=False)
    except (ImportError, AttributeError):
        pass


def patch_registry(monkeypatch, fakes: List[Tuple[str, Any]]) -> None:
    """Replace LLMRegistry.LLMS with the given fakes.

    fakes is a list of (model_name, model_instance) pairs. Use this when a test
    needs to exercise LLMService._switch_to_next_model (which reads LLMRegistry.LLMS
    directly to find the next instance).
    """
    from app.services.llm import LLMRegistry

    new_llms = [{"name": name, "llm": fake} for name, fake in fakes]
    monkeypatch.setattr(LLMRegistry, "LLMS", new_llms)


def disable_tenacity_sleep(monkeypatch) -> None:
    """Make tenacity's internal sleep a no-op in tests.

    LLMService uses `@retry(wait=wait_exponential(min=2, max=10))`, which would
    sleep multiple seconds between retries. We null the sleep via asyncio.sleep
    patching (tenacity defers to asyncio.sleep for async retries).
    """
    import asyncio

    async def _no_sleep(_duration):
        return None

    monkeypatch.setattr(asyncio, "sleep", _no_sleep)
