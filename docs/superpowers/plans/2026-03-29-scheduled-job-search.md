# Scheduled Job Search with Resume Matching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user configurable job search scheduling, multi-site search, resume storage, and LLM-based job-resume match scoring (0–100) displayed on kanban cards.

**Architecture:** New `SearchConfig` model stores per-user search settings; `_search_for_user()` becomes the reusable core function called by both the manual trigger API (`POST /search/run`) and the APScheduler per-user cron jobs; `ScoringService` instantiates its own `LLMService` per batch to avoid shared-singleton race conditions.

**Tech Stack:** FastAPI, SQLModel, APScheduler (AsyncIOScheduler + CronTrigger), LangChain (HumanMessage/SystemMessage), DuckDuckGo, Next.js (App Router), TypeScript, React

---

## File Map

### New files
| File | Responsibility |
|------|----------------|
| `app/models/search_config.py` | `SearchConfig` SQLModel table |
| `app/services/scoring_service.py` | `score_job()` — LLM-based 0–100 scorer |
| `app/api/v1/search.py` | `GET/PUT /search/config`, `POST /search/run` |

### Modified files
| File | Change |
|------|--------|
| `app/models/user.py` | Add `resume_text: Optional[str]` |
| `app/models/application.py` | Add `match_score: Optional[int]` |
| `app/services/database.py` | Add `noqa` import of `SearchConfig`; add `get_user_by_id`, `update_user_resume` methods |
| `app/services/job_service.py` | Add `upsert_search_config`, `get_search_config`, `get_all_search_configs`; update `batch_create_pending` to accept `match_score` |
| `app/core/scheduler.py` | Refactor to `_search_for_user()`, per-user scheduling, `async setup_scheduler()` |
| `app/core/config.py` | Add `"search": ["30 per minute"]` rate limit key |
| `app/api/v1/settings.py` | Add `GET/PUT /settings/resume` endpoints |
| `app/api/v1/api.py` | Register `search_router` |
| `app/main.py` | `await setup_scheduler()` |
| `frontend/lib/types.ts` | Add `match_score?: number` to `Application` |
| `frontend/lib/api.ts` | Add resume + search config API functions |
| `frontend/lib/i18n.ts` | Add i18n keys for new UI |
| `frontend/components/tracker/KanbanCard.tsx` | Score badge next to source badge |
| `frontend/components/tracker/KanbanBoard.tsx` | Sort pending column by score; accept `refreshKey` |
| `frontend/components/settings/SystemPromptModal.tsx` → `SettingsModal.tsx` | Rename; add Resume + Search Settings tabs |
| `frontend/app/chat/page.tsx` | Update import; pass `onSearchComplete` to `SettingsModal`; `key={kanbanRefreshKey}` on `KanbanBoard` |

---

## Task 1: Backend data models

**Files:**
- Create: `app/models/search_config.py`
- Modify: `app/models/user.py`
- Modify: `app/models/application.py`
- Modify: `app/services/database.py` (import + 2 new methods)

> Note: No automated tests exist in this repo. Skip TDD steps; implement and commit directly.

- [ ] **Step 1: Create `app/models/search_config.py`**

```python
"""SearchConfig model — per-user job search configuration."""

from datetime import UTC, datetime
from typing import Optional

from sqlmodel import Field, SQLModel, UniqueConstraint


class SearchConfig(SQLModel, table=True):
    """Stores per-user job search configuration: target sites and schedule."""

    __tablename__ = "search_configs"
    __table_args__ = (UniqueConstraint("user_id", name="uq_search_configs_user_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    target_sites: str = Field(default="")
    schedule_enabled: bool = Field(default=False)
    schedule_cron: str = Field(default="0 9 * * *")
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
```

- [ ] **Step 2: Add `resume_text` to `app/models/user.py`**

Find the `system_prompt` field and add `resume_text` directly below it:

```python
resume_text: Optional[str] = Field(default=None)
```

- [ ] **Step 3: Add `match_score` to `app/models/application.py`**

Add to the Application model fields (near `snippet`):

```python
match_score: Optional[int] = Field(default=None, ge=0, le=100)
```

- [ ] **Step 4: Register `SearchConfig` in `app/services/database.py`**

Find the existing `noqa` model imports (lines ~27–29) and add:

```python
from app.models.search_config import SearchConfig  # noqa: F401
```

- [ ] **Step 5: Add `get_user_by_id` and `update_user_resume` to `DatabaseService` in `app/services/database.py`**

Add both methods after the existing `update_user_system_prompt` method (follow its exact pattern):

```python
async def get_user_by_id(self, user_id: int) -> Optional[User]:
    """Fetch a user by primary key.

    Args:
        user_id: The user's primary key.

    Returns:
        Optional[User]: The user if found, None otherwise.
    """
    with Session(self.engine) as session:
        return session.get(User, user_id)

async def update_user_resume(self, user_id: int, resume_text: Optional[str]) -> User:
    """Set or clear a user's resume text.

    Args:
        user_id: The ID of the user to update.
        resume_text: Plain-text resume, or None to clear.

    Returns:
        User: The updated user.

    Raises:
        HTTPException: If the user is not found.
    """
    with Session(self.engine) as session:
        user = session.get(User, user_id)
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        user.resume_text = resume_text
        session.add(user)
        session.commit()
        session.refresh(user)
        logger.info("user_resume_updated", user_id=user_id, has_resume=resume_text is not None)
        return user
```

`HTTPException` is already imported. Add `Optional` to the `typing` import if not already present.

- [ ] **Step 6: Commit**

```bash
git add app/models/search_config.py app/models/user.py app/models/application.py app/services/database.py
git commit -m "feat: add SearchConfig model, resume_text, match_score fields"
```

---

## Task 2: Job service extensions

**Files:**
- Modify: `app/services/job_service.py`

- [ ] **Step 1: Add imports to `job_service.py`**

At the top of the file, add (after existing imports):

```python
from datetime import UTC, datetime

from app.models.search_config import SearchConfig
```

`Optional`, `List`, `select` are likely already imported; verify and add if missing.

- [ ] **Step 2: Add search config methods to `JobService`**

Add after the existing methods (before the module-level singleton):

```python
async def upsert_search_config(
    self,
    user_id: int,
    target_sites: str,
    schedule_enabled: bool,
    schedule_cron: str,
) -> SearchConfig:
    """Create or update the search config for a user."""
    with Session(self._engine) as session:
        existing = session.exec(
            select(SearchConfig).where(SearchConfig.user_id == user_id)
        ).first()
        if existing:
            existing.target_sites = target_sites
            existing.schedule_enabled = schedule_enabled
            existing.schedule_cron = schedule_cron
            existing.updated_at = datetime.now(UTC)
            session.add(existing)
            session.commit()
            session.refresh(existing)
            return existing
        config = SearchConfig(
            user_id=user_id,
            target_sites=target_sites,
            schedule_enabled=schedule_enabled,
            schedule_cron=schedule_cron,
        )
        session.add(config)
        session.commit()
        session.refresh(config)
        return config

async def get_search_config(self, user_id: int) -> Optional[SearchConfig]:
    """Return the search config for a user, or None if not yet created."""
    with Session(self._engine) as session:
        return session.exec(
            select(SearchConfig).where(SearchConfig.user_id == user_id)
        ).first()

async def get_all_search_configs(self) -> List[SearchConfig]:
    """Return all search configs with schedule_enabled=True."""
    with Session(self._engine) as session:
        return list(
            session.exec(
                select(SearchConfig).where(SearchConfig.schedule_enabled == True)  # noqa: E712
            ).all()
        )
```

- [ ] **Step 3: Update `batch_create_pending` to accept `match_score`**

Find the `batch_create_pending` method. Each `item` dict in the listings list already has keys like `title`, `company`, `url`, `snippet`. Add `match_score` extraction when constructing the `Application` object:

```python
match_score=item.get("match_score"),
```

Add this line in the Application constructor call inside `batch_create_pending`. The exact location depends on the existing code — find where `Application(...)` is constructed and add `match_score=item.get("match_score")` to it.

- [ ] **Step 4: Commit**

```bash
git add app/services/job_service.py
git commit -m "feat: add search config service methods, match_score in batch_create_pending"
```

---

## Task 3: Scoring service

**Files:**
- Create: `app/services/scoring_service.py`

- [ ] **Step 1: Create `app/services/scoring_service.py`**

```python
"""LLM-based job-resume match scoring (0–100)."""

import json
from typing import Optional

from langchain_core.messages import HumanMessage, SystemMessage

from app.core.logging import logger
from app.services.llm import LLMService

_SYSTEM_PROMPT = (
    "You are a job-resume matching expert. "
    "Given a job listing and a resume, output ONLY a JSON object: {\"score\": N} "
    "where N is an integer from 0 to 100. "
    "100 means perfect match, 0 means completely irrelevant. "
    "Output only the JSON object, no markdown, no explanation."
)


async def score_job(
    job_title: str,
    snippet: str,
    resume_text: str,
    llm: LLMService,
) -> Optional[int]:
    """Score how well a job listing matches the user's resume.

    Args:
        job_title: Job title from search result.
        snippet: Short job description snippet.
        resume_text: User's plain-text resume.
        llm: LLMService instance owned by the caller (one per batch, not per call).

    Returns:
        Integer score 0–100, or None if scoring fails (non-blocking).
    """
    user_content = (
        f"Job Title: {job_title}\n"
        f"Job Description: {snippet}\n\n"
        f"Resume:\n{resume_text[:3000]}"
    )
    try:
        messages = [
            SystemMessage(content=_SYSTEM_PROMPT),
            HumanMessage(content=user_content),
        ]
        response = await llm.call(messages)
        text = response.content.strip()
        # Strip markdown code fences if the model wraps the JSON
        if text.startswith("```"):
            parts = text.split("```")
            text = parts[1].lstrip("json").strip() if len(parts) > 1 else text
        data = json.loads(text)
        score = int(data["score"])
        return max(0, min(100, score))
    except Exception as e:
        logger.warning("job_scoring_failed", job_title=job_title, error=str(e))
        return None
```

- [ ] **Step 2: Commit**

```bash
git add app/services/scoring_service.py
git commit -m "feat: add scoring_service for LLM-based job-resume matching"
```

---

## Task 4: Scheduler refactor

**Files:**
- Modify: `app/core/scheduler.py`
- Modify: `app/main.py`

- [ ] **Step 1: Rewrite `app/core/scheduler.py`**

Replace the entire file contents with:

```python
"""APScheduler setup for per-user automated job search."""

import asyncio
import functools
from typing import Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from langchain_community.utilities import DuckDuckGoSearchAPIWrapper

from app.core.logging import logger
from app.models.job_preference import JobPreference
from app.models.search_config import SearchConfig
from app.services.job_service import job_service
from app.services.llm import LLMService
from app.services.scoring_service import score_job

scheduler = AsyncIOScheduler()
_wrapper = DuckDuckGoSearchAPIWrapper()


async def _search_for_user(
    user_id: int,
    pref: Optional[JobPreference],
    config: Optional[SearchConfig],
    resume_text: Optional[str],
) -> dict:
    """Run job search for one user and create pending kanban cards.

    Args:
        user_id: The user to search for.
        pref: The user's job preference (keywords, location, job_type).
        config: The user's search config (target_sites, schedule settings).
        resume_text: The user's plain-text resume for scoring, or None.

    Returns:
        dict with keys "inserted" and "skipped".
    """
    if pref is None:
        logger.warning("job_search_skipped_no_pref", user_id=user_id)
        return {"inserted": 0, "skipped": 0}

    base_query = f"{pref.keywords} job {pref.location} {pref.job_type}"
    queries = []

    if config and config.target_sites:
        sites = [s.strip() for s in config.target_sites.split(",") if s.strip()]
        for site in sites:
            queries.append(f"{base_query} site:{site}")

    if not queries:
        queries = [base_query]

    num_results = 5 if len(queries) > 1 else 10
    all_results: list[dict] = []
    seen_urls: set[str] = set()

    for query in queries:
        try:
            raw = await asyncio.get_running_loop().run_in_executor(
                None,
                functools.partial(_wrapper.results, query, num_results=num_results),
            )
            for r in raw:
                url = r.get("link", "")
                if url and url not in seen_urls:
                    seen_urls.add(url)
                    all_results.append(
                        {
                            "title": r.get("title", ""),
                            "company": "",
                            "location": pref.location,
                            "url": url,
                            "snippet": r.get("snippet", ""),
                        }
                    )
        except Exception:
            logger.exception("job_search_query_failed", user_id=user_id, query=query)

    # Score each result against the resume (one LLMService per batch)
    if resume_text and all_results:
        llm = LLMService()
        for item in all_results:
            item["match_score"] = await score_job(
                item["title"], item["snippet"], resume_text, llm
            )

    result = await job_service.batch_create_pending(user_id, all_results)
    # archive_stale_pending() operates globally across all users — this is acceptable
    # for scheduled runs, but when called from POST /search/run it archives cards
    # for all users, not just the triggering user. This matches the existing behavior
    # and is intentional at the current scale.
    await job_service.archive_stale_pending()

    logger.info(
        "job_search_user_done",
        user_id=user_id,
        keywords=pref.keywords,
        inserted=result.get("inserted", 0),
        skipped=result.get("skipped", 0),
        num_queries=len(queries),
    )
    return result


async def _scheduled_search_for_user(user_id: int) -> None:
    """APScheduler job entry point for one user's scheduled search."""
    logger.info("scheduled_job_search_started", user_id=user_id)
    try:
        from app.services.database import database_service  # local import avoids circular dep

        pref = await job_service.get_preference(user_id)
        config = await job_service.get_search_config(user_id)
        user = await database_service.get_user_by_id(user_id)
        resume_text = user.resume_text if user else None
        await _search_for_user(user_id, pref, config, resume_text)
    except Exception:
        logger.exception("scheduled_job_search_failed", user_id=user_id)


async def setup_scheduler() -> AsyncIOScheduler:
    """Register per-user scheduled jobs and return the configured scheduler."""
    configs = await job_service.get_all_search_configs()
    for config in configs:
        scheduler.add_job(
            _scheduled_search_for_user,
            CronTrigger.from_crontab(config.schedule_cron),
            args=[config.user_id],
            id=f"job_search_{config.user_id}",
            replace_existing=True,
        )
        logger.info(
            "scheduler_job_registered",
            user_id=config.user_id,
            cron=config.schedule_cron,
        )
    return scheduler
```

- [ ] **Step 2: Update `app/main.py` to `await setup_scheduler()`**

In `main.py`, find the lifespan function:

```python
scheduler = setup_scheduler()
scheduler.start()
```

Replace with:

```python
scheduler = await setup_scheduler()
scheduler.start()
```

- [ ] **Step 3: Commit**

```bash
git add app/core/scheduler.py app/main.py
git commit -m "feat: refactor scheduler to per-user _search_for_user, async setup"
```

---

## Task 5: Search API routes + config

**Files:**
- Modify: `app/core/config.py`
- Create: `app/api/v1/search.py`
- Modify: `app/api/v1/api.py`

- [ ] **Step 1: Add `"search"` rate limit to `app/core/config.py`**

Find `RATE_LIMIT_ENDPOINTS` dict (around line 186). Existing keys use the `"N per unit"` format (e.g., `"30 per minute"`). Add:

```python
"search": ["30 per minute"],
```

- [ ] **Step 2: Create `app/api/v1/search.py`**

```python
"""Search configuration and manual trigger endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from apscheduler.triggers.cron import CronTrigger

from app.core.limiter import limiter
from app.core.config import settings
from app.core.logging import logger
from app.core.scheduler import scheduler, _search_for_user, _scheduled_search_for_user
from app.models.user import User
from app.services.database import database_service
from app.services.job_service import job_service
from app.api.v1.auth import get_current_user

router = APIRouter()


class SearchConfigResponse(BaseModel):
    target_sites: str
    schedule_enabled: bool
    schedule_cron: str


class SearchConfigUpdate(BaseModel):
    target_sites: str = Field(default="")
    schedule_enabled: bool = Field(default=False)
    schedule_cron: str = Field(default="0 9 * * *")


class SearchRunResponse(BaseModel):
    inserted: int
    skipped: int


@router.get("/config", response_model=SearchConfigResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["search"][0])
async def get_search_config(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> SearchConfigResponse:
    """Return the current user's search config (defaults if not set)."""
    config = await job_service.get_search_config(current_user.id)
    if config is None:
        return SearchConfigResponse(
            target_sites="",
            schedule_enabled=False,
            schedule_cron="0 9 * * *",
        )
    return SearchConfigResponse(
        target_sites=config.target_sites,
        schedule_enabled=config.schedule_enabled,
        schedule_cron=config.schedule_cron,
    )


@router.put("/config", response_model=SearchConfigResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["search"][0])
async def update_search_config(
    body: SearchConfigUpdate,
    request: Request,
    current_user: User = Depends(get_current_user),
) -> SearchConfigResponse:
    """Upsert the current user's search config and sync APScheduler."""
    # Validate cron expression
    try:
        CronTrigger.from_crontab(body.schedule_cron)
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=422, detail=f"Invalid cron expression: {e}")

    # Guard: scheduling requires a JobPreference to exist
    if body.schedule_enabled:
        pref = await job_service.get_preference(current_user.id)
        if pref is None:
            raise HTTPException(
                status_code=400,
                detail="Cannot enable scheduling without a job preference configured.",
            )

    config = await job_service.upsert_search_config(
        user_id=current_user.id,
        target_sites=body.target_sites,
        schedule_enabled=body.schedule_enabled,
        schedule_cron=body.schedule_cron,
    )

    # Sync APScheduler
    job_id = f"job_search_{current_user.id}"
    if config.schedule_enabled:
        trigger = CronTrigger.from_crontab(config.schedule_cron)
        if scheduler.get_job(job_id):
            scheduler.reschedule_job(job_id, trigger=trigger)
        else:
            scheduler.add_job(
                _scheduled_search_for_user,
                trigger,
                args=[current_user.id],
                id=job_id,
                replace_existing=True,
            )
        logger.info("scheduler_job_updated", user_id=current_user.id, cron=config.schedule_cron)
    else:
        if scheduler.get_job(job_id):
            scheduler.remove_job(job_id)
            logger.info("scheduler_job_removed", user_id=current_user.id)

    return SearchConfigResponse(
        target_sites=config.target_sites,
        schedule_enabled=config.schedule_enabled,
        schedule_cron=config.schedule_cron,
    )


@router.post("/run", response_model=SearchRunResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["search"][0])
async def run_search(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> SearchRunResponse:
    """Manually trigger a job search for the current user."""
    pref = await job_service.get_preference(current_user.id)
    config = await job_service.get_search_config(current_user.id)
    user = await database_service.get_user_by_id(current_user.id)
    resume_text = user.resume_text if user else None

    result = await _search_for_user(current_user.id, pref, config, resume_text)
    logger.info("manual_search_run", user_id=current_user.id, result=result)
    return SearchRunResponse(inserted=result.get("inserted", 0), skipped=result.get("skipped", 0))
```

- [ ] **Step 3: Register router in `app/api/v1/api.py`**

Import and include the search router (follow the existing pattern for other routers):

```python
from app.api.v1.search import router as search_router

api_router.include_router(search_router, prefix="/search", tags=["search"])
```

- [ ] **Step 4: Commit**

```bash
git add app/core/config.py app/api/v1/search.py app/api/v1/api.py
git commit -m "feat: add search config and manual trigger API endpoints"
```

---

## Task 6: Resume API routes

**Files:**
- Modify: `app/api/v1/settings.py`

- [ ] **Step 1: Add resume schemas to `app/api/v1/settings.py`**

After the existing `SystemPromptRequest` schema, add:

```python
class ResumeRequest(BaseModel):
    resume_text: str = Field(max_length=50000)

class ResumeResponse(BaseModel):
    resume_text: Optional[str]
```

`Optional` should already be imported; if not, add it to the `typing` import.

- [ ] **Step 2: Add resume endpoints to `app/api/v1/settings.py`**

After the existing system prompt endpoints, add:

```python
@router.get("/resume", response_model=ResumeResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def get_resume(
    request: Request,
    current_user: User = Depends(get_current_user),
) -> ResumeResponse:
    """Return the current user's resume text."""
    return ResumeResponse(resume_text=current_user.resume_text)


@router.put("/resume", response_model=ResumeResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def update_resume(
    body: ResumeRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
) -> ResumeResponse:
    """Save the current user's plain-text resume."""
    user = await database_service.update_user_resume(current_user.id, body.resume_text)
    logger.info("resume_updated", user_id=current_user.id)
    return ResumeResponse(resume_text=user.resume_text)
```

The rate limit key `"settings"` must exist in `RATE_LIMIT_ENDPOINTS`. If it doesn't, use `"search"` or add `"settings": ["60 per minute"]` to `config.py`.

- [ ] **Step 3: Commit**

```bash
git add app/api/v1/settings.py
git commit -m "feat: add resume GET/PUT endpoints to settings API"
```

---

## Task 7: Frontend types + API client + i18n

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/lib/i18n.ts`

- [ ] **Step 1: Add `match_score` to `Application` type in `frontend/lib/types.ts`**

Find the `Application` interface/type and add:

```typescript
match_score?: number | null
```

- [ ] **Step 2: Add API functions to `frontend/lib/api.ts`**

Add at the end of the file (or near related functions):

```typescript
// ── Resume ────────────────────────────────────────────────────────────────

export async function apiGetResume(
  accessToken: string
): Promise<{ resume_text: string | null }> {
  const res = await fetch(`${API_BASE}/settings/resume`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Failed to load resume: ${res.status}`)
  return res.json()
}

export async function apiSaveResume(
  accessToken: string,
  resume_text: string
): Promise<{ resume_text: string | null }> {
  const res = await fetch(`${API_BASE}/settings/resume`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ resume_text }),
  })
  if (!res.ok) throw new Error(`Failed to save resume: ${res.status}`)
  return res.json()
}

// ── Search config ─────────────────────────────────────────────────────────

export interface SearchConfig {
  target_sites: string
  schedule_enabled: boolean
  schedule_cron: string
}

export async function apiGetSearchConfig(accessToken: string): Promise<SearchConfig> {
  const res = await fetch(`${API_BASE}/search/config`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Failed to load search config: ${res.status}`)
  return res.json()
}

export async function apiSaveSearchConfig(
  accessToken: string,
  config: SearchConfig
): Promise<SearchConfig> {
  const res = await fetch(`${API_BASE}/search/config`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail ?? `Failed to save search config: ${res.status}`)
  }
  return res.json()
}

export async function apiRunSearch(
  accessToken: string
): Promise<{ inserted: number; skipped: number }> {
  const res = await fetch(`${API_BASE}/search/run`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`Search failed: ${res.status}`)
  return res.json()
}
```

`API_BASE` is the existing constant in `api.ts` — use whatever name the file already uses.

- [ ] **Step 3: Add i18n keys to `frontend/lib/i18n.ts`**

In the `zh` dict, add (near the existing settings keys):

```typescript
// Settings modal (multi-tab)
settings_title: '设置',
settings_tab_prompt: '系统提示词',
settings_tab_resume: '简历',
settings_tab_search: '搜索设置',
settings_resume_placeholder: '粘贴你的简历文本（纯文本即可）…',
settings_resume_save: '保存简历',
settings_resume_saving: '保存中…',
settings_resume_saved: '已保存',
settings_search_sites_label: '目标网站（逗号分隔）',
settings_search_sites_placeholder: 'linkedin.com, boss.zhipin.com',
settings_search_schedule_label: '定时搜索',
settings_search_cron_label: 'Cron 表达式',
settings_search_save: '保存配置',
settings_search_saving: '保存中…',
settings_search_run: '立即搜索',
settings_search_running: '搜索中…',
settings_search_done: (inserted: number, skipped: number) =>
  `完成：新增 ${inserted} 条，跳过 ${skipped} 条`,
```

In the `en` dict, add the same keys with English values:

```typescript
settings_title: 'Settings',
settings_tab_prompt: 'System Prompt',
settings_tab_resume: 'Resume',
settings_tab_search: 'Search Settings',
settings_resume_placeholder: 'Paste your plain-text resume here…',
settings_resume_save: 'Save Resume',
settings_resume_saving: 'Saving…',
settings_resume_saved: 'Saved',
settings_search_sites_label: 'Target websites (comma-separated)',
settings_search_sites_placeholder: 'linkedin.com, indeed.com',
settings_search_schedule_label: 'Scheduled search',
settings_search_cron_label: 'Cron expression',
settings_search_save: 'Save Settings',
settings_search_saving: 'Saving…',
settings_search_run: 'Search Now',
settings_search_running: 'Searching…',
settings_search_done: (inserted: number, skipped: number) =>
  `Done: ${inserted} new, ${skipped} skipped`,
```

Also update `settings_aria` in both dicts:

```typescript
settings_aria: '设置',   // zh
settings_aria: 'Settings',  // en
```

**Important for `settings_search_done`:** The existing `Dict` type is `Record<string, StringValue | FnValue>` where `FnValue = (...args: never[]) => string`. TypeScript's contravariant function parameters mean `(inserted: number, skipped: number) => string` is NOT assignable to `FnValue` — a direct cast `as FnValue` will also fail. Do NOT modify the `Dict` type (it would break other keys). Instead, cast via `unknown`:

```typescript
settings_search_done: ((inserted: number, skipped: number) =>
  `完成：新增 ${inserted} 条，跳过 ${skipped} 条`) as unknown as FnValue,
```

Apply the same `as unknown as FnValue` cast to the English entry.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/api.ts frontend/lib/i18n.ts
git commit -m "feat: add match_score type, resume/search API client, i18n keys"
```

---

## Task 8: KanbanCard score badge

**Files:**
- Modify: `frontend/components/tracker/KanbanCard.tsx`

- [ ] **Step 1: Add score badge to `KanbanCard.tsx`**

Find the top-right area in `KanbanCard` where the source badge is rendered (the `div` containing the source `<span>`). Wrap both the score badge and the source badge in a flex container:

Replace the existing source-badge span structure with:

```tsx
<div className="flex items-center gap-1 shrink-0">
  {app.match_score != null && (
    <span
      className={[
        "text-[10px] font-body rounded-full px-2 py-0.5 font-semibold tabular-nums",
        app.match_score >= 80
          ? "bg-[#dcfce7] text-[#16a34a]"
          : app.match_score >= 60
          ? "bg-[#fef9c3] text-[#a16207]"
          : "bg-black/5 text-[#999]",
      ].join(" ")}
    >
      {app.match_score}
    </span>
  )}
  <span
    className={[
      "text-[10px] font-body rounded-full px-2 py-0.5",
      app.source === "scheduler"
        ? "bg-[#ede9ff] text-[#7c6af5]"
        : "bg-[#f0f9f0] text-[#5a9a5a]",
    ].join(" ")}
  >
    {app.source === "scheduler" ? t("card_source_scheduler") : t("card_source_manual")}
  </span>
</div>
```

The exact className values for the source badge must match the existing code — read the file first and preserve the existing source badge styles exactly, just wrapping it in the new div alongside the score badge.

- [ ] **Step 2: Commit**

```bash
git add frontend/components/tracker/KanbanCard.tsx
git commit -m "feat: add match_score badge to kanban card"
```

---

## Task 9: KanbanBoard — sort pending column by score

**Files:**
- Modify: `frontend/components/tracker/KanbanBoard.tsx`

- [ ] **Step 1: Sort pending cards by `match_score` descending in `KanbanBoard.tsx`**

Find where cards are filtered per column (look for something like `applications.filter(a => toColumnStatus(a.status) === status)` or similar). After filtering, add a sort for the pending column:

```tsx
const colCards = applications.filter(
  (a) => toColumnStatus(a.status) === col.status   // adjust to match existing code
)
const displayCards =
  col.status === "pending"
    ? [...colCards].sort((a, b) => {
        if (a.match_score == null && b.match_score == null) return 0
        if (a.match_score == null) return 1
        if (b.match_score == null) return -1
        return b.match_score - a.match_score
      })
    : colCards
```

Then pass `displayCards` instead of `colCards` to `KanbanColumn`. Adjust variable names to match what the existing code uses.

- [ ] **Step 2: Commit**

```bash
git add frontend/components/tracker/KanbanBoard.tsx
git commit -m "feat: sort pending kanban column by match_score descending"
```

---

## Task 10: SettingsModal — rename and add tabs

**Files:**
- Rename: `frontend/components/settings/SystemPromptModal.tsx` → `frontend/components/settings/SettingsModal.tsx`
- Modify: `frontend/app/chat/page.tsx`

- [ ] **Step 1: Create `SettingsModal.tsx` (rename + rewrite)**

Create `frontend/components/settings/SettingsModal.tsx` with the full multi-tab modal. Read `SystemPromptModal.tsx` first to understand its structure, then replace it with the following (adapt classNames and layout to match the existing design):

```tsx
"use client"

import { useState, useEffect, useCallback } from "react"
import { useI18n } from "@/hooks/useI18n"
import {
  apiGetSystemPrompt,
  apiSaveSystemPrompt,
  apiGetResume,
  apiSaveResume,
  apiGetSearchConfig,
  apiSaveSearchConfig,
  apiRunSearch,
  type SearchConfig,
} from "@/lib/api"

// --- adjust these imports to match what SystemPromptModal already imports ---

type Tab = "prompt" | "resume" | "search"

interface Props {
  accessToken: string
  onClose: () => void
  onSearchComplete?: () => void
}

export function SettingsModal({ accessToken, onClose, onSearchComplete }: Props) {
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>("prompt")

  // ── System Prompt tab state ────────────────────────────────────────────
  // Copy the existing state and logic from SystemPromptModal here verbatim.
  // (system prompt text, saving state, save handler)

  // ── Resume tab state ──────────────────────────────────────────────────
  const [resumeText, setResumeText] = useState("")
  const [resumeSaving, setResumeSaving] = useState(false)
  const [resumeSaved, setResumeSaved] = useState(false)

  useEffect(() => {
    if (tab !== "resume") return
    apiGetResume(accessToken)
      .then((d) => setResumeText(d.resume_text ?? ""))
      .catch(() => {})
  }, [tab, accessToken])

  const handleSaveResume = useCallback(async () => {
    setResumeSaving(true)
    setResumeSaved(false)
    try {
      await apiSaveResume(accessToken, resumeText)
      setResumeSaved(true)
      setTimeout(() => setResumeSaved(false), 2000)
    } finally {
      setResumeSaving(false)
    }
  }, [accessToken, resumeText])

  // ── Search Settings tab state ─────────────────────────────────────────
  const [searchConfig, setSearchConfig] = useState<SearchConfig>({
    target_sites: "",
    schedule_enabled: false,
    schedule_cron: "0 9 * * *",
  })
  const [searchSaving, setSearchSaving] = useState(false)
  const [searchRunning, setSearchRunning] = useState(false)
  const [searchResult, setSearchResult] = useState<string | null>(null)

  useEffect(() => {
    if (tab !== "search") return
    apiGetSearchConfig(accessToken)
      .then((c) => setSearchConfig(c))
      .catch(() => {})
  }, [tab, accessToken])

  const handleSaveSearch = useCallback(async () => {
    setSearchSaving(true)
    try {
      await apiSaveSearchConfig(accessToken, searchConfig)
    } catch (e: unknown) {
      alert(e instanceof Error ? e.message : "Save failed")
    } finally {
      setSearchSaving(false)
    }
  }, [accessToken, searchConfig])

  const handleRunSearch = useCallback(async () => {
    setSearchRunning(true)
    setSearchResult(null)
    try {
      const r = await apiRunSearch(accessToken)
      const msg = (t("settings_search_done") as (i: number, s: number) => string)(
        r.inserted,
        r.skipped
      )
      setSearchResult(msg)
      onSearchComplete?.()
    } catch {
      setSearchResult("Search failed")
    } finally {
      setSearchRunning(false)
    }
  }, [accessToken, t, onSearchComplete])

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    // Use the same modal shell (backdrop, panel, close button) as SystemPromptModal.
    // Replace inner content with tabs:
    <div /* modal shell — copy from SystemPromptModal */>
      {/* Tab bar */}
      <div className="flex border-b border-black/5 mb-4">
        {(["prompt", "resume", "search"] as Tab[]).map((id) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={[
              "px-4 py-2 text-sm font-body transition-colors",
              tab === id
                ? "border-b-2 border-black font-semibold"
                : "text-[#999] hover:text-black",
            ].join(" ")}
          >
            {t(
              id === "prompt"
                ? "settings_tab_prompt"
                : id === "resume"
                ? "settings_tab_resume"
                : "settings_tab_search"
            )}
          </button>
        ))}
      </div>

      {/* System Prompt tab — paste existing SystemPromptModal body here */}
      {tab === "prompt" && (
        <div>{/* existing prompt textarea + save button */}</div>
      )}

      {/* Resume tab */}
      {tab === "resume" && (
        <div className="flex flex-col gap-3">
          <label className="text-sm text-[#666] font-body">
            {t("settings_tab_resume")}
          </label>
          <textarea
            value={resumeText}
            onChange={(e) => setResumeText(e.target.value)}
            placeholder={t("settings_resume_placeholder") as string}
            rows={12}
            className="w-full rounded-xl border border-black/8 bg-[#fafafa] px-4 py-3 text-sm font-body resize-y focus:outline-none focus:ring-2 focus:ring-black/10"
          />
          <button
            onClick={handleSaveResume}
            disabled={resumeSaving}
            className="self-end rounded-xl bg-black text-white text-sm font-body px-5 py-2 hover:bg-black/80 disabled:opacity-50"
          >
            {resumeSaving
              ? t("settings_resume_saving")
              : resumeSaved
              ? t("settings_resume_saved")
              : t("settings_resume_save")}
          </button>
        </div>
      )}

      {/* Search Settings tab */}
      {tab === "search" && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="text-sm text-[#666] font-body">
              {t("settings_search_sites_label")}
            </label>
            <input
              type="text"
              value={searchConfig.target_sites}
              onChange={(e) =>
                setSearchConfig((c) => ({ ...c, target_sites: e.target.value }))
              }
              placeholder={t("settings_search_sites_placeholder") as string}
              className="rounded-xl border border-black/8 bg-[#fafafa] px-4 py-2.5 text-sm font-body focus:outline-none focus:ring-2 focus:ring-black/10"
            />
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm text-[#666] font-body">
              {t("settings_search_schedule_label")}
            </span>
            <button
              role="switch"
              aria-checked={searchConfig.schedule_enabled}
              onClick={() =>
                setSearchConfig((c) => ({
                  ...c,
                  schedule_enabled: !c.schedule_enabled,
                }))
              }
              className={[
                "w-10 h-6 rounded-full transition-colors",
                searchConfig.schedule_enabled ? "bg-black" : "bg-black/15",
              ].join(" ")}
            >
              <span
                className={[
                  "block w-4 h-4 bg-white rounded-full shadow transition-transform mx-1",
                  searchConfig.schedule_enabled ? "translate-x-4" : "translate-x-0",
                ].join(" ")}
              />
            </button>
          </div>

          {searchConfig.schedule_enabled && (
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-[#666] font-body">
                {t("settings_search_cron_label")}
              </label>
              <input
                type="text"
                value={searchConfig.schedule_cron}
                onChange={(e) =>
                  setSearchConfig((c) => ({ ...c, schedule_cron: e.target.value }))
                }
                placeholder="0 9 * * *"
                className="rounded-xl border border-black/8 bg-[#fafafa] px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-black/10"
              />
            </div>
          )}

          <div className="flex items-center gap-3 pt-1">
            <button
              onClick={handleSaveSearch}
              disabled={searchSaving}
              className="rounded-xl bg-black text-white text-sm font-body px-5 py-2 hover:bg-black/80 disabled:opacity-50"
            >
              {searchSaving ? t("settings_search_saving") : t("settings_search_save")}
            </button>
            <button
              onClick={handleRunSearch}
              disabled={searchRunning}
              className="rounded-xl border border-black/10 text-sm font-body px-5 py-2 hover:bg-black/5 disabled:opacity-50"
            >
              {searchRunning ? t("settings_search_running") : t("settings_search_run")}
            </button>
          </div>

          {searchResult && (
            <p className="text-sm text-[#666] font-body">{searchResult}</p>
          )}
        </div>
      )}
    </div>
  )
}
```

**Important:** Read `SystemPromptModal.tsx` carefully before writing `SettingsModal.tsx`. Copy the existing prompt tab state and save logic verbatim. Copy the modal shell (backdrop, panel, close button, title) exactly — do not change their styles.

- [ ] **Step 2: Delete the old `SystemPromptModal.tsx`**

After confirming the new file is complete:

```bash
rm frontend/components/settings/SystemPromptModal.tsx
```

- [ ] **Step 3: Update `frontend/app/chat/page.tsx`**

1. Replace import:
   ```tsx
   // Old:
   import { SystemPromptModal } from "@/components/settings/SystemPromptModal"
   // New:
   import { SettingsModal } from "@/components/settings/SettingsModal"
   ```

2. Add `kanbanRefreshKey` state near the other state declarations:
   ```tsx
   const [kanbanRefreshKey, setKanbanRefreshKey] = useState(0)
   ```

3. Replace the `<SystemPromptModal ...>` JSX with:
   ```tsx
   <SettingsModal
     accessToken={getAccessToken() ?? ""}
     onClose={() => setShowSettings(false)}
     onSearchComplete={() => setKanbanRefreshKey((k) => k + 1)}
   />
   ```

4. Find where `<KanbanBoard />` is rendered and add the key prop:
   ```tsx
   <KanbanBoard key={kanbanRefreshKey} />
   ```

- [ ] **Step 4: Commit**

```bash
git add frontend/components/settings/SettingsModal.tsx frontend/app/chat/page.tsx
git rm frontend/components/settings/SystemPromptModal.tsx
git commit -m "feat: rename SystemPromptModal to SettingsModal with resume and search tabs"
```

---

## Final smoke-test

- [ ] **Step 1: Start the backend and confirm no import errors**

```bash
make dev
```

Expected: server starts, no `ImportError` or `AttributeError`.

- [ ] **Step 2: Verify new tables exist**

```bash
# Connect to Postgres and check
psql $DATABASE_URL -c "\dt search_configs"
psql $DATABASE_URL -c "\d users" | grep resume_text
psql $DATABASE_URL -c "\d applications" | grep match_score
```

Expected: all three show up.

- [ ] **Step 3: Test backend endpoints via Swagger**

Open `/docs` and test:
- `PUT /api/v1/settings/resume` with a resume body
- `GET /api/v1/settings/resume` — should return the saved text
- `PUT /api/v1/search/config` with `target_sites="linkedin.com"`, `schedule_enabled=false`
- `POST /api/v1/search/run` — should return `{"inserted": N, "skipped": M}`

- [ ] **Step 4: Start the frontend and verify UI**

```bash
cd frontend && pnpm dev
```

Open the app, click the settings icon → should see 3 tabs: System Prompt, Resume, Search Settings.

In Search Settings: enter a site, click "立即搜索" / "Search Now", verify kanban reloads with new cards and score badges.

- [ ] **Step 5: Final commit if any fixes were needed**

```bash
git add -p
git commit -m "fix: smoke-test corrections for scheduled job search feature"
```
