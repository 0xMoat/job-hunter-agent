"""Integration tests for /api/v1/preferences."""


async def test_get_preferences_returns_404_when_none_set(session_client):
    """Test that GET /preferences returns 404 when no preferences exist."""
    response = await session_client.get("/api/v1/preferences")
    assert response.status_code == 404
    assert response.json()["detail"] == "No preferences set yet"


async def test_put_preferences_creates_and_get_returns_them(session_client):
    """Test that PUT /preferences creates preferences and GET retrieves them."""
    payload = {
        "keywords": "agent engineer",
        "location": "Shanghai",
        "job_type": "fulltime",
    }
    put_response = await session_client.put("/api/v1/preferences", json=payload)
    assert put_response.status_code == 200, put_response.text

    get_response = await session_client.get("/api/v1/preferences")
    assert get_response.status_code == 200
    pref = get_response.json()
    assert pref["keywords"] == "agent engineer"
    assert pref["location"] == "Shanghai"
    assert pref["job_type"] == "fulltime"
