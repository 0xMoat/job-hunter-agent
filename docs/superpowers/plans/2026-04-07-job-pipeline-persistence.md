# Job Pipeline Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users save interesting job search results to the Kanban board via interactive checkable cards, and inject pending applications into the system prompt so the Agent remembers them across sessions.

**Architecture:** Frontend intercepts `job_search_tool` results and renders them as checkable JD cards. User selects favorites and batch-saves to the existing `Application` table (`source=chat`). On every new message, pending applications are injected into the system prompt alongside mem0 long-term memory.

**Tech Stack:** FastAPI, SQLModel, LangGraph, Next.js, React, Tailwind CSS

---

### Task 1: Backend — `BatchListingItem` add `source` field

**Files:**
- Modify: `app/api/v1/applications.py:34-42`

- [ ] **Step 1: Add `source` field to `BatchListingItem`**

In `app/api/v1/applications.py`, add the `source` field to the schema:

```python
class BatchListingItem(BaseModel):
    """A single listing item for batch creation."""

    title: str
    company: str = ""
    url: str = Field(min_length=1)
    snippet: str = ""
    found_date: Optional[str] = None
    source: str = "scheduler"
```

- [ ] **Step 2: Verify lint passes**

Run: `cd /Users/young/Downloads/repos/Job-Hunter-Agent && make lint`
Expected: No new lint errors from this change.

- [ ] **Step 3: Commit**

```bash
git add app/api/v1/applications.py
git commit -m "feat: add source field to BatchListingItem schema"
```

---

### Task 2: Backend — `batch_create_pending` pass through `source`

**Files:**
- Modify: `app/services/job_service.py:121-173`

- [ ] **Step 1: Update `batch_create_pending` to use item source**

In `app/services/job_service.py`, in the `batch_create_pending` method, change the hardcoded `source="scheduler"` to read from the item dict. Find this block (around line 153):

```python
            card = Application(
                user_id=user_id,
                title=item.get("title", ""),
                company=item.get("company", ""),
                url=url,
                snippet=item.get("snippet", ""),
                found_date=found_date_val,
                source="scheduler",
                status="pending",
                match_score=item.get("match_score"),
            )
```

Replace with:

```python
            card = Application(
                user_id=user_id,
                title=item.get("title", ""),
                company=item.get("company", ""),
                url=url,
                snippet=item.get("snippet", ""),
                found_date=found_date_val,
                source=item.get("source", "scheduler"),
                status="pending",
                match_score=item.get("match_score"),
            )
```

- [ ] **Step 2: Verify lint passes**

Run: `cd /Users/young/Downloads/repos/Job-Hunter-Agent && make lint`
Expected: No new lint errors.

- [ ] **Step 3: Commit**

```bash
git add app/services/job_service.py
git commit -m "feat: batch_create_pending passes through source field"
```

---

### Task 3: Backend — `GraphState` add `pending_applications` field

**Files:**
- Modify: `app/schemas/graph.py`

- [ ] **Step 1: Add `pending_applications` to `GraphState`**

Replace the full `GraphState` class in `app/schemas/graph.py`:

```python
class GraphState(BaseModel):
    """State definition for the LangGraph Agent/Workflow."""

    messages: Annotated[list, add_messages] = Field(
        default_factory=list, description="The messages in the conversation"
    )
    long_term_memory: str = Field(default="", description="The long term memory of the conversation")
    pending_applications: str = Field(default="", description="Pending applications from the kanban board")
```

- [ ] **Step 2: Verify lint passes**

Run: `cd /Users/young/Downloads/repos/Job-Hunter-Agent && make lint`
Expected: No new lint errors.

- [ ] **Step 3: Commit**

```bash
git add app/schemas/graph.py
git commit -m "feat: add pending_applications field to GraphState"
```

---

### Task 4: Backend — `_get_pending_applications` + parallel injection

**Files:**
- Modify: `app/core/langgraph/graph.py`

This task adds the `_get_pending_applications` method and wires it into `get_stream_response` alongside the existing `_get_relevant_memory` call.

- [ ] **Step 1: Add import for `job_service`**

At the top of `app/core/langgraph/graph.py`, add this import alongside the existing service imports (near line 54 where `from app.services.llm import llm_service` is):

```python
from app.services.job_service import job_service
```

- [ ] **Step 2: Add `_get_pending_applications` method**

Add this method to the `LangGraphAgent` class, after the `_update_long_term_memory` method (after line 236):

```python
    async def _get_pending_applications(self, user_id: str) -> str:
        """Get pending applications for injection into the system prompt.

        Args:
            user_id: The user ID.

        Returns:
            Formatted string of pending applications, or a placeholder if none.
        """
        try:
            apps = await job_service.list_applications(int(user_id))
            pending = [a for a in apps if a.status == "pending"]
            if not pending:
                return "暂无待处理的职位"
            max_display = 15
            lines = []
            for i, app in enumerate(pending[:max_display], 1):
                company_part = f" {app.company} —" if app.company else ""
                url_part = f" {app.url}" if app.url else ""
                lines.append(f"{i}. [{app.title}]{company_part}{url_part}")
            if len(pending) > max_display:
                lines.append(f"...还有 {len(pending) - max_display} 条未显示")
            return "\n".join(lines)
        except Exception as e:
            logger.error("failed_to_get_pending_applications", error=str(e), user_id=user_id)
            return "暂无待处理的职位"
```

- [ ] **Step 3: Replace sequential memory query with parallel gather**

In the `get_stream_response` method, find this block (around line 432):

```python
        relevant_memory = (
            await self._get_relevant_memory(user_id, messages[-1].content)
        ) or "No relevant memory found."
```

Replace with:

```python
        relevant_memory, pending_apps = await asyncio.gather(
            self._get_relevant_memory(user_id, messages[-1].content),
            self._get_pending_applications(user_id),
        )
        relevant_memory = relevant_memory or "No relevant memory found."
```

- [ ] **Step 4: Pass `pending_applications` into graph input**

In the same method, find the `astream` call (around line 444):

```python
            async for event_mode, event_data in self._graph.astream(
                {"messages": dump_messages(messages), "long_term_memory": relevant_memory},
```

Replace with:

```python
            async for event_mode, event_data in self._graph.astream(
                {"messages": dump_messages(messages), "long_term_memory": relevant_memory, "pending_applications": pending_apps},
```

- [ ] **Step 5: Update `_chat` to pass `pending_applications` into system prompt**

In the `_chat` method, find the custom prompt formatting block (around line 258):

```python
    custom = config["configurable"].get("custom_system_prompt")
    if custom:
        try:
            SYSTEM_PROMPT = custom.format(
                agent_name=settings.PROJECT_NAME + " Agent",
                long_term_memory=state.long_term_memory,
                current_date_and_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            )
```

Replace with:

```python
    custom = config["configurable"].get("custom_system_prompt")
    if custom:
        try:
            SYSTEM_PROMPT = custom.format(
                agent_name=settings.PROJECT_NAME + " Agent",
                long_term_memory=state.long_term_memory,
                pending_applications=state.pending_applications,
                current_date_and_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            )
```

Then find the two `load_system_prompt` calls in the same method:

```python
            SYSTEM_PROMPT = load_system_prompt(long_term_memory=state.long_term_memory)
    else:
        SYSTEM_PROMPT = load_system_prompt(long_term_memory=state.long_term_memory)
```

Replace both with:

```python
            SYSTEM_PROMPT = load_system_prompt(long_term_memory=state.long_term_memory, pending_applications=state.pending_applications)
    else:
        SYSTEM_PROMPT = load_system_prompt(long_term_memory=state.long_term_memory, pending_applications=state.pending_applications)
```

- [ ] **Step 6: Verify lint passes**

Run: `cd /Users/young/Downloads/repos/Job-Hunter-Agent && make lint`
Expected: No new lint errors from these changes.

- [ ] **Step 7: Commit**

```bash
git add app/core/langgraph/graph.py
git commit -m "feat: inject pending applications into system prompt via parallel query"
```

---

### Task 5: Backend — System prompt update

**Files:**
- Modify: `app/core/prompts/system.md`

- [ ] **Step 1: Add pending applications section to system prompt**

In `app/core/prompts/system.md`, insert the following block **before** the `# Current date and time` section (before the last 2 lines):

```markdown
# 用户的求职看板（待处理）
以下是用户收藏但还未投递的职位。当用户提到"上次搜到的"、"之前那个XX公司的职位"时，
优先从这里匹配。如果用户想对某个职位写求职信或做公司调研，直接使用这里的信息。
{pending_applications}

```

- [ ] **Step 2: Add natural language fallback guidance to Workflow section**

In the same file, after the existing workflow item 6 (Daily search setup), add:

```markdown

7. **Saving search results**: When the user expresses interest in specific search results
   but hasn't used the frontend save button (e.g. "第3个不错", "帮我保存那个字节的"),
   proactively call `application_tracker_tool(action=add)` to save the job to their board.
```

- [ ] **Step 3: Commit**

```bash
git add app/core/prompts/system.md
git commit -m "feat: add pending_applications section and save-from-chat guidance to system prompt"
```

---

### Task 6: Frontend — `Application` type update + API client function

**Files:**
- Modify: `frontend/lib/types.ts:75`
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Update `Application.source` type**

In `frontend/lib/types.ts`, find line 75:

```typescript
  source: "scheduler" | "manual"
```

Replace with:

```typescript
  source: "scheduler" | "manual" | "chat"
```

- [ ] **Step 2: Add `apiBatchCreateApplications` function**

In `frontend/lib/api.ts`, add the following function in the Applications section (after the existing `apiDeleteApplication` function):

```typescript
export async function apiBatchCreateApplications(
  sessionToken: string,
  listings: { title: string; company: string; url: string; snippet: string; source: string }[],
): Promise<{ inserted: number; skipped: number }> {
  const res = await req(
    "/api/v1/applications/batch",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listings }),
    },
    sessionToken,
  )
  return res.json()
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/types.ts frontend/lib/api.ts
git commit -m "feat: add chat source type and batch create API client"
```

---

### Task 7: Frontend — `JobSearchResultCard` component

**Files:**
- Create: `frontend/components/chat/JobSearchResultCard.tsx`

- [ ] **Step 1: Create the `JobSearchResultCard` component**

Create `frontend/components/chat/JobSearchResultCard.tsx`:

```tsx
"use client"

import { useState } from "react"
import type { ToolCallEntry } from "@/lib/types"
import { apiBatchCreateApplications } from "@/lib/api"
import { getSessionToken } from "@/lib/auth"

interface JobResult {
  title: string
  link: string
  snippet: string
}

interface Props {
  entry: ToolCallEntry
}

function parseResults(entry: ToolCallEntry): { keywords: string; results: JobResult[] } {
  try {
    const data = JSON.parse(entry.resultContent ?? "{}")
    const keywords = [data.keywords, data.location].filter(Boolean).join(" · ")
    const results: JobResult[] = (data.results ?? []).filter(
      (r: JobResult) => r.link && r.link.length > 0,
    )
    return { keywords, results }
  } catch {
    return { keywords: "", results: [] }
  }
}

export function JobSearchResultCard({ entry }: Props) {
  const { keywords, results } = parseResults(entry)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle")
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set())
  const [feedback, setFeedback] = useState("")

  const toggle = (idx: number) => {
    if (status !== "idle") return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const handleSave = async () => {
    const token = getSessionToken()
    if (!token || selected.size === 0) return
    setStatus("saving")
    try {
      const listings = Array.from(selected).map((idx) => {
        const r = results[idx]
        return {
          title: r.title,
          company: "",
          url: r.link,
          snippet: r.snippet,
          source: "chat",
        }
      })
      const res = await apiBatchCreateApplications(token, listings)
      const newSaved = new Set(savedUrls)
      listings.forEach((l) => newSaved.add(l.url))
      setSavedUrls(newSaved)
      setSelected(new Set())
      setStatus("saved")
      if (res.skipped > 0) {
        setFeedback(`已保存 ${res.inserted} 条，${res.skipped} 条已存在`)
      } else {
        setFeedback(`已保存 ${res.inserted} 条到看板`)
      }
    } catch {
      setStatus("idle")
      setFeedback("保存失败，请重试")
    }
  }

  if (results.length === 0) {
    return (
      <div className="glass rounded-xl my-1 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-[var(--text-2)]">
          <span className="w-[7px] h-[7px] rounded-full bg-green-500 flex-shrink-0" />
          <span className="font-body font-semibold">Job Search</span>
          {keywords && <span className="font-mono text-xs text-[var(--text-3)]">{keywords}</span>}
        </div>
        <p className="mt-2 text-xs font-body text-[var(--text-3)] italic">未找到相关职位</p>
      </div>
    )
  }

  return (
    <div className="glass rounded-xl my-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
        <span className="w-[7px] h-[7px] rounded-full bg-green-500 flex-shrink-0" />
        <span className="font-body font-semibold text-sm text-[var(--text-2)]">Job Search</span>
        {keywords && (
          <span className="font-mono text-xs text-[var(--text-3)] truncate">{keywords}</span>
        )}
        <span className="ml-auto font-mono text-xs text-[var(--text-3)]">{results.length} 条结果</span>
      </div>

      {/* Result list */}
      <div className="divide-y divide-[var(--border)]">
        {results.map((r, idx) => {
          const isSaved = savedUrls.has(r.link)
          const isSelected = selected.has(idx)
          return (
            <label
              key={idx}
              className={`flex gap-3 px-4 py-3 cursor-pointer transition-colors ${
                isSaved
                  ? "opacity-60 cursor-default"
                  : isSelected
                    ? "bg-[var(--accent)]/[0.04]"
                    : "hover:bg-black/[0.02]"
              }`}
              onClick={(e) => {
                if (isSaved) {
                  e.preventDefault()
                  return
                }
                toggle(idx)
              }}
            >
              {/* Checkbox */}
              <div className="pt-0.5 flex-shrink-0">
                {isSaved ? (
                  <span className="flex items-center justify-center w-4 h-4 rounded bg-green-500 text-white text-[10px]">
                    ✓
                  </span>
                ) : (
                  <span
                    className={`flex items-center justify-center w-4 h-4 rounded border transition-colors ${
                      isSelected
                        ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] text-[10px]"
                        : "border-[var(--border-strong)]"
                    }`}
                  >
                    {isSelected && "✓"}
                  </span>
                )}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <p className="font-body font-semibold text-sm text-[var(--text)] leading-snug line-clamp-1">
                  {r.title}
                </p>
                <p className="font-body text-xs text-[var(--text-3)] mt-0.5 line-clamp-2 leading-relaxed">
                  {r.snippet}
                </p>
                <a
                  href={r.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-block mt-1 font-mono text-[10px] text-[var(--accent)] opacity-60 hover:opacity-100 truncate max-w-[280px]"
                >
                  {new URL(r.link).hostname} ↗
                </a>
              </div>
            </label>
          )
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--border)] bg-black/[0.01]">
        {feedback && (
          <span className="font-body text-xs text-[var(--text-3)]">{feedback}</span>
        )}
        {!feedback && <span />}
        {status === "saved" ? (
          <span className="font-body text-xs font-semibold text-green-600">已保存 ✓</span>
        ) : (
          <button
            onClick={handleSave}
            disabled={selected.size === 0 || status === "saving"}
            className={`font-body text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              selected.size === 0 || status === "saving"
                ? "text-[var(--text-3)] bg-black/[0.03] cursor-not-allowed"
                : "text-[var(--accent-fg)] bg-[var(--accent)] hover:opacity-90 cursor-pointer"
            }`}
          >
            {status === "saving"
              ? "保存中..."
              : `保存到看板${selected.size > 0 ? ` (${selected.size})` : ""}`}
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/chat/JobSearchResultCard.tsx
git commit -m "feat: add JobSearchResultCard component with checkable JD cards"
```

---

### Task 8: Frontend — Wire `JobSearchResultCard` into `MessageBubble`

**Files:**
- Modify: `frontend/components/chat/MessageBubble.tsx`

- [ ] **Step 1: Add import**

In `frontend/components/chat/MessageBubble.tsx`, add the import alongside the existing `ToolCallCard` import (line 3):

```typescript
import { ToolCallCard } from "./ToolCallCard"
import { JobSearchResultCard } from "./JobSearchResultCard"
```

- [ ] **Step 2: Update tool call rendering**

In the same file, find the tool calls mapping block (around line 30):

```tsx
            {message.toolCalls.map((tc) => (
              <ToolCallCard key={tc.toolCallId} entry={tc} isStreaming={isStreaming} />
            ))}
```

Replace with:

```tsx
            {message.toolCalls.map((tc) =>
              tc.toolName === "job_search_tool" && tc.status === "done" ? (
                <JobSearchResultCard key={tc.toolCallId} entry={tc} />
              ) : (
                <ToolCallCard key={tc.toolCallId} entry={tc} isStreaming={isStreaming} />
              ),
            )}
```

- [ ] **Step 3: Verify the frontend builds**

Run: `cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/chat/MessageBubble.tsx
git commit -m "feat: render JobSearchResultCard for job_search_tool results"
```

---

### Task 9: Integration verification

**Files:** None — verification only.

- [ ] **Step 1: Verify backend lint**

Run: `cd /Users/young/Downloads/repos/Job-Hunter-Agent && make lint`
Expected: No new lint errors from our changes.

- [ ] **Step 2: Verify frontend build**

Run: `cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm build`
Expected: Build succeeds with no type errors.

- [ ] **Step 3: Verify all files changed match the spec**

Cross-check against the spec at `docs/superpowers/specs/2026-04-07-job-pipeline-persistence-design.md`:

| Spec item | Task |
|-----------|------|
| `BatchListingItem.source` field | Task 1 ✓ |
| `batch_create_pending` pass through `source` | Task 2 ✓ |
| `GraphState.pending_applications` field | Task 3 ✓ |
| `_get_pending_applications` + parallel query + `_chat` formatting | Task 4 ✓ |
| System prompt `{pending_applications}` + workflow guidance | Task 5 ✓ |
| `Application.source` type update + API client | Task 6 ✓ |
| `JobSearchResultCard` component | Task 7 ✓ |
| `MessageBubble` conditional rendering | Task 8 ✓ |
