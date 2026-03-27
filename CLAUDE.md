# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Setup
uv sync                          # Install dependencies

# Development
make dev                         # Run with hot reload (development env)
make prod                        # Run in production
make staging                     # Run in staging

# Code quality
make lint                        # ruff check .
make format                      # ruff format .

# Evaluation (LLM quality scoring via Langfuse traces)
make eval                        # Interactive mode
make eval-quick                  # Non-interactive, default settings
make eval-no-report              # Skip JSON report generation

# Docker
make docker-run                  # Start with docker-compose (development)
make docker-run-env ENV=staging  # Start for specific environment
make docker-logs ENV=development
make docker-stop ENV=development
```

Environment is controlled by `APP_ENV`. Config is loaded from `.env.<environment>` (e.g. `.env.development`). Copy `.env.example` to get started.

There are no automated tests in this repository.

## Architecture

The application is a FastAPI service wrapping a LangGraph AI agent, with three distinct top-level concerns: the API app (`app/`), the evaluation harness (`evals/`), and Docker/infra scripts (`scripts/`).

### Request flow

```
app/main.py          ← FastAPI app, wires all middleware + routes
  app/core/          ← Infrastructure: config (fan-in 14), logging (fan-in 9),
  │                     middleware, metrics (Prometheus), limiter (slowapi)
  app/api/v1/api.py  ← Router aggregator mounted at /api/v1
    auth.py          ← Registration, login, session CRUD; highest fan-out (16)
    chatbot.py       ← Chat endpoints (sync + SSE streaming) → delegates to agent
  app/core/langgraph/graph.py  ← LangGraphAgent: StateGraph with PostgreSQL
  │                               checkpointing, mem0 long-term memory, tool nodes
  app/services/      ← DatabaseService (SQLModel/asyncpg), LLMService (OpenAI +
  │                     tenacity retry + circular model fallback)
  app/models/        ← SQLModel ORM tables: User, Session, Thread, BaseModel
  app/schemas/       ← Pydantic I/O schemas: auth, chat, graph state
  app/utils/         ← JWT helpers, LangGraph message utilities, input sanitization
```

### Key design decisions

- **Environment-aware config**: `app/core/config.py:Settings` loads from the appropriate `.env.<env>` file. `APP_ENV` environment variable selects the environment. Per-environment overrides are applied in `Settings.__init__`.
- **LangGraph agent** (`app/core/langgraph/graph.py`): Uses `AsyncPostgresSaver` for conversation checkpointing (persistent across restarts), `AsyncMemory` from mem0 for semantic long-term memory per user, and LangChain tools (DuckDuckGo search). The compiled graph is cached on the `LangGraphAgent` instance.
- **LLM resilience** (`app/services/llm.py`): `LLMService` iterates through all models in `LLMRegistry` with tenacity exponential backoff. If all models fail, it raises. Tool binding is applied at the `LLMService` level.
- **Session = conversation thread**: A `Session` record (in PostgreSQL) maps to a LangGraph thread ID (UUID). The checkpointer stores graph state keyed by thread ID, enabling multi-turn resumption.
- **Streaming**: `chatbot.py` returns `StreamingResponse` via an async generator that yields SSE JSON chunks from `LangGraphAgent.astream()`. Prometheus metrics track stream duration.
- **Evaluation loop** (`evals/`): Completely standalone. Fetches unscored Langfuse traces from the last 24 hours, scores each with OpenAI structured output against metric prompts in `evals/metrics/prompts/*.md`, pushes scores back to Langfuse, and writes a JSON report.

## Code Conventions (from AGENTS.md)

**Logging** — always use `structlog`; event names must be `lowercase_with_underscores`; no f-strings in structlog events; pass variables as kwargs; use `logger.exception()` (not `logger.error()`) to preserve tracebacks.

```python
# Correct
logger.info("chat_request_received", session_id=session.id, message_count=len(messages))
# Wrong
logger.info(f"chat request received for {session.id}")
```

**Retries** — use `tenacity` with exponential backoff everywhere:
```python
@retry(stop=stop_after_attempt(3), wait=wait_exponential(multiplier=1, min=4, max=10))
```

**FastAPI routes** — all routes must have a `@limiter.limit(...)` decorator; use dependency injection for services/auth; all database operations must be async.

**Imports** — always at the top of the file, never inside functions or classes.

**Error handling** — handle errors early with guard clauses and early returns; happy path goes last; use `HTTPException` for expected API errors.

**LangGraph patterns** — define state with Pydantic models in `app/schemas/graph.py`; use `Command` for controlling node transitions; all LLM calls must have Langfuse `CallbackHandler` tracing enabled.

**Adding eval metrics** — create a new `.md` file in `evals/metrics/prompts/`. It is auto-discovered at runtime.
