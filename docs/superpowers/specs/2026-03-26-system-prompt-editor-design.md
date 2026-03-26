# System Prompt Editor — Design Spec

**Date:** 2026-03-26
**Status:** Approved

## Overview

Allow each user to view and edit their own system prompt through a settings modal in the chat UI. Changes are persisted per-user in the database. Users can reset to the developer default at any time.

## Requirements

- Each user has an independent system prompt (not shared across users).
- The UI entry point is a gear icon (⚙) in the navbar, opening a modal.
- The modal shows a live preview of the rendered prompt (template variables filled with placeholder text) above a raw textarea editor.
- Three operations: save custom prompt, reset to default, cancel.
- Template variables `{long_term_memory}` and `{current_date_and_time}` must be preserved; the API validates their presence on save.
- "Reset to default" restores the content of `app/core/prompts/system.md`.

## Data Layer

### `app/models/user.py`

Add one nullable column to the existing `User` SQLModel table:

```python
system_prompt: Optional[str] = Field(default=None)
```

`None` means no customization — the runtime falls back to `system.md`. Requires a database migration (Alembic `ALTER TABLE users ADD COLUMN system_prompt TEXT`).

## API Layer

New router: `app/api/v1/settings.py`, mounted at `/api/v1/settings`.
Authentication: `get_current_session` (session JWT), same as other endpoints.

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/settings/system-prompt` | Returns `{prompt: str, is_default: bool}`. If no custom prompt, returns `system.md` content with `is_default: true`. |
| `PUT` | `/api/v1/settings/system-prompt` | Body: `{prompt: str}`. Validates `{long_term_memory}` and `{current_date_and_time}` are present. Saves to `User.system_prompt`. |
| `DELETE` | `/api/v1/settings/system-prompt` | Sets `User.system_prompt = None`. Response: `{prompt: <system.md content>, is_default: true}`. |

Rate limiting: `30/minute` (same as preferences endpoints).

## Backend Prompt Loading

### `app/core/langgraph/graph.py`

In `get_stream_response()` and `get_response()`, before invoking the graph:

1. Load the user's `system_prompt` from DB using `user_id`.
2. Pass it into the graph via `configurable`:

```python
config = {
    "configurable": {
        "thread_id": session_id,
        "user_id": user_id,
        "custom_system_prompt": user.system_prompt,  # None = use default
    }
}
```

In the `_chat` node:

```python
custom = config["configurable"].get("custom_system_prompt")
raw_prompt = custom if custom else load_system_prompt()
system_content = raw_prompt.format(
    agent_name=...,
    long_term_memory=state.long_term_memory,
    current_date_and_time=...,
)
```

`GraphState` schema is unchanged. The custom prompt travels via `configurable`, not state.

## Frontend

### Navbar change — `frontend/app/chat/page.tsx`

Add a `showSettings` boolean state. Insert a `⚙` button to the right of the language toggle. On click: `setShowSettings(true)`.

### New component — `frontend/components/settings/SystemPromptModal.tsx`

```
SystemPromptModal (props: { onClose: () => void, accessToken: string })
├── Header: "系统提示词" title + ✕ close button
├── Preview panel (read-only, top half)
│   └── Renders draft template with {long_term_memory} → "(用户记忆)"
│       and {current_date_and_time} → current timestamp as placeholder
├── Textarea editor (bottom half)
│   └── Controlled, bound to `draft` state
├── Footer
│   ├── Left: "重置为默认" → DELETE /settings/system-prompt, replace draft with default
│   └── Right: "取消" (close) | "保存" → PUT /settings/system-prompt
```

On mount: `GET /settings/system-prompt` → populate textarea with returned prompt.

On save error (missing variables): show inline error message below textarea.

### API calls — `frontend/lib/api.ts`

```typescript
apiGetSystemPrompt(accessToken: string): Promise<{ prompt: string; is_default: boolean }>
apiSaveSystemPrompt(accessToken: string, prompt: string): Promise<{ prompt: string; is_default: boolean }>
apiResetSystemPrompt(accessToken: string): Promise<{ prompt: string; is_default: boolean }>
```

These use the user-level `accessToken` (not `sessionToken`) since system prompt is user-scoped, not session-scoped.

## Files Changed

| File | Change |
|------|--------|
| `app/models/user.py` | Add `system_prompt: Optional[str]` column |
| `app/api/v1/settings.py` | New — GET / PUT / DELETE endpoints |
| `app/api/v1/api.py` | Register settings router |
| `app/core/langgraph/graph.py` | Load user prompt from DB, pass via configurable |
| `frontend/app/chat/page.tsx` | Add ⚙ icon + modal state |
| `frontend/components/settings/SystemPromptModal.tsx` | New modal component |
| `frontend/lib/api.ts` | Add 3 API functions |

## Out of Scope

- Prompt versioning or history.
- Per-session prompt overrides.
- Syntax validation beyond variable presence check.
- Admin view of other users' prompts.
