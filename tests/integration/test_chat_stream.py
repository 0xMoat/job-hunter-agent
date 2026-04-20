"""Integration tests for POST /api/v1/chatbot/chat/stream — SSE contract.

LLM is mocked at the BaseChatModel boundary; tool execution is not mocked
in C-1 because the scripted LLM returns a plain AIMessage (no tool_calls)
so no tool node is ever reached.
"""

import json
from typing import Any as _Any
from typing import Iterator as _Iterator
from typing import Optional as _Optional

import pytest
from langchain_core.callbacks import CallbackManagerForLLMRun as _CM
from langchain_core.language_models.chat_models import BaseChatModel as _BaseChatModel
from langchain_core.messages import AIMessage
from langchain_core.messages import AIMessage as _AI
from langchain_core.messages import AIMessageChunk as _AIMessageChunk
from langchain_core.messages import BaseMessage as _BaseMessage
from langchain_core.outputs import ChatGeneration as _ChatGeneration
from langchain_core.outputs import ChatGenerationChunk as _ChatGenerationChunk
from langchain_core.outputs import ChatResult as _ChatResult
from langchain_core.tools import Tool

from tests.support.fake_llm import inject_main_llm, make_fake_chat_model


@pytest.fixture
def plain_text_llm(monkeypatch):
    """Inject a fake LLM that replies with one plain AIMessage, then stop."""
    fake = make_fake_chat_model([AIMessage(content="hello from fake llm")])
    inject_main_llm(monkeypatch, fake)
    return fake


async def test_chat_stream_plain_text(session_client, plain_text_llm):
    """A chat_stream request with a scripted plain-text reply produces a valid
    SSE response containing at least one content chunk and a terminal done event."""
    async with session_client.stream(
        "POST",
        "/api/v1/chatbot/chat/stream",
        json={"messages": [{"role": "user", "content": "hi"}]},
    ) as response:
        assert response.status_code == 200, await response.aread()
        body = b""
        async for chunk in response.aiter_bytes():
            body += chunk

    text = body.decode("utf-8")
    # SSE format: each event is "data: {...}\n\n"
    assert "data:" in text, f"response lacks SSE data lines: {text[:500]!r}"

    # Parse SSE events — reassemble streamed text chunks and verify the scripted
    # reply appears. The adapter emits one "type":"text" event per token chunk
    # (LLM streaming), so we concatenate them before matching.
    text_payload = ""
    has_done = False
    for raw in text.split("\n\n"):
        line = raw.strip()
        if not line.startswith("data:"):
            continue
        payload = line[len("data:") :].strip()
        try:
            evt = json.loads(payload)
        except json.JSONDecodeError:
            continue
        if evt.get("type") == "text":
            text_payload += evt.get("content", "")
        if evt.get("done") is True or evt.get("type") == "done":
            has_done = True

    assert "hello from fake llm" in text_payload, (
        f"reassembled text missing scripted reply; got {text_payload!r}; raw={text[-500:]!r}"
    )
    assert has_done, f"response missing terminal done event: {text[-500:]!r}"


class _ScriptedStreamingFake(_BaseChatModel):
    """BaseChatModel subclass that emits proper chunks via `_stream`.

    Why a custom fake instead of GenericFakeChatModel / FakeMessagesListChatModel?
    - GenericFakeChatModel._stream raises on empty content (our first turn
      needs `content="" + tool_calls=[...]`).
    - FakeMessagesListChatModel has no `_stream`, so the chat_stream SSE adapter
      (which taps `stream_mode="messages"`) never sees per-token AIMessageChunks
      for the final content — our test assertion cannot reassemble it.

    By subclassing BaseChatModel and implementing `_stream`, LangChain's runtime
    fires `on_llm_new_token` per chunk (what LangGraph messages-mode consumes)
    AND `BaseChatModel.ainvoke` falls back to `generate_from_stream` to produce
    a well-formed AIMessage for the graph's node return value.
    """

    responses: list = []

    def __init__(self, responses, **kwargs):
        super().__init__(**kwargs)
        # Pydantic field, not a plain attribute
        object.__setattr__(self, "_scripted", list(responses))
        object.__setattr__(self, "_cursor", 0)

    @property
    def _llm_type(self) -> str:
        return "scripted-streaming-fake"

    def bind_tools(self, *_args, **_kwargs):  # called by LLMService
        return self

    def _generate(self, messages, stop=None, run_manager=None, **kwargs):
        msg = self._scripted[self._cursor % len(self._scripted)]
        object.__setattr__(self, "_cursor", self._cursor + 1)
        return _ChatResult(generations=[_ChatGeneration(message=msg)])

    def _stream(
        self,
        messages: list[_BaseMessage],
        stop: _Optional[list[str]] = None,
        run_manager: _Optional[_CM] = None,
        **kwargs: _Any,
    ) -> _Iterator[_ChatGenerationChunk]:
        msg = self._scripted[self._cursor % len(self._scripted)]
        object.__setattr__(self, "_cursor", self._cursor + 1)

        if isinstance(msg, _AI) and msg.tool_calls:
            tcs = [
                {
                    "name": tc["name"],
                    "args": json.dumps(tc.get("args", {})),
                    "id": tc["id"],
                    "index": idx,
                }
                for idx, tc in enumerate(msg.tool_calls)
            ]
            chunk = _ChatGenerationChunk(
                message=_AIMessageChunk(content="", tool_call_chunks=tcs)
            )
            if run_manager:
                run_manager.on_llm_new_token("", chunk=chunk)
            yield chunk
            return

        content = msg.content if isinstance(msg, _AI) else str(msg)
        if not content:
            chunk = _ChatGenerationChunk(message=_AIMessageChunk(content=""))
            if run_manager:
                run_manager.on_llm_new_token("", chunk=chunk)
            yield chunk
            return

        words = content.split(" ")
        for idx, w in enumerate(words):
            piece = w + (" " if idx < len(words) - 1 else "")
            chunk = _ChatGenerationChunk(message=_AIMessageChunk(content=piece))
            if run_manager:
                run_manager.on_llm_new_token(piece, chunk=chunk)
            yield chunk


@pytest.fixture
def tool_calling_llm(monkeypatch):
    """Inject LLM that returns tool_call on first turn, then final content."""
    fake = _ScriptedStreamingFake(
        [
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "duckduckgo_search",
                        "args": {"query": "x"},
                        "id": "call_1",
                    }
                ],
            ),
            AIMessage(content="based on the tool output, the answer is 42"),
        ]
    )
    inject_main_llm(monkeypatch, fake)

    # Inject fake tool via tools_by_name (verified real attribute on LangGraphAgent).
    from app.api.v1.chatbot import agent as main_agent

    fake_tool = Tool.from_function(
        func=lambda query: "mock tool output about " + str(query),
        name="duckduckgo_search",
        description="fake search",
    )
    monkeypatch.setattr(
        main_agent, "tools_by_name", {"duckduckgo_search": fake_tool}, raising=False
    )
    return fake


async def test_chat_stream_with_tool_call(session_client, tool_calling_llm):
    """A chat_stream with a scripted tool_call round-trip surfaces the tool output
    and the final content through the SSE stream."""
    async with session_client.stream(
        "POST",
        "/api/v1/chatbot/chat/stream",
        json={"messages": [{"role": "user", "content": "use the tool"}]},
    ) as response:
        assert response.status_code == 200, await response.aread()
        body = b""
        async for chunk in response.aiter_bytes():
            body += chunk

    text = body.decode("utf-8")

    text_chunks: list[str] = []
    seen_tool_call = False
    seen_tool_result = False
    for raw in text.split("\n\n"):
        line = raw.strip()
        if not line.startswith("data:"):
            continue
        payload = line[len("data:") :].strip()
        if payload == "[DONE]":
            continue
        try:
            evt = json.loads(payload)
        except json.JSONDecodeError:
            continue
        evt_type = evt.get("type")
        if evt_type == "text":
            text_chunks.append(evt.get("content", "") or evt.get("text", ""))
        elif evt_type in ("tool_call_start", "tool_call", "tool_use"):
            seen_tool_call = True
        elif evt_type in ("tool_call_end", "tool_result", "tool_output", "tool_message"):
            seen_tool_result = True

    final_text = "".join(text_chunks)
    assert "the answer is 42" in final_text, (
        f"final content not reassembled from chunks: {final_text!r} "
        f"(raw tail: {text[-500:]!r})"
    )
    # Must see some indication the tool was invoked — either via a dedicated tool event
    # OR the tool output / call id appearing somewhere in the raw stream.
    tool_signal_present = (
        seen_tool_call
        or seen_tool_result
        or "mock tool output about" in text
        or "call_1" in text
    )
    assert tool_signal_present, (
        f"no tool call/result signal found in stream: {text[:1000]!r}"
    )


async def test_chat_stream_done_event_always_fires(session_client, monkeypatch):
    """Even on an empty-content reply the stream must terminate with a done marker."""
    fake = make_fake_chat_model([AIMessage(content="")])
    inject_main_llm(monkeypatch, fake)

    async with session_client.stream(
        "POST",
        "/api/v1/chatbot/chat/stream",
        json={"messages": [{"role": "user", "content": "?"}]},
    ) as response:
        assert response.status_code == 200
        body = b""
        async for chunk in response.aiter_bytes():
            body += chunk

    text = body.decode("utf-8")
    assert (
        "[DONE]" in text
        or '"done"' in text
        or '"type":"done"' in text
        or "event: done" in text
    ), f"response missing terminal done marker: {text[-500:]!r}"
