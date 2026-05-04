# Job Hunter Agent

> AI-powered job hunting assistant — automates job search, company research, cover letter writing, and application tracking via a LangGraph conversational agent.

---

## Features

| Feature | Description |
|---|---|
| **Job Search** | Search LinkedIn, Indeed, BOSS 直聘, Lagou by keyword + location + job type via DuckDuckGo |
| **Company Research** | Research target company overview, culture (Glassdoor), recent news, and funding |
| **Resume Tailoring + PDF** | LLM-generated tailored resume text + weasyprint PDF export with signed download URLs |
| **JD ↔ Resume Match Scoring** | Score JD/resume match across skills/experience/domain/soft with weighted breakdown |
| **Interview Prep** | Generate interview questions + JD gap analysis based on the tailored resume |
| **Application Tracking (Kanban)** | Drag-and-drop kanban board with 5 states (pending / applied / interviewing / completed / not_a_match), per-card artifacts |
| **Plan & Execute (HITL)** | Agent self-planning with human approval gates — user can approve, revise with feedback, or cancel multi-step plans |
| **Daily Auto-Search** | Save search preferences; APScheduler cron fetches new listings into "Today's Picks" |
| **Long-Term Memory** | Cross-session memory of user skills, experience, and preferences for personalized responses |
| **Custom System Prompt** | Per-user editable system prompt with a modal UI |
| **Streaming Chat** | Real-time SSE streaming with live tool-call cards in the frontend |
| **Onboarding Tour** | First-login UI tour + seeded tutorial session with default resume (bilingual zh-CN / en) |
| **Google OAuth** | Single-click login via Google ID token verification |

---

## 🚀 Tech Stack

| Module | Tech Stack |
|---|---|
| **Backend** | ![Python](https://img.shields.io/badge/Python-3.13-3776AB?logo=python&logoColor=white) ![FastAPI](https://img.shields.io/badge/FastAPI-0.115-009688?logo=fastapi&logoColor=white) ![uvloop](https://img.shields.io/badge/uvloop-async-2C5BB4) |
| **Frontend** | ![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white) ![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black) ![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white) ![Tailwind](https://img.shields.io/badge/Tailwind-4-06B6D4?logo=tailwindcss&logoColor=white) |
| **AI Orchestration** | ![LangGraph](https://img.shields.io/badge/LangGraph-StateGraph-1C3C3C) ![LangChain](https://img.shields.io/badge/LangChain-tools-1C3C3C?logo=langchain&logoColor=white) ![HITL](https://img.shields.io/badge/HITL-interrupt-purple) |
| **LLM Models** | ![DeepSeek](https://img.shields.io/badge/DeepSeek-Chat-4D6BFE) ![Groq](https://img.shields.io/badge/Groq-Llama_3.3_70B-F55036) ![Gemini](https://img.shields.io/badge/Gemini-2.5/2.0_Flash-4285F4?logo=googlegemini&logoColor=white) |
| **Data Storage** | ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white) ![pgvector](https://img.shields.io/badge/pgvector-mem0-336791) ![SQLModel](https://img.shields.io/badge/SQLModel-asyncpg-009688) |
| **Observability** | ![Langfuse](https://img.shields.io/badge/Langfuse-Tracing-000000) ![Prometheus](https://img.shields.io/badge/Prometheus-Metrics-E6522C?logo=prometheus&logoColor=white) ![Grafana](https://img.shields.io/badge/Grafana-Dashboard-F46800?logo=grafana&logoColor=white) ![structlog](https://img.shields.io/badge/structlog-JSON-2C3E50) |
| **Auth & Security** | ![Google](https://img.shields.io/badge/Google_OAuth-2.0-4285F4?logo=google&logoColor=white) ![JWT](https://img.shields.io/badge/JWT-python--jose-000000?logo=jsonwebtokens&logoColor=white) ![slowapi](https://img.shields.io/badge/slowapi-RateLimit-009688) |
| **Resilience & Jobs** | ![tenacity](https://img.shields.io/badge/tenacity-Retry-2C5BB4) ![APScheduler](https://img.shields.io/badge/APScheduler-Cron-blue) |
| **PDF & Docs** | ![weasyprint](https://img.shields.io/badge/weasyprint-PDF-FF6F00) ![Jinja2](https://img.shields.io/badge/Jinja2-Template-B41717?logo=jinja&logoColor=white) |
| **Testing** | ![pytest](https://img.shields.io/badge/pytest-8-0A9EDC?logo=pytest&logoColor=white) ![Vitest](https://img.shields.io/badge/Vitest-RTL-6E9F18?logo=vitest&logoColor=white) ![httpx](https://img.shields.io/badge/httpx-ASGI-2C3E50) |

---

## Architecture

### System Overview

> 5-minute system-design view — top-down tiers (client → API → application → data → externals), with protocols labeled and observability on the side rail.

```mermaid
flowchart TB
    subgraph Client["Client Tier"]
        Web["Next.js 16 Frontend<br/>(Vercel)"]
    end

    subgraph API["API Tier — FastAPI"]
        MW["Middleware<br/>CORS · JWT Auth · slowapi RateLimit<br/>LoggingContext · Prometheus"]
        REST["REST Endpoints<br/>/auth · /preferences · /listings<br/>/applications · /settings · /tutorial"]
        STREAM["SSE Stream<br/>/chatbot/chat/stream<br/>/chatbot/plan-execute"]
    end

    subgraph App["Application Tier"]
        Agent["LangGraph Agent<br/>chat ⇄ tool_call ReAct loop<br/>plan-execute sub-agent (HITL interrupt)"]
        LLMSvc["LLMService<br/>circular fallback across 5 models<br/>tenacity exponential backoff"]
        Tools["15 Tools<br/>search · analysis · generation<br/>persistence · meta"]
        Sched["APScheduler<br/>daily_job_search · cron 08:00"]
    end

    subgraph Data["Data Tier"]
        PG[("PostgreSQL<br/>users · sessions · applications<br/>listings · preferences<br/>LangGraph checkpoints")]
        Vec[("pgvector<br/>mem0 long-term memory<br/>per-user semantic embeddings")]
        Files[("Resume PDF artifacts<br/>signed-URL downloads")]
    end

    subgraph Ext["External Services"]
        Google["Google OAuth<br/>ID token verification"]
        LLMs["LLM Providers<br/>DeepSeek · Groq · Gemini"]
        DDG["DuckDuckGo<br/>web search"]
    end

    subgraph Obs["Observability"]
        LF["Langfuse<br/>LLM traces + evals"]
        Prom["Prometheus + Grafana<br/>LLM / mem0 / tool metrics"]
    end

    Web -->|HTTPS| MW
    Web <-->|SSE| STREAM
    MW --> REST
    MW --> STREAM
    REST --> Agent
    STREAM --> Agent
    Agent <--> LLMSvc
    Agent --> Tools
    Tools --> PG
    Tools --> Files
    Agent <--> Vec
    LLMSvc -->|OpenAI-compatible| LLMs
    Tools --> DDG
    REST -->|verify| Google
    Sched --> Tools
    Agent -.-> LF
    MW -.-> Prom
```

<details>
<summary><b>LangGraph Agent — internal ReAct loop & tool catalog</b></summary>

```mermaid
flowchart LR
    START(["START"]) --> ChatNode

    subgraph Graph["LangGraph StateGraph"]
        ChatNode["💬 chat<br/>LLM + long-term memory<br/>apply system prompt"]
        ToolNode["🔧 tool_call<br/>dispatch + collect ToolMessages"]
        END_N(["END"])
        ChatNode -->|tool_calls| ToolNode
        ToolNode -->|results| ChatNode
        ChatNode -->|no tool_calls| END_N
    end

    subgraph Tools["15 Tools"]
        T1["🔍 Search · job / web / company"]
        T2["📊 Analysis · jd_match · gap · interview_qs"]
        T3["✉️ Generation · cover_letter · resume · pdf"]
        T4["💾 Persistence · tracker · preferences"]
        T5["🚀 Meta · start_plan_execute (HITL)"]
    end

    ToolNode --> T1 & T2 & T3 & T4 & T5

    subgraph LLMSvc["LLMService — Circular Fallback"]
        M1[deepseek-chat] --> M2[llama-3.3-70b]
        M2 --> M3[gemini-2.5-flash]
        M3 --> M4[gemini-2.0-flash]
        M4 --> M5[gemini-2.0-flash-lite]
        M5 --> M1
    end

    ChatNode <--> LLMSvc
```

</details>

---

## Quick Start

### Prerequisites

- Python 3.13+ managed by [uv](https://docs.astral.sh/uv/)
- PostgreSQL with pgvector extension (or `docker compose up db` for a ready-made pgvector/pg16 container)
- Node 22+ and pnpm 10+ for the frontend
- Docker + OrbStack (optional, for containerized setup)

### Setup

```bash
# 1. Install dependencies
uv sync

# 2. Configure environment
cp .env.example .env.development
# Edit .env.development with your keys

# 3. Run (development)
make dev
```

Open Swagger UI at `http://localhost:8000/docs`.

### Required Environment Variables

See [`.env.example`](.env.example) for the full list. Minimum to boot:

- **Database** — `POSTGRES_*` (host / port / db / user / password)
- **LLM** — at least one of `DEEPSEEK_API_KEY` / `GROQ_API_KEY` / `OPENAI_API_KEY` (Gemini via OpenAI-compatible endpoint)
- **Auth** — `GOOGLE_CLIENT_ID` + `JWT_SECRET_KEY`
- **Observability** (optional) — `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY`

### Docker

```bash
make docker-run                    # development
make docker-run-env ENV=staging    # staging
make docker-logs ENV=development
```

Monitoring: Prometheus on `:9090`, Grafana on `:3000` (admin / admin).

---

## API Reference

Full schema at `http://localhost:8000/docs` (Swagger). Key surface:

| Group | Endpoints |
|---|---|
| **Auth** | `POST /auth/google` · session CRUD on `/auth/session(s)` |
| **Chat** | `POST /chatbot/chat/stream` (SSE) · `POST /chatbot/plan-execute` (HITL) · `GET/DELETE /chatbot/messages` |
| **Job Data** | `GET/PUT /preferences` · `GET /listings` · `GET/POST/PATCH/DELETE /applications` (+ `/batch`) |
| **Resume** | `GET /resume/download/{token}` (signed PDF URL) |
| **Tutorial** | `/tutorial/status` · `/seed` · `/replay` · `/dismiss` |
| **Search** | `GET/PUT /search/config` · `POST /search/run` |
| **Settings** | `/settings/system-prompt` · `/settings/resume` · `/settings/langfuse-url` |
| **Ops** | `GET /health` · `GET /metrics` (Prometheus) |

---

## Testing & Evaluation

```bash
make test          # 49 tests (unit + integration); requires Postgres on :5432
make test-fast     # skip @pytest.mark.slow

cd frontend && pnpm test   # Vitest + RTL

make eval          # score recent Langfuse traces against evals/metrics/prompts/*.md
```

Backend uses an in-process httpx ASGI client; LLM calls mocked at the `BaseChatModel` boundary (`tests/support/fake_llm.py`). CI runs both jobs on every PR; deploy is gated on tests passing.

---

## Project Structure

```
app/
├── api/v1/         # auth · chatbot · preferences · listings · applications · resume · search · settings · tutorial
├── core/
│   ├── config · logging · metrics · middleware · limiter · scheduler · pdf_cleanup
│   ├── langgraph/  # graph.py (ReAct) · plan_execute.py (HITL) · tools/ (15 fns)
│   ├── tutorial/   # bilingual onboarding content
│   └── prompts/    # system + planner/replanner templates
├── models/         # SQLModel ORM
├── schemas/        # Pydantic I/O
├── services/       # database · llm (5-model fallback) · job · scoring · resume_pdf
└── utils/          # JWT · message helpers · sanitization

frontend/           # Next.js 16 + React 19 + Tailwind 4
tests/              # unit + integration + support/fake_llm.py
evals/              # Langfuse-based eval harness
scripts/            # migrate.py (idempotent)
grafana/ prometheus/  # observability stack configs
```

---

## License

See [LICENSE](LICENSE).
