"""Integration tests for /api/v1/settings/*."""


async def test_get_system_prompt_returns_default_for_fresh_user(user_client):
    response = await user_client.get("/api/v1/settings/system-prompt")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["is_default"] is True
    assert isinstance(body["prompt"], str)
    assert len(body["prompt"]) > 0


async def test_put_and_delete_system_prompt_round_trip(user_client):
    custom = "You are a specialized test-bot. Always reply with 'ack'. {long_term_memory} {current_date_and_time}"

    # Save custom prompt
    put_response = await user_client.put(
        "/api/v1/settings/system-prompt",
        json={"prompt": custom},
    )
    assert put_response.status_code == 200, put_response.text
    put_body = put_response.json()
    assert put_body["prompt"] == custom
    assert put_body["is_default"] is False

    # GET returns the custom prompt
    get_response = await user_client.get("/api/v1/settings/system-prompt")
    assert get_response.status_code == 200
    assert get_response.json()["prompt"] == custom
    assert get_response.json()["is_default"] is False

    # DELETE resets to default
    del_response = await user_client.delete("/api/v1/settings/system-prompt")
    assert del_response.status_code == 200
    del_body = del_response.json()
    assert del_body["is_default"] is True
    assert del_body["prompt"] != custom


async def test_get_resume_returns_null_for_fresh_user(user_client):
    response = await user_client.get("/api/v1/settings/resume")
    assert response.status_code == 200
    assert response.json() == {"resume_text": None}


async def test_put_resume_persists_and_get_returns_it(user_client):
    payload = {"resume_text": "## Test Candidate\n\n10 years of integration testing."}

    put_response = await user_client.put("/api/v1/settings/resume", json=payload)
    assert put_response.status_code == 200, put_response.text
    assert put_response.json()["resume_text"] == payload["resume_text"]

    get_response = await user_client.get("/api/v1/settings/resume")
    assert get_response.status_code == 200
    assert get_response.json()["resume_text"] == payload["resume_text"]


async def test_get_langfuse_url_returns_200_with_url_base_key(user_client):
    response = await user_client.get("/api/v1/settings/langfuse-url")
    assert response.status_code == 200
    body = response.json()
    assert "url_base" in body
