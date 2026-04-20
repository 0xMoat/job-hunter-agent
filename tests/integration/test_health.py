"""Smoke test: confirms ASGI client + app fixture work end-to-end."""


async def test_health_endpoint_returns_ok(client):
    """Test that /health endpoint returns healthy status with correct structure."""
    response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "healthy"
    assert "version" in body
    assert body["environment"] == "test"
    assert body["components"]["api"] == "healthy"
    assert body["components"]["database"] == "healthy"
