# Onboarding Tour & Default Resume Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New users get a pre-seeded tutorial session + locale-matched default resume; driver.js tour auto-launches on first login, explains every major UI surface (Chat, sidebar, Settings, Kanban, P&E), and can be replayed from Settings. A dismissible banner reminds users whose resume is still the template to replace it.

**Architecture:**
- **Backend**: new DB columns (`session.is_tutorial`, `user.resume_is_default`, `user.tutorial_completed_at`); a new `/tutorial/*` router seeds one `is_tutorial=true` Session row plus a locale-chosen default resume on first login, and exposes replay/dismiss/status. No LangGraph checkpoint is written — the tutorial session is rendered **client-side** as static, locale-aware content using the real message components (`MessageBubble`, `ToolCallCard`, `JobSearchResultCard`, `PlanTimeline`). This avoids the complexity of seeding LangGraph PostgreSQL state.
- **Frontend**: `driver.js` (~5KB vanilla lib, React-19 safe) drives UI-overlay tour steps pulled from the existing `t()` i18n dictionary. `ChatPanel` branches on `session.is_tutorial` → renders `TutorialSessionContent` instead of `useChat` messages. A top banner shows when `resume_is_default=true` outside the tutorial session. Auto-launch on first visit, gated by a `localStorage.jh_tour_done` flag synchronized with the backend `tutorial_completed_at`.

**Tech Stack:** Next.js 16.2 / React 19.2 / Tailwind v4 / custom i18n (`lib/i18n.ts`) on the frontend; FastAPI / SQLModel / Postgres on the backend; `driver.js` as the only new dependency.

---

## File Structure

### Backend — files to CREATE
- `app/core/tutorial/__init__.py` — package marker
- `app/core/tutorial/content.py` — constants + `get_default_resume(locale)` + `get_tutorial_session_name(locale)`
- `app/core/tutorial/default_resume_zh.md` — Chinese example resume (Jane Doe / 张颖 persona, ~5 KB)
- `app/core/tutorial/default_resume_en.md` — English example resume (same persona)
- `app/api/v1/tutorial.py` — router with `GET /status`, `POST /seed`, `POST /replay`, `POST /dismiss`

### Backend — files to MODIFY
- `scripts/migrate.py` — add migration step for the 3 new columns
- `app/models/session.py` — add `is_tutorial: bool`
- `app/models/user.py` — add `resume_is_default: bool`, `tutorial_completed_at: datetime | None`
- `app/services/database.py` — add `seed_tutorial_session`, `mark_tutorial_done`, `reset_tutorial` helpers
- `app/api/v1/settings.py` — on `PUT /resume` set `resume_is_default=False`
- `app/api/v1/auth.py` — when `list_sessions` returns and the user has no sessions yet, call tutorial seeder
- `app/api/v1/api.py` — mount `tutorial_router`
- `app/schemas/auth.py` — add `is_tutorial` and `created_at` to the `SessionItem`-equivalent schema if missing

### Frontend — files to CREATE
- `frontend/lib/tour/steps.ts` — `buildTourSteps(t, locale)` returning driver.js step array
- `frontend/lib/tour/driver.ts` — thin wrapper around `driver()` (start, destroy, step helpers)
- `frontend/contexts/TourContext.tsx` — `TourProvider` + `useTour()` hook; orchestrates auto-launch + replay
- `frontend/components/tutorial/TutorialSessionContent.tsx` — static tutorial message stream
- `frontend/components/tutorial/DefaultResumeBanner.tsx` — dismissible banner
- `frontend/lib/api-tutorial.ts` — client fetchers for `/tutorial/*`

### Frontend — files to MODIFY
- `frontend/package.json` — add `driver.js` dep
- `frontend/lib/i18n.ts` — new keys (listed in Task 6)
- `frontend/lib/api.ts` — extend `SessionItem` with `is_tutorial?: boolean`, `created_at?: string`; add `apiGetResumeStatus` returning `{ resume_is_default }`
- `frontend/contexts/SessionContext.tsx` — include `is_tutorial` in state; expose `isTutorialSession(id)` helper
- `frontend/components/chat/SessionSidebar.tsx` — badge ("📘 教学 / Tutorial") on `is_tutorial` rows; `data-tour="sidebar"` attribute
- `frontend/components/chat/ChatPanel.tsx` — branch to `TutorialSessionContent` when active session is tutorial; render `DefaultResumeBanner` otherwise; add `data-tour="chat"` + `data-tour="input"`
- `frontend/components/chat/ChatInput.tsx` — accept `disabled?: boolean` + `disabledHint?: string` props
- `frontend/components/tracker/KanbanBoard.tsx` — add `data-tour="kanban"`
- `frontend/app/chat/page.tsx` — wrap content in `TourProvider`; add `data-tour` on tab buttons and settings gear
- `frontend/components/settings/SettingsModal.tsx` — add "Replay tutorial" row inside an existing or new "Tutorial" tab (simpler: button at bottom of Resume tab)

---

## Task 1: Database migration

**Files:**
- Modify: `scripts/migrate.py` (append to `run()` before `conn.commit()`)

- [ ] **Step 1.1 — Add migration block**

Append this block immediately after the Google-auth block and before `conn.commit()` in `scripts/migrate.py:run()`:

```python
        # Onboarding tour migration ------------------------------------
        if table_exists(cur, "session"):
            if not column_exists(cur, "session", "is_tutorial"):
                cur.execute(
                    'ALTER TABLE session ADD COLUMN is_tutorial BOOLEAN NOT NULL DEFAULT FALSE'
                )
                print("  Added column: session.is_tutorial")
            if not column_exists(cur, "session", "created_at"):
                cur.execute(
                    'ALTER TABLE session ADD COLUMN created_at TIMESTAMP WITH TIME ZONE '
                    'NOT NULL DEFAULT NOW()'
                )
                print("  Added column: session.created_at")

        if table_exists(cur, "user"):
            if not column_exists(cur, "user", "resume_is_default"):
                cur.execute(
                    'ALTER TABLE "user" ADD COLUMN resume_is_default BOOLEAN NOT NULL DEFAULT FALSE'
                )
                print("  Added column: user.resume_is_default")
            if not column_exists(cur, "user", "tutorial_completed_at"):
                cur.execute(
                    'ALTER TABLE "user" ADD COLUMN tutorial_completed_at TIMESTAMP WITH TIME ZONE'
                )
                print("  Added column: user.tutorial_completed_at")
```

- [ ] **Step 1.2 — Run migration locally**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent/.worktrees/feat-onboarding-tour
uv run python scripts/migrate.py
```

Expected output includes: `Added column: session.is_tutorial`, `Added column: user.resume_is_default`, `Added column: user.tutorial_completed_at`. A second run must print `Column already exists:` for every added column (idempotence check).

- [ ] **Step 1.3 — Commit**

```bash
git add scripts/migrate.py
git commit -m "feat(db): add tutorial + default-resume columns"
```

---

## Task 2: SQLModel updates

**Files:**
- Modify: `app/models/session.py`
- Modify: `app/models/user.py`

- [ ] **Step 2.1 — Extend Session model**

Replace `app/models/session.py` body (keep existing imports, add `datetime` + `Optional` if missing):

```python
"""This file contains the session model for the application."""

from datetime import datetime
from typing import TYPE_CHECKING

from sqlmodel import Field, Relationship

from app.models.base import BaseModel

if TYPE_CHECKING:
    from app.models.user import User


class Session(BaseModel, table=True):
    """Session model for storing chat sessions."""

    id: str = Field(primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    name: str = Field(default="")
    is_tutorial: bool = Field(default=False)
    created_at: datetime = Field(default_factory=datetime.utcnow)
    user: "User" = Relationship(back_populates="sessions")
```

- [ ] **Step 2.2 — Extend User model**

In `app/models/user.py`, add imports at the top (`from datetime import datetime`) and add the two new fields after `resume_text`:

```python
    resume_text: Optional[str] = Field(default=None)
    resume_is_default: bool = Field(default=False)
    tutorial_completed_at: Optional[datetime] = Field(default=None)
```

- [ ] **Step 2.3 — Verify**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent/.worktrees/feat-onboarding-tour
uv run python -c "from app.models.session import Session; from app.models.user import User; print(Session.model_fields.keys()); print(User.model_fields.keys())"
```

Expected: Session fields include `is_tutorial`, `created_at`; User fields include `resume_is_default`, `tutorial_completed_at`.

- [ ] **Step 2.4 — Commit**

```bash
git add app/models/session.py app/models/user.py
git commit -m "feat(models): is_tutorial on Session, resume_is_default on User"
```

---

## Task 3: Tutorial content module

**Files:**
- Create: `app/core/tutorial/__init__.py`
- Create: `app/core/tutorial/content.py`
- Create: `app/core/tutorial/default_resume_zh.md`
- Create: `app/core/tutorial/default_resume_en.md`

- [ ] **Step 3.1 — Create `__init__.py`**

```python
"""Tutorial seeding content (locale-aware default resume + session name)."""
```

- [ ] **Step 3.2 — Create `content.py`**

```python
"""Locale-aware tutorial content loaders."""

from pathlib import Path
from typing import Literal

Locale = Literal["zh-CN", "en"]

_DIR = Path(__file__).parent


def get_default_resume(locale: Locale) -> str:
    """Return the default resume plain text for a given locale."""
    filename = "default_resume_zh.md" if locale == "zh-CN" else "default_resume_en.md"
    return (_DIR / filename).read_text(encoding="utf-8")


def get_tutorial_session_name(locale: Locale) -> str:
    """Return the sidebar display name for the tutorial session."""
    return "📘 使用引导教学" if locale == "zh-CN" else "📘 Tutorial"


def normalize_locale(raw: str | None) -> Locale:
    """Normalize the value from the client's Accept-Language or form payload."""
    if raw and raw.lower().startswith("zh"):
        return "zh-CN"
    return "en"
```

- [ ] **Step 3.3 — Create Chinese default resume**

Write to `app/core/tutorial/default_resume_zh.md`:

```markdown
# 张颖 (Jane Zhang)
AI 工程师 · 上海 · jane.zhang@example.com · +86 138-0000-0000

## 个人简介
5 年后端与 AI 应用开发经验，专注于 LLM Agent 设计、RAG 系统构建与生产级推理服务部署。熟悉 LangGraph、OpenAI Function Calling 与向量检索链路的全栈调优。

## 工作经历

### 资深 AI 工程师 — 星云智能 （2023.03 – 至今）
- 主导构建面向 B 端客户的 Agentic 知识助手，日均处理对话 10 万+，用户满意度从 72% 提升至 91%。
- 使用 LangGraph 编排工具调用链路，将复杂业务工作流的落地周期从 6 周压缩至 2 周。
- 设计 Redis + pgvector 的混合检索方案，召回率 +18%，P99 响应时延 800ms → 320ms。

### 后端工程师 — 明远科技 （2020.07 – 2023.02）
- 负责订单中台核心服务，Python/FastAPI，日订单量 500 万。
- 推动服务从单体向微服务演进，关键接口错误率下降 60%。
- 主导引入 OpenTelemetry + Prometheus 可观测性体系。

## 技能
Python / TypeScript · LangGraph · OpenAI API · PostgreSQL · Redis · Docker · Kubernetes · AWS · pgvector · LangFuse

## 教育
上海交通大学 · 计算机科学与技术硕士 （2018 – 2020）
复旦大学 · 软件工程学士 （2014 – 2018）

## 项目
- **AgentOps 平台** — 开源，1.2k stars，Python/FastAPI，Agent 行为回放与成本分析。
- **Resume Tailor** — 基于 LLM 的简历定制工具，接入 3 家 HR SaaS 客户。

> 这是一份**测试用默认简历**。请在"设置 → 简历"中替换为你的真实简历，AI 将据此为你匹配职位并定制投递材料。
```

- [ ] **Step 3.4 — Create English default resume**

Write to `app/core/tutorial/default_resume_en.md`:

```markdown
# Jane Doe
AI Engineer · San Francisco · jane.doe@example.com · +1 (415) 555-0144

## Summary
5 years building backend systems and production LLM applications. Deep experience designing agentic workflows with LangGraph, tuning RAG pipelines, and shipping low-latency inference services at scale.

## Experience

### Senior AI Engineer — Nebula Intelligence (2023.03 – Present)
- Led an agentic knowledge-assistant product for B2B customers, handling 100k+ daily conversations; raised CSAT from 72% to 91%.
- Orchestrated multi-tool workflows with LangGraph, cutting time-to-production for complex business flows from 6 weeks to 2.
- Designed a Redis + pgvector hybrid retrieval stack: recall +18%, P99 latency 800ms → 320ms.

### Backend Engineer — Mingyuan Tech (2020.07 – 2023.02)
- Owned the order-management core service (Python / FastAPI), 5M daily orders.
- Drove the monolith-to-microservices migration; critical-path error rate down 60%.
- Introduced OpenTelemetry + Prometheus across the platform.

## Skills
Python / TypeScript · LangGraph · OpenAI API · PostgreSQL · Redis · Docker · Kubernetes · AWS · pgvector · Langfuse

## Education
Shanghai Jiao Tong University — M.S. Computer Science (2018 – 2020)
Fudan University — B.S. Software Engineering (2014 – 2018)

## Projects
- **AgentOps** — OSS, 1.2k stars; Python/FastAPI agent trace replay and cost analytics.
- **Resume Tailor** — LLM-based resume tailoring tool shipped with 3 HR-SaaS customers.

> This is a **sample default resume** for demo purposes. Open *Settings → Resume* and replace it with your own so the AI can match jobs and tailor materials for you.
```

- [ ] **Step 3.5 — Commit**

```bash
git add app/core/tutorial/
git commit -m "feat(tutorial): default resume templates + content loader"
```

---

## Task 4: Tutorial router + DB helpers

**Files:**
- Modify: `app/services/database.py`
- Create: `app/api/v1/tutorial.py`
- Modify: `app/api/v1/api.py`

- [ ] **Step 4.1 — Add database helpers**

In `app/services/database.py`, add these methods to `DatabaseService` (locate by searching for an existing `update_user_resume` method and add the new ones near it):

```python
    async def seed_tutorial_for_user(
        self,
        user_id: int,
        locale: str,
        session_id: str,
        session_name: str,
        default_resume: str,
    ) -> Session:
        """Create the tutorial Session row and write the default resume.

        Idempotent: if a tutorial session already exists for the user, it is
        returned unchanged. The default resume is only written when the user
        currently has no resume or the stored resume is already the default.
        """
        async with self.async_session() as s:
            existing = (
                await s.execute(
                    select(Session).where(
                        Session.user_id == user_id, Session.is_tutorial.is_(True)
                    )
                )
            ).scalar_one_or_none()
            if existing is None:
                tutorial = Session(
                    id=session_id,
                    user_id=user_id,
                    name=session_name,
                    is_tutorial=True,
                )
                s.add(tutorial)
            else:
                tutorial = existing

            user = (
                await s.execute(select(User).where(User.id == user_id))
            ).scalar_one()
            if not user.resume_text or user.resume_is_default:
                user.resume_text = default_resume
                user.resume_is_default = True
            await s.commit()
            await s.refresh(tutorial)
            return tutorial

    async def mark_tutorial_completed(self, user_id: int) -> None:
        """Stamp tutorial_completed_at = now() on the user."""
        async with self.async_session() as s:
            user = (
                await s.execute(select(User).where(User.id == user_id))
            ).scalar_one()
            user.tutorial_completed_at = datetime.now(UTC)
            await s.commit()

    async def reset_tutorial_completion(self, user_id: int) -> None:
        """Clear tutorial_completed_at so the tour re-auto-starts."""
        async with self.async_session() as s:
            user = (
                await s.execute(select(User).where(User.id == user_id))
            ).scalar_one()
            user.tutorial_completed_at = None
            await s.commit()
```

Make sure `datetime`, `UTC`, `select`, `Session`, `User` are imported at the top of the file (most of these should already be there — verify with the file's existing imports and add only what's missing). **Use `datetime.now(UTC)`, not `datetime.utcnow()`** (the latter is deprecated since Python 3.12 and produces tz-naive values that conflict with the tz-aware Postgres columns).

- [ ] **Step 4.2 — Create tutorial router**

Write `app/api/v1/tutorial.py`:

```python
"""Tutorial seeding and replay endpoints."""

import uuid

from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel, Field

from app.api.v1.auth import get_current_user
from app.core.config import settings
from app.core.limiter import limiter
from app.core.logging import logger
from app.core.tutorial.content import (
    Locale,
    get_default_resume,
    get_tutorial_session_name,
    normalize_locale,
)
from app.models.user import User
from app.services.database import database_service as db_service

router = APIRouter()


class TutorialStatus(BaseModel):
    has_tutorial_session: bool
    tutorial_session_id: str | None
    tutorial_completed: bool
    resume_is_default: bool


class TutorialSeedRequest(BaseModel):
    locale: str = Field(default="en")


class TutorialSeedResponse(BaseModel):
    session_id: str
    name: str


@router.get("/status", response_model=TutorialStatus)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def get_tutorial_status(
    request: Request,
    user: User = Depends(get_current_user),
) -> TutorialStatus:
    session = await db_service.get_tutorial_session_for_user(user.id)
    return TutorialStatus(
        has_tutorial_session=session is not None,
        tutorial_session_id=session.id if session else None,
        tutorial_completed=user.tutorial_completed_at is not None,
        resume_is_default=user.resume_is_default,
    )


@router.post("/seed", response_model=TutorialSeedResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def seed_tutorial(
    request: Request,
    body: TutorialSeedRequest,
    user: User = Depends(get_current_user),
) -> TutorialSeedResponse:
    locale: Locale = normalize_locale(body.locale)
    tutorial = await db_service.seed_tutorial_for_user(
        user_id=user.id,
        locale=locale,
        session_id=str(uuid.uuid4()),
        session_name=get_tutorial_session_name(locale),
        default_resume=get_default_resume(locale),
    )
    logger.info("tutorial_seeded", user_id=user.id, session_id=tutorial.id, locale=locale)
    return TutorialSeedResponse(session_id=tutorial.id, name=tutorial.name)


@router.post("/replay", response_model=TutorialSeedResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def replay_tutorial(
    request: Request,
    body: TutorialSeedRequest,
    user: User = Depends(get_current_user),
) -> TutorialSeedResponse:
    """Reset tutorial_completed_at and ensure a tutorial session exists."""
    locale: Locale = normalize_locale(body.locale)
    await db_service.reset_tutorial_completion(user.id)
    tutorial = await db_service.seed_tutorial_for_user(
        user_id=user.id,
        locale=locale,
        session_id=str(uuid.uuid4()),
        session_name=get_tutorial_session_name(locale),
        default_resume=get_default_resume(locale),
    )
    logger.info("tutorial_replay", user_id=user.id, session_id=tutorial.id, locale=locale)
    return TutorialSeedResponse(session_id=tutorial.id, name=tutorial.name)


@router.post("/dismiss")
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def dismiss_tutorial(
    request: Request,
    user: User = Depends(get_current_user),
) -> dict:
    await db_service.mark_tutorial_completed(user.id)
    logger.info("tutorial_dismissed", user_id=user.id)
    return {"ok": True}
```

- [ ] **Step 4.3 — Add `get_tutorial_session_for_user` helper**

In `app/services/database.py`, add next to the other helpers:

```python
    async def get_tutorial_session_for_user(self, user_id: int) -> Session | None:
        async with self.async_session() as s:
            return (
                await s.execute(
                    select(Session).where(
                        Session.user_id == user_id, Session.is_tutorial.is_(True)
                    )
                )
            ).scalar_one_or_none()
```

- [ ] **Step 4.4 — Mount the router**

In `app/api/v1/api.py`, add the import and include:

```python
from app.api.v1.tutorial import router as tutorial_router
# ...
api_router.include_router(tutorial_router, prefix="/tutorial", tags=["tutorial"])
```

- [ ] **Step 4.5 — Verify the endpoints load**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent/.worktrees/feat-onboarding-tour
uv run python -c "from app.api.v1.api import api_router; print([r.path for r in api_router.routes if 'tutorial' in r.path])"
```

Expected: a list containing `/tutorial/status`, `/tutorial/seed`, `/tutorial/replay`, `/tutorial/dismiss`.

- [ ] **Step 4.6 — Commit**

```bash
git add app/services/database.py app/api/v1/tutorial.py app/api/v1/api.py
git commit -m "feat(api): /tutorial router (status, seed, replay, dismiss)"
```

---

## Task 5: Auto-seed on first session-list fetch + clear `resume_is_default` on manual save

**Files:**
- Modify: `app/api/v1/auth.py` (find `list_sessions` or the session-list endpoint)
- Modify: `app/api/v1/settings.py:update_resume` (lines 149-159)
- Modify: `app/schemas/auth.py` (or wherever the session-list response shape is defined — locate via `grep -n "session_id" app/schemas/*.py`)

- [ ] **Step 5.1 — Clear `resume_is_default` on manual save**

Replace the body of `update_resume` in `app/api/v1/settings.py`:

```python
@router.put("/resume", response_model=ResumeResponse)
@limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
async def update_resume(
    body: ResumeRequest,
    request: Request,
    current_user: User = Depends(get_current_user),
) -> ResumeResponse:
    """Save the current user's plain-text resume and mark it non-default."""
    user = await db_service.update_user_resume(current_user.id, body.resume_text)
    # Side-effect: manual edits always mark the resume as non-default.
    await db_service.set_resume_is_default(current_user.id, False)
    logger.info("resume_updated", user_id=current_user.id)
    return ResumeResponse(resume_text=user.resume_text)
```

- [ ] **Step 5.2 — Add `set_resume_is_default` helper**

In `app/services/database.py`:

```python
    async def set_resume_is_default(self, user_id: int, value: bool) -> None:
        async with self.async_session() as s:
            user = (
                await s.execute(select(User).where(User.id == user_id))
            ).scalar_one()
            user.resume_is_default = value
            await s.commit()
```

- [ ] **Step 5.3 — Auto-seed in session-list**

First locate the endpoint:

```bash
grep -n "sessions" app/api/v1/auth.py | head -10
```

At the start of the handler (before the existing session-fetch logic), inject the auto-seed call. The handler typically takes `user: User = Depends(get_current_user)` — use that. Accept an optional `Accept-Language` header:

```python
# at top of file add:
from fastapi import Header
from app.core.tutorial.content import (
    get_default_resume,
    get_tutorial_session_name,
    normalize_locale,
)
import uuid

# inside the list-sessions handler, at the very start of its body:
async def list_sessions(
    request: Request,
    user: User = Depends(get_current_user),
    accept_language: str | None = Header(default=None),
):
    existing = await db_service.list_sessions_for_user(user.id)
    if not existing:
        locale = normalize_locale(accept_language)
        await db_service.seed_tutorial_for_user(
            user_id=user.id,
            locale=locale,
            session_id=str(uuid.uuid4()),
            session_name=get_tutorial_session_name(locale),
            default_resume=get_default_resume(locale),
        )
        existing = await db_service.list_sessions_for_user(user.id)
    # ... existing serialization logic continues, but MUST now include is_tutorial + created_at
```

> Adapt the exact variable names (`existing`, `list_sessions_for_user`) to match the real code — do not invent a helper if one already exists; use the current accessor.

- [ ] **Step 5.4 — Extend the session-list response**

Find the schema that serializes sessions in the list response (search `app/schemas/auth.py` first). Add:

```python
    is_tutorial: bool = False
    created_at: datetime | None = None
```

Then in the handler, when building each item, include these two fields from the ORM row.

- [ ] **Step 5.5 — Smoke-test**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent/.worktrees/feat-onboarding-tour
# In one shell:
make dev
# In another shell, log in via the UI to obtain a fresh access_token, then:
curl -H "Authorization: Bearer <ACCESS_TOKEN>" -H "Accept-Language: zh-CN" \
     http://localhost:8000/api/v1/auth/sessions | jq '.[] | {name, is_tutorial}'
```

Expected: exactly one row with `is_tutorial: true` and a Chinese name. Running the same command a second time must still show exactly one tutorial session (idempotence).

- [ ] **Step 5.6 — Commit**

```bash
git add app/api/v1/auth.py app/api/v1/settings.py app/services/database.py app/schemas/auth.py
git commit -m "feat(api): auto-seed tutorial on first login; clear default flag on resume save"
```

---

## Task 6: Frontend i18n strings

**Files:**
- Modify: `frontend/lib/i18n.ts`

- [ ] **Step 6.1 — Add tutorial keys to the `zh` dictionary**

Insert in `lib/i18n.ts` inside the `zh` object, at the end (just before the closing `}`):

```ts
  // Tutorial — sidebar + banners
  tutorial_badge: '教学',
  tutorial_session_name: '📘 使用引导教学',
  tutorial_default_resume_banner: '当前正在使用测试默认简历。去「设置 → 简历」替换为你的真实简历 →',
  tutorial_banner_cta: '去设置',
  tutorial_banner_dismiss: '暂不处理',
  tutorial_input_disabled: '本会话仅作教程展示。点击「＋ 新建对话」开始与 AI 交流。',
  tutorial_replay: '重放引导教学',
  tutorial_replay_confirm: '将重置教学进度并重新开始引导。继续？',
  // Tutorial — static session content
  tut_user_1: '帮我找上海的 Agent Engineer 岗位，3-5 年经验',
  tut_assistant_1: '好的，我为你搜索"Agent Engineer · 上海"相关职位。',
  tut_assistant_2: '我找到 3 个匹配结果。选择你感兴趣的，我会保存到你的追踪看板。',
  tut_user_2: '帮我处理看板里这 2 张待投递职位',
  tut_pe_plan_1: '为每家公司做深度研究（规模/融资/文化）',
  tut_pe_plan_2: '根据 JD 打分并排序优先级',
  tut_pe_plan_3: '为前 2 家定制简历并生成 PDF',
  tut_assistant_done: '已为 2 家公司完成研究、匹配分析和简历定制，可在「追踪看板」卡片中查看每项产物。',
  // Tutorial — tour steps
  tour_welcome_title: '欢迎使用 Job Hunter ✦',
  tour_welcome_body: '我会花 1 分钟带你看看核心功能。你随时可以点击右下角「跳过」退出。',
  tour_sidebar_title: '对话侧边栏',
  tour_sidebar_body: '每个对话都是一次独立的求职任务。教学会话已经为你准备好，点击它可以查看完整示例。',
  tour_chat_title: '与 Agent 对话',
  tour_chat_body: '这里展示 AI 的回复、工具调用过程与生成的职位卡片。所有行动都是实时可见的。',
  tour_input_title: '发送消息',
  tour_input_body: '告诉 Agent 你想做什么：搜职位、分析 JD、定制简历或让它帮你规划一周投递。',
  tour_tab_tracker_title: '追踪看板',
  tour_tab_tracker_body: '所有感兴趣的职位都在这里，可拖拽更新进度；卡片上会显示匹配分、简历产物。',
  tour_settings_title: '设置',
  tour_settings_body: '在这里编辑系统提示词、替换默认简历、配置搜索关键词或重放本教程。',
  tour_memory_title: 'AI 记忆',
  tour_memory_body: 'Agent 会跨会话记住你的偏好（目标岗位、城市、工作风格），越用越懂你。',
  tour_pe_title: 'Plan & Execute',
  tour_pe_body: '复杂任务（如批量研究公司 + 定制简历）会自动升级为 P&E 计划，你可以在对话中看到每一步的执行进度。',
  tour_done_title: '开始使用吧 🚀',
  tour_done_body: '有任何问题直接告诉 Agent。你也可以在「设置」里随时重放本教程。',
  tour_skip: '跳过',
  tour_next: '下一步',
  tour_prev: '上一步',
  tour_done: '完成',
```

- [ ] **Step 6.2 — Add the mirrored English keys**

Insert the same keys inside the `en` object with English values:

```ts
  tutorial_badge: 'Tutorial',
  tutorial_session_name: '📘 Tutorial',
  tutorial_default_resume_banner: "You're using a sample default resume. Open Settings → Resume to replace it with your own →",
  tutorial_banner_cta: 'Open Settings',
  tutorial_banner_dismiss: 'Later',
  tutorial_input_disabled: 'This session is read-only for the tutorial. Click “+ New Chat” to start your own conversation.',
  tutorial_replay: 'Replay Tutorial',
  tutorial_replay_confirm: 'Reset tutorial progress and re-launch? This cannot be undone.',
  tut_user_1: 'Find Agent Engineer roles in San Francisco, 3-5 yrs',
  tut_assistant_1: "Got it — searching for 'Agent Engineer · San Francisco'.",
  tut_assistant_2: 'I found 3 matches. Pick the ones you like and I will save them to your kanban.',
  tut_user_2: 'Process these 2 pending jobs on my kanban',
  tut_pe_plan_1: 'Deep research on each company (size / funding / culture)',
  tut_pe_plan_2: 'Score JD match and rank priorities',
  tut_pe_plan_3: 'Tailor a resume + generate a PDF for the top 2',
  tut_assistant_done: 'Done — research, match scoring, and tailored resumes are ready. Open any kanban card to view artifacts.',
  tour_welcome_title: 'Welcome to Job Hunter ✦',
  tour_welcome_body: "I'll spend a minute showing you around. You can skip anytime from the bottom-right.",
  tour_sidebar_title: 'Conversation sidebar',
  tour_sidebar_body: 'Each conversation is one job-hunt task. A tutorial session is already set up — click it to see a full example.',
  tour_chat_title: 'Chat with the Agent',
  tour_chat_body: 'Assistant replies, tool calls, and job cards appear here inline. Everything the AI does is visible in real time.',
  tour_input_title: 'Send a message',
  tour_input_body: 'Tell the agent what you want: search jobs, analyze a JD, tailor your resume, or plan this week.',
  tour_tab_tracker_title: 'Tracker',
  tour_tab_tracker_body: 'All saved jobs live here. Drag to update status; cards surface match scores and resume artifacts.',
  tour_settings_title: 'Settings',
  tour_settings_body: 'Edit your system prompt, replace the default resume, configure search keywords, or replay this tour.',
  tour_memory_title: 'AI Memory',
  tour_memory_body: 'The agent remembers your preferences across sessions (role, city, working style) and gets better over time.',
  tour_pe_title: 'Plan & Execute',
  tour_pe_body: 'Complex tasks (e.g. research N companies + tailor resumes) auto-escalate to a P&E plan; each step streams its progress.',
  tour_done_title: "You're all set 🚀",
  tour_done_body: 'Ask the agent anything. You can replay this tour any time from Settings.',
  tour_skip: 'Skip',
  tour_next: 'Next',
  tour_prev: 'Back',
  tour_done: 'Done',
```

- [ ] **Step 6.3 — Verify TS compiles**

```bash
cd frontend && pnpm exec tsc --noEmit
```

Expected: no output (clean).

- [ ] **Step 6.4 — Commit**

```bash
git add frontend/lib/i18n.ts
git commit -m "feat(i18n): tutorial + tour strings (zh / en)"
```

---

## Task 7: Install driver.js + build tour step definitions

**Files:**
- Modify: `frontend/package.json`
- Create: `frontend/lib/tour/driver.ts`
- Create: `frontend/lib/tour/steps.ts`

- [ ] **Step 7.1 — Install dependency**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent/.worktrees/feat-onboarding-tour/frontend
pnpm add driver.js
```

Expected: `package.json` now has `"driver.js": "^1.x"` in dependencies.

- [ ] **Step 7.2 — Create `lib/tour/driver.ts`**

```ts
"use client"

import { driver as createDriver, type Driver, type DriveStep } from "driver.js"
import "driver.js/dist/driver.css"

let instance: Driver | null = null

export function startTour(steps: DriveStep[], onDone: () => void) {
  instance?.destroy()
  instance = createDriver({
    showProgress: true,
    allowClose: true,
    animate: true,
    overlayOpacity: 0.55,
    steps,
    onDestroyed: () => onDone(),
  })
  instance.drive()
}

export function stopTour() {
  instance?.destroy()
  instance = null
}

export type { DriveStep } from "driver.js"
```

- [ ] **Step 7.3 — Create `lib/tour/steps.ts`**

```ts
import type { DriveStep } from "./driver"

type T = (key: string, ...args: unknown[]) => string

export function buildTourSteps(t: T): DriveStep[] {
  const base = (key: string): DriveStep["popover"] => ({
    title: t(`tour_${key}_title`),
    description: t(`tour_${key}_body`),
    nextBtnText: t("tour_next"),
    prevBtnText: t("tour_prev"),
    doneBtnText: t("tour_done"),
    showButtons: ["next", "previous", "close"],
    closeBtnText: t("tour_skip"),
  })

  return [
    { popover: base("welcome") },
    { element: '[data-tour="sidebar"]', popover: { ...base("sidebar"), side: "right", align: "start" } },
    { element: '[data-tour="chat"]', popover: { ...base("chat"), side: "left", align: "center" } },
    { element: '[data-tour="input"]', popover: { ...base("input"), side: "top", align: "center" } },
    { element: '[data-tour="tab-tracker"]', popover: { ...base("tab_tracker"), side: "bottom", align: "center" } },
    { element: '[data-tour="pe-timeline"]', popover: { ...base("pe"), side: "left", align: "center" } },
    { element: '[data-tour="settings"]', popover: { ...base("settings"), side: "bottom", align: "end" } },
    { popover: base("memory") },
    { popover: base("done") },
  ]
}
```

- [ ] **Step 7.4 — Verify TS**

```bash
cd frontend && pnpm exec tsc --noEmit
```

Expected: no output.

- [ ] **Step 7.5 — Commit**

```bash
git add frontend/package.json frontend/pnpm-lock.yaml frontend/lib/tour/
git commit -m "feat(tour): install driver.js + i18n-driven step definitions"
```

---

## Task 8: Add `data-tour` anchors + mount TourProvider

**Files:**
- Create: `frontend/contexts/TourContext.tsx`
- Create: `frontend/lib/api-tutorial.ts`
- Modify: `frontend/app/chat/page.tsx`
- Modify: `frontend/components/chat/SessionSidebar.tsx`
- Modify: `frontend/components/chat/ChatPanel.tsx`
- Modify: `frontend/components/chat/ChatInput.tsx`
- Modify: `frontend/components/tracker/KanbanBoard.tsx`
- Modify: `frontend/components/plan/PlanTimeline.tsx`

- [ ] **Step 8.1 — Create the tutorial API client**

Write `frontend/lib/api-tutorial.ts`:

```ts
const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

async function fetchJson<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`))
  return res.json() as Promise<T>
}

export interface TutorialStatus {
  has_tutorial_session: boolean
  tutorial_session_id: string | null
  tutorial_completed: boolean
  resume_is_default: boolean
}

export function apiTutorialStatus(accessToken: string) {
  return fetchJson<TutorialStatus>("/api/v1/tutorial/status", accessToken)
}

export function apiTutorialReplay(accessToken: string, locale: string) {
  return fetchJson<{ session_id: string; name: string }>(
    "/api/v1/tutorial/replay",
    accessToken,
    { method: "POST", body: JSON.stringify({ locale }) },
  )
}

export function apiTutorialDismiss(accessToken: string) {
  return fetchJson<{ ok: boolean }>("/api/v1/tutorial/dismiss", accessToken, { method: "POST" })
}
```

- [ ] **Step 8.2 — Create `TourContext.tsx`**

```tsx
"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { useLanguage } from "@/contexts/LanguageContext"
import { buildTourSteps } from "@/lib/tour/steps"
import { startTour, stopTour } from "@/lib/tour/driver"
import { apiTutorialDismiss, apiTutorialStatus } from "@/lib/api-tutorial"
import { getAccessToken } from "@/lib/auth"

interface TourContextValue {
  start: () => void
  stop: () => void
  hasAutoStarted: boolean
}

const TourContext = createContext<TourContextValue | null>(null)

const LOCAL_DONE_KEY = "jh_tour_done"

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage()
  const hasAutoStartedRef = useRef(false)
  const [hasAutoStarted, setHasAutoStarted] = useState(false)

  const finish = useCallback(() => {
    localStorage.setItem(LOCAL_DONE_KEY, "1")
    const token = getAccessToken()
    if (token) apiTutorialDismiss(token).catch(() => {})
  }, [])

  const start = useCallback(() => {
    const steps = buildTourSteps(t)
    startTour(steps, finish)
  }, [t, finish])

  const stop = useCallback(() => {
    stopTour()
    finish()
  }, [finish])

  // Auto-start: only once per mount; respects localStorage and backend completion flag.
  useEffect(() => {
    if (hasAutoStartedRef.current) return
    hasAutoStartedRef.current = true
    const token = getAccessToken()
    if (!token) return
    if (localStorage.getItem(LOCAL_DONE_KEY) === "1") return

    let cancelled = false
    apiTutorialStatus(token)
      .then((status) => {
        if (cancelled) return
        if (status.tutorial_completed) {
          localStorage.setItem(LOCAL_DONE_KEY, "1")
          return
        }
        // Give the DOM a moment to finish hydration before anchoring popovers.
        setTimeout(() => {
          if (cancelled) return
          start()
          setHasAutoStarted(true)
        }, 600)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [start])

  return (
    <TourContext.Provider value={{ start, stop, hasAutoStarted }}>
      {children}
    </TourContext.Provider>
  )
}

export function useTour() {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error("useTour must be used within TourProvider")
  return ctx
}
```

- [ ] **Step 8.3 — Wrap `chat/page.tsx` with `TourProvider`**

Modify `frontend/app/chat/page.tsx`:

1. Add import: `import { TourProvider } from "@/contexts/TourContext"`
2. In the `ChatPage` default export, nest `<TourProvider>` **inside** `<SessionProvider>` (so it can read auth + sessions):

```tsx
export default function ChatPage() {
  return (
    <SessionProvider>
      <TourProvider>
        <Suspense>
          <ChatPageInner />
        </Suspense>
      </TourProvider>
    </SessionProvider>
  )
}
```

3. Add `data-tour` anchors on the relevant elements:
   - Tracker tab button: add `data-tour="tab-tracker"` to its `<button>` inside the `role="tablist"` map (only the tracker one — use a conditional in the loop).
   - Settings menu button: add `data-tour="settings"` to the user-menu trigger (`<button onClick={() => setShowUserMenu(...`).

- [ ] **Step 8.4 — Anchor sidebar + chat + input**

- `SessionSidebar.tsx` outer wrapper div: add `data-tour="sidebar"` to the `<div className="flex-shrink-0 w-52">`.
- `ChatPanel.tsx` root glass-strong div: add `data-tour="chat"` to `<div className="glass-strong rounded-3xl flex flex-col h-full">`.
- `ChatInput.tsx`: add `data-tour="input"` to the root `<form>` or wrapper.
- `KanbanBoard.tsx` root: add `data-tour="kanban"` to the outermost component div.
- `PlanTimeline.tsx` root: add `data-tour="pe-timeline"` to the outermost div.

- [ ] **Step 8.5 — Dev sanity check**

```bash
cd frontend && pnpm dev
```

Open the browser, log in, confirm:
1. Tour auto-starts (if this is a fresh account or after clearing `localStorage.jh_tour_done`).
2. Each step highlights the correct element. No console errors.

- [ ] **Step 8.6 — Commit**

```bash
git add frontend/contexts/TourContext.tsx frontend/lib/api-tutorial.ts frontend/app/chat/page.tsx frontend/components/chat/SessionSidebar.tsx frontend/components/chat/ChatPanel.tsx frontend/components/chat/ChatInput.tsx frontend/components/tracker/KanbanBoard.tsx frontend/components/plan/PlanTimeline.tsx
git commit -m "feat(tour): TourProvider + data-tour anchors across UI"
```

---

## Task 9: Tutorial session renderer + disabled input

**Files:**
- Create: `frontend/components/tutorial/TutorialSessionContent.tsx`
- Modify: `frontend/components/chat/ChatPanel.tsx`
- Modify: `frontend/components/chat/ChatInput.tsx`
- Modify: `frontend/lib/api.ts`
- Modify: `frontend/contexts/SessionContext.tsx`

- [ ] **Step 9.1 — Extend `SessionItem` + session context**

In `frontend/lib/api.ts`, extend `SessionItem`:

```ts
export interface SessionItem {
  session_id: string
  name: string
  token: {
    access_token: string
    token_type: string
    expires_at: string
  }
  created_at?: string
  is_tutorial?: boolean
}
```

- [ ] **Step 9.2 — Create `TutorialSessionContent.tsx`**

```tsx
"use client"

import { useLanguage } from "@/contexts/LanguageContext"
import { MessageBubble } from "@/components/chat/MessageBubble"
import { JobSearchResultCard } from "@/components/chat/JobSearchResultCard"
import type { ChatMessage, ToolCallEntry } from "@/lib/types"

function buildJobSearchEntry(locale: string): ToolCallEntry {
  const resultsZh = [
    { title: "AI Engineer · 星云智能 · 上海", link: "https://example.com/job/001",
      snippet: "5 年 LangGraph 经验，负责 Agent 产品研发，25-50k/月。" },
    { title: "Agentic Platform Lead · 洞见科技 · 上海", link: "https://example.com/job/002",
      snippet: "主导 Agent 平台 0-1 搭建，技术栈 Python/LangChain，35-60k/月。" },
    { title: "LLM 应用工程师 · 智源研究院 · 上海", link: "https://example.com/job/003",
      snippet: "RAG + 工具调用方向，熟悉 OpenAI / Anthropic API，30-55k/月。" },
  ]
  const resultsEn = [
    { title: "AI Engineer · Nebula Intelligence · San Francisco", link: "https://example.com/job/001",
      snippet: "5+ yrs LangGraph; own agent product roadmap. $180-240k." },
    { title: "Agentic Platform Lead · Insight Tech · San Francisco", link: "https://example.com/job/002",
      snippet: "0-1 agent platform; Python/LangChain stack. $200-260k." },
    { title: "LLM Applications Engineer · Beacon AI · San Francisco", link: "https://example.com/job/003",
      snippet: "RAG + tool calling; OpenAI/Anthropic API expertise. $190-250k." },
  ]
  const payload = {
    keywords: locale === "zh-CN" ? "Agent Engineer" : "Agent Engineer",
    location: locale === "zh-CN" ? "上海" : "San Francisco",
    intro_text: locale === "zh-CN"
      ? "这是我为你找到的 3 个职位，勾选你感兴趣的即可保存到看板。"
      : "Here are 3 matching roles — tick the ones you'd like and I'll save them to your kanban.",
    results: locale === "zh-CN" ? resultsZh : resultsEn,
  }
  return {
    id: "tut-job-search-1",
    name: "search_jobs",
    status: "done",
    requestContent: JSON.stringify({ query: payload.keywords, location: payload.location }),
    resultContent: JSON.stringify(payload),
  } as ToolCallEntry
}

export function TutorialSessionContent() {
  const { t, locale } = useLanguage()
  const jobSearchEntry = buildJobSearchEntry(locale)

  const userMessages: ChatMessage[] = [
    { id: "tut-u-1", role: "user", content: t("tut_user_1") } as ChatMessage,
    { id: "tut-u-2", role: "user", content: t("tut_user_2") } as ChatMessage,
  ]
  const assistant1: ChatMessage = { id: "tut-a-1", role: "assistant", content: t("tut_assistant_1") } as ChatMessage
  const assistant2: ChatMessage = { id: "tut-a-2", role: "assistant", content: t("tut_assistant_2") } as ChatMessage
  const assistantDone: ChatMessage = { id: "tut-a-3", role: "assistant", content: t("tut_assistant_done") } as ChatMessage

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <MessageBubble message={userMessages[0]} />
      <MessageBubble message={assistant1} />
      <JobSearchResultCard entry={jobSearchEntry} />
      <MessageBubble message={assistant2} />

      <MessageBubble message={userMessages[1]} />

      {/* Static P&E plan block */}
      <div data-tour="pe-timeline" className="glass rounded-2xl px-4 py-3 border border-[var(--border)]">
        <div className="text-xs font-body font-medium text-[var(--text-3)] uppercase tracking-wide mb-2">
          Plan &amp; Execute
        </div>
        <ol className="space-y-1.5 text-sm font-body text-[var(--text-2)]">
          <li>1. {t("tut_pe_plan_1")} <span className="text-green-600">✓</span></li>
          <li>2. {t("tut_pe_plan_2")} <span className="text-green-600">✓</span></li>
          <li>3. {t("tut_pe_plan_3")} <span className="text-green-600">✓</span></li>
        </ol>
      </div>

      <MessageBubble message={assistantDone} />
    </div>
  )
}
```

> If `MessageBubble` or `JobSearchResultCard` expect a different `ChatMessage` shape than `{ id, role, content }`, adapt the objects to match the existing types (grep `ChatMessage` in `lib/types.ts` before implementing). Do **not** invent new types — reuse exactly what the real components expect.

- [ ] **Step 9.3 — Add `disabled` + `disabledHint` to `ChatInput`**

Extend `ChatInput.tsx` props and render logic:

```tsx
interface Props {
  // ...existing props...
  disabled?: boolean
  disabledHint?: string
}

// ...inside the component, when disabled:
if (props.disabled) {
  return (
    <div data-tour="input" className="px-5 py-4 border-t border-[var(--border)] text-center">
      <p className="text-sm font-body text-[var(--text-3)]">{props.disabledHint}</p>
    </div>
  )
}
```

Adapt the exact JSX to the current ChatInput structure — wrap the existing form in a top-level conditional rather than duplicating it.

- [ ] **Step 9.4 — Branch `ChatPanel` on `is_tutorial`**

In `ChatPanel.tsx`:

1. Import: `import { TutorialSessionContent } from "@/components/tutorial/TutorialSessionContent"`.
2. After computing `currentSession`:

```tsx
const isTutorial = currentSession?.is_tutorial === true
```

3. Replace the message-list render branch with:

```tsx
{isTutorial ? (
  <TutorialSessionContent />
) : (
  <>
    {/* existing messages.map(...) rendering */}
  </>
)}
```

4. Pass `disabled={isTutorial}` and `disabledHint={t("tutorial_input_disabled")}` to `<ChatInput />`.

- [ ] **Step 9.5 — Verify build**

```bash
cd frontend && pnpm exec tsc --noEmit && pnpm build 2>&1 | tail -20
```

Expected: TS clean; Next build succeeds.

- [ ] **Step 9.6 — Commit**

```bash
git add frontend/components/tutorial/ frontend/components/chat/ChatPanel.tsx frontend/components/chat/ChatInput.tsx frontend/lib/api.ts frontend/contexts/SessionContext.tsx
git commit -m "feat(tutorial): static tutorial session renderer + disabled input"
```

---

## Task 10: Sidebar badge, default-resume banner, Settings replay button, final wiring

**Files:**
- Modify: `frontend/components/chat/SessionSidebar.tsx`
- Create: `frontend/components/tutorial/DefaultResumeBanner.tsx`
- Modify: `frontend/components/chat/ChatPanel.tsx`
- Modify: `frontend/components/settings/SettingsModal.tsx`

- [ ] **Step 10.1 — Badge on tutorial row in sidebar**

In `SessionSidebar.tsx`, inside the session map (next to `displayName`), append after the name span:

```tsx
{session.is_tutorial && (
  <span className="ml-1 inline-flex items-center rounded-full bg-indigo-100 text-indigo-700 px-1.5 py-0.5 text-[9px] font-medium">
    {t('tutorial_badge')}
  </span>
)}
```

- [ ] **Step 10.2 — Build `DefaultResumeBanner.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useLanguage } from "@/contexts/LanguageContext"

interface Props {
  onOpenSettings: () => void
}

export function DefaultResumeBanner({ onOpenSettings }: Props) {
  const { t } = useLanguage()
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <div className="mx-5 mt-3 mb-0 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 flex items-center gap-3">
      <span className="text-xs font-body text-amber-900 flex-1">{t("tutorial_default_resume_banner")}</span>
      <button
        onClick={onOpenSettings}
        className="text-xs font-body font-medium text-amber-900 underline underline-offset-2 hover:text-amber-950"
      >
        {t("tutorial_banner_cta")}
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label={t("tutorial_banner_dismiss")}
        className="text-amber-700 hover:text-amber-900 px-1"
      >
        ✕
      </button>
    </div>
  )
}
```

- [ ] **Step 10.3 — Show banner from `ChatPanel`**

In `ChatPanel.tsx`:

1. Fetch status once per mount:

```tsx
import { apiTutorialStatus } from "@/lib/api-tutorial"
import { getAccessToken } from "@/lib/auth"
import { DefaultResumeBanner } from "@/components/tutorial/DefaultResumeBanner"
// ...
const [resumeIsDefault, setResumeIsDefault] = useState(false)
useEffect(() => {
  const token = getAccessToken()
  if (!token) return
  apiTutorialStatus(token).then((s) => setResumeIsDefault(s.resume_is_default)).catch(() => {})
}, [])
```

2. The component needs a handler to open settings. Since Settings is managed at the page level, either:
   - lift a callback via a new `onRequestOpenSettings?: () => void` prop on `ChatPanel`, and pass it from `ChatPageInner` (`setShowSettings(true)`).

3. Render above the message list when `!isTutorial && resumeIsDefault`:

```tsx
{!isTutorial && resumeIsDefault && (
  <DefaultResumeBanner onOpenSettings={onRequestOpenSettings ?? (() => {})} />
)}
```

4. Update `frontend/app/chat/page.tsx` to pass `onRequestOpenSettings={() => setShowSettings(true)}` to `<ChatPanel />`.

- [ ] **Step 10.4 — Replay button in Settings**

In `SettingsModal.tsx`, inside the Resume tab panel (after the `Save` button), add:

```tsx
<div className="mt-4 pt-4 border-t border-black/5 flex flex-col gap-2">
  <button
    onClick={async () => {
      if (!confirm(t("tutorial_replay_confirm") as string)) return
      const { apiTutorialReplay } = await import("@/lib/api-tutorial")
      // locale comes from useLanguage hook
      await apiTutorialReplay(accessToken, localeFromCtx)
      localStorage.removeItem("jh_tour_done")
      window.location.reload()
    }}
    className="self-start rounded-xl border border-black/10 text-sm font-body px-4 py-2 hover:bg-black/5"
  >
    {t("tutorial_replay")}
  </button>
</div>
```

> `localeFromCtx` is the locale from `useLanguage()` — add `const { t, locale: localeFromCtx } = useLanguage()` at the top of the component.

- [ ] **Step 10.5 — End-to-end dogfood**

```bash
cd /Users/young/Downloads/repos/Job-Hunter-Agent/.worktrees/feat-onboarding-tour
# Terminal 1:
make dev
# Terminal 2:
cd frontend && pnpm dev
```

Manual verification checklist (user in browser):

1. Fresh account → log in. Sidebar shows one tutorial session with the 📘 badge. Resume banner appears above chat on any non-tutorial session.
2. Tour auto-starts. Each step highlights the correct element. Click "Skip" → tour ends.
3. Open the tutorial session → static content renders: user msg → assistant intro → 3 job cards → assistant follow-up → user P&E trigger → P&E plan block with 3 steps ✓ → done message. Input box is replaced by the disabled hint.
4. Try the job-card checkbox + "Save to Kanban" in the tutorial session → it should write to the real kanban (no tutorial-scoped block).
5. Switch language (EN ↔ zh-CN) → all tutorial / banner / tour copy updates on reload.
6. Open **Settings → Resume → Replay Tutorial** → confirm dialog → tour relaunches after reload; new tutorial session id appears in sidebar (old one removed by backend seeder if idempotent by-session; else both present — verify and fix).
7. Edit the resume + save → banner disappears on next chat reload.

- [ ] **Step 10.6 — Commit**

```bash
git add frontend/components/chat/SessionSidebar.tsx frontend/components/tutorial/DefaultResumeBanner.tsx frontend/components/chat/ChatPanel.tsx frontend/app/chat/page.tsx frontend/components/settings/SettingsModal.tsx
git commit -m "feat(tutorial): sidebar badge, default-resume banner, replay button"
```

---

## Self-Review

Checked against the user-confirmed spec:

| Requirement | Covered by |
|---|---|
| i18n-aware (single-language based on UI locale, not bilingual) | Tasks 3 (content), 6 (strings), 7 (steps via `t()`), 9 (renderer reads `locale`) |
| Locale-matched default resume written to user account | Tasks 3 + 4 (`seed_tutorial_for_user`), 5 (auto-seed on first login) |
| Pre-populated session in sidebar with clear badge | Tasks 4 (seed row), 10 (badge) |
| Tutorial covers: chat, kanban, settings, memory, P&E, UI entries | Task 6 (tour step copy) + Task 9 (static session content) + Task 8 (anchors) |
| Auto-launch on first login | Task 8 (TourContext auto-start, Task 4 completion flag) |
| Replay from Settings | Task 10 (Replay button) |
| Editable default resume written directly | Tasks 3 + 4 (writes to `user.resume_text`) |
| Chat prompt about using default resume, CTA to replace | Task 10 (DefaultResumeBanner) |
| Driver.js chosen + justified | Header / Tech Stack + Task 7 |
| Isolated from another session | This plan lives in its own worktree `.worktrees/feat-onboarding-tour` |
| Job search + JD selection + P&E full flow | Task 9 static content structure |

No placeholders (`TBD`, "implement later", etc.). All types consistent (`SessionItem` / `is_tutorial` / `ChatMessage`). Every step has concrete code or a runnable command. Verification substitutes manual curl/UI checks because the repo has no automated tests (per CLAUDE.md: "There are no automated tests in this repository.").

---

**Plan complete and saved to `docs/superpowers/plans/2026-04-18-onboarding-tour.md`.**
