"""Integration tests for /api/v1/search/config (DB-backed parts only).

POST /search/run is deferred — it triggers DuckDuckGo + LLM and needs its own mock strategy.
"""


async def test_get_config_returns_defaults_for_fresh_user(user_client):
    response = await user_client.get("/api/v1/search/config")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {
        "target_sites": "",
        "schedule_enabled": False,
        "schedule_cron": "0 9 * * *",
    }


async def test_put_config_upserts_and_get_returns_it(user_client):
    payload = {
        "target_sites": "linkedin.com, boss.zhipin.com",
        "schedule_enabled": False,
        "schedule_cron": "0 8 * * 1-5",
    }
    put_response = await user_client.put("/api/v1/search/config", json=payload)
    assert put_response.status_code == 200, put_response.text
    assert put_response.json() == payload

    get_response = await user_client.get("/api/v1/search/config")
    assert get_response.status_code == 200
    assert get_response.json() == payload


async def test_put_config_with_invalid_cron_returns_422(user_client):
    response = await user_client.put(
        "/api/v1/search/config",
        json={
            "target_sites": "",
            "schedule_enabled": False,
            "schedule_cron": "not a valid cron at all",
        },
    )
    assert response.status_code == 422
    assert "Invalid cron expression" in response.json()["detail"]


async def test_put_config_with_schedule_enabled_but_no_preference_returns_400(user_client):
    response = await user_client.put(
        "/api/v1/search/config",
        json={
            "target_sites": "",
            "schedule_enabled": True,
            "schedule_cron": "0 9 * * *",
        },
    )
    assert response.status_code == 400
    assert "preference" in response.json()["detail"].lower()
