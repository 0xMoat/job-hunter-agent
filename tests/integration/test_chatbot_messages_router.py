"""Integration tests for /api/v1/chatbot/messages (DB-backed parts only).

Streaming and plan-execute endpoints are deferred — they require an LLM mock
strategy and are out of scope for this bootstrap pass.
"""


async def test_get_messages_returns_empty_list_for_fresh_session(session_client):
    response = await session_client.get("/api/v1/chatbot/messages")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {"messages": []}


async def test_delete_messages_on_empty_session_succeeds(session_client):
    response = await session_client.delete("/api/v1/chatbot/messages")
    assert response.status_code == 200, response.text
    assert response.json() == {"message": "Chat history cleared successfully"}

    # Subsequent GET still returns empty
    get_response = await session_client.get("/api/v1/chatbot/messages")
    assert get_response.status_code == 200
    assert get_response.json() == {"messages": []}
