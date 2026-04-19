"""Shared pytest fixtures for backend tests."""

import os

# CRITICAL: must set APP_ENV before any app.* import — Settings reads it at module load,
# and DatabaseService() is instantiated at app.api.v1.* import time.
os.environ.setdefault("APP_ENV", "test")

from typing import AsyncIterator

import psycopg2
import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient


@pytest.fixture(scope="session")
def _ensure_test_db() -> None:
    """Create the jha_test database if it doesn't exist. Runs once per session."""
    admin_conn = psycopg2.connect(
        host=os.environ["POSTGRES_HOST"],
        port=os.environ["POSTGRES_PORT"],
        dbname="postgres",  # connect to default DB to issue CREATE DATABASE
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
    )
    admin_conn.autocommit = True
    cur = admin_conn.cursor()
    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", (os.environ["POSTGRES_DB"],))
    if cur.fetchone() is None:
        cur.execute(f'CREATE DATABASE "{os.environ["POSTGRES_DB"]}"')
    cur.close()
    admin_conn.close()


@pytest.fixture(scope="session")
def app(_ensure_test_db):
    """Import the FastAPI app once. Triggers Settings load + DatabaseService.create_all."""
    from app.main import app as fastapi_app
    return fastapi_app


@pytest_asyncio.fixture
async def client(app) -> AsyncIterator[AsyncClient]:
    """Async HTTP client bound to the in-process ASGI app — no network, no port."""
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac


@pytest.fixture
def fake_user_id() -> str:
    import uuid
    return str(uuid.uuid4())
