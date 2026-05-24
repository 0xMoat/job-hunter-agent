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


# ============================================================================
# annotate_pe_outcome — write PE terminal status back to chat history so
# chat agent can re-trigger PE on subsequent same-query attempts.
# ============================================================================


@pytest.mark.asyncio
async def test_annotate_pe_outcome_rewrites_handoff_tool_message(monkeypatch):
    """The most recent ToolMessage carrying __plan_execute_handoff__ must be
    rewritten in place with a `status` field so the next LLM turn sees it.
    """
    import json as _json
    from langchain_core.messages import ToolMessage

    handoff_payload = {
        "__plan_execute_handoff__": True,
        "goal": "research X and tailor resume",
        "reason": "multi-step",
    }
    handoff_msg = ToolMessage(
        id="msg-handoff",
        tool_call_id="call_handoff_1",
        content=_json.dumps(handoff_payload, ensure_ascii=False),
    )
    msgs = [
        HumanMessage(content="research X and tailor resume"),
        AIMessage(content="", tool_calls=[{"name": "start_plan_execute", "args": handoff_payload, "id": "call_handoff_1"}]),
        handoff_msg,
    ]

    class _FakeState:
        values = {"messages": msgs}

    captured: dict = {}
    async def _fake_aget_state(config):
        return _FakeState()
    async def _fake_aupdate_state(config, update):
        captured["config"] = config
        captured["update"] = update
        return {}

    fake_graph = type(
        "G",
        (),
        {"aget_state": staticmethod(_fake_aget_state), "aupdate_state": staticmethod(_fake_aupdate_state)},
    )()
    monkeypatch.setattr(main_agent, "_graph", fake_graph, raising=False)

    ok = await main_agent.annotate_pe_outcome("sess-1", "cancelled_by_user", user_feedback="只处理最新2个")

    assert ok is True
    assert captured["config"]["configurable"]["thread_id"] == "sess-1"
    new_msgs = captured["update"]["messages"]
    assert len(new_msgs) == 1
    new = new_msgs[0]
    assert isinstance(new, ToolMessage)
    # Same id → add_messages reducer replaces the original in place
    assert new.id == "msg-handoff"
    assert new.tool_call_id == "call_handoff_1"
    parsed = _json.loads(new.content)
    assert parsed["__plan_execute_handoff__"] is True
    assert parsed["status"] == "cancelled_by_user"
    assert parsed["user_feedback"] == "只处理最新2个"
    # Original goal/reason preserved
    assert parsed["goal"] == "research X and tailor resume"


@pytest.mark.asyncio
async def test_annotate_pe_outcome_noop_when_no_handoff_in_history(monkeypatch):
    """If PE was started via direct API call (no chat handoff), there's no
    handoff tool-message to annotate — must return False without raising.
    """
    msgs = [
        HumanMessage(content="hi"),
        AIMessage(content="hello"),
    ]

    class _FakeState:
        values = {"messages": msgs}

    update_called = {"value": False}
    async def _fake_aget_state(config):
        return _FakeState()
    async def _fake_aupdate_state(config, update):
        update_called["value"] = True
        return {}

    fake_graph = type(
        "G",
        (),
        {"aget_state": staticmethod(_fake_aget_state), "aupdate_state": staticmethod(_fake_aupdate_state)},
    )()
    monkeypatch.setattr(main_agent, "_graph", fake_graph, raising=False)

    ok = await main_agent.annotate_pe_outcome("sess-2", "completed")

    assert ok is False
    assert update_called["value"] is False, "must not write when no handoff is present"


@pytest.mark.asyncio
async def test_annotate_pe_outcome_picks_most_recent_handoff_on_repeat(monkeypatch):
    """When there are multiple handoffs in history (user re-triggered PE),
    the LATEST one gets stamped, not the earliest.
    """
    import json as _json
    from langchain_core.messages import ToolMessage

    p1 = {"__plan_execute_handoff__": True, "goal": "first run", "status": "cancelled_by_user"}
    p2 = {"__plan_execute_handoff__": True, "goal": "second run"}
    msgs = [
        ToolMessage(id="old-handoff", tool_call_id="c1", content=_json.dumps(p1)),
        HumanMessage(content="try again"),
        ToolMessage(id="new-handoff", tool_call_id="c2", content=_json.dumps(p2)),
    ]

    class _FakeState:
        values = {"messages": msgs}

    captured: dict = {}
    async def _fake_aget_state(config):
        return _FakeState()
    async def _fake_aupdate_state(config, update):
        captured["update"] = update
        return {}

    fake_graph = type(
        "G",
        (),
        {"aget_state": staticmethod(_fake_aget_state), "aupdate_state": staticmethod(_fake_aupdate_state)},
    )()
    monkeypatch.setattr(main_agent, "_graph", fake_graph, raising=False)

    ok = await main_agent.annotate_pe_outcome("sess-3", "completed")

    assert ok is True
    written = captured["update"]["messages"][0]
    assert written.id == "new-handoff"
    payload = _json.loads(written.content)
    assert payload["goal"] == "second run"
    assert payload["status"] == "completed"
