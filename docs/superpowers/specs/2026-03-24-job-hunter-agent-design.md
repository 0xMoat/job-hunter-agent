# Job Hunter Agent — Design Spec

**Date**: 2026-03-24
**Status**: Approved
**Purpose**: Demo project for agent engineer interviews — showcases industrial-grade agent tech stack (LangGraph, mem0, Langfuse, APScheduler) through a practical job-hunting assistant.

---

## 1. Goals

- Demonstrate hands-on understanding of industrial agent frameworks in a working system
- Support live demo during interviews (Next.js chat UI) and code walkthrough (clean architecture)
- Cover key agent engineering concepts: tool orchestration, long-term memory, conversation checkpointing, LLM observability, scheduled autonomous tasks
- Leave a clear architectural path for multi-agent extension (documented, not implemented)

## 2. Architecture Overview

The system extends the existing FastAPI + LangGraph template. Infrastructure (PostgreSQL checkpointing, mem0, Langfuse tracing, tenacity retry, Prometheus metrics, rate limiting) is unchanged. Changes are concentrated in three areas: tools, system prompt, and frontend.

```
┌─────────────────────────────────────────────────┐
│  Next.js Frontend                               │
│  - Chat UI with visible tool call trace         │
│  - Job cards (structured listings)              │
│  - Application tracker dashboard                │
│  - "Today's Picks" tab (daily search results)   │
└────────────────────┬────────────────────────────┘
                     │ SSE streaming (existing endpoint)
┌────────────────────▼────────────────────────────┐
│  FastAPI (existing)                             │
│  + new REST endpoints: /preferences, /listings, │
│    /applications                                │
└────────────────────┬────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────┐
│  LangGraph Agent (modified)                     │
│                                                 │
│  chat ──► tool_call ──► chat                   │
│                                                 │
│  Tools (new):                                   │
│    job_search_tool                              │
│    company_research_tool                        │
│    cover_letter_tool                            │
│    application_tracker_tool                     │
│                                                 │
│  System prompt: job-hunting specialist          │
└────────┬────────────────────────────────────────┘
         │
┌────────▼────────────────────────────────────────┐
│  APScheduler (integrated into FastAPI lifespan) │
│  Daily 08:00 — calls job_search_tool directly   │
│  for each user's saved preferences              │
└────────┬────────────────────────────────────────┘
         │
┌────────▼────────────────────────────────────────┐
│  PostgreSQL                                     │
│  - checkpoints (existing)                       │
│  - pgvector / mem0 (existing)                   │
│  - applications (new) — structured CRUD         │
│  - job_listings (new) — daily search results    │
│  - job_preferences (new) — per-user criteria    │
└─────────────────────────────────────────────────┘
```

## 3. Tools

### 3.1 `job_search_tool`

| Field | Detail |
|---|---|
| Input | `keywords: str`, `location: str`, `job_type: str` (fulltime/remote/contract) |
| Logic | DuckDuckGo search with structured Pydantic parsing |
| Output | `List[JobListing]` — title, company, location, url, snippet, posted_date |

### 3.2 `company_research_tool`

| Field | Detail |
|---|---|
| Input | `company_name: str`, `aspects: List[str]` (culture/news/reviews/funding) |
| Logic | Multiple DuckDuckGo searches: Glassdoor reviews, recent news, LinkedIn |
| Output | `CompanyReport` — overview, recent_news[], culture_notes, red_flags[] |

### 3.3 `cover_letter_tool`

| Field | Detail |
|---|---|
| Input | `job_listing: JobListing`, `user_profile: str` (from mem0), `tone: str` (formal/casual) |
| Logic | Dedicated LLM prompt — does not go through the main chat node |
| Output | Structured text — subject_line, body, key_highlights[] |

### 3.4 `application_tracker_tool`

| Field | Detail |
|---|---|
| Input | `action: str` (add/update/list/delete), `application_data: dict` |
| Logic | Direct async PostgreSQL CRUD on `applications` table |
| Output | Operation result or list of applications |

### 3.5 Tool call example (demo flow)

```
User:  "帮我找 agent engineer 岗位，我在上海"
Agent: → job_search_tool("agent engineer", "上海", "fulltime")
       → returns 5 listings

User:  "研究一下字节跳动"
Agent: → company_research_tool("字节跳动", ["culture", "news"])
       → returns CompanyReport

User:  "帮我写一封求职信"
Agent: → cover_letter_tool(job=..., user_profile=mem0.search(...))
       → returns cover letter

User:  "记录我投了字节跳动"
Agent: → application_tracker_tool("add", {company: "字节跳动", status: "applied"})
```

## 4. Memory Strategy

Two distinct memory mechanisms, each used for what it's best at:

| Layer | Mechanism | What it stores | Why |
|---|---|---|---|
| Short-term | LangGraph PostgreSQL checkpointer | Conversation history per session | Resumable across restarts |
| Long-term semantic | mem0 (pgvector) | User profile: skills, experience, target roles, salary expectations, location preferences | Semantic retrieval for cover letter generation |
| Structured records | PostgreSQL tables | Applications, job listings, job preferences | Needs structured queries (filter by status, date, company) |

**Design decision**: Application tracking goes to PostgreSQL directly (not mem0) because it needs reliable structured queries, not semantic similarity search.

## 5. Scheduled Search

APScheduler is integrated into FastAPI's `lifespan` async context manager — no separate process or task queue required.

```python
# Runs daily at 08:00
async def daily_job_search():
    users = await db.get_all_users_with_preferences()
    for user in users:
        prefs = user.job_preferences
        results = await job_search_tool.ainvoke({
            "keywords": prefs.keywords,
            "location": prefs.location,
            "job_type": prefs.job_type,
        })
        await db.upsert_job_listings(user_id=user.id, listings=results)
```

**Key decisions**:
- Scheduled tasks call the tool directly, not through the full LangGraph agent — batch processing does not need conversation state
- Results are deduplicated by URL before insertion
- Users set search preferences via chat ("帮我设置每日搜索：agent engineer，上海，remote优先")
- Frontend "Today's Picks" tab fetches from `GET /api/v1/listings` — frontend-initiated pull, no push/notification needed

## 6. Frontend

**Stack**: Next.js + Tailwind CSS. Connects to existing SSE endpoint with no backend changes required for chat.

**Layout**:
- Left panel: Chat with visible tool call trace (tool name + status rendered inline as SSE chunks arrive)
- Right panel: Application tracker dashboard (status columns: Applied / Interviewing / Rejected)
- Top tab: "Today's Picks" — daily search results from scheduled jobs

**Tool call visibility**: SSE stream chunks containing tool calls are parsed and rendered as inline cards before the assistant's text response. This makes the agent's reasoning chain visible without any backend changes.

## 7. New API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET/PUT | `/api/v1/preferences` | Read/write user's job search preferences |
| GET | `/api/v1/listings` | Fetch daily search results |
| GET/POST/PATCH/DELETE | `/api/v1/applications` | CRUD for application tracking |

## 8. New Database Tables

### `job_preferences`
```sql
user_id, keywords, location, job_type, created_at, updated_at
```

### `job_listings`
```sql
id, user_id, title, company, location, url (unique), snippet,
posted_date, found_date, is_read
```

### `applications`
```sql
id, user_id, company, title, url, status, applied_date,
notes, created_at, updated_at
```

## 9. System Prompt Changes

`app/core/prompts/system.md` is rewritten for a job-hunting specialist persona:
- Proactively asks for user background on first interaction to populate mem0
- Guides users through the full job-hunting workflow
- References long-term memory (user profile) when generating cover letters
- Knows how to set job preferences via `application_tracker_tool`

## 10. What This Demo Showcases (Interview Talking Points)

| Concept | Where it appears |
|---|---|
| Tool orchestration / ReAct loop | 4 specialized tools, visible in UI |
| LangGraph StateGraph | `chat → tool_call → chat` node pattern |
| PostgreSQL checkpointing | Conversation resumption across restarts |
| Long-term memory (mem0 + pgvector) | User profile persisted, retrieved for cover letters |
| LLM observability (Langfuse) | Full trace of every tool call and LLM invocation |
| Retry / resilience (tenacity) | Circular model fallback in LLMService |
| Scheduled autonomous agents | APScheduler daily search |
| Structured outputs (Pydantic) | JobListing, CompanyReport schemas |
| SSE streaming | Real-time chat response |

## 11. Multi-Agent Extension Path (Not Implemented)

The current single-agent design has natural sub-agent boundaries. If extended:

```
Orchestrator
  ├── SearchAgent  — owns job_search_tool
  ├── ResearchAgent — owns company_research_tool
  └── WritingAgent  — owns cover_letter_tool
```

Each agent becomes a compiled LangGraph subgraph. The Orchestrator routes via LLM decision or explicit `Command(goto=...)`. Not implemented because the current task dependencies are sequential and the coordination overhead outweighs the benefit. Worth adding if concurrent multi-company research becomes a requirement.

## 12. Out of Scope

- Email / push notifications (results surface via dashboard pull)
- Direct job board API integrations (DuckDuckGo search is sufficient for demo)
- Resume PDF parsing (user provides background via chat)
- OAuth / social login
