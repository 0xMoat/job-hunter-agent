"""Integration tests for /api/v1/listings."""


async def test_get_listings_returns_empty_list_for_fresh_user(session_client):
    """Test that a fresh user with no DB data returns empty listings."""
    response = await session_client.get("/api/v1/listings")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {"listings": [], "count": 0}
