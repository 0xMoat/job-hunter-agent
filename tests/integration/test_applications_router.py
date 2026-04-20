"""Integration tests for /api/v1/applications."""


async def test_list_empty_for_fresh_user(session_client):
    response = await session_client.get("/api/v1/applications")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body == {"applications": [], "count": 0, "archived_count": 0}


async def test_create_then_list_returns_new_application(session_client):
    payload = {
        "company": "Acme Corp",
        "title": "Agent Engineer",
        "url": "https://acme.test/jobs/1",
        "notes": "Met the recruiter at meetup",
        "status": "pending",
    }
    create_response = await session_client.post("/api/v1/applications", json=payload)
    assert create_response.status_code == 201, create_response.text
    created = create_response.json()
    assert created["company"] == "Acme Corp"
    assert created["title"] == "Agent Engineer"
    assert created["status"] == "pending"
    assert "id" in created
    assert created.get("pdf_download_url") is None
    assert "pdf_token" not in created  # should be stripped

    list_response = await session_client.get("/api/v1/applications")
    assert list_response.status_code == 200
    body = list_response.json()
    assert body["count"] == 1
    assert body["applications"][0]["company"] == "Acme Corp"


async def test_patch_updates_status_and_notes(session_client):
    # Create first
    create_resp = await session_client.post(
        "/api/v1/applications",
        json={"company": "Beta Inc", "title": "SDE", "status": "pending"},
    )
    app_id = create_resp.json()["id"]

    # Patch to applied with notes
    patch_resp = await session_client.patch(
        f"/api/v1/applications/{app_id}",
        json={"status": "applied", "notes": "Sent application via referral"},
    )
    assert patch_resp.status_code == 200, patch_resp.text
    updated = patch_resp.json()
    assert updated["status"] == "applied"
    assert updated["notes"] == "Sent application via referral"


async def test_patch_nonexistent_returns_404(session_client):
    response = await session_client.patch(
        "/api/v1/applications/999999",
        json={"status": "applied"},
    )
    assert response.status_code == 404


async def test_delete_removes_application(session_client):
    create_resp = await session_client.post(
        "/api/v1/applications",
        json={"company": "Gamma LLC", "title": "ML Eng", "status": "pending"},
    )
    app_id = create_resp.json()["id"]

    del_resp = await session_client.delete(f"/api/v1/applications/{app_id}")
    assert del_resp.status_code == 200
    assert del_resp.json() == {"message": "Application deleted"}

    # Subsequent delete should 404
    second_del = await session_client.delete(f"/api/v1/applications/{app_id}")
    assert second_del.status_code == 404
