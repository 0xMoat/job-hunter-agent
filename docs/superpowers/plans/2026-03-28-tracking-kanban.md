# Tracking Kanban Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the "Today's Picks" listings tab and the Chat ApplicationTracker sidebar with a unified horizontal 4-column kanban board that auto-populates from the scheduler and supports drag-and-drop status transitions.

**Architecture:** Extend `Application` model with `pending` status + `snippet`/`found_date`/`source`/`archived_at` fields. Scheduler writes `pending` cards via a new `batch_create_pending` service method. Frontend uses `@dnd-kit/core` for drag-and-drop across columns. No automated tests exist in this repo — verify with `make dev` and manual browser testing.

**Tech Stack:** FastAPI, SQLModel, PostgreSQL, Next.js 16, TypeScript, @dnd-kit/core (new)

**Spec:** `docs/superpowers/specs/2026-03-28-tracking-kanban-design.md`

---

## File Map

### Backend — Created
- `scripts/migrate.py` — Idempotent PostgreSQL migration: ADD COLUMN + UPDATE status values

### Backend — Modified
- `app/models/application.py` — Add fields: `snippet`, `found_date`, `source`, `archived_at`
- `app/services/job_service.py` — Add `batch_create_pending()` and `archive_stale_pending()` methods; update `add_application()` default status to `pending`
- `app/api/v1/applications.py` — Add `POST /applications/batch` endpoint; update `GET /applications` to filter archived; accept new status values in PATCH
- `app/core/scheduler.py` — Replace `upsert_listings()` call with `batch_create_pending()` + `archive_stale_pending()`
- `app/core/langgraph/tools/application_tracker.py` — Update status docstring; change `add` action default to `status="pending"`
- `scripts/docker-entrypoint.sh` — Add `python scripts/migrate.py` before app start

### Frontend — Created
- `frontend/components/tracker/KanbanCard.tsx` — Single card component
- `frontend/components/tracker/KanbanColumn.tsx` — Column with header, card list, add button
- `frontend/components/tracker/KanbanBoard.tsx` — DndContext wrapper, 4-column layout

### Frontend — Modified
- `frontend/lib/types.ts` — Update `ApplicationStatus`, `Application` interface; remove `JobListing`
- `frontend/lib/api.ts` — Add `apiMoveCard()`; remove `apiGetListings()`
- `frontend/lib/i18n.ts` — Add kanban i18n keys (both `zh-CN` and `en` dicts)
- `frontend/hooks/useApplications.ts` — Add `moveCard()`, filter archived
- `frontend/app/chat/page.tsx` — Remove `ApplicationTracker` sidebar; rename tab; swap `ListingsPanel` → `KanbanBoard`

### Frontend — Deleted
- `frontend/components/listings/ListingsPanel.tsx`
- `frontend/components/listings/ListingCard.tsx`
- `frontend/components/tracker/ApplicationTracker.tsx`
- `frontend/components/tracker/ApplicationCard.tsx`
- `frontend/hooks/useListings.ts`

---

## Task 1: DB Migration Script

**Files:**
- Create: `scripts/migrate.py`
- Modify: `scripts/docker-entrypoint.sh:82-83`

- [ ] **Step 1: Create `scripts/migrate.py`**

```python
"""Idempotent database migration for tracking kanban feature.

Run before app startup. Safe to execute multiple times.
"""

import os
import sys

import psycopg2


def get_conn():
    return psycopg2.connect(
        host=os.environ["POSTGRES_HOST"],
        port=os.environ.get("POSTGRES_PORT", "5432"),
        dbname=os.environ["POSTGRES_DB"],
        user=os.environ["POSTGRES_USER"],
        password=os.environ["POSTGRES_PASSWORD"],
    )


def column_exists(cur, table: str, column: str) -> bool:
    cur.execute(
        """
        SELECT 1 FROM information_schema.columns
        WHERE table_name = %s AND column_name = %s
        """,
        (table, column),
    )
    return cur.fetchone() is not None


def run():
    conn = get_conn()
    conn.autocommit = False
    cur = conn.cursor()
    try:
        # 1. Add new columns to applications table (idempotent)
        new_columns = [
            ("snippet",      "TEXT"),
            ("found_date",   "DATE"),
            ("source",       "TEXT NOT NULL DEFAULT 'manual'"),
            ("archived_at",  "TIMESTAMP WITH TIME ZONE"),
        ]
        for col, col_type in new_columns:
            if not column_exists(cur, "applications", col):
                cur.execute(f"ALTER TABLE applications ADD COLUMN {col} {col_type}")
                print(f"  Added column: applications.{col}")
            else:
                print(f"  Column already exists: applications.{col}")

        # 2. Migrate legacy status values
        cur.execute(
            "UPDATE applications SET status = 'completed' WHERE status = 'offer'"
        )
        print(f"  Migrated 'offer' → 'completed': {cur.rowcount} rows")

        cur.execute(
            "UPDATE applications SET status = 'not_a_match' WHERE status = 'rejected'"
        )
        print(f"  Migrated 'rejected' → 'not_a_match': {cur.rowcount} rows")

        conn.commit()
        print("Migration completed successfully.")
    except Exception as e:
        conn.rollback()
        print(f"Migration failed: {e}", file=sys.stderr)
        sys.exit(1)
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    run()
```

- [ ] **Step 2: Wire migration into docker-entrypoint.sh**

Find the comment `# Run database migrations if necessary` (line ~82) and replace with:

```bash
# Run database migrations
python scripts/migrate.py
```

- [ ] **Step 3: Verify script syntax**

```bash
cd /path/to/repo && python -m py_compile scripts/migrate.py && echo "OK"
```

Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add scripts/migrate.py scripts/docker-entrypoint.sh
git commit -m "feat: add db migration script for tracking kanban"
```

---

## Task 2: Backend Model + Service Methods

**Files:**
- Modify: `app/models/application.py`
- Modify: `app/services/job_service.py`

- [ ] **Step 1: Update `app/models/application.py`**

Replace the entire file content:

```python
"""Application model for tracking job applications."""

from datetime import UTC, date, datetime
from typing import Optional

from sqlmodel import Field

from app.models.base import BaseModel


class Application(BaseModel, table=True):
    """Tracks a job application or discovered listing for the user.

    Status flow: pending → applied → interviewing → completed | not_a_match

    Attributes:
        id: Primary key
        user_id: FK to User.id (int)
        company: Company name
        title: Job title
        url: Job posting URL
        status: pending / applied / interviewing / completed / not_a_match
        applied_date: Date of application (null for pending cards)
        notes: Free-form notes
        snippet: JD summary snippet (from scheduler search results)
        found_date: Date scheduler found this listing (null for manual cards)
        source: "scheduler" or "manual"
        archived_at: Set when card is auto-archived; null = active
        updated_at: Last update timestamp
    """

    __tablename__ = "applications"

    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    company: str
    title: str
    url: Optional[str] = Field(default=None)
    status: str = Field(default="pending")
    applied_date: Optional[date] = Field(default=None)
    notes: Optional[str] = Field(default=None)
    snippet: Optional[str] = Field(default=None)
    found_date: Optional[date] = Field(default=None)
    source: str = Field(default="manual")
    archived_at: Optional[datetime] = Field(default=None)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(UTC))
```

- [ ] **Step 2: Add `batch_create_pending` and `archive_stale_pending` to `app/services/job_service.py`**

Add these two methods to the `JobService` class, after `get_listings`:

```python
async def batch_create_pending(
    self, user_id: int, listings: List[dict]
) -> dict:
    """Create pending kanban cards from scheduler results.

    Skips listings that already have an Application record (by user_id + url).
    Returns {"inserted": N, "skipped": M}.
    """
    inserted = 0
    skipped = 0
    with Session(self._engine) as session:
        for item in listings:
            url = item.get("url", "")
            if not url:
                skipped += 1
                continue
            exists = session.exec(
                select(Application).where(
                    Application.user_id == user_id,
                    Application.url == url,
                )
            ).first()
            if exists:
                skipped += 1
                continue
            found_date_raw = item.get("found_date")
            if isinstance(found_date_raw, str):
                from datetime import date as date_type
                found_date_val = date_type.fromisoformat(found_date_raw)
            elif isinstance(found_date_raw, date):
                found_date_val = found_date_raw
            else:
                found_date_val = datetime.now(UTC).date()
            card = Application(
                user_id=user_id,
                title=item.get("title", ""),
                company=item.get("company", ""),
                url=url,
                snippet=item.get("snippet", ""),
                found_date=found_date_val,
                source="scheduler",
                status="pending",
            )
            session.add(card)
            inserted += 1
        session.commit()
    logger.info(
        "pending_cards_created",
        user_id=user_id,
        inserted=inserted,
        skipped=skipped,
    )
    return {"inserted": inserted, "skipped": skipped}

async def archive_stale_pending(self, days: int = 7) -> int:
    """Set archived_at on scheduler-sourced pending cards older than `days`.

    Only affects cards where source='scheduler' and status='pending'.
    Manual pending cards are never auto-archived.
    Returns count of archived records.
    """
    from datetime import timedelta
    cutoff = datetime.now(UTC).date() - timedelta(days=days)
    count = 0
    with Session(self._engine) as session:
        stale = session.exec(
            select(Application).where(
                Application.status == "pending",
                Application.source == "scheduler",
                Application.found_date < cutoff,
                Application.archived_at.is_(None),
            )
        ).all()
        for card in stale:
            card.archived_at = datetime.now(UTC)
            session.add(card)
            count += 1
        session.commit()
    logger.info("stale_pending_archived", count=count, cutoff=str(cutoff))
    return count
```

- [ ] **Step 3: Update `add_application` default status to `"pending"`**

In `job_service.py`, find the `add_application` method. Change:
```python
app = Application(
    user_id=user_id, company=company, title=title, url=url, notes=notes
)
```
To:
```python
app = Application(
    user_id=user_id,
    company=company,
    title=title,
    url=url,
    notes=notes,
    source="manual",
    status="pending",
)
```

- [ ] **Step 4: Start the server and verify it starts without errors**

```bash
make dev
```

Expected: Server starts, no import errors or AttributeErrors.

- [ ] **Step 5: Commit**

```bash
git add app/models/application.py app/services/job_service.py
git commit -m "feat: extend Application model and add kanban service methods"
```

---

## Task 3: Backend API Updates

**Files:**
- Modify: `app/api/v1/applications.py`

- [ ] **Step 1: Add `BatchListingItem` and `BatchCreate` Pydantic schemas at the top of the file**

After the existing `ApplicationUpdate` class, add:

```python
class BatchListingItem(BaseModel):
    """A single listing item for batch creation."""

    title: str
    company: str = ""
    url: str
    snippet: str = ""
    found_date: Optional[str] = None


class BatchCreate(BaseModel):
    """Request body for batch creating pending cards from scheduler."""

    listings: list[BatchListingItem]
```

- [ ] **Step 2: Add `POST /applications/batch` endpoint**

Add after the existing `add_application` endpoint:

```python
@router.post("/applications/batch", status_code=201)
@limiter.limit("10/minute")
async def batch_create_applications(
    request: Request,
    body: BatchCreate,
    session: Session = Depends(get_current_session),
):
    """Batch-create pending kanban cards from scheduler results."""
    listings = [item.model_dump() for item in body.listings]
    result = await job_service.batch_create_pending(session.user_id, listings)
    logger.info(
        "batch_applications_created",
        user_id=session.user_id,
        inserted=result["inserted"],
        skipped=result["skipped"],
    )
    return result
```

- [ ] **Step 3: Update `GET /applications` to filter archived and return `archived_count`**

Find `list_applications` endpoint. Replace:
```python
apps = await job_service.list_applications(session.user_id)
return {"applications": apps, "count": len(apps)}
```
With:
```python
apps = await job_service.list_applications(session.user_id)
archived_count = await job_service.count_archived_pending(session.user_id)
return {"applications": apps, "count": len(apps), "archived_count": archived_count}
```

- [ ] **Step 4: Update `list_applications` and add `count_archived_pending` in `job_service.py`**

Replace the `list_applications` method to always exclude archived:

```python
async def list_applications(self, user_id: int) -> List[Application]:
    """List all active (non-archived) applications for a user, newest first."""
    with Session(self._engine) as session:
        return list(
            session.exec(
                select(Application)
                .where(Application.user_id == user_id)
                .where(Application.archived_at.is_(None))
                .order_by(desc(Application.updated_at))
            ).all()
        )
```

Add a new `count_archived_pending` method:

```python
async def count_archived_pending(self, user_id: int) -> int:
    """Count scheduler-sourced pending cards that have been archived for this user."""
    with Session(self._engine) as session:
        results = session.exec(
            select(Application).where(
                Application.user_id == user_id,
                Application.status == "pending",
                Application.source == "scheduler",
                Application.archived_at.is_not(None),
            )
        ).all()
        return len(results)
```

- [ ] **Step 5: Verify with curl**

```bash
# Start server first: make dev
curl -s -X POST http://localhost:8000/api/v1/applications/batch \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your_session_token>" \
  -d '{"listings": [{"title": "Test", "company": "ACME", "url": "https://example.com/1", "snippet": "Test snippet"}]}'
```

Expected: `{"inserted": 1, "skipped": 0}`

- [ ] **Step 6: Commit**

```bash
git add app/api/v1/applications.py app/services/job_service.py
git commit -m "feat: add batch application endpoint and archived filter"
```

---

## Task 4: Scheduler + LangGraph Tool Update

**Files:**
- Modify: `app/core/scheduler.py`
- Modify: `app/core/langgraph/tools/application_tracker.py`

- [ ] **Step 1: Update `app/core/scheduler.py`**

Replace the `upsert_listings` call block (lines 52–58) with:

```python
result = await job_service.batch_create_pending(pref.user_id, listings)
archived = await job_service.archive_stale_pending()
logger.info(
    "daily_job_search_user_done",
    user_id=pref.user_id,
    keywords=pref.keywords,
    inserted=result["inserted"],
    skipped=result["skipped"],
    archived=archived,
)
```

- [ ] **Step 2: Update `application_tracker_tool` docstring and `add` action**

In `app/core/langgraph/tools/application_tracker.py`:

Change the `status` line in Args docstring from:
```
status: Application status for update: applied / interviewing / rejected / offer
```
To:
```
status: Application status for update: pending / applied / interviewing / completed / not_a_match
```

Change the `add` action block to set `source="manual"` and use the service method's new default:

The `add_application` in `job_service` now defaults to `status="pending"` and `source="manual"`, so the tool call `await job_service.add_application(user_id, company, title, url, notes)` already picks up the new defaults. No code change needed in the tool itself beyond the docstring.

- [ ] **Step 3: Restart server and verify no errors**

```bash
make dev
```

Expected: clean startup, scheduler registers job as before.

- [ ] **Step 4: Commit**

```bash
git add app/core/scheduler.py app/core/langgraph/tools/application_tracker.py
git commit -m "feat: update scheduler and agent tool for kanban status values"
```

---

## Task 5: Frontend Types + API

**Files:**
- Modify: `frontend/lib/types.ts`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Update `frontend/lib/types.ts`**

Replace the file content:

```typescript
// Domain types for the Job Hunter Agent frontend.

export type MessageRole = "user" | "assistant"

export type ApplicationStatus =
  | "pending"
  | "applied"
  | "interviewing"
  | "completed"
  | "not_a_match"

export const KANBAN_COLUMNS: { status: ApplicationStatus; labelKey: string }[] = [
  { status: "pending",      labelKey: "col_pending" },
  { status: "applied",      labelKey: "col_applied" },
  { status: "completed",    labelKey: "col_completed" },
  { status: "not_a_match",  labelKey: "col_not_a_match" },
]

// "applied" and "interviewing" both render in the "applied" column
export function toColumnStatus(status: ApplicationStatus): ApplicationStatus {
  if (status === "interviewing") return "applied"
  return status
}

export interface ToolCallEntry {
  toolCallId: string
  toolName: string
  callingContent: string
  resultContent?: string
  status: "calling" | "done"
}

export interface ChatMessage {
  id: string
  role: MessageRole
  textContent: string
  toolCalls: ToolCallEntry[]
  timestamp?: Date
}

export interface StreamChunk {
  type: "text" | "tool_call" | "tool_result" | "done"
  content: string
  tool_name?: string
  tool_call_id?: string
  calling_args?: string
  done: boolean
}

export interface Application {
  id: number
  user_id: number
  company: string
  title: string
  url?: string
  status: ApplicationStatus
  applied_date?: string
  notes?: string
  snippet?: string
  found_date?: string
  source: "scheduler" | "manual"
  archived_at?: string
  updated_at: string
}
```

- [ ] **Step 2: Update `frontend/lib/api.ts`**

Remove the `JobListing` import from the top. Remove the `apiGetListings` function entirely.

Add `apiMoveCard` after `apiUpdateApplication`:

```typescript
export async function apiMoveCard(
  sessionToken: string,
  id: number,
  status: string,
): Promise<Application> {
  return apiUpdateApplication(sessionToken, id, { status })
}
```

- [ ] **Step 3: Check for TypeScript errors**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -30
```

Expected: errors only in files that reference `JobListing` or old `ApplicationStatus` values — those will be fixed in subsequent tasks.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/api.ts
git commit -m "feat: update frontend types and API for kanban"
```

---

## Task 6: i18n Keys

**Files:**
- Modify: `frontend/lib/i18n.ts`

- [ ] **Step 1: Add new keys to the `zh` dict in `frontend/lib/i18n.ts`**

Find the `zh` dict. Add after `col_rejected`:

```typescript
  // Kanban
  tab_tracker: '追踪看板',
  col_pending: '待处理',
  col_applied: '投递待面试',
  col_completed: '已完成',
  col_not_a_match: '不匹配',
  card_source_scheduler: '调度发现',
  card_source_manual: '手动添加',
  kanban_archived_n: (n: number) => `已归档 ${n} 张超期卡片`,
  kanban_add_card: '＋ 手动添加',
  kanban_loading: '加载中…',
  card_view_job: '查看职位 →',
```

- [ ] **Step 2: Add same keys to the `en` dict**

Find the `en` dict. Add after `col_rejected`:

```typescript
  // Kanban
  tab_tracker: 'Tracker',
  col_pending: 'To Review',
  col_applied: 'Applied',
  col_completed: 'Completed',
  col_not_a_match: 'Not a Match',
  card_source_scheduler: 'Auto-found',
  card_source_manual: 'Added manually',
  kanban_archived_n: (n: number) => `${n} cards auto-archived`,
  kanban_add_card: '+ Add card',
  kanban_loading: 'Loading…',
  card_view_job: 'View job →',
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep i18n
```

Expected: no errors in i18n.ts.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/i18n.ts
git commit -m "feat: add kanban i18n keys"
```

---

## Task 7: KanbanCard Component

**Files:**
- Create: `frontend/components/tracker/KanbanCard.tsx`

- [ ] **Step 1: Create `frontend/components/tracker/KanbanCard.tsx`**

```tsx
"use client"

import { useDraggable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { useLanguage } from "@/contexts/LanguageContext"
import type { Application } from "@/lib/types"

interface KanbanCardProps {
  app: Application
  onDelete: (id: number) => void
}

export function KanbanCard({ app, onDelete }: KanbanCardProps) {
  const { t } = useLanguage()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: app.id,
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="bg-white rounded-xl p-3 shadow-sm border border-[var(--border)]
                 cursor-grab active:cursor-grabbing select-none
                 hover:shadow-md transition-shadow"
    >
      {/* Company + source badge */}
      <div className="flex items-start justify-between gap-2 mb-0.5">
        <span className="font-body font-semibold text-sm text-[var(--text)] leading-tight">
          {app.company || "—"}
        </span>
        <span
          className={`shrink-0 text-[10px] font-body rounded-full px-2 py-0.5 ${
            app.source === "scheduler"
              ? "bg-[#ede9ff] text-[#7c6af5]"
              : "bg-[#f0f9f0] text-[#5a9a5a]"
          }`}
        >
          {app.source === "scheduler" ? t("card_source_scheduler") : t("card_source_manual")}
        </span>
      </div>

      {/* Title */}
      <p className="font-body text-xs text-[var(--text-2)] mb-1">{app.title}</p>

      {/* Date */}
      <p className="font-body text-[10px] text-[var(--text-3)] mb-2">
        {app.found_date ?? app.applied_date ?? ""}
      </p>

      {/* Snippet */}
      {app.snippet && (
        <p className="font-body text-[11px] text-[var(--text-2)] bg-black/[0.03]
                      rounded-lg px-2 py-1.5 leading-relaxed mb-2
                      line-clamp-3">
          {app.snippet}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-1">
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(app.id) }}
          className="text-[10px] font-body text-[var(--text-3)] hover:text-red-500
                     transition-colors"
        >
          {t("delete")}
        </button>
        {app.url && (
          <a
            href={app.url}
            target="_blank"
            rel="noopener noreferrer"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] font-body text-[#7c6af5] hover:underline"
          >
            {t("card_view_job")}
          </a>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep KanbanCard
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/tracker/KanbanCard.tsx
git commit -m "feat: add KanbanCard component"
```

---

## Task 8: KanbanColumn Component

**Files:**
- Create: `frontend/components/tracker/KanbanColumn.tsx`

- [ ] **Step 1: Create `frontend/components/tracker/KanbanColumn.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useDroppable } from "@dnd-kit/core"
import { KanbanCard } from "./KanbanCard"
import { useLanguage } from "@/contexts/LanguageContext"
import type { Application, ApplicationStatus } from "@/lib/types"

interface KanbanColumnProps {
  status: ApplicationStatus
  labelKey: string
  cards: Application[]
  archivedCount?: number
  onDelete: (id: number) => void
  onAddCard: (company: string, title: string, url?: string) => Promise<void>
}

const COLUMN_ACCENT: Record<ApplicationStatus, string> = {
  pending:      "text-[#7c6af5]",
  applied:      "text-[#2563eb]",
  interviewing: "text-[#2563eb]",
  completed:    "text-[#16a34a]",
  not_a_match:  "text-[#999]",
}

const BADGE_ACCENT: Record<ApplicationStatus, string> = {
  pending:      "bg-[#ede9ff] text-[#7c6af5]",
  applied:      "bg-[#dbeafe] text-[#2563eb]",
  interviewing: "bg-[#dbeafe] text-[#2563eb]",
  completed:    "bg-[#dcfce7] text-[#16a34a]",
  not_a_match:  "bg-black/5 text-[#999]",
}

export function KanbanColumn({
  status,
  labelKey,
  cards,
  archivedCount,
  onDelete,
  onAddCard,
}: KanbanColumnProps) {
  const { t } = useLanguage()
  const { setNodeRef, isOver } = useDroppable({ id: status })

  const [showAdd, setShowAdd] = useState(false)
  const [company, setCompany] = useState("")
  const [title, setTitle] = useState("")
  const [url, setUrl] = useState("")

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!company.trim() || !title.trim()) return
    await onAddCard(company.trim(), title.trim(), url.trim() || undefined)
    setCompany(""); setTitle(""); setUrl(""); setShowAdd(false)
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col flex-1 min-w-0 rounded-2xl p-3 transition-colors
                  ${isOver ? "bg-white/50" : "bg-white/25"}`}
    >
      {/* Column header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <span className={`font-body font-bold text-[10px] uppercase tracking-widest ${COLUMN_ACCENT[status]}`}>
          {t(labelKey)}
        </span>
        <span className={`font-body text-[10px] rounded-full px-2 py-0.5 ${BADGE_ACCENT[status]}`}>
          {cards.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 flex-1 min-h-[120px]">
        {cards.map((card) => (
          <KanbanCard key={card.id} app={card} onDelete={onDelete} />
        ))}
      </div>

      {/* Archived hint — only shown in pending column when there are archived cards */}
      {status === "pending" && !!archivedCount && archivedCount > 0 && (
        <p className="font-body text-[10px] text-[var(--text-3)] italic text-center mt-2">
          {t("kanban_archived_n", archivedCount)}
        </p>
      )}

      {/* Add card form */}
      {showAdd ? (
        <form onSubmit={handleAdd} className="mt-2 space-y-1.5">
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder={t("form_company")}
            required
            className="w-full px-2.5 py-1.5 text-xs font-body bg-white rounded-lg
                       border border-[var(--border-strong)] text-[var(--text)]
                       placeholder:text-[var(--text-3)]
                       focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#141210]/20"
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("form_title_field")}
            required
            className="w-full px-2.5 py-1.5 text-xs font-body bg-white rounded-lg
                       border border-[var(--border-strong)] text-[var(--text)]
                       placeholder:text-[var(--text-3)]
                       focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#141210]/20"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("form_url")}
            type="url"
            className="w-full px-2.5 py-1.5 text-xs font-body bg-white rounded-lg
                       border border-[var(--border-strong)] text-[var(--text)]
                       placeholder:text-[var(--text-3)]
                       focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#141210]/20"
          />
          <div className="flex gap-1.5">
            <button type="submit"
              className="flex-1 py-1.5 text-[11px] font-body font-medium
                         bg-[var(--accent)] text-[var(--accent-fg)] rounded-full">
              {t("tracker_save")}
            </button>
            <button type="button" onClick={() => setShowAdd(false)}
              className="flex-1 py-1.5 text-[11px] font-body
                         glass text-[var(--text-2)] rounded-full">
              {t("tracker_cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="mt-2 w-full py-2 text-[11px] font-body text-[var(--text-3)]
                     border border-dashed border-[var(--border)] rounded-lg
                     hover:bg-white/60 hover:text-[var(--text-2)] transition-colors"
        >
          {t("kanban_add_card")}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep KanbanColumn
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/tracker/KanbanColumn.tsx
git commit -m "feat: add KanbanColumn component"
```

---

## Task 9: KanbanBoard + useApplications Hook

**Files:**
- Create: `frontend/components/tracker/KanbanBoard.tsx`
- Modify: `frontend/hooks/useApplications.ts`

- [ ] **Step 1: Update `frontend/hooks/useApplications.ts`**

Replace the file content:

```typescript
"use client"

import { useState, useCallback, useEffect } from "react"
import {
  apiListApplications,
  apiAddApplication,
  apiUpdateApplication,
  apiDeleteApplication,
  apiMoveCard,
} from "@/lib/api"
import { getSessionToken } from "@/lib/auth"
import type { Application, ApplicationStatus } from "@/lib/types"

export function useApplications() {
  const [applications, setApplications] = useState<Application[]>([])
  const [archivedCount, setArchivedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = getSessionToken()
    if (!token) return
    setLoading(true)
    try {
      const data = await apiListApplications(token)
      setApplications(data.applications)
      setArchivedCount(data.archived_count ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load applications")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const addApplication = useCallback(
    async (company: string, title: string, url?: string): Promise<Application | undefined> => {
      const token = getSessionToken()
      if (!token) return
      try {
        const app = await apiAddApplication(token, { company, title, url })
        setApplications((prev) => [app, ...prev])
        return app
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add application")
      }
    },
    [],
  )

  const moveCard = useCallback(
    async (id: number, newStatus: ApplicationStatus): Promise<void> => {
      const token = getSessionToken()
      if (!token) return
      // Optimistic update
      setApplications((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a))
      )
      try {
        const updated = await apiMoveCard(token, id, newStatus)
        setApplications((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to move card")
        // Rollback on error
        load()
      }
    },
    [load],
  )

  const deleteApplication = useCallback(async (id: number): Promise<void> => {
    const token = getSessionToken()
    if (!token) return
    try {
      await apiDeleteApplication(token, id)
      setApplications((prev) => prev.filter((a) => a.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete application")
    }
  }, [])

  return {
    applications,
    archivedCount,
    loading,
    error,
    addApplication,
    moveCard,
    deleteApplication,
    reload: load,
  }
}
```

- [ ] **Step 2: Install `@dnd-kit/core` and `@dnd-kit/utilities`**

```bash
cd frontend && pnpm add @dnd-kit/core @dnd-kit/utilities
```

- [ ] **Step 3: Create `frontend/components/tracker/KanbanBoard.tsx`**

```tsx
"use client"

import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"
import { KanbanColumn } from "./KanbanColumn"
import { useApplications } from "@/hooks/useApplications"
import { useLanguage } from "@/contexts/LanguageContext"
import { KANBAN_COLUMNS, toColumnStatus } from "@/lib/types"
import type { ApplicationStatus } from "@/lib/types"

export function KanbanBoard() {
  const { applications, archivedCount, loading, addApplication, moveCard, deleteApplication } = useApplications()
  const { t } = useLanguage()

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const cardId = active.id as number
    const targetStatus = over.id as ApplicationStatus
    const card = applications.find((a) => a.id === cardId)
    if (!card) return
    // Resolve: if target column is "applied", keep existing interviewing status if card is already interviewing
    const newStatus: ApplicationStatus =
      targetStatus === "applied" && card.status === "interviewing"
        ? "interviewing"
        : targetStatus
    if (card.status === newStatus) return
    moveCard(cardId, newStatus)
  }

  if (loading) {
    return (
      <div className="glass-strong rounded-3xl flex items-center justify-center h-full">
        <p className="font-body font-light text-sm text-[var(--text-3)]">{t("kanban_loading")}</p>
      </div>
    )
  }

  return (
    <div className="glass-strong rounded-3xl flex flex-col h-full overflow-hidden">
      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <div className="flex gap-3 flex-1 overflow-x-auto p-4">
          {KANBAN_COLUMNS.map(({ status, labelKey }) => {
            const colCards = applications.filter(
              (a) => toColumnStatus(a.status) === status
            )
            return (
              <KanbanColumn
                key={status}
                status={status}
                labelKey={labelKey}
                cards={colCards}
                archivedCount={status === "pending" ? archivedCount : undefined}
                onDelete={deleteApplication}
                onAddCard={addApplication}
              />
            )
          })}
        </div>
      </DndContext>
    </div>
  )
}
```

- [ ] **Step 4: Verify TypeScript**

```bash
cd frontend && npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors in the new files.

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/useApplications.ts frontend/components/tracker/KanbanBoard.tsx
git commit -m "feat: add KanbanBoard and update useApplications with moveCard"
```

---

## Task 10: Page Layout Update + Cleanup

**Files:**
- Modify: `frontend/app/chat/page.tsx`
- Delete: old listings and tracker components

- [ ] **Step 1: Update `frontend/app/chat/page.tsx`**

Replace imports block at top:
```tsx
import { ChatPanel } from "@/components/chat/ChatPanel"
import { SessionSidebar } from "@/components/chat/SessionSidebar"
import { KanbanBoard } from "@/components/tracker/KanbanBoard"
import { SystemPromptModal } from "@/components/settings/SystemPromptModal"
import { SessionProvider } from "@/contexts/SessionContext"
import { useLanguage } from "@/contexts/LanguageContext"
```
(Remove imports for `ApplicationTracker` and `ListingsPanel`)

Change the `Tab` type and tab config:
```tsx
type Tab = "chat" | "tracker"
```

Change the tab array (find the `[{ key: "chat"...}]` array):
```tsx
{([
  { key: "chat" as Tab, label: t('tab_chat') },
  { key: "tracker" as Tab, label: t('tab_tracker') },
]).map(...)}
```

Change `tab === "picks"` references to `tab === "tracker"` in `handleTabChange` and `router.replace`.

In the content section, replace `{tab === "chat" ? (...) : (<ListingsPanel />)}` with:

```tsx
{tab === "chat" ? (
  <div className="h-full flex gap-3">
    <SessionSidebar streaming={streaming} />
    <div className="flex-1 min-w-0 overflow-hidden">
      <ChatPanel onStreamingChange={setStreaming} />
    </div>
  </div>
) : (
  <KanbanBoard />
)}
```
(The inner wrapper and `ApplicationTracker` sidebar are removed — Chat tab is now full-width two-panel.)

- [ ] **Step 2: Delete deprecated files**

```bash
rm frontend/components/listings/ListingsPanel.tsx
rm frontend/components/listings/ListingCard.tsx
rm frontend/components/tracker/ApplicationTracker.tsx
rm frontend/components/tracker/ApplicationCard.tsx
rm frontend/hooks/useListings.ts
```

- [ ] **Step 3: Verify TypeScript compiles cleanly**

```bash
cd frontend && npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Step 4: Start frontend dev server and smoke test**

```bash
cd frontend && pnpm dev
```

Open http://localhost:3000 in browser:
- Login → should redirect to /chat with "对话" and "追踪看板" tabs
- Click "追踪看板" tab → kanban board renders with 4 columns
- Click "+ 手动添加" in any column → form appears, save a card → card appears in column
- Drag card from one column to another → card moves, status updates

- [ ] **Step 5: Final commit**

```bash
git add frontend/app/chat/page.tsx
git add -u  # stage deletions
git commit -m "feat: wire up KanbanBoard, remove old tracker and listings components"
```

---

## Task 11: End-to-End Smoke Test

- [ ] **Step 1: Run full stack**

```bash
make dev  # starts FastAPI backend
cd frontend && pnpm dev  # in a second terminal
```

- [ ] **Step 2: Verify scheduler path (manual trigger)**

```bash
# Trigger the daily job search manually via Python
cd /path/to/repo
python -c "
import asyncio
from app.core.scheduler import _daily_job_search
asyncio.run(_daily_job_search())
"
```

Expected: log lines showing `daily_job_search_user_done` with `inserted` and `archived` counts. New cards appear in "待处理" column after page refresh.

- [ ] **Step 3: Verify drag-and-drop**

Drag a "待处理" card to "投递待面试" column.

Expected: card moves, `PATCH /api/v1/applications/{id}` called with `{"status": "applied"}`, card stays in new column after page refresh.

- [ ] **Step 4: Verify LangGraph tool (in chat)**

In chat, type: "我刚投了字节跳动的后端工程师职位"

Expected: agent calls `application_tracker_tool` with `action="add"`, card appears in "待处理" column (manual, status=pending). Status can be moved via drag.
