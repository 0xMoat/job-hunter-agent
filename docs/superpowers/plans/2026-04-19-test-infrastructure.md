# Test Infrastructure Bootstrap Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bootstrap a minimal, runnable testing pyramid for both backend and frontend so future features land with regression coverage instead of ad-hoc manual smoke testing.

**Architecture:** Three phases. Phase 1 stands up `pytest` + httpx integration testing for the FastAPI app against a disposable Postgres container. Phase 2 stands up Vitest + React Testing Library for the Next.js frontend. Phase 3 wires both into a GitHub Actions test gate so deploys can no longer ship red. Each phase produces a working test command + a sample test that *actually exercises real code* (not a `assert 1 == 1` smoke test).

**Tech Stack:**
- Backend: `pytest` 8.x, `pytest-asyncio`, `httpx` async client, ephemeral Postgres via existing `docker-compose` `db` service
- Frontend: `vitest` 2.x, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `msw` (only when first API mock is needed — YAGNI for now)
- CI: GitHub Actions matrix job, reuses existing `.github/workflows/deploy.yaml` workflow file

---

## Audit Findings (Why This Plan Exists)

Verified 2026-04-19 against current `master` (commit `f21368f`):

| Area | Current state | Risk |
|---|---|---|
| Backend tests | **0 test files**; `pytest 8.3.5` declared in `[dependency-groups] test` but never invoked | Silent regressions in `auth.py` (recent Google OAuth + tutorial seeding), `tutorial.py` (created 2026-04-18), `scripts/migrate.py` (recent `created_at` bug, mem #102) |
| Backend test deps | `pytest`, `httpx` only — **`pytest-asyncio` missing**, all DB ops + LangGraph are async, so any router test would fail-to-collect | Blocker for first test |
| `DatabaseService` | Module-level singleton (`db_service = DatabaseService()` in routers) fires `create_all` at import time (mem #122) | Tests must boot against real Postgres OR patch before import — picking real Postgres for fidelity |
| Frontend tests | **0 test files, 0 test framework**, no `test` script in `package.json` | Tour/Kanban/SessionContext have grown complex with no safety net |
| CI gate | `.github/workflows/deploy.yaml` runs Docker rebuild + health checks + Vercel deploy — **no `pytest`, no `pnpm test`** | Broken code can reach prod if health endpoint stays green |
| `evals/` | Production-traffic LLM quality scoring via Langfuse, NOT application unit/integration testing | Out of scope; complementary, not substitute |

**Out of scope for this plan (deferred):**
- Playwright E2E (defer until tour/kanban UX freezes — see Phase 4 outline)
- Visual regression / Storybook (design language still iterating)
- Load/performance testing (no SLO defined yet)
- LangGraph node-level unit tests with mocked LLM (large undertaking, separate plan)

---

## File Structure

**Phase 1 (Backend) creates:**
- `tests/__init__.py` — marker package
- `tests/conftest.py` — pytest fixtures: event loop, ephemeral Postgres URL, FastAPI test client, auth helper
- `tests/integration/__init__.py`
- `tests/integration/test_auth_router.py` — first integration test (Google login mocked at the `google_id_token.verify_oauth2_token` boundary)
- `tests/integration/test_tutorial_router.py` — exercises tutorial seed flow against real DB
- `tests/unit/__init__.py`
- `tests/unit/test_migrate_idempotency.py` — runs `scripts/migrate.run()` twice, asserts no error + columns exist
- `Makefile` — add `test` target

**Phase 1 modifies:**
- `pyproject.toml:50` — add `pytest-asyncio>=0.24` to `[dependency-groups] test`
- `pyproject.toml:53-55` — add `[tool.pytest.ini_options].asyncio_mode = "auto"` and `testpaths = ["tests"]`

**Phase 2 (Frontend) creates:**
- `frontend/vitest.config.ts`
- `frontend/vitest.setup.ts` — jest-dom matchers
- `frontend/lib/__tests__/i18n.test.ts` — pure-function unit test (smallest possible real test)
- `frontend/contexts/__tests__/SessionContext.test.tsx` — renders provider, exercises a state transition

**Phase 2 modifies:**
- `frontend/package.json` — add `test`, `test:watch` scripts and devDeps
- `frontend/tsconfig.json` — add `vitest/globals` to `types` if needed

**Phase 3 (CI) creates:**
- `.github/workflows/test.yaml` — runs on PR + push, blocks merge

---

## Phase 1: Backend pytest Bootstrap

### Task 1.1: Add `pytest-asyncio` dependency and pytest config

**Files:**
- Modify: `pyproject.toml:50` and `pyproject.toml:53-55`

- [ ] **Step 1: Edit `pyproject.toml`**

Change line 50 from:
```toml
test = ["httpx>=0.28.1", "pytest>=8.3.5"]
```
to:
```toml
test = ["httpx>=0.28.1", "pytest>=8.3.5", "pytest-asyncio>=0.24.0"]
```

Change the `[tool.pytest.ini_options]` block (lines 53-55) from:
```toml
[tool.pytest.ini_options]
markers = ["slow: marks tests as slow (deselect with '-m \"not slow\"')"]
python_files = ["test_*.py", "*_test.py", "tests.py"]
```
to:
```toml
[tool.pytest.ini_options]
markers = ["slow: marks tests as slow (deselect with '-m \"not slow\"')"]
python_files = ["test_*.py", "*_test.py", "tests.py"]
testpaths = ["tests"]
asyncio_mode = "auto"
```

- [ ] **Step 2: Sync deps**

Run: `uv sync --group test`
Expected: pytest-asyncio installed, no errors.

- [ ] **Step 3: Commit**

```bash
git add pyproject.toml uv.lock
git commit -m "test: add pytest-asyncio and configure testpaths"
```

---

### Task 1.2: Add `make test` target

**Files:**
- Modify: `Makefile` (append a new target)

- [ ] **Step 1: Add target**

Append to `Makefile`:
```makefile
test:
	APP_ENV=test uv run pytest -v

test-fast:
	APP_ENV=test uv run pytest -v -m "not slow"
```

- [ ] **Step 2: Verify** (will collect 0 tests, exit code 5)

Run: `make test || true`
Expected: pytest output "no tests ran" — confirms wiring works.

- [ ] **Step 3: Commit**

```bash
git add Makefile
git commit -m "test: add make test/test-fast targets"
```

---

### Task 1.3: Create `.env.test` and ephemeral test database fixture

**Files:**
- Create: `.env.test`
- Create: `tests/__init__.py` (empty)
- Create: `tests/conftest.py`

The `DatabaseService` singleton is instantiated at module import time and runs `create_all` against whatever Postgres `Settings` resolves. We set `APP_ENV=test` so it loads `.env.test`, which points at a separate database name on the same local Postgres.

- [ ] **Step 1: Create `.env.test`**

```bash
# Test environment — uses local Postgres (same instance as dev), separate DB name
APP_ENV=test
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=jha_test
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
JWT_SECRET_KEY=test-secret-do-not-use-in-prod
LLM_API_KEY=sk-test-fake
LANGFUSE_PUBLIC_KEY=pk-lf-test
LANGFUSE_SECRET_KEY=sk-lf-test
LANGFUSE_HOST=http://localhost:3000
GOOGLE_CLIENT_ID=test-client-id.apps.googleusercontent.com
DEFAULT_LLM_TEMPERATURE=0.0
MAX_TOKENS=2000
LOG_LEVEL=WARNING
```

(Adjust env var names if `app/core/config.py:Settings` uses different keys — read `Settings.model_fields` to verify.)

- [ ] **Step 2: Create `tests/__init__.py`** (empty file)

- [ ] **Step 3: Create `tests/conftest.py`**

```python
"""Shared pytest fixtures for backend tests."""

import os

# CRITICAL: must set APP_ENV before any app.* import — Settings reads it at module load,
# and DatabaseService() is instantiated at app.api.v1.* import time.
os.environ.setdefault("APP_ENV", "test")

import asyncio
import uuid
from typing import AsyncIterator, Iterator

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
    return str(uuid.uuid4())
```

- [ ] **Step 4: Smoke-run**

Pre-req: local Postgres running on `localhost:5432` with `postgres/postgres` superuser. (Already true in dev — `docker-compose up db` if not.)

Run: `make test`
Expected: Still "no tests ran" but no collection errors. If you see `ImportError` from `app.main`, fix the env vars in `.env.test` to match what `Settings` requires.

- [ ] **Step 5: Commit**

```bash
git add .env.test tests/__init__.py tests/conftest.py
git commit -m "test: add conftest with ephemeral test DB and ASGI client fixture"
```

---

### Task 1.4: First integration test — `GET /health` (smoke, proves the wiring)

**Files:**
- Create: `tests/integration/__init__.py` (empty)
- Create: `tests/integration/test_health.py`

- [ ] **Step 1: Write the failing test**

Create `tests/integration/test_health.py`:
```python
"""Smoke test: confirms ASGI client + app fixture work end-to-end."""


async def test_health_endpoint_returns_ok(client):
    response = await client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body.get("status") == "healthy" or body.get("status") == "ok"
```

(If you don't know the exact response shape, run `grep -rn "/health" app/` first to find the handler and adjust the assertion.)

- [ ] **Step 2: Run test**

Run: `make test`
Expected: 1 test passes. If it fails on response shape, fix the assertion to match `app/main.py`'s `/health` handler — do NOT change the handler.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/__init__.py tests/integration/test_health.py
git commit -m "test: add /health smoke test"
```

---

### Task 1.5: Migration idempotency unit test

**Files:**
- Create: `tests/unit/__init__.py` (empty)
- Create: `tests/unit/test_migrate_idempotency.py`

This guards the exact bug class from mem #102 (`session.created_at` collided with `BaseModel.created_at`).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/test_migrate_idempotency.py`:
```python
"""Migration must be safely re-runnable. Reproduces the failure mode from
the 2026-04-18 session.created_at incident (mem #102)."""

import psycopg2
import pytest

from scripts import migrate


def _columns(table: str) -> set[str]:
    import os
    conn = psycopg2.connect(
        host=os.environ["POSTGRES_HOST"],
        port=os.environ["POSTGRES_PORT"],
        dbname=os.environ["POSTGRES_DB"],
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
    )
    cur = conn.cursor()
    cur.execute(
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = %s",
        (table,),
    )
    cols = {row[0] for row in cur.fetchall()}
    cur.close()
    conn.close()
    return cols


def test_migrate_run_is_idempotent(app):
    """Running migrate.run() twice must not raise and must leave schema unchanged."""
    # First run
    migrate.run()
    cols_after_first = _columns("applications")

    # Second run — must be a no-op, no DuplicateColumn errors
    migrate.run()
    cols_after_second = _columns("applications")

    assert cols_after_first == cols_after_second
    # Spot-check a few columns from the kanban migration
    assert "snippet" in cols_after_first
    assert "match_score" in cols_after_first
```

- [ ] **Step 2: Run test**

Run: `uv run pytest tests/unit/test_migrate_idempotency.py -v`
Expected: PASS. If it fails because `applications` table doesn't exist, the `app` fixture (which triggers `create_all`) wasn't reached — verify `tests/unit/conftest.py` isn't shadowing `tests/conftest.py`.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/__init__.py tests/unit/test_migrate_idempotency.py
git commit -m "test: add migration idempotency regression test"
```

---

### Task 1.6: Auth router integration test (the hardest one — establishes the pattern)

**Files:**
- Create: `tests/integration/test_auth_router.py`

Goal: prove a real router can be tested against a real DB with the external Google OAuth call mocked at its boundary.

- [ ] **Step 1: Find the Google verify call site**

Run: `grep -n "verify_oauth2_token" app/api/v1/auth.py`
Note the exact import path — typically `google.oauth2.id_token.verify_oauth2_token`. It's monkey-patched via the symbol *as imported into auth.py*: `app.api.v1.auth.google_id_token.verify_oauth2_token`.

- [ ] **Step 2: Write the test**

Create `tests/integration/test_auth_router.py`:
```python
"""Integration test for POST /api/v1/auth/google — exercises the full
DB write path, mocking only the external Google token verification."""

from unittest.mock import patch


async def test_google_login_creates_user_and_returns_token(client):
    fake_google_payload = {
        "sub": "google-oauth-id-12345",
        "email": "newuser@example.test",
        "name": "Test User",
        "picture": "https://example.test/avatar.png",
    }

    with patch(
        "app.api.v1.auth.google_id_token.verify_oauth2_token",
        return_value=fake_google_payload,
    ):
        response = await client.post(
            "/api/v1/auth/google",
            json={"id_token": "fake-google-id-token"},
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert "access_token" in body
    assert body["user"]["email"] == "newuser@example.test"


async def test_google_login_invalid_token_returns_401(client):
    from google.auth import exceptions as google_exceptions

    with patch(
        "app.api.v1.auth.google_id_token.verify_oauth2_token",
        side_effect=google_exceptions.GoogleAuthError("invalid token"),
    ):
        response = await client.post(
            "/api/v1/auth/google",
            json={"id_token": "garbage"},
        )

    assert response.status_code == 401
```

- [ ] **Step 3: Run**

Run: `uv run pytest tests/integration/test_auth_router.py -v`
Expected: 2 tests pass. If routes are mounted at a different prefix, fix the URL — do NOT change the router.

If the test leaves a stray user row that breaks re-runs, add a per-test cleanup fixture:
```python
@pytest_asyncio.fixture(autouse=True)
async def _cleanup_users():
    yield
    # delete users created during the test
    from app.services.database import db_service  # adjust import
    # ...
```
(Skip cleanup if the test already uses unique emails per run via `uuid`.)

- [ ] **Step 4: Commit**

```bash
git add tests/integration/test_auth_router.py
git commit -m "test: add Google OAuth login integration test"
```

---

### Task 1.7: Document the backend test workflow in `CLAUDE.md`

**Files:**
- Modify: `CLAUDE.md` (append a "Testing" section under "Commands")

- [ ] **Step 1: Edit `CLAUDE.md`**

Add under the existing `## Commands` block, after the `make eval-no-report` line:
```markdown
# Testing
make test                        # Run all tests (requires local Postgres on :5432)
make test-fast                   # Skip @pytest.mark.slow tests
uv run pytest tests/integration -v   # Integration only
uv run pytest -k "auth"          # Filter by name
```

And update the `There are no automated tests in this repository.` line — change to:
```markdown
Tests live in `tests/` (`tests/unit/`, `tests/integration/`). Run with `make test`. Tests require a local Postgres on `:5432` reachable as `postgres/postgres`; the fixture creates a `jha_test` database automatically. See `tests/conftest.py` for the test client + DB fixture.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document backend testing workflow"
```

---

## Phase 2: Frontend Vitest Bootstrap

### Task 2.1: Install Vitest + RTL + jsdom

**Files:**
- Modify: `frontend/package.json`

- [ ] **Step 1: Install**

Run from `frontend/`:
```bash
pnpm add -D vitest @vitest/ui jsdom \
  @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

- [ ] **Step 2: Add scripts**

Edit `frontend/package.json`, change the `scripts` block to:
```json
"scripts": {
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "eslint",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:ui": "vitest --ui"
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml
git commit -m "test(frontend): add vitest, RTL, jsdom"
```

---

### Task 2.2: Vitest config + setup file

**Files:**
- Create: `frontend/vitest.config.ts`
- Create: `frontend/vitest.setup.ts`

- [ ] **Step 1: Create `frontend/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "dist"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
```

- [ ] **Step 2: Install vite react plugin** (needed by config above)

```bash
pnpm add -D @vitejs/plugin-react
```

- [ ] **Step 3: Create `frontend/vitest.setup.ts`**

```typescript
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 4: Verify wiring** (no tests yet → exit code 1, but no config errors)

Run from `frontend/`: `pnpm test || true`
Expected: vitest reports "No test files found" — config is valid.

- [ ] **Step 5: Commit**

```bash
git add frontend/vitest.config.ts frontend/vitest.setup.ts frontend/package.json frontend/pnpm-lock.yaml
git commit -m "test(frontend): add vitest config and setup"
```

---

### Task 2.3: First unit test — `lib/i18n.ts` pure function

**Files:**
- Create: `frontend/lib/__tests__/i18n.test.ts`

Pick the smallest pure function in `frontend/lib/i18n.ts` to test. If `i18n.ts` exports something like `t(key, locale)` or `getDictionary(locale)`, test that.

- [ ] **Step 1: Read the i18n module**

Run: `cat frontend/lib/i18n.ts | head -60`
Pick a function with no side effects. Note its exact signature.

- [ ] **Step 2: Write the test** (replace the function name + assertions with what `i18n.ts` actually exports)

Create `frontend/lib/__tests__/i18n.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
// Adjust the import to match the real export from lib/i18n.ts
import { t } from "@/lib/i18n";

describe("i18n.t", () => {
  it("returns the Chinese string for a known key in zh-CN", () => {
    const result = t("common.save", "zh-CN");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("returns the English string for a known key in en", () => {
    const result = t("common.save", "en");
    expect(typeof result).toBe("string");
    expect(result.length).toBeGreaterThan(0);
  });

  it("falls back gracefully for an unknown key", () => {
    const result = t("this.key.does.not.exist", "en");
    // Expectation depends on implementation: either returns the key, undefined, or empty string
    expect(result === "this.key.does.not.exist" || result === "" || result === undefined).toBe(true);
  });
});
```

- [ ] **Step 3: Run**

Run from `frontend/`: `pnpm test`
Expected: 3 tests pass. If imports fail, adjust the import path or function name to match `lib/i18n.ts`.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/__tests__/i18n.test.ts
git commit -m "test(frontend): add i18n pure-function unit test"
```

---

### Task 2.4: First component test — render `SessionContext` provider

**Files:**
- Create: `frontend/contexts/__tests__/SessionContext.test.tsx`

- [ ] **Step 1: Read `SessionContext` exports**

Run: `grep -n "export" frontend/contexts/SessionContext.tsx`
Note the provider name and the hook (typically `SessionProvider` + `useSession`).

- [ ] **Step 2: Write the test**

Create `frontend/contexts/__tests__/SessionContext.test.tsx`:
```typescript
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
// Adjust imports to match the real exports
import { SessionProvider, useSession } from "@/contexts/SessionContext";

function Probe() {
  const session = useSession();
  return <div data-testid="probe">{session ? "has-context" : "no-context"}</div>;
}

describe("SessionContext", () => {
  it("provides context value to children inside the provider", () => {
    render(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    expect(screen.getByTestId("probe")).toHaveTextContent("has-context");
  });
});
```

If `SessionProvider` requires props (e.g. an initial session list) or makes a `fetch` call on mount, mock the fetch with `vi.stubGlobal("fetch", vi.fn().mockResolvedValue(...))` in a `beforeEach`. Don't over-engineer this — skip the test and add a TODO if mocking gets gnarly; come back when MSW is introduced.

- [ ] **Step 3: Run**

Run from `frontend/`: `pnpm test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add frontend/contexts/__tests__/SessionContext.test.tsx
git commit -m "test(frontend): add SessionContext provider render test"
```

---

## Phase 3: CI Test Gate

### Task 3.1: Add GitHub Actions test workflow

**Files:**
- Create: `.github/workflows/test.yaml`

- [ ] **Step 1: Create the workflow**

```yaml
name: Tests

on:
  pull_request:
  push:
    branches: [master]

jobs:
  backend:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    steps:
      - uses: actions/checkout@v4
      - uses: astral-sh/setup-uv@v4
        with:
          enable-cache: true
      - name: Set up Python
        run: uv python install 3.13
      - name: Install dependencies
        run: uv sync --group test
      - name: Copy .env.test
        run: cp .env.test .env.test.ci
      - name: Run pytest
        env:
          APP_ENV: test
          POSTGRES_HOST: localhost
          POSTGRES_PORT: "5432"
          POSTGRES_DB: jha_test
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
        run: uv run pytest -v

  frontend:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: frontend
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: pnpm
          cache-dependency-path: frontend/pnpm-lock.yaml
      - run: pnpm install --frozen-lockfile
      - run: pnpm test
```

- [ ] **Step 2: Verify locally** (lint the YAML)

Run: `python -c "import yaml; yaml.safe_load(open('.github/workflows/test.yaml'))"`
Expected: no error.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/test.yaml
git commit -m "ci: add backend + frontend test workflow"
```

- [ ] **Step 4: Push and observe**

```bash
git push
```
Expected: A new "Tests" check appears on the next PR. If the workflow fails on first run, fix root causes (env vars, DB connection) — do NOT add `continue-on-error`.

---

### Task 3.2: Make the existing deploy workflow depend on tests passing

**Files:**
- Modify: `.github/workflows/deploy.yaml`

- [ ] **Step 1: Read current deploy workflow**

Run: `cat .github/workflows/deploy.yaml`
Identify the top-level deploy job name(s).

- [ ] **Step 2: Add `needs:` gate**

For each deploy job, add:
```yaml
  deploy-job-name:
    needs: [backend, frontend]   # adjust to match the test workflow
    ...
```

If the deploy workflow runs on a different trigger than the test workflow (e.g. only on `push` to master), they need to share the same trigger before `needs:` can chain them. Simplest fix: convert deploy to run on `workflow_run` after Tests succeeds. If that's a bigger change than expected, **stop and surface it** rather than improvising.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy.yaml
git commit -m "ci: gate deploy on tests passing"
```

---

## Phase 4: Deferred Scope (Outline Only — Separate Plans)

Document these so they don't get forgotten, but don't expand into tasks here.

| Item | Trigger to start | Estimated scope |
|---|---|---|
| Playwright E2E (login → chat stream → save JD → kanban) | After onboarding tour merges to master and UX stops churning | 1–2 days |
| LangGraph node-level tests with mocked LLM (`plan_execute`, `score_jd_match`, `company_research`) | When a regression in agent behavior actually bites | 2–3 days, needs LLM mock strategy decision (record/replay vs stub) |
| MSW for frontend API mocking | When the second component test needs to mock `fetch` | 0.5 day |
| Storybook + visual regression | After design language stabilizes (Cool Blue + tour CSS settled) | 2 days |
| Lighthouse CI / `/benchmark` perf budget | When a real perf SLO is defined | 1 day |
| Load test for SSE chat streaming | When concurrent user count becomes a concern | 1 day |

---

## Self-Review Checklist

Spec coverage:
- ✅ Backend pytest skeleton — Tasks 1.1–1.3
- ✅ Migration idempotency regression — Task 1.5
- ✅ First real router integration test — Task 1.6
- ✅ Frontend Vitest + RTL skeleton — Tasks 2.1–2.4
- ✅ CI gate — Tasks 3.1–3.2
- ✅ Deferred items documented — Phase 4

Placeholder scan: No "TBD" / "implement later" / "add appropriate error handling" found. All code blocks are concrete; tests with adjustable assertions explicitly say "adjust to match real export."

Type consistency: `client` fixture name reused across all integration tests; `app` fixture cited consistently; `SessionProvider`/`useSession` named consistently in Task 2.4.

Risks called out inline:
- DB fixture requires local Postgres reachable as `postgres/postgres` — documented in Task 1.3 + Task 1.7
- `verify_oauth2_token` patch path may differ from assumed — Task 1.6 Step 1 verifies first
- Deploy workflow trigger may not chain cleanly — Task 3.2 Step 2 says "stop and surface"
