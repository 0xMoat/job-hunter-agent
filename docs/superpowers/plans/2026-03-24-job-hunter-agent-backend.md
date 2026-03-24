# Job Hunter Agent — Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform the generic LangGraph chat template into a job-hunting specialist agent with 5 tools, APScheduler daily search, structured SSE streaming, and 3 new REST API resource groups.

**Architecture:** Single LangGraph agent (chat → tool_call loop) extended with job-specific tools. New SQLModel models share the existing sync SQLAlchemy engine — intentional deviation from spec's asyncpg proposal to keep a single connection pattern and reduce complexity at demo scale. APScheduler wired into FastAPI lifespan. SSE stream extended to emit typed chunks for tool-call visibility.

**Tech Stack:** FastAPI, LangGraph, LangChain, SQLModel/SQLAlchemy (sync), APScheduler, DuckDuckGo search, mem0 (InjectedState), Langfuse, structlog, tenacity

**Note:** Frontend (Next.js) is a separate plan — `2026-03-24-job-hunter-agent-frontend.md`. This plan delivers a fully functional backend.

**Spec:** `docs/superpowers/specs/2026-03-24-job-hunter-agent-design.md`

**Config injection pattern used throughout:** All tools that need `user_id` use `Annotated[RunnableConfig, InjectedToolArg]` so LangChain excludes `config` from the JSON schema shown to the LLM. `InjectedState` is used for `long_term_memory` in `cover_letter_tool`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `app/models/job_preference.py` | Create | `JobPreference` SQLModel table |
| `app/models/job_listing.py` | Create | `JobListing` SQLModel table |
| `app/models/application.py` | Create | `Application` SQLModel table |
| `app/services/job_service.py` | Create | `JobService` — CRUD for all 3 new tables, shares existing engine |
| `app/core/langgraph/tools/job_search.py` | Create | `job_search_tool` — DuckDuckGo structured job search |
| `app/core/langgraph/tools/company_research.py` | Create | `company_research_tool` — multi-query company research |
| `app/core/langgraph/tools/cover_letter.py` | Create | `cover_letter_tool` — LLM cover letter with InjectedState |
| `app/core/langgraph/tools/application_tracker.py` | Create | `application_tracker_tool` — application CRUD via JobService |
| `app/core/langgraph/tools/job_preferences.py` | Create | `job_preferences_tool` — save search preferences via JobService |
| `app/core/langgraph/tools/__init__.py` | Modify | Register all 5 new tools |
| `app/core/langgraph/graph.py` | Modify | Pass `config` in `_tool_call`, add `user_id` to `configurable` |
| `app/core/prompts/system.md` | Modify | Job-hunting specialist persona |
| `app/schemas/chat.py` | Modify | Add `StreamChunk` model |
| `app/api/v1/chatbot.py` | Modify | Update `event_generator` to emit structured `StreamChunk` JSON |
| `app/api/v1/preferences.py` | Create | `GET/PUT /preferences` REST endpoint |
| `app/api/v1/listings.py` | Create | `GET /listings` REST endpoint |
| `app/api/v1/applications.py` | Create | `GET/POST/PATCH/DELETE /applications` REST endpoint |
| `app/api/v1/api.py` | Modify | Register 3 new routers |
| `app/core/scheduler.py` | Create | APScheduler daily job search job |
| `app/main.py` | Modify | Wire scheduler into lifespan |
| `app/services/database.py` | Modify | Import new models (triggers table creation via `create_all`) |

---

## Task 1: Install dependency + create new SQLModel models

**Files:**
- Create: `app/models/job_preference.py`
- Create: `app/models/job_listing.py`
- Create: `app/models/application.py`
- Modify: `app/services/database.py` (import new models)

- [ ] **Step 1: Install apscheduler**

```bash
uv add apscheduler
```

Expected: `pyproject.toml` updated, lock file updated.

- [ ] **Step 2: Create `app/models/job_preference.py`**

```python
"""Job preference model for storing user's job search criteria."""

from datetime import UTC, datetime
from typing import Optional

from sqlmodel import Field, UniqueConstraint

from app.models.base import BaseModel


class JobPreference(BaseModel, table=True):
    """Stores a user's daily job search criteria.

    Attributes:
        id: Primary key
        user_id: FK to User.id (int)
        keywords: Job title / skill keywords
        location: Target location (city or 'remote')
        job_type: fulltime / remote / contract
        updated_at: Last updated timestamp
    """

    __tablename__ = "job_preferences"
    __table_args__ = (UniqueConstraint("user_id", name="uq_job_preferences_user_id"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    keywords: str
    location: str
    job_type: str = Field(default="fulltime")
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
```

- [ ] **Step 3: Create `app/models/job_listing.py`**

```python
"""Job listing model for storing daily search results."""

from datetime import UTC, date, datetime
from typing import Optional

from sqlmodel import Field, UniqueConstraint

from app.models.base import BaseModel


class JobListing(BaseModel, table=True):
    """Stores a job listing found by the daily scheduler.

    Attributes:
        id: Primary key
        user_id: FK to User.id (int)
        title: Job title
        company: Company name
        location: Job location
        url: Source URL (composite unique with user_id)
        snippet: Short description from search result
        found_date: Date scheduler found this listing
        is_read: Whether the user has viewed this listing
    """

    __tablename__ = "job_listings"
    __table_args__ = (UniqueConstraint("user_id", "url", name="uq_job_listings_user_url"),)

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    title: str
    company: str = Field(default="")
    location: str = Field(default="")
    url: str
    snippet: str = Field(default="")
    found_date: date = Field(default_factory=lambda: datetime.now(UTC).date())
    is_read: bool = Field(default=False)
```

- [ ] **Step 4: Create `app/models/application.py`**

```python
"""Application model for tracking job applications."""

from datetime import UTC, date, datetime
from typing import Optional

from sqlmodel import Field

from app.models.base import BaseModel


class Application(BaseModel, table=True):
    """Tracks a job application submitted by the user.

    Attributes:
        id: Primary key
        user_id: FK to User.id (int)
        company: Company name
        title: Job title
        url: Job posting URL
        status: applied / interviewing / rejected / offer
        applied_date: Date of application
        notes: Free-form notes
        updated_at: Last update timestamp
    """

    __tablename__ = "applications"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    company: str
    title: str
    url: Optional[str] = Field(default=None)
    status: str = Field(default="applied")
    applied_date: date = Field(default_factory=lambda: datetime.now(UTC).date())
    notes: Optional[str] = Field(default=None)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
```

- [ ] **Step 5: Import new models in `app/services/database.py`**

Add these imports near the top of `database.py`, after existing imports and before the `DatabaseService` class definition. This ensures the models are registered with `SQLModel.metadata` before `create_all` is called.

```python
# Import new models so SQLModel registers them before create_all
from app.models.application import Application  # noqa: F401
from app.models.job_listing import JobListing  # noqa: F401
from app.models.job_preference import JobPreference  # noqa: F401
```

- [ ] **Step 6: Verify tables are created**

```bash
make dev
curl http://localhost:8000/health
```

Check the service starts without errors. If psql is available:
```bash
psql $DATABASE_URL -c "\dt"
```
Expected: `applications`, `job_listings`, `job_preferences` tables exist.

- [ ] **Step 7: Commit**

```bash
git add app/models/job_preference.py app/models/job_listing.py app/models/application.py app/services/database.py pyproject.toml uv.lock
git commit -m "feat: add JobPreference, JobListing, Application models"
```

---

## Task 2: JobService — unified service for new tables

**Files:**
- Create: `app/services/job_service.py`

Follows the same sync-SQLAlchemy-in-async-wrapper pattern as existing `DatabaseService`. Reuses `database_service.engine` — no additional connection pool.

- [ ] **Step 1: Create `app/services/job_service.py`**

```python
"""Service layer for job-hunting domain: preferences, listings, applications."""

from datetime import UTC, datetime
from typing import List, Optional

from sqlalchemy import desc
from sqlmodel import Session, select

from app.core.logging import logger
from app.models.application import Application
from app.models.job_listing import JobListing
from app.models.job_preference import JobPreference
from app.services.database import database_service


class JobService:
    """Handles all persistence for the job-hunting domain.

    Reuses DatabaseService engine — no additional connection pool.
    Methods are async def for FastAPI compatibility; internals are sync SQLAlchemy
    (same pattern as DatabaseService).
    """

    @property
    def _engine(self):
        """Reuse the existing DatabaseService engine."""
        return database_service.engine

    # ── Preferences ──────────────────────────────────────────────────────────

    async def upsert_preference(
        self, user_id: int, keywords: str, location: str, job_type: str
    ) -> JobPreference:
        """Create or update job search preference for a user."""
        with Session(self._engine) as session:
            existing = session.exec(
                select(JobPreference).where(JobPreference.user_id == user_id)
            ).first()

            if existing:
                existing.keywords = keywords
                existing.location = location
                existing.job_type = job_type
                existing.updated_at = datetime.now(UTC)
                session.add(existing)
                session.commit()
                session.refresh(existing)
                logger.info("job_preference_updated", user_id=user_id)
                return existing

            pref = JobPreference(
                user_id=user_id, keywords=keywords, location=location, job_type=job_type
            )
            session.add(pref)
            session.commit()
            session.refresh(pref)
            logger.info("job_preference_created", user_id=user_id)
            return pref

    async def get_preference(self, user_id: int) -> Optional[JobPreference]:
        """Get job search preference for a user."""
        with Session(self._engine) as session:
            return session.exec(
                select(JobPreference).where(JobPreference.user_id == user_id)
            ).first()

    async def get_all_preferences(self) -> List[JobPreference]:
        """Get all users' preferences (used by daily scheduler).

        Note: loads all records — suitable for demo scale only.
        Production use requires pagination or active-user filtering.
        """
        with Session(self._engine) as session:
            return list(session.exec(select(JobPreference)).all())

    # ── Listings ──────────────────────────────────────────────────────────────

    async def upsert_listings(self, user_id: int, listings: List[dict]) -> int:
        """Insert new listings, skip duplicates (user_id + url). Returns count inserted."""
        inserted = 0
        with Session(self._engine) as session:
            for item in listings:
                url = item.get("url", "")
                if not url:
                    continue  # skip entries without a URL — no meaningful dedup key
                exists = session.exec(
                    select(JobListing).where(
                        JobListing.user_id == user_id,
                        JobListing.url == url,
                    )
                ).first()
                if not exists:
                    listing = JobListing(
                        user_id=user_id,
                        title=item.get("title", ""),
                        company=item.get("company", ""),
                        location=item.get("location", ""),
                        url=url,
                        snippet=item.get("snippet", ""),
                    )
                    session.add(listing)
                    inserted += 1
            session.commit()
        logger.info("listings_upserted", user_id=user_id, inserted=inserted)
        return inserted

    async def get_listings(self, user_id: int, limit: int = 50) -> List[JobListing]:
        """Get most recent job listings for a user."""
        with Session(self._engine) as session:
            return list(
                session.exec(
                    select(JobListing)
                    .where(JobListing.user_id == user_id)
                    .order_by(desc(JobListing.found_date))
                    .limit(limit)
                ).all()
            )

    # ── Applications ──────────────────────────────────────────────────────────

    async def add_application(
        self,
        user_id: int,
        company: str,
        title: str,
        url: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> Application:
        """Record a new job application."""
        with Session(self._engine) as session:
            app = Application(
                user_id=user_id, company=company, title=title, url=url, notes=notes
            )
            session.add(app)
            session.commit()
            session.refresh(app)
            logger.info("application_added", user_id=user_id, company=company)
            return app

    async def update_application(
        self,
        application_id: int,
        user_id: int,
        status: Optional[str] = None,
        notes: Optional[str] = None,
    ) -> Optional[Application]:
        """Update application status or notes."""
        with Session(self._engine) as session:
            app = session.exec(
                select(Application).where(
                    Application.id == application_id,
                    Application.user_id == user_id,
                )
            ).first()
            if not app:
                return None
            if status:
                app.status = status
            if notes is not None:
                app.notes = notes
            app.updated_at = datetime.now(UTC)
            session.add(app)
            session.commit()
            session.refresh(app)
            logger.info("application_updated", application_id=application_id, user_id=user_id)
            return app

    async def list_applications(self, user_id: int) -> List[Application]:
        """List all applications for a user, newest first."""
        with Session(self._engine) as session:
            return list(
                session.exec(
                    select(Application)
                    .where(Application.user_id == user_id)
                    .order_by(desc(Application.applied_date))
                ).all()
            )

    async def delete_application(self, application_id: int, user_id: int) -> bool:
        """Delete an application. Returns True if deleted."""
        with Session(self._engine) as session:
            app = session.exec(
                select(Application).where(
                    Application.id == application_id,
                    Application.user_id == user_id,
                )
            ).first()
            if not app:
                return False
            session.delete(app)
            session.commit()
            logger.info("application_deleted", application_id=application_id, user_id=user_id)
            return True


job_service = JobService()
```

- [ ] **Step 2: Lint check**

```bash
make lint
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add app/services/job_service.py
git commit -m "feat: add JobService for preferences, listings, applications"
```

---

## Task 3: `job_search_tool`

**Files:**
- Create: `app/core/langgraph/tools/job_search.py`

- [ ] **Step 1: Create `app/core/langgraph/tools/job_search.py`**

```python
"""Job search tool — searches for job listings via DuckDuckGo."""

from langchain_community.tools import DuckDuckGoSearchResults
from langchain_core.tools import tool

from app.core.logging import logger

_search = DuckDuckGoSearchResults(num_results=8, handle_tool_error=True)


@tool
async def job_search_tool(keywords: str, location: str, job_type: str = "fulltime") -> str:
    """Search for job listings matching the given criteria.

    Use this when the user asks to find jobs, search positions, or look for openings.

    Args:
        keywords: Job title or skills to search for, e.g. "agent engineer", "backend python"
        location: Target location, e.g. "上海", "Beijing", "remote"
        job_type: One of: fulltime, remote, contract. Defaults to fulltime.

    Returns:
        Formatted string with job listings found.
    """
    query = (
        f"{keywords} {job_type} job {location} "
        f"site:linkedin.com OR site:lagou.com OR site:zhipin.com OR site:indeed.com"
    )
    logger.info("job_search_started", keywords=keywords, location=location, job_type=job_type)
    try:
        results = await _search.arun(query)
        logger.info("job_search_completed", keywords=keywords, result_length=len(str(results)))
        return f"Job search results for '{keywords}' in '{location}' ({job_type}):\n\n{results}"
    except Exception as e:
        logger.exception("job_search_failed", keywords=keywords, error=str(e))
        return f"Search failed: {str(e)}"
```

- [ ] **Step 2: Commit**

```bash
git add app/core/langgraph/tools/job_search.py
git commit -m "feat: add job_search_tool"
```

---

## Task 4: `company_research_tool`

**Files:**
- Create: `app/core/langgraph/tools/company_research.py`

- [ ] **Step 1: Create `app/core/langgraph/tools/company_research.py`**

```python
"""Company research tool — gathers background, culture, and news about a company."""

from langchain_community.tools import DuckDuckGoSearchResults
from langchain_core.tools import tool

from app.core.logging import logger

_search = DuckDuckGoSearchResults(num_results=5, handle_tool_error=True)

_QUERIES = {
    "overview": "{company} company overview business model products",
    "culture": "{company} company culture employee review Glassdoor work life balance",
    "news": "{company} latest news 2024 2025",
    "funding": "{company} funding valuation investors series",
}


@tool
async def company_research_tool(company_name: str, aspects: str = "overview,culture,news") -> str:
    """Research a company's background, culture, and recent news.

    Use this when the user asks to investigate, research, or learn about a company
    before applying or in preparation for an interview.

    Args:
        company_name: Name of the company to research, e.g. "字节跳动", "Anthropic"
        aspects: Comma-separated aspects to research.
                 Available: overview, culture, news, funding.
                 Defaults to "overview,culture,news".

    Returns:
        Formatted research report combining results from multiple searches.
    """
    aspect_list = [a.strip() for a in aspects.split(",") if a.strip() in _QUERIES]
    logger.info("company_research_started", company=company_name, aspects=aspect_list)

    sections = []
    for aspect in aspect_list:
        query = _QUERIES[aspect].format(company=company_name)
        try:
            result = await _search.arun(query)
            sections.append(f"## {aspect.capitalize()}\n{result}")
        except Exception as e:
            logger.exception("company_research_aspect_failed", company=company_name, aspect=aspect, error=str(e))
            sections.append(f"## {aspect.capitalize()}\nSearch failed: {str(e)}")

    logger.info("company_research_completed", company=company_name)
    return f"# Company Research: {company_name}\n\n" + "\n\n".join(sections)
```

- [ ] **Step 2: Commit**

```bash
git add app/core/langgraph/tools/company_research.py
git commit -m "feat: add company_research_tool"
```

---

## Task 5: `cover_letter_tool`

**Files:**
- Create: `app/core/langgraph/tools/cover_letter.py`

Uses `InjectedState("long_term_memory")` to read the user profile from `GraphState` without the LLM passing it. Uses `llm_service.call()` directly with a `HumanMessage` for a dedicated LLM call. Langfuse tracing happens automatically through the global callback set in `get_stream_response` config — no explicit callback passing needed in the tool.

- [ ] **Step 1: Create `app/core/langgraph/tools/cover_letter.py`**

```python
"""Cover letter tool — generates personalized cover letters using user profile from memory."""

from typing import Annotated

from langchain_core.messages import HumanMessage
from langchain_core.tools import tool
from langgraph.prebuilt import InjectedState

from app.core.logging import logger
from app.services.llm import llm_service


@tool
async def cover_letter_tool(
    job_title: str,
    company: str,
    job_description: str,
    tone: str = "professional",
    long_term_memory: Annotated[str, InjectedState("long_term_memory")] = "",
) -> str:
    """Generate a personalized cover letter or cold email for a job application.

    Use this when the user asks to write a cover letter, application email, or
    outreach message for a specific position.

    Args:
        job_title: The job title being applied for
        company: The company name
        job_description: Key requirements or description from the job posting
        tone: Writing style — "professional", "casual", or "formal". Defaults to "professional".

    Returns:
        A structured cover letter with subject line and body.
    """
    user_profile = long_term_memory or "No user profile available yet."

    prompt = f"""Write a {tone} cover letter for the following job.

Job Title: {job_title}
Company: {company}
Job Description: {job_description}

User Profile (use this to personalize):
{user_profile}

Format your response as:
**Subject:** <email subject line>

**Body:**
<cover letter body>

**Key Highlights:**
- <highlight 1>
- <highlight 2>
- <highlight 3>

Keep it concise (under 300 words). Focus on matching the user's actual experience to the job requirements."""

    logger.info("cover_letter_generation_started", job_title=job_title, company=company)
    try:
        response = await llm_service.call([HumanMessage(content=prompt)])
        logger.info("cover_letter_generated", job_title=job_title, company=company)
        return response.content if hasattr(response, "content") else str(response)
    except Exception as e:
        logger.exception("cover_letter_generation_failed", job_title=job_title, error=str(e))
        return f"Failed to generate cover letter: {str(e)}"
```

- [ ] **Step 2: Commit**

```bash
git add app/core/langgraph/tools/cover_letter.py
git commit -m "feat: add cover_letter_tool with InjectedState user profile"
```

---

## Task 6: `application_tracker_tool` + `job_preferences_tool`

**Files:**
- Create: `app/core/langgraph/tools/application_tracker.py`
- Create: `app/core/langgraph/tools/job_preferences.py`

Both use `Annotated[RunnableConfig, InjectedToolArg]` so `config` is hidden from LLM schema.

- [ ] **Step 1: Create `app/core/langgraph/tools/application_tracker.py`**

```python
"""Application tracker tool — records and queries the user's job applications."""

from typing import Annotated, Optional

from langchain_core.tools import InjectedToolArg, tool
from langgraph.types import RunnableConfig

from app.core.logging import logger
from app.services.job_service import job_service


@tool
async def application_tracker_tool(
    action: str,
    company: str = "",
    title: str = "",
    url: Optional[str] = None,
    status: Optional[str] = None,
    application_id: Optional[int] = None,
    notes: Optional[str] = None,
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Track job applications — add, update status, list, or delete records.

    Use this when the user says they applied to a company, wants to update an
    application status, or asks to see their application history.

    Args:
        action: One of: "add", "list", "update", "delete"
        company: Company name (required for add)
        title: Job title (required for add)
        url: Job posting URL (optional for add)
        status: Application status for update: applied / interviewing / rejected / offer
        application_id: Application ID (required for update/delete)
        notes: Free-form notes (optional)

    Returns:
        Confirmation message or formatted list of applications.
    """
    user_id = (config or {}).get("configurable", {}).get("user_id")
    if not user_id:
        return "Error: user_id not available. Cannot track application."

    logger.info("application_tracker_called", action=action, user_id=user_id)

    if action == "add":
        if not company or not title:
            return "Error: 'company' and 'title' are required to add an application."
        app = await job_service.add_application(user_id, company, title, url, notes)
        return f"✅ Recorded application to {company} ({title}). Application ID: {app.id}"

    elif action == "list":
        apps = await job_service.list_applications(user_id)
        if not apps:
            return "No applications recorded yet."
        lines = [
            f"- [{a.status.upper()}] {a.company} — {a.title} (ID: {a.id}, {a.applied_date})"
            for a in apps
        ]
        return "Your applications:\n" + "\n".join(lines)

    elif action == "update":
        if not application_id:
            return "Error: 'application_id' is required to update."
        updated = await job_service.update_application(application_id, user_id, status, notes)
        if not updated:
            return f"Application ID {application_id} not found."
        return f"✅ Updated application {application_id}: status={updated.status}"

    elif action == "delete":
        if not application_id:
            return "Error: 'application_id' is required to delete."
        deleted = await job_service.delete_application(application_id, user_id)
        return (
            f"✅ Deleted application {application_id}"
            if deleted
            else f"Application {application_id} not found."
        )

    return f"Unknown action: {action}. Use: add, list, update, delete."
```

- [ ] **Step 2: Create `app/core/langgraph/tools/job_preferences.py`**

```python
"""Job preferences tool — saves user's daily job search criteria."""

from typing import Annotated

from langchain_core.tools import InjectedToolArg, tool
from langgraph.types import RunnableConfig

from app.core.logging import logger
from app.services.job_service import job_service


@tool
async def job_preferences_tool(
    keywords: str,
    location: str,
    job_type: str = "fulltime",
    config: Annotated[RunnableConfig, InjectedToolArg] = None,
) -> str:
    """Save the user's job search preferences for daily automated search.

    Use this when the user tells you what kind of jobs to search for daily,
    or asks to update their job search settings.

    Args:
        keywords: Job title or skills, e.g. "agent engineer", "fullstack python"
        location: Target location, e.g. "上海", "remote", "Beijing"
        job_type: One of: fulltime, remote, contract. Defaults to fulltime.

    Returns:
        Confirmation that preferences were saved.
    """
    user_id = (config or {}).get("configurable", {}).get("user_id")
    if not user_id:
        return "Error: user_id not available. Cannot save preferences."

    await job_service.upsert_preference(user_id, keywords, location, job_type)
    logger.info("job_preferences_saved", user_id=user_id, keywords=keywords, location=location)
    return (
        f"✅ Daily search configured: '{keywords}' in '{location}' ({job_type}). "
        f"The scheduler will search every day at 08:00."
    )
```

- [ ] **Step 3: Commit**

```bash
git add app/core/langgraph/tools/application_tracker.py app/core/langgraph/tools/job_preferences.py
git commit -m "feat: add application_tracker_tool and job_preferences_tool"
```

---

## Task 7: Register all tools + fix `_tool_call` to pass `config`

**Files:**
- Modify: `app/core/langgraph/tools/__init__.py`
- Modify: `app/core/langgraph/graph.py`

- [ ] **Step 1: Update `app/core/langgraph/tools/__init__.py`**

Replace the entire file:

```python
"""LangGraph tools for the job-hunting agent."""

from langchain_core.tools.base import BaseTool

from .application_tracker import application_tracker_tool
from .company_research import company_research_tool
from .cover_letter import cover_letter_tool
from .duckduckgo_search import duckduckgo_search_tool
from .job_preferences import job_preferences_tool
from .job_search import job_search_tool

tools: list[BaseTool] = [
    job_search_tool,
    company_research_tool,
    cover_letter_tool,
    application_tracker_tool,
    job_preferences_tool,
    duckduckgo_search_tool,
]
```

- [ ] **Step 2: Fix `_tool_call` in `app/core/langgraph/graph.py`**

Change the method signature (line ~231):

```python
# Before:
async def _tool_call(self, state: GraphState) -> Command:

# After:
async def _tool_call(self, state: GraphState, config: RunnableConfig) -> Command:
```

Change the tool invocation (line ~242):

```python
# Before:
tool_result = await self.tools_by_name[tool_call["name"]].ainvoke(tool_call["args"])

# After:
tool_result = await self.tools_by_name[tool_call["name"]].ainvoke(tool_call["args"], config=config)
```

- [ ] **Step 3: Add `user_id` to `configurable` in `get_response` and `get_stream_response`**

In `get_response` (line ~315):

```python
# Before:
"configurable": {"thread_id": session_id},

# After:
"configurable": {"thread_id": session_id, "user_id": user_id},
```

Repeat the same change in `get_stream_response` (line ~356).

- [ ] **Step 4: Verify app starts and tools are listed**

```bash
make dev
curl http://localhost:8000/api/v1/openapi.json | python -m json.tool | grep -c "tool"
```

Expected: app starts without errors.

- [ ] **Step 5: Commit**

```bash
git add app/core/langgraph/tools/__init__.py app/core/langgraph/graph.py
git commit -m "feat: register all 5 tools, pass config in _tool_call, add user_id to configurable"
```

---

## Task 8: Update system prompt

**Files:**
- Modify: `app/core/prompts/system.md`

- [ ] **Step 1: Replace `app/core/prompts/system.md`**

```markdown
# Name: {agent_name}
# Role: Job Hunting Specialist

You are an expert job-hunting assistant. Help users find relevant jobs, research
target companies, write personalized cover letters, and track their applications.

# Workflow

1. **First interaction**: Proactively ask for the user's background — skills, years of
   experience, target roles, target locations, and salary expectations. This information
   is stored automatically in long-term memory and used to personalize cover letters.

2. **Job search**: When the user asks to find jobs, confirm keywords and location, then
   call `job_search_tool`. Present results as a clear list.

3. **Company research**: When the user wants to investigate a company before applying or
   interviewing, call `company_research_tool`. Summarize red flags if any appear.

4. **Cover letter**: When writing outreach or application emails, call `cover_letter_tool`.
   The tool automatically uses the user's stored profile — you do not need to re-ask for it.

5. **Application tracking**: After the user decides to apply, offer to record it with
   `application_tracker_tool`. When they ask for their application history, list it.

6. **Daily search setup**: If the user wants automated daily job discovery, save their
   preferences with `job_preferences_tool`. The system will search every morning at 08:00
   and results appear in the "Today's Picks" tab.

# Guidelines

- Always be encouraging but realistic. If a role seems like a poor fit, say so tactfully.
- Never fabricate job listings — only present results from tool calls.
- If you don't know the answer, say so honestly.

# What you know about the user
{long_term_memory}

# Current date and time
{current_date_and_time}
```

- [ ] **Step 2: Smoke test**

```bash
make dev
# After obtaining a session token via auth endpoints:
curl -X POST http://localhost:8000/api/v1/chatbot/chat \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <session_token>" \
  -d '{"messages": [{"role": "user", "content": "你好"}]}'
```

Expected: Agent introduces itself as a job-hunting specialist, asks about user background.

- [ ] **Step 3: Commit**

```bash
git add app/core/prompts/system.md
git commit -m "feat: update system prompt to job-hunting specialist persona"
```

---

## Task 9: Structured SSE streaming (`StreamChunk`)

**Files:**
- Modify: `app/schemas/chat.py`
- Modify: `app/core/langgraph/graph.py`
- Modify: `app/api/v1/chatbot.py`

`stream_mode="messages"` is kept — in this mode LangGraph emits all messages produced by graph nodes, including `AIMessageChunk` (with or without tool calls) and `ToolMessage`, which gives us everything needed for structured rendering.

- [ ] **Step 1: Add `StreamChunk` to `app/schemas/chat.py`**

Add after the existing `StreamResponse` class. Also add `Optional` to the imports.

```python
class StreamChunk(BaseModel):
    """A typed chunk in the SSE stream.

    Extends StreamResponse with a type field to distinguish text tokens from
    tool calls and tool results, enabling frontend to render inline tool cards.
    The done field mirrors StreamResponse for backwards compatibility.

    Attributes:
        type: Chunk type — text, tool_call, tool_result, or done.
        content: Text content or tool call summary.
        tool_name: Tool name (for tool_call and tool_result chunks).
        tool_call_id: Tool call correlation ID.
        done: Whether this is the final chunk.
    """

    type: Literal["text", "tool_call", "tool_result", "done"] = Field(
        default="text", description="Chunk type"
    )
    content: str = Field(default="", description="Chunk content")
    tool_name: Optional[str] = Field(default=None, description="Tool name")
    tool_call_id: Optional[str] = Field(default=None, description="Tool call ID")
    done: bool = Field(default=False, description="Whether the stream is complete")
```

- [ ] **Step 2: Add new imports at top of `app/core/langgraph/graph.py`**

Add to the existing imports block (top of file, not inside functions):

```python
import json as _json

from langchain_core.messages import AIMessageChunk
from langchain_core.messages import ToolMessage as LCToolMessage
```

- [ ] **Step 3: Replace the `async for` loop body in `get_stream_response`**

The existing loop (lines ~378-388):

```python
            async for token, _ in self._graph.astream(
                {"messages": dump_messages(messages), "long_term_memory": relevant_memory},
                config,
                stream_mode="messages",
            ):
                try:
                    yield token.content
                except Exception as token_error:
                    logger.error("Error processing token", error=str(token_error), session_id=session_id)
                    continue
```

Replace with:

```python
            async for token, _ in self._graph.astream(
                {"messages": dump_messages(messages), "long_term_memory": relevant_memory},
                config,
                stream_mode="messages",
            ):
                try:
                    if isinstance(token, AIMessageChunk):
                        if token.tool_call_chunks:
                            for tc in token.tool_call_chunks:
                                if tc.get("name"):
                                    yield _json.dumps({
                                        "type": "tool_call",
                                        "content": f"Calling {tc['name']}...",
                                        "tool_name": tc["name"],
                                        "tool_call_id": tc.get("id", ""),
                                        "done": False,
                                    })
                        elif token.content:
                            yield _json.dumps({
                                "type": "text",
                                "content": token.content,
                                "done": False,
                            })
                    elif isinstance(token, LCToolMessage):
                        yield _json.dumps({
                            "type": "tool_result",
                            "content": str(token.content)[:200],
                            "tool_name": token.name,
                            "tool_call_id": token.tool_call_id,
                            "done": False,
                        })
                except Exception as token_error:
                    logger.error("error_processing_token", error=str(token_error), session_id=session_id)
                    continue
```

- [ ] **Step 4: Update `event_generator` in `app/api/v1/chatbot.py`**

Add to imports at top of file:
```python
import json as _json
```

Remove `StreamResponse` from the import (it is no longer used in this file). The import line currently is:
```python
from app.schemas.chat import (
    ChatRequest,
    ChatResponse,
    Message,
    StreamResponse,
)
```

Change to:
```python
from app.schemas.chat import (
    ChatRequest,
    ChatResponse,
    Message,
)
```

Inside `event_generator`, replace the entire `try` block content:

```python
            try:
                with llm_stream_duration_seconds.labels(model=agent.llm_service.get_llm().get_name()).time():
                    async for chunk in agent.get_stream_response(
                        chat_request.messages, session.id, user_id=session.user_id
                    ):
                        yield f"data: {chunk}\n\n"

                yield f"data: {_json.dumps({'type': 'done', 'content': '', 'done': True})}\n\n"

            except Exception as e:
                logger.error(
                    "stream_chat_request_failed",
                    session_id=session.id,
                    error=str(e),
                    exc_info=True,
                )
                yield f"data: {_json.dumps({'type': 'done', 'content': str(e), 'done': True})}\n\n"
```

Note: `full_response` accumulation is removed — it was only used internally and had no consumers. Langfuse captures the full trace independently.

- [ ] **Step 5: Verify structured stream**

```bash
make dev
curl -N -X POST http://localhost:8000/api/v1/chatbot/chat/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <session_token>" \
  -d '{"messages": [{"role": "user", "content": "帮我找上海的agent engineer工作"}]}'
```

Expected: stream contains `{"type": "tool_call", ...}` chunk(s) followed by `{"type": "text", ...}` chunks.

- [ ] **Step 6: Commit**

```bash
git add app/schemas/chat.py app/core/langgraph/graph.py app/api/v1/chatbot.py
git commit -m "feat: structured SSE streaming with typed chunks (text/tool_call/tool_result/done)"
```

---

## Task 10: New REST API endpoints

**Files:**
- Create: `app/api/v1/preferences.py`
- Create: `app/api/v1/listings.py`
- Create: `app/api/v1/applications.py`
- Modify: `app/api/v1/api.py`

All endpoints: `@limiter.limit(...)`, `Depends(get_current_session)`, async, `HTTPException` for errors — same pattern as existing endpoints.

- [ ] **Step 1: Create `app/api/v1/preferences.py`**

```python
"""Job search preferences endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.api.v1.auth import get_current_session
from app.core.limiter import limiter
from app.core.logging import logger
from app.models.session import Session
from app.services.job_service import job_service

router = APIRouter()


class PreferenceRequest(BaseModel):
    """Request body for updating job preferences."""

    keywords: str
    location: str
    job_type: str = "fulltime"


@router.get("/preferences")
@limiter.limit("30/minute")
async def get_preferences(request: Request, session: Session = Depends(get_current_session)):
    """Get the current user's job search preferences."""
    pref = await job_service.get_preference(session.user_id)
    if not pref:
        raise HTTPException(status_code=404, detail="No preferences set yet")
    return pref


@router.put("/preferences")
@limiter.limit("30/minute")
async def set_preferences(
    request: Request,
    body: PreferenceRequest,
    session: Session = Depends(get_current_session),
):
    """Create or update job search preferences."""
    pref = await job_service.upsert_preference(
        session.user_id, body.keywords, body.location, body.job_type
    )
    logger.info("preferences_updated_via_api", user_id=session.user_id)
    return pref
```

- [ ] **Step 2: Create `app/api/v1/listings.py`**

```python
"""Job listings endpoints — daily search results."""

from fastapi import APIRouter, Depends, Request

from app.api.v1.auth import get_current_session
from app.core.limiter import limiter
from app.models.session import Session
from app.services.job_service import job_service

router = APIRouter()


@router.get("/listings")
@limiter.limit("60/minute")
async def get_listings(request: Request, session: Session = Depends(get_current_session)):
    """Get the latest job listings found by the daily scheduler."""
    listings = await job_service.get_listings(session.user_id)
    return {"listings": listings, "count": len(listings)}
```

- [ ] **Step 3: Create `app/api/v1/applications.py`**

```python
"""Job application tracking endpoints."""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.api.v1.auth import get_current_session
from app.core.limiter import limiter
from app.core.logging import logger
from app.models.session import Session
from app.services.job_service import job_service

router = APIRouter()


class ApplicationCreate(BaseModel):
    """Request body for creating a new application record."""

    company: str
    title: str
    url: Optional[str] = None
    notes: Optional[str] = None


class ApplicationUpdate(BaseModel):
    """Request body for updating an application."""

    status: Optional[str] = None
    notes: Optional[str] = None


@router.get("/applications")
@limiter.limit("60/minute")
async def list_applications(request: Request, session: Session = Depends(get_current_session)):
    """List all job applications for the current user."""
    apps = await job_service.list_applications(session.user_id)
    return {"applications": apps, "count": len(apps)}


@router.post("/applications", status_code=201)
@limiter.limit("30/minute")
async def add_application(
    request: Request,
    body: ApplicationCreate,
    session: Session = Depends(get_current_session),
):
    """Record a new job application."""
    app = await job_service.add_application(
        session.user_id, body.company, body.title, body.url, body.notes
    )
    logger.info("application_added_via_api", user_id=session.user_id, company=body.company)
    return app


@router.patch("/applications/{application_id}")
@limiter.limit("30/minute")
async def update_application(
    request: Request,
    application_id: int,
    body: ApplicationUpdate,
    session: Session = Depends(get_current_session),
):
    """Update an application's status or notes."""
    updated = await job_service.update_application(
        application_id, session.user_id, body.status, body.notes
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Application not found")
    return updated


@router.delete("/applications/{application_id}")
@limiter.limit("30/minute")
async def delete_application(
    request: Request,
    application_id: int,
    session: Session = Depends(get_current_session),
):
    """Delete an application record."""
    deleted = await job_service.delete_application(application_id, session.user_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Application not found")
    return {"message": "Application deleted"}
```

- [ ] **Step 4: Register routers in `app/api/v1/api.py`**

Add imports:
```python
from app.api.v1.applications import router as applications_router
from app.api.v1.listings import router as listings_router
from app.api.v1.preferences import router as preferences_router
```

Add after existing router includes:
```python
api_router.include_router(preferences_router, prefix="", tags=["job-preferences"])
api_router.include_router(listings_router, prefix="", tags=["job-listings"])
api_router.include_router(applications_router, prefix="", tags=["job-applications"])
```

- [ ] **Step 5: Verify endpoints in OpenAPI**

```bash
make dev
open http://localhost:8000/docs
```

Expected: `/api/v1/preferences`, `/api/v1/listings`, `/api/v1/applications` visible with correct HTTP methods.

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/preferences.py app/api/v1/listings.py app/api/v1/applications.py app/api/v1/api.py
git commit -m "feat: add preferences, listings, applications REST endpoints"
```

---

## Task 11: APScheduler — daily job search

**Files:**
- Create: `app/core/scheduler.py`
- Modify: `app/main.py`

The scheduler uses `DuckDuckGoSearchAPIWrapper` (returns structured `List[dict]` with `title`, `link`, `snippet`) instead of the string-returning tool, so listings can be stored with meaningful URLs.

- [ ] **Step 1: Create `app/core/scheduler.py`**

```python
"""APScheduler setup for daily automated job search."""

import asyncio

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from langchain_community.utilities import DuckDuckGoSearchAPIWrapper

from app.core.logging import logger
from app.services.job_service import job_service

scheduler = AsyncIOScheduler()

_wrapper = DuckDuckGoSearchAPIWrapper(num_results=10)


async def _daily_job_search() -> None:
    """Run job search for all users who have preferences configured.

    Calls DuckDuckGoSearchAPIWrapper directly (not through LangGraph agent)
    to get structured results with real URLs for deduplication.
    Note: get_all_preferences() loads all records — suitable for demo scale.
    Production use requires pagination or active-user filtering.
    CronTrigger uses server local timezone — set tz= if deploying to UTC servers.
    """
    logger.info("daily_job_search_started")
    prefs = await job_service.get_all_preferences()
    if not prefs:
        logger.info("daily_job_search_no_preferences")
        return

    for pref in prefs:
        try:
            query = f"{pref.keywords} job {pref.location} {pref.job_type}"
            # DuckDuckGoSearchAPIWrapper.results() is synchronous — run in executor
            # to avoid blocking the async event loop during the scheduled window.
            raw_results = await asyncio.get_event_loop().run_in_executor(
                None, lambda: _wrapper.results(query, num_results=10)
            )
            listings = [
                {
                    "title": r.get("title", ""),
                    "company": "",  # DDG doesn't always provide company separately
                    "location": pref.location,
                    "url": r.get("link", ""),
                    "snippet": r.get("snippet", ""),
                }
                for r in raw_results
                if r.get("link")  # only include results with a real URL
            ]
            inserted = await job_service.upsert_listings(pref.user_id, listings)
            logger.info(
                "daily_job_search_user_done",
                user_id=pref.user_id,
                keywords=pref.keywords,
                inserted=inserted,
            )
        except Exception as e:
            logger.exception("daily_job_search_user_failed", user_id=pref.user_id, error=str(e))

    logger.info("daily_job_search_completed", user_count=len(prefs))


def setup_scheduler() -> AsyncIOScheduler:
    """Register all scheduled jobs and return the scheduler."""
    scheduler.add_job(
        _daily_job_search,
        CronTrigger(hour=8, minute=0),
        id="daily_job_search",
        replace_existing=True,
    )
    return scheduler
```

- [ ] **Step 2: Wire scheduler into `app/main.py` lifespan**

Add import near the top:
```python
from app.core.scheduler import setup_scheduler
```

Update the `lifespan` function:
```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Handle application startup and shutdown events."""
    logger.info(
        "application_startup",
        project_name=settings.PROJECT_NAME,
        version=settings.VERSION,
        api_prefix=settings.API_V1_STR,
    )
    scheduler = setup_scheduler()
    scheduler.start()
    logger.info("scheduler_started")
    yield
    scheduler.shutdown()
    logger.info("application_shutdown")
```

- [ ] **Step 3: Verify scheduler starts**

```bash
make dev
```

Expected log line: `scheduler_started` on startup. No import errors.

- [ ] **Step 4: Commit**

```bash
git add app/core/scheduler.py app/main.py
git commit -m "feat: APScheduler daily job search at 08:00 with structured URL results"
```

---

## Final verification

- [ ] **Full smoke test**

```bash
make dev

# 1. Register
curl -s -X POST http://localhost:8000/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "testpass123"}'

# 2. Login → get token
curl -s -X POST http://localhost:8000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com", "password": "testpass123"}'

# 3. Create session → get session_token
curl -s -X POST http://localhost:8000/api/v1/auth/sessions \
  -H "Authorization: Bearer <token>"

# 4. Stream chat — verify tool_call chunk visible
curl -N -X POST http://localhost:8000/api/v1/chatbot/chat/stream \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <session_token>" \
  -d '{"messages": [{"role": "user", "content": "帮我找上海的agent engineer工作"}]}'

# 5. Set preferences
curl -X PUT http://localhost:8000/api/v1/preferences \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <session_token>" \
  -d '{"keywords": "agent engineer", "location": "上海", "job_type": "fulltime"}'

# 6. List applications (empty initially)
curl http://localhost:8000/api/v1/applications \
  -H "Authorization: Bearer <session_token>"
```

- [ ] **Lint**

```bash
make lint
```

- [ ] **Final commit if cleanup needed**

```bash
git add -p
git commit -m "chore: lint fixes"
```

---

## What's Next

**Frontend plan**: `docs/superpowers/plans/2026-03-24-job-hunter-agent-frontend.md`
- Next.js + Tailwind chat UI
- Tool call trace rendering (consumes `StreamChunk` from this backend)
- Application tracker dashboard (Kanban columns)
- "Today's Picks" listings tab
