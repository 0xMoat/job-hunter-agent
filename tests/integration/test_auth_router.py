"""Integration test for POST /api/v1/auth/google — exercises the full
DB write path, mocking only the external Google token verification."""

import uuid
from unittest.mock import patch

from google.auth import exceptions as google_exceptions


async def test_google_login_creates_user_and_returns_token(client):
    # Use a unique email per run so the test is re-runnable without cleanup
    unique_id = uuid.uuid4().hex[:8]
    fake_payload = {
        "sub": f"google-oauth-id-{unique_id}",
        "email": f"newuser-{unique_id}@example.test",
        "name": "Test User",
        "picture": "https://example.test/avatar.png",
    }

    with patch(
        "app.api.v1.auth.google_id_token.verify_oauth2_token",
        return_value=fake_payload,
    ):
        response = await client.post(
            "/api/v1/auth/google",
            json={"credential": "fake-google-id-token"},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user"]["email"] == fake_payload["email"]
    assert body["user"]["name"] == "Test User"
    assert body["user"]["avatar_url"] == fake_payload["picture"]
    assert isinstance(body["user"]["id"], int)
    # Token schema: {access_token, token_type, expires_at}
    assert "token" in body
    assert isinstance(body["token"]["access_token"], str)
    assert body["token"]["access_token"]
    assert body["token"]["token_type"] == "bearer"
    assert "expires_at" in body["token"]


async def test_google_login_invalid_token_returns_401(client):
    with patch(
        "app.api.v1.auth.google_id_token.verify_oauth2_token",
        side_effect=google_exceptions.GoogleAuthError("invalid token"),
    ):
        response = await client.post(
            "/api/v1/auth/google",
            json={"credential": "garbage"},
        )

    assert response.status_code == 401
    assert "Invalid Google token" in response.json()["detail"]
