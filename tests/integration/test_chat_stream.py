"""Integration tests for POST /api/v1/chatbot/chat/stream — SSE contract.

LLM is mocked at the BaseChatModel boundary; tool execution is not mocked
in C-1 because the scripted LLM returns a plain AIMessage (no tool_calls)
so no tool node is ever reached.
"""

import json

import pytest
from langchain_core.messages import AIMessage

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
