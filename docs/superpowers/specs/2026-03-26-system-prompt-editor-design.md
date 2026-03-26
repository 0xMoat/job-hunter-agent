# System Prompt Editor — Design Spec

**Date:** 2026-03-26
**Status:** Approved

## Overview

Allow each user to view and edit their own system prompt through a settings modal in the chat UI. Changes are persisted per-user in the database. Users can reset to the developer default at any time.

## Requirements

- Each user has an independent system prompt (not shared across users).
- The UI entry point is a gear icon (⚙) in the navbar, opening a modal.
- The modal shows a live preview of the rendered prompt above a raw textarea editor.
- Three operations: save custom prompt, reset to default, cancel.
- Allowed template variables: `{agent_name}`, `{long_term_memory}`, `{current_date_and_time}`. Both `{long_term_memory}` and `{current_date_and_time}` are required. `{agent_name}` is optional (injected automatically). Any other `{variable}` token causes a 422 on save.
- "Reset to default" restores the raw content of `app/core/prompts/system.md`.
- Maximum prompt length: 10,000 characters, enforced at the Pydantic layer (DB column remains unconstrained `TEXT`).

## Data Layer

### `app/models/user.py`

Add one nullable column:

```python
system_prompt: Optional[str] = Field(default=None)
```

`None` = no customization; runtime falls back to `system.md`.

### Database Migration

`alembic/versions/<hash>_add_user_system_prompt.py`

```sql
ALTER TABLE users ADD COLUMN system_prompt TEXT;
```

### `app/services/database.py`

Add one new method:

```python
async def update_user_system_prompt(self, user_id: int, prompt: Optional[str]) -> User:
    """Set or clear a user's custom system prompt. Pass None to reset to default."""
```

All settings endpoints use this for writes; GET uses the existing `get_user(user_id)`.

## API Layer

New router: `app/api/v1/settings.py`, mounted at `/api/v1/settings`.

**Authentication: `get_current_user` (user-level accessToken)**, not `get_current_session`.

**Rate limiting:** add `"settings": ["30 per minute"]` inside the `default_endpoints` dict in `app/core/config.py` (inside the dict so the env-override loop covers it). Use `settings.RATE_LIMIT_ENDPOINTS["settings"][0]`.

All three endpoints return the same shape: `{"prompt": str, "is_default": bool}`.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/settings/system-prompt` | Returns current user's prompt. If `User.system_prompt` is `None`, reads `system.md` raw via `open()` (not `load_system_prompt()`, which requires `long_term_memory`) and returns it with `is_default: true`. |
| `PUT` | `/api/v1/settings/system-prompt` | Body: `{"prompt": str}` (max 10,000 chars). Validates: (1) `{long_term_memory}` present, (2) `{current_date_and_time}` present, (3) no unknown `{variable}` tokens (whitelist: `agent_name`, `long_term_memory`, `current_date_and_time`). Returns **422** with descriptive `detail` on any failure. On success: saves and returns `{"prompt", "is_default": false}`. |
| `DELETE` | `/api/v1/settings/system-prompt` | Sets `User.system_prompt = None` via `update_user_system_prompt`. Returns `{"prompt": <raw system.md>, "is_default": true}`. |

## Backend Prompt Loading

### `app/api/v1/chatbot.py`

Add a module-level instance:

```python
db_service = DatabaseService()
```

This is consistent with the existing `agent = LangGraphAgent()` pattern in the same file.

Before each `chat` and `chat_stream` request, fetch the user:

```python
user = await db_service.get_user(session.user_id)
custom_prompt = user.system_prompt  # None if not customized
```

This is one indexed DB round-trip per request. Accepted trade-off given simplicity; the user record is small and the lookup is by primary key.

Pass into both `get_stream_response()` and `get_response()`:

```python
await agent.get_stream_response(..., custom_system_prompt=custom_prompt)
await agent.get_response(..., custom_system_prompt=custom_prompt)
```

### `app/core/langgraph/graph.py`

Add `custom_system_prompt: Optional[str] = None` to both `get_stream_response()` and `get_response()`. Both methods forward it into `config["configurable"]`:

```python
config = {
    "configurable": {
        "thread_id": session_id,
        "user_id": user_id,
        "custom_system_prompt": custom_system_prompt,
    }
}
```

LangGraph passes `configurable` dict contents through to every node via the `RunnableConfig` second parameter, which `_chat` already receives as `config: RunnableConfig`.

In the `_chat` node:

```python
custom = config["configurable"].get("custom_system_prompt")

if custom:
    try:
        system_content = custom.format(
            agent_name=settings.PROJECT_NAME + " Agent",
            long_term_memory=state.long_term_memory,
            current_date_and_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        )
    except KeyError:
        # Unknown variable in user prompt — fall back gracefully
        logger.warning("custom_prompt_format_error_falling_back",
                       session_id=config["configurable"]["thread_id"])
        system_content = load_system_prompt(long_term_memory=state.long_term_memory)
else:
    system_content = load_system_prompt(long_term_memory=state.long_term_memory)
```

`load_system_prompt()` handles its own `str.format()` internally; the result is never formatted again.

`GraphState` schema is unchanged.

## Frontend

### Navbar — `frontend/app/chat/page.tsx`

Add `showSettings: boolean` state (default `false`). Insert a `⚙` icon button right of the language toggle. On click: `setShowSettings(true)`. Pass `accessToken={getAccessToken()}` to the modal (using `getAccessToken()` from `@/lib/auth`, already used in `SessionContext`).

### New component — `frontend/components/settings/SystemPromptModal.tsx`

```
SystemPromptModal (props: { onClose: () => void; accessToken: string })
├── Header: "系统提示词" + ✕ close button
├── Preview panel (top, read-only, scrollable)
│   ├── Renders `draft` template with variables replaced:
│   │     {long_term_memory}      → "(用户记忆)"
│   │     {current_date_and_time} → current timestamp
│   │     {agent_name}            → project name
│   └── Unrecognized {variable} tokens highlighted with warning style (e.g. amber background)
├── Textarea editor (bottom, controlled by `draft` state)
├── Inline error (below textarea, shown on 422 — displays server `detail` string)
└── Footer
    ├── Left: "重置为默认" → DELETE, replace draft with returned prompt, clear error
    └── Right: "取消" (onClose) | "保存" → PUT, close on success
```

On mount: `GET /settings/system-prompt` → set `draft` to returned `prompt`.

### API calls — `frontend/lib/api.ts`

```typescript
interface SystemPromptResponse { prompt: string; is_default: boolean }

apiGetSystemPrompt(accessToken: string): Promise<SystemPromptResponse>
apiSaveSystemPrompt(accessToken: string, prompt: string): Promise<SystemPromptResponse>
apiResetSystemPrompt(accessToken: string): Promise<SystemPromptResponse>
```

## Files Changed

| File | Change |
|------|--------|
| `app/models/user.py` | Add `system_prompt: Optional[str]` |
| `alembic/versions/<hash>_add_user_system_prompt.py` | New migration |
| `app/core/config.py` | Add `"settings": ["30 per minute"]` to `default_endpoints` |
| `app/services/database.py` | Add `update_user_system_prompt(user_id, prompt)` |
| `app/api/v1/settings.py` | New — GET / PUT / DELETE |
| `app/api/v1/api.py` | Register settings router |
| `app/api/v1/chatbot.py` | Add `db_service`; fetch user and pass `custom_system_prompt` |
| `app/core/langgraph/graph.py` | Accept `custom_system_prompt`; apply in `_chat` with KeyError fallback |
| `frontend/app/chat/page.tsx` | Add ⚙ icon + `showSettings` state |
| `frontend/components/settings/SystemPromptModal.tsx` | New modal component |
| `frontend/lib/api.ts` | Add 3 API functions |

## Out of Scope

- Prompt versioning or history.
- Per-session prompt overrides.
- Admin view of other users' prompts.
