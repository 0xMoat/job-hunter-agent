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

Add a `noqa` import of `SearchConfig` to `app/services/database.py` alongside the existing model imports so that SQLModel registers the table before `create_all()` is called.

### Modified model: `app/models/user.py`

Add `resume_text: Optional[str] = Field(default=None)`.

### Modified model: `app/models/application.py`

Add `match_score: Optional[int] = Field(default=None)`.

### New API routes: `app/api/v1/search.py`

Mounted at `/api/v1/search/`. All endpoints use `get_current_user` (user-level Bearer token, same as `settings.py`), not session token.

Rate limits: add `"search": ["30/minute"]` to `RATE_LIMIT_ENDPOINTS` in `app/core/config.py`.

```
GET  /config   → Return current SearchConfig (or default values if none exists; does NOT auto-create a row)
PUT  /config   → Upsert SearchConfig; validate cron via CronTrigger construction (raise 422 on invalid);
                 if schedule_enabled=True, validate that JobPreference exists (raise 400 if not);
                 dynamically reschedule/remove APScheduler job
POST /run      → Immediately trigger job search for the current user; runs synchronously in executor;
                 returns 200 { "inserted": int, "skipped": int } on completion
```

Scheduler access from the API layer: `app/core/scheduler.py` exposes the `scheduler` module-level singleton. `search.py` imports it directly (`from app.core.scheduler import scheduler`). No circular import arises because `scheduler.py` imports `job_service` from `app/services/`, not from `app/api/`.

### Modified API routes: `app/api/v1/settings.py`

Add resume endpoints. Uses `get_current_user` (same as existing endpoints in this file).

```
GET  /resume   → Return { resume_text: str | null }
PUT  /resume   → body: { resume_text: str, max_length=50000 }, save to users table
```

### Modified service: `app/services/job_service.py`

- Add `upsert_search_config(user_id, target_sites, schedule_enabled, schedule_cron)`
- Add `get_search_config(user_id) -> Optional[SearchConfig]`
- Add `get_all_search_configs() -> List[SearchConfig]`
- Modify `batch_create_pending` to accept `match_score` per listing

### New service method: `app/services/scoring_service.py`

`score_job(job_title, snippet, resume_text) -> Optional[int]`

- Accepts a `llm: LLMService` parameter — the caller (`_search_for_user`) instantiates one `LLMService()` at the start and passes it in for the whole batch, avoiding both the global-singleton race condition and per-call construction overhead
- Calls the LLM with a structured prompt requesting JSON `{ "score": int }` (0–100); uses `response_format={"type": "json_object"}` or equivalent structured output
- Returns the score integer; returns `None` on any LLM failure (non-blocking, log warning)
- Prompt instructs: score 100 = perfect match, 0 = completely irrelevant
- `match_score` field should be defined with `Field(default=None, ge=0, le=100)` to prevent out-of-range values

### Modified scheduler: `app/core/scheduler.py`

`archive_stale_pending` is retained: call `await job_service.archive_stale_pending()` once per user run inside `_search_for_user`, same as the current behavior.

Extract core search logic into reusable `_search_for_user(user_id, pref, config, resume_text) -> dict`:

If `pref` is `None`, log a warning and return `{"inserted": 0, "skipped": 0}` early.

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

Rename `SystemPromptModal` to `SettingsModal` (update the export and all call sites — currently only `app/chat/page.tsx`). The component becomes a multi-tab settings panel with three tabs:

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
