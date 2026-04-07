# Job Pipeline Persistence — Design Spec

**Date:** 2026-04-07
**Status:** Approved
**Goal:** Let users save interesting job search results to the Kanban board via interactive checkable cards, and inject pending applications into the system prompt so the Agent remembers them across sessions.

---

## Problem

When a user searches for jobs via `job_search_tool` in chat, the results are ephemeral — displayed once and lost when the session ends. Starting a new session, the Agent has no idea what jobs the user previously found or expressed interest in. This breaks the continuity of a job-hunting workflow that naturally spans multiple days and sessions.

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| What to save | Only jobs the user explicitly selects | Avoids noise; user controls their pipeline |
| Where to store | Existing `Application` table, `source=chat` | Reuses Kanban board; zero UI for browsing |
| How to select | Frontend checkable JD cards + batch save button | Visual, intuitive, low friction |
| How to recall | Inject pending Applications into system prompt | Agent always aware; no extra tool call needed |
| Fallback | Agent can also save via `application_tracker_tool` on natural language cues | Covers users who express interest in text |

---

## Backend Changes

### 1. `BatchListingItem` schema — add `source` field

**File:** `app/api/v1/applications.py`

```python
class BatchListingItem(BaseModel):
    title: str
    company: str = ""
    url: str = Field(min_length=1)
    snippet: str = ""
    found_date: Optional[str] = None
    source: str = "scheduler"  # "scheduler" | "chat" | "manual"
```

### 2. `batch_create_pending` — pass through `source`

**File:** `app/services/job_service.py`

Currently hardcodes `source="scheduler"`. Change to use the `source` value from each listing item, defaulting to `"scheduler"` for backward compatibility.

### 3. `GraphState` — add `pending_applications` field

**File:** `app/schemas/graph.py`

```python
class GraphState(BaseModel):
    messages: Annotated[list, add_messages] = Field(default_factory=list)
    long_term_memory: str = Field(default="")
    pending_applications: str = Field(default="")  # NEW
```

### 4. `LangGraphAgent` — add `_get_pending_applications` method

**File:** `app/core/langgraph/graph.py`

New async method that:
- Calls `job_service.list_applications(user_id)` (already exists)
- Filters to `status == "pending"`
- Formats as numbered list: `1. [Title] Company — URL`
- Caps at 15 entries; appends "...还有 N 条" if truncated
- Returns `"暂无待处理的职位"` if empty

### 5. `get_stream_response` — parallel query and inject

**File:** `app/core/langgraph/graph.py`

Before streaming, run in parallel:
```python
relevant_memory, pending_apps = await asyncio.gather(
    self._get_relevant_memory(user_id, messages[-1].content),
    self._get_pending_applications(user_id),
)
```

Pass both into graph input:
```python
{"messages": ..., "long_term_memory": relevant_memory, "pending_applications": pending_apps}
```

### 6. System prompt update

**File:** `app/core/prompts/system.md`

Add at the end (before `{current_date_and_time}`):

```markdown
# 用户的求职看板（待处理）
以下是用户收藏但还未投递的职位。当用户提到"上次搜到的"、"之前那个XX公司的职位"时，
优先从这里匹配。如果用户想对某个职位写求职信或做公司调研，直接使用这里的信息。
{pending_applications}
```

Add to Workflow section:

> 当用户对搜索结果表达兴趣但没有使用前端勾选功能时（例如"第3个不错"、"帮我保存那个字节的"），
> 主动调用 `application_tracker_tool(action=add)` 将该职位加入看板。

### 7. `_chat` node — format pending_applications into prompt

**File:** `app/core/langgraph/graph.py`

In `_chat`, pass `pending_applications=state.pending_applications` to `load_system_prompt()` / custom prompt formatting, alongside the existing `long_term_memory`.

---

## Frontend Changes

### 1. `JobSearchResultCard` component (NEW)

**File:** `frontend/components/chat/JobSearchResultCard.tsx`

**Props:** Same as `ToolCallCard` — receives `entry: ToolCallEntry`.

**Rendering:**
- Header: search icon + "Job Search" + keywords from `callingContent`
- Body: parse `entry.resultContent` JSON → iterate `results` array
- Each result rendered as a card row:
  - Checkbox (left)
  - Title (bold)
  - Company + location (extracted from title/snippet best-effort)
  - Snippet (truncated, 2 lines)
  - Link (clickable, opens new tab)
- Footer: "保存到看板 (N)" button, disabled when N=0

**States:**
- `idle` — checkboxes interactive, button shows count
- `saving` — button shows spinner
- `saved` — checked items show ✅, button shows "已保存"

**History restore:** When rendering from chat history, cross-reference URLs against user's Applications (fetched via existing `useApplications` hook or a lightweight check). Already-saved items show ✅.

### 2. `MessageBubble` — conditional rendering

**File:** `frontend/components/chat/MessageBubble.tsx`

In `toolCalls.map()`:
```tsx
if (entry.toolName === "job_search_tool" && entry.status === "done")
  → <JobSearchResultCard entry={entry} />
else
  → <ToolCallCard entry={entry} />
```

While `status === "calling"`, show the existing `ToolCallCard` loading animation.

### 3. API client function

**File:** `frontend/lib/api.ts`

```typescript
export async function apiBatchCreateApplications(
  token: string,
  listings: { title: string; company: string; url: string; snippet: string; source: string }[]
): Promise<{ inserted: number; skipped: number }>
```

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Result with empty `link` | Card row rendered without checkbox, grayed out, not selectable |
| Duplicate URL save | Backend `(user_id, url)` unique constraint → `skipped` count → frontend toast "N 条已存在" |
| 0 pending applications | System prompt injects "暂无待处理的职位" |
| 0 search results | `JobSearchResultCard` shows empty state text, no button |
| History message restore | Cross-check URLs against existing Applications; show ✅ for saved ones |
| >15 pending applications | Truncate list, append "...还有 N 条未显示" |

---

## Files Changed

| File | Change |
|------|--------|
| `app/api/v1/applications.py` | `BatchListingItem.source` field |
| `app/services/job_service.py` | `batch_create_pending` pass through `source` |
| `app/schemas/graph.py` | `GraphState.pending_applications` field |
| `app/core/langgraph/graph.py` | `_get_pending_applications`, parallel query in `get_stream_response`, `_chat` prompt formatting |
| `app/core/prompts/system.md` | `{pending_applications}` section + workflow guidance |
| `frontend/components/chat/JobSearchResultCard.tsx` | New component |
| `frontend/components/chat/MessageBubble.tsx` | Conditional rendering by `toolName` |
| `frontend/lib/api.ts` | `apiBatchCreateApplications` function |

**No migration needed** — `Application.source` is already a `str` column accepting any value.
