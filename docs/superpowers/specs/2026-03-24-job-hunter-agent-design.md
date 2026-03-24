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
                     │ SSE streaming (structured chunks)
┌────────────────────▼────────────────────────────┐
│  FastAPI (existing + new endpoints)             │
│  + GET/PUT  /api/v1/preferences                 │
│  + GET      /api/v1/listings                    │
│  + CRUD     /api/v1/applications                │
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
│    job_preferences_tool                         │
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

## 3. Tool Context: How Tools Access User Identity

All tools run inside the LangGraph `tool_call` node. Two pieces of context need to be available to tools:

- **`user_id`**: injected via `RunnableConfig["configurable"]["user_id"]` — already set per-request in `chatbot.py`. Tools receive `config: RunnableConfig` as a second argument via LangGraph's tool calling convention.
- **`long_term_memory`**: stored in `GraphState.long_term_memory` (already populated by `_get_relevant_memory` before each graph invocation). The `cover_letter_tool` reads it from state via the `InjectedState` annotation.

This means tools do NOT call mem0 directly — they consume pre-fetched context that the graph node already provides.

**Implementation note**: The existing `_tool_call` node calls `tool.ainvoke(tool_call["args"])` without passing `config`. This must be changed to `tool.ainvoke(tool_call["args"], config=config)`, which requires updating the method signature to `async def _tool_call(self, state: GraphState, config: RunnableConfig)`. LangGraph passes `config` as the second argument to node functions automatically.

## 4. Tools

### 4.1 `job_search_tool`

| Field | Detail |
|---|---|
| Input | `keywords: str`, `location: str`, `job_type: str` (fulltime/remote/contract) |
| Logic | DuckDuckGo search with structured Pydantic parsing |
| Output | `List[JobListing]` — title, company, location, url, snippet, posted_date |

### 4.2 `company_research_tool`

| Field | Detail |
|---|---|
| Input | `company_name: str`, `aspects: List[str]` (culture/news/reviews/funding) |
| Logic | Multiple DuckDuckGo searches: Glassdoor reviews, recent news, LinkedIn |
| Output | `CompanyReport` — overview, recent_news[], culture_notes, red_flags[] |

### 4.3 `cover_letter_tool`

| Field | Detail |
|---|---|
| Input | `job_listing: JobListing`, `tone: str` (formal/casual), `long_term_memory: Annotated[str, InjectedState("long_term_memory")]` |
| Logic | Reads user profile from `GraphState.long_term_memory` (injected, not fetched). Makes a dedicated `llm_service.call()` with a cover letter–specific prompt. Langfuse `CallbackHandler` is passed via `config`. |
| Output | Structured text — subject_line, body, key_highlights[] |

### 4.4 `application_tracker_tool`

| Field | Detail |
|---|---|
| Input | `action: str` (add/update/list/delete), `application_data: dict` |
| Logic | Calls `ApplicationService` (new internal async service wrapping DB operations). Does NOT do direct DB access — respects service layer boundary. `user_id` from `config["configurable"]["user_id"]`. |
| Output | Operation result or list of applications |

### 4.5 `job_preferences_tool`

| Field | Detail |
|---|---|
| Input | `keywords: str`, `location: str`, `job_type: str` |
| Logic | Calls `PreferencesService.upsert(user_id, ...)`. Single write path for preferences — the REST `PUT /api/v1/preferences` endpoint calls the same service. |
| Output | Confirmation message |

**Note**: Preferences have one write path: `job_preferences_tool` (via agent) and `PUT /api/v1/preferences` (via REST) both delegate to `PreferencesService.upsert()`. No conflict possible.

### 4.6 Tool call example (demo flow)

```
User:  "帮我找 agent engineer 岗位，我在上海"
Agent: → job_search_tool("agent engineer", "上海", "fulltime")
       → returns 5 listings

User:  "研究一下字节跳动"
Agent: → company_research_tool("字节跳动", ["culture", "news"])
       → returns CompanyReport

User:  "帮我写一封求职信"
Agent: → cover_letter_tool(job=..., tone="formal")
         (long_term_memory injected from GraphState)
       → returns cover letter

User:  "记录我投了字节跳动"
Agent: → application_tracker_tool("add", {company: "字节跳动", status: "applied"})

User:  "设置每日搜索：agent engineer，上海，remote"
Agent: → job_preferences_tool("agent engineer", "上海", "remote")
```

**Concurrent tool calls**: The current `tool_call` node executes tools serially (for-loop). If the LLM emits multiple tool calls in one response, they run sequentially. This is intentional for the demo — predictable execution order makes the reasoning trace easier to follow. Parallel tool execution is noted as a multi-agent extension point.

## 5. Memory Strategy

Two distinct memory mechanisms, each used for what it's best at:

| Layer | Mechanism | What it stores | Why |
|---|---|---|---|
| Short-term | LangGraph PostgreSQL checkpointer | Conversation history per session | Resumable across restarts |
| Long-term semantic | mem0 (pgvector) | User profile: skills, experience, target roles, salary expectations, location preferences | Semantic retrieval, injected into GraphState before each invocation |
| Structured records | PostgreSQL tables | Applications, job listings, job preferences | Needs structured queries (filter by status, date, company) |

## 6. Scheduled Search

APScheduler is integrated into FastAPI's `lifespan` async context manager — no separate process or task queue required.

```python
async def daily_job_search():
    prefs_list = await PreferencesService.get_all()  # new method
    for pref in prefs_list:
        results = await job_search_tool.ainvoke({
            "keywords": pref.keywords,
            "location": pref.location,
            "job_type": pref.job_type,
        })
        await ListingsService.upsert_for_user(user_id=pref.user_id, listings=results)
# Note: get_all() loads all users — suitable for demo scale only.
# Production use requires pagination or active-user filtering.
```

**Key decisions**:
- Scheduled tasks call the tool directly, not through the full LangGraph agent — batch processing does not need conversation state
- Results are deduplicated by `(user_id, url)` composite unique constraint before insertion (not url-only, which would break multi-user scenarios)
- Frontend "Today's Picks" tab fetches from `GET /api/v1/listings` — frontend pull, no push/notification needed

**DB async strategy**: New service classes (`ApplicationService`, `PreferencesService`, `ListingsService`) use `asyncpg` directly (same pattern as `AsyncPostgresSaver`) rather than the existing synchronous `DatabaseService`, avoiding sync IO in async contexts.

## 7. SSE Streaming — Structured Chunks

The existing SSE stream yields raw `content: str` strings. To render tool call cards in the frontend, the following changes are needed:

**Schema** — `StreamResponse` in `app/schemas/chat.py` is replaced by `StreamChunk`:

```python
class StreamChunk(BaseModel):
    type: Literal["text", "tool_call", "tool_result", "done"]
    content: str
    tool_name: Optional[str] = None   # for tool_call / tool_result
    tool_call_id: Optional[str] = None
```

**Backend** — `get_stream_response` in `graph.py` currently uses `stream_mode="messages"` and yields `token.content` (a string). To emit structured chunks, the `stream_mode` is changed to `["messages", "updates"]`. The async generator distinguishes:
- `AIMessageChunk` with no `tool_calls` → emit `type="text"` chunk
- `AIMessageChunk` with `tool_calls` → emit `type="tool_call"` chunk
- `ToolMessage` → emit `type="tool_result"` chunk

The `event_generator` in `chatbot.py` serialises each `StreamChunk` as JSON instead of raw text.

**Frontend** — parses `type` and renders:
- `text` → appended to assistant bubble
- `tool_call` → inline card: "🔧 job_search_tool(agent engineer, 上海)…"
- `tool_result` → card update: "✅ 找到 5 个职位"
- `done` → stream end

## 8. Frontend

**Stack**: Next.js + Tailwind CSS.

**Layout**:
- Left panel: Chat with visible tool call trace
- Right panel: Application tracker dashboard (status columns: Applied / Interviewing / Rejected)
- Top tab: "Today's Picks" — daily search results from scheduled jobs

## 9. New API Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET/PUT | `/api/v1/preferences` | Read/write user's job search preferences (delegates to `PreferencesService`) |
| GET | `/api/v1/listings` | Fetch daily search results |
| GET/POST/PATCH/DELETE | `/api/v1/applications` | CRUD for application tracking (delegates to `ApplicationService`) |

## 10. New Database Tables & Models

### SQLModel classes (new)

```python
class JobPreference(BaseModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID
    keywords: str
    location: str
    job_type: str
    updated_at: datetime

class JobListing(BaseModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID
    title: str
    company: str
    location: str
    url: str
    snippet: str
    posted_date: Optional[date]
    found_date: date
    __table_args__ = (UniqueConstraint("user_id", "url"),)  # composite unique

class Application(BaseModel, table=True):
    id: uuid.UUID = Field(default_factory=uuid.uuid4, primary_key=True)
    user_id: uuid.UUID
    company: str
    title: str
    url: Optional[str]
    status: str  # applied / interviewing / rejected / offer
    applied_date: date
    notes: Optional[str]
```

### New internal services (async, using asyncpg)

- `ApplicationService` — CRUD for `Application`
- `PreferencesService` — upsert/get for `JobPreference`; `get_all()` used by scheduler
- `ListingsService` — upsert (dedup by user_id+url) for `JobListing`

## 11. System Prompt

`app/core/prompts/system.md` is rewritten for a job-hunting specialist persona. Core instructions draft:

```
# Role
You are a job-hunting specialist assistant. Help the user find relevant jobs,
research target companies, write personalized cover letters, and track their applications.

# Workflow
1. On first interaction, proactively collect: skills, years of experience, target roles,
   target locations, salary expectations. Store these via conversation — they will be
   persisted to long-term memory automatically.
2. When searching jobs, always confirm keywords and location before calling job_search_tool.
3. When writing a cover letter, use the user profile from long-term memory to personalize it.
4. After the user decides to apply, offer to record it via application_tracker_tool.

# What you know about the user
{long_term_memory}

# Current date and time
{current_date_and_time}
```

## 12. What This Demo Showcases (Interview Talking Points)

| Concept | Where it appears |
|---|---|
| Tool orchestration / ReAct loop | 5 specialized tools, visible in UI |
| LangGraph StateGraph | `chat → tool_call → chat` node pattern |
| PostgreSQL checkpointing | Conversation resumption across restarts |
| Long-term memory (mem0 + pgvector) | User profile persisted, injected via `InjectedState` |
| LLM observability (Langfuse) | Full trace of every tool call and LLM invocation |
| Retry / resilience (tenacity) | Circular model fallback in LLMService |
| Scheduled autonomous agents | APScheduler daily search |
| Structured outputs (Pydantic) | JobListing, CompanyReport, StreamChunk schemas |
| SSE streaming | Real-time structured chunks with tool call visibility |
| Service layer separation | Tools call services, not DB directly |

## 13. Multi-Agent Extension Path (Not Implemented)

The current single-agent design has natural sub-agent boundaries. If extended:

```
Orchestrator
  ├── SearchAgent  — owns job_search_tool
  ├── ResearchAgent — owns company_research_tool
  └── WritingAgent  — owns cover_letter_tool, job_preferences_tool
```

Each agent becomes a compiled LangGraph subgraph. The Orchestrator routes via `Command(goto=...)`. Parallel company research across multiple firms becomes feasible. Not implemented because current task dependencies are sequential and coordination overhead outweighs the benefit.

## 14. Out of Scope

- Email / push notifications (results surface via dashboard pull)
- Direct job board API integrations (DuckDuckGo search is sufficient for demo)
- Resume PDF parsing (user provides background via chat)
- OAuth / social login
- Parallel tool execution (noted as multi-agent extension point)
