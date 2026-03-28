# Scheduled Job Search with Resume Matching — Design Spec

**Date:** 2026-03-28
**Status:** Approved

---

## Overview

Add a configurable job search scheduler that:
1. Searches specified target websites using DuckDuckGo with `site:` filters
2. Deduplicates results against the existing kanban `applications` table
3. Automatically creates pending kanban cards for new listings
4. Scores each listing against the user's resume (0–100) using the LLM service
5. Displays scores on kanban cards; sorts pending column by score descending
6. Supports both manual trigger (primary) and optional cron-based scheduling

---

## Data Model Changes

### New table: `search_configs`

One row per user. Stores search configuration separate from job search criteria (which lives in `job_preferences`).

| Column            | Type    | Default        | Notes                                      |
|-------------------|---------|----------------|--------------------------------------------|
| `id`              | int     | PK             |                                            |
| `user_id`         | int     | unique, indexed | FK to users                               |
| `target_sites`    | str     | `""`           | Comma-separated, e.g. `"linkedin.com,boss.zhipin.com"` |
| `schedule_enabled`| bool    | `false`        |                                            |
| `schedule_cron`   | str     | `"0 9 * * *"`  | Standard cron expression                   |
| `updated_at`      | datetime| now()          |                                            |

### Modified table: `users`

Add nullable column:

| Column        | Type | Notes                          |
|---------------|------|--------------------------------|
| `resume_text` | text | Nullable. User-pasted plain text resume. |

### Modified table: `applications`

Add nullable column:

| Column        | Type | Notes                                                         |
|---------------|------|---------------------------------------------------------------|
| `match_score` | int  | Nullable. 0–100. Set by scheduler on creation. Null for manual cards or when no resume is set. |

---

## Backend

### New model: `app/models/search_config.py`

`SearchConfig` SQLModel with the fields above.

### Modified model: `app/models/user.py`

Add `resume_text: Optional[str] = Field(default=None)`.

### Modified model: `app/models/application.py`

Add `match_score: Optional[int] = Field(default=None)`.

### New API routes: `app/api/v1/search.py`

Mounted at `/api/v1/search/`:

```
GET  /config   → Return current SearchConfig (or defaults if none exists)
PUT  /config   → Upsert SearchConfig; dynamically reschedule/remove APScheduler job
POST /run      → Manually trigger job search for the current user immediately
```

### Modified API routes: `app/api/v1/settings.py`

Add resume endpoints:

```
GET  /resume   → Return { resume_text: str | null }
PUT  /resume   → body: { resume_text: str }, save to users table
```

### Modified service: `app/services/job_service.py`

- Add `upsert_search_config(user_id, target_sites, schedule_enabled, schedule_cron)`
- Add `get_search_config(user_id) -> Optional[SearchConfig]`
- Add `get_all_search_configs() -> List[SearchConfig]`
- Modify `batch_create_pending` to accept `match_score` per listing

### New service method: `app/services/scoring_service.py`

`score_job(job_title, snippet, resume_text) -> int`

- Calls `LLMService` with a structured prompt requesting `{ "score": int }` (0–100)
- Returns the score integer; returns `None` on LLM failure (non-blocking)
- Prompt instructs: score 100 = perfect match, 0 = completely irrelevant

### Modified scheduler: `app/core/scheduler.py`

Extract core search logic into reusable `_search_for_user(user_id, pref, config, resume_text) -> dict`:

1. If `config.target_sites` is non-empty: split by comma, run one DuckDuckGo query per site with `site:<domain>` appended, collect up to 5 results each
2. If `target_sites` is empty: single query as before
3. Merge all results, deduplicate by URL
4. For each result: call `scoring_service.score_job()` if `resume_text` is set
5. Call `job_service.batch_create_pending()` with scored listings

`setup_scheduler()` changes:
- On startup: load all `SearchConfig` rows where `schedule_enabled=True`, register one APScheduler job per user (`id="job_search_{user_id}"`)
- The existing `daily_job_search` global job is removed

`POST /search/run` calls `_search_for_user()` directly (runs in executor to avoid blocking).

Dynamic scheduling:
- `PUT /search/config` with `schedule_enabled=True` → `scheduler.add_job()` or `scheduler.reschedule_job()`
- `PUT /search/config` with `schedule_enabled=False` → `scheduler.remove_job()` if exists

---

## Frontend

### Settings modal: multi-tab expansion

Extend `SystemPromptModal` into a multi-tab settings panel with three tabs:

1. **System Prompt** (existing)
2. **Resume** — multi-line textarea for pasting plain text resume; Save button
3. **Search Settings**:
   - Target websites input (comma-separated placeholder: `linkedin.com, boss.zhipin.com`)
   - Schedule toggle (on/off)
   - Cron expression input (only visible when toggle is on; default `0 9 * * *`)
   - **"Search Now"** button → calls `POST /api/v1/search/run`, shows toast on completion, triggers kanban refresh

### `KanbanCard` changes

Add match score badge next to the source badge (top-right area):
- `score ≥ 80`: green background, white text
- `score 60–79`: amber/yellow background
- `score < 60`: gray background
- `score = null`: badge not rendered

### `KanbanColumn` / `KanbanBoard` changes

In the `pending` column, sort cards by `match_score` descending before rendering (nulls last). Sorting is client-side; no API change needed.

---

## Error Handling

- **LLM scoring failure**: log warning, set `match_score = null`, card still created — non-blocking
- **DuckDuckGo rate limit / network error**: log exception per user, continue to next user — existing behavior preserved
- **`POST /run` while search in progress**: no lock needed at this scale; duplicate runs produce no-op inserts (dedup handles it)
- **Invalid cron expression**: validate on PUT `/config`, return 422 with message before saving or updating scheduler

---

## Out of Scope

- Storing or displaying the LLM's score reasoning/explanation
- Per-keyword or per-site granular scheduling
- Resume file upload (PDF/Word parsing) — plain text only
- Pagination of scheduler preferences at scale
