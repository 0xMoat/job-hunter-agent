"""Integration test for the compiled main LangGraph agent — a full ReAct loop.

Uses MemorySaver (not Postgres) for checkpointing. The fake LLM scripts a
two-turn flow: first turn returns a tool_call, second turn returns final content.
"""

from langchain_core.language_models.fake_chat_models import FakeMessagesListChatModel
from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langchain_core.tools import Tool
from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, StateGraph

from app.api.v1.chatbot import agent as main_agent
from app.schemas.graph import GraphState
from tests.support.fake_llm import inject_main_llm


async def test_react_loop_tool_call_then_final_response(monkeypatch):
    # Script: first LLM call -> tool_call message; second LLM call -> final content
    # Use FakeMessagesListChatModel because we need tool_calls preserved (not re-chunked).
    fake = FakeMessagesListChatModel(
        responses=[
            AIMessage(
                content="",
                tool_calls=[
                    {
                        "name": "duckduckgo_search",
                        "args": {"query": "python language"},
                        "id": "call_1",
                    }
                ],
            ),
            AIMessage(content="python is a programming language"),
        ]
    )
    inject_main_llm(monkeypatch, fake)

    # Inject a fake tool via the actual attribute name (tools_by_name dict)
    fake_tool = Tool.from_function(
        func=lambda query: "python is a dynamically-typed language",
        name="duckduckgo_search",
        description="fake search",
    )
    monkeypatch.setattr(
        main_agent, "tools_by_name", {"duckduckgo_search": fake_tool}, raising=False
    )

    # Build an ad-hoc compiled graph with MemorySaver using the agent's real node methods
    builder = StateGraph(GraphState)
    builder.add_node("chat", main_agent._chat, ends=["tool_call", END])
    builder.add_node("tool_call", main_agent._tool_call, ends=["chat"])
    builder.set_entry_point("chat")
    compiled = builder.compile(checkpointer=MemorySaver())

    config = {"configurable": {"thread_id": "test-react-loop"}}
    result = await compiled.ainvoke(
        {"messages": [HumanMessage(content="tell me about python")]},
        config=config,
    )

    messages = result["messages"]
    # There must be a ToolMessage with the fake tool's output somewhere in the trace
    assert any(
        isinstance(m, ToolMessage) and "dynamically-typed" in m.content for m in messages
    ), f"expected ToolMessage with tool output, got {[type(m).__name__ for m in messages]}"
    # Final message must be the LLM's post-tool AIMessage
    final = messages[-1]
    assert isinstance(final, AIMessage), f"expected AIMessage as final, got {type(final)}"
    assert "programming language" in final.content
