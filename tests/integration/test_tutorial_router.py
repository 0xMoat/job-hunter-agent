"""Integration tests for /api/v1/tutorial/*."""


async def test_status_for_fresh_user(user_client):
    response = await user_client.get("/api/v1/tutorial/status")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["has_tutorial_session"] is False
    assert body["tutorial_session_id"] is None
    assert body["tutorial_completed"] is False
    assert "resume_is_default" in body


async def test_seed_creates_tutorial_session(user_client):
    seed_response = await user_client.post(
        "/api/v1/tutorial/seed",
        json={"locale": "en"},
    )
    assert seed_response.status_code == 200, seed_response.text
    body = seed_response.json()
    assert isinstance(body["session_id"], str)
    assert len(body["session_id"]) > 0
    assert isinstance(body["name"], str)
    assert len(body["name"]) > 0

    # Status should now reflect the seeded session
    status_response = await user_client.get("/api/v1/tutorial/status")
    status = status_response.json()
    assert status["has_tutorial_session"] is True
    assert status["tutorial_session_id"] == body["session_id"]
    assert status["tutorial_completed"] is False


async def test_dismiss_marks_tutorial_completed(user_client):
    # Seed first so there's a tutorial to dismiss
    await user_client.post("/api/v1/tutorial/seed", json={"locale": "en"})

    dismiss_response = await user_client.post("/api/v1/tutorial/dismiss")
    assert dismiss_response.status_code == 200
    assert dismiss_response.json() == {"ok": True}

    status_response = await user_client.get("/api/v1/tutorial/status")
    assert status_response.json()["tutorial_completed"] is True


async def test_replay_resets_completed_and_ensures_session(user_client):
    # Seed + dismiss to set completed=True
    await user_client.post("/api/v1/tutorial/seed", json={"locale": "en"})
    await user_client.post("/api/v1/tutorial/dismiss")

    # Replay resets completion
    replay_response = await user_client.post(
        "/api/v1/tutorial/replay",
        json={"locale": "en"},
    )
    assert replay_response.status_code == 200, replay_response.text

    status = (await user_client.get("/api/v1/tutorial/status")).json()
    assert status["has_tutorial_session"] is True
    assert status["tutorial_completed"] is False
