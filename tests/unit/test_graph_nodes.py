"""Unit tests for LangGraphAgent node contracts (chat, tool_call).

These tests exercise individual nodes as async functions — no compiled graph,
no streaming. Each node takes (state, config) and returns a Command.
"""

import pytest
from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.tools import Tool
from langgraph.graph import END

from app.api.v1.chatbot import agent as main_agent
from app.schemas.graph import GraphState
from tests.support.fake_llm import inject_main_llm, make_fake_chat_model


# _chat reads config["configurable"]["thread_id"] for logging, so we need a minimal config.
_CONFIG = {"configurable": {"thread_id": "test-thread"}}


@pytest.mark.asyncio
async def test_chat_node_with_no_tool_calls_commands_to_end(monkeypatch):
    fake = make_fake_chat_model([AIMessage(content="final answer, no tool needed")])
    inject_main_llm(monkeypatch, fake)

    state = GraphState(messages=[HumanMessage(content="hi")])
    result = await main_agent._chat(state, config=_CONFIG)

    # Result is a langgraph Command with .goto and .update attributes.
    assert result.goto == END, f"expected END, got {result.goto}"


@pytest.mark.asyncio
async def test_chat_node_with_tool_calls_commands_to_tool_call(monkeypatch):
    tool_call_msg = AIMessage(
        content="",
        tool_calls=[
            {"name": "duckduckgo_search", "args": {"query": "python"}, "id": "call_1"}
        ],
    )
    # Use FakeMessagesListChatModel to preserve the tool_calls field on the returned message.
    fake = FakeMessagesListChatModel(responses=[tool_call_msg])
    inject_main_llm(monkeypatch, fake)

    state = GraphState(messages=[HumanMessage(content="search python")])
    result = await main_agent._chat(state, config=_CONFIG)

    assert result.goto == "tool_call", f"expected 'tool_call', got {result.goto}"


@pytest.mark.asyncio
async def test_tool_call_node_appends_tool_result_and_returns_to_chat(monkeypatch):
    # Agent looks up tools via self.tools_by_name (dict keyed by tool name).
    fake_tool = Tool.from_function(
        func=lambda query: "canned search result for " + query,
        name="duckduckgo_search",
        description="fake search",
    )
    monkeypatch.setattr(
        main_agent, "tools_by_name", {"duckduckgo_search": fake_tool}, raising=False
    )

    # State ending in an AIMessage with a tool_call — _tool_call consumes state.messages[-1].tool_calls
    tool_call_msg = AIMessage(
        content="",
        tool_calls=[
            {"name": "duckduckgo_search", "args": {"query": "python"}, "id": "call_1"}
        ],
    )
    state = GraphState(messages=[HumanMessage(content="search"), tool_call_msg])
    result = await main_agent._tool_call(state, config=_CONFIG)

    assert result.goto == "chat", f"expected 'chat', got {result.goto}"
    # The update must include a messages list with a new ToolMessage at the end
    updated_messages = result.update.get("messages") if result.update else []
    assert any(isinstance(m, ToolMessage) for m in updated_messages), (
        f"expected ToolMessage in update.messages, got {updated_messages}"
    )
