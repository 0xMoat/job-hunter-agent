"""Shared pytest fixtures for backend tests."""

import os

from dotenv import load_dotenv

# CRITICAL: must set APP_ENV before any app.* import — Settings reads it at module load,
# and DatabaseService() is instantiated at app.api.v1.* import time.
os.environ.setdefault("APP_ENV", "test")

# Load .env.test to populate POSTGRES_* and other environment variables
load_dotenv(f".env.{os.environ['APP_ENV']}")

import uuid
from typing import AsyncIterator

import psycopg2
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


def _ensure_test_db_at_import() -> None:
    """Create the jha_test database if it doesn't exist.

    MUST run before any `app.*` module is imported by pytest collection:
    several tests import `app.api.v1.chatbot` at module top, which triggers
    `DatabaseService()` to connect to POSTGRES_DB. If the DB doesn't exist yet,
    collection fails before any fixture has a chance to run.
    """
    admin_conn = psycopg2.connect(
        host=os.environ["POSTGRES_HOST"],
        port=os.environ["POSTGRES_PORT"],
        dbname="postgres",
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
    )
    admin_conn.autocommit = True
    try:
        cur = admin_conn.cursor()
        try:
            cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (os.environ["POSTGRES_DB"],))
            if cur.fetchone() is None:
                cur.execute(f'CREATE DATABASE "{os.environ["POSTGRES_DB"]}"')
        finally:
            cur.close()
    finally:
        admin_conn.close()


_ensure_test_db_at_import()


@pytest.fixture(scope="session")
def app():
    """Import the FastAPI app once. Triggers Settings load + DatabaseService.create_all.

    The test DB is guaranteed to exist because `_ensure_test_db_at_import()`
    ran at conftest module load (before any test file was collected).
    """
    from app.main import app as fastapi_app
    return fastapi_app


@pytest_asyncio.fixture
async def client(app) -> AsyncIterator[AsyncClient]:
    """Async HTTP client bound to the in-process ASGI app — no network, no port."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
def fake_user_id() -> str:
    return str(uuid.uuid4())


@pytest_asyncio.fixture
async def test_user(app):
    """Create a fresh test user for each test. Uses uuid-suffixed google_id
    and email so re-runs and parallel test files don't conflict."""
    from app.services.database import DatabaseService

    db = DatabaseService()
    suffix = uuid.uuid4().hex[:12]
    user = await db.upsert_user_by_google_id(
        google_id=f"test-google-{suffix}",
        email=f"test-{suffix}@example.test",
        name=f"Test User {suffix}",
        avatar_url="https://example.test/avatar.png",
    )
    return user


@pytest_asyncio.fixture
async def user_token(test_user) -> str:
    """JWT that passes `get_current_user` dependency."""
    from app.utils.auth import create_access_token

    token = create_access_token(str(test_user.id))
    return token.access_token


@pytest_asyncio.fixture
async def user_client(client, user_token) -> AsyncIterator[AsyncClient]:
    """Async HTTP client pre-authenticated as test_user (user-level JWT)."""
    client.headers["Authorization"] = f"Bearer {user_token}"
    try:
        yield client
    finally:
        client.headers.pop("Authorization", None)


@pytest_asyncio.fixture
async def test_session(test_user):
    """Create a fresh test session owned by test_user."""
    from app.services.database import DatabaseService

    db = DatabaseService()
    session_id = str(uuid.uuid4())
    session = await db.create_session(session_id, test_user.id)
    return session


@pytest_asyncio.fixture
async def session_token(test_session) -> str:
    """JWT that passes `get_current_session` dependency."""
    from app.utils.auth import create_access_token

    token = create_access_token(test_session.id)
    return token.access_token


@pytest_asyncio.fixture
async def session_client(client, session_token) -> AsyncIterator[AsyncClient]:
    """Async HTTP client pre-authenticated with session-level JWT."""
    client.headers["Authorization"] = f"Bearer {session_token}"
    try:
        yield client
    finally:
        client.headers.pop("Authorization", None)
