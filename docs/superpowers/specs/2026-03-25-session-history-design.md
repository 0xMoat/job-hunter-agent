# Session History: Complete Save, View, and Continue

**Date:** 2026-03-25
**Status:** Approved

---

## Overview

Add a collapsible left sidebar to the chat page that lists all past conversations. Users can switch between sessions to view full history and continue any conversation. Session names are automatically derived from the first user message.

---

## Background

The backend already persists all messages via LangGraph's PostgreSQL checkpointer. Session management APIs (list, create, delete, rename) are fully implemented. This is a **frontend-only** feature.

Relevant backend APIs:
- `GET /api/v1/auth/sessions` — list all sessions for the authenticated user (requires user JWT)
- `POST /api/v1/auth/session` — create a new session
- `PATCH /api/v1/auth/session/{session_id}/name` — rename a session
- `GET /api/v1/chatbot/messages` — get full message history for a session (requires session JWT)

---

## Architecture

### SessionContext

New `contexts/SessionContext.tsx` — the single source of truth for session state.

```ts
interface SessionItem {
  session_id: string
  name: string
  token: { access_token: string }
}

interface SessionContextValue {
  sessions: SessionItem[]
  currentSessionId: string | null
  currentSessionToken: string | null
  switchSession: (id: string) => void
  createSession: () => Promise<void>
  loading: boolean
}
```

Initialization:
1. On mount, fetch `GET /sessions` using `jh_access_token`
2. Set the current session to the most recently used session (stored in `jh_session_token`)
3. Expose `switchSession` and `createSession` to children

### useChat Changes

`useChat` is updated to accept `sessionToken: string | null` as a parameter.

- When `sessionToken` changes (session switch), call `GET /messages` to load history
- On first user message send, fire a background `PATCH /session/:id/name` with the first 30 characters of the message
- All other logic (streaming, tool calls) remains unchanged

### SessionSidebar Component

New `components/chat/SessionSidebar.tsx`.

- Collapsible: default expanded (220px), collapsed to 0 with a visible toggle button
- Header: "＋ 新建对话" button
- Session list: each item shows name + relative date ("今天", "昨天", or `MM/DD`)
- Active session highlighted with accent background
- While streaming, session items are non-interactive (pointer-events: none)

---

## File Changes

| File | Change |
|------|--------|
| `contexts/SessionContext.tsx` | **New** — session list, current token, switch/create actions |
| `components/chat/SessionSidebar.tsx` | **New** — collapsible sidebar UI |
| `hooks/useChat.ts` | **Modified** — accept sessionToken param, load history on mount/switch, auto-name |
| `lib/api.ts` | **Modified** — add `apiGetSessions`, `apiGetMessages`, `apiUpdateSessionName` |
| `lib/auth.ts` | No change (already stores access token and session token) |
| `app/chat/page.tsx` | **Modified** — wrap with `SessionContext.Provider`, add `SessionSidebar` |
| `app/login/page.tsx` | No change |

---

## Data Flow

### Session Switch

```
User clicks session in sidebar
  → SessionContext.switchSession(id)
  → currentSessionToken updated (from sessions list)
  → localStorage jh_session_token updated
  → useChat detects sessionToken change
  → calls GET /messages with new session token
  → messages state populated with history
  → ChatInput enabled, user can continue
```

### Auto-Naming

```
User sends first message
  → sendMessage() fires as normal
  → After message appended to state, check: is this session name still a default?
  → If yes: PATCH /session/:id/name with message.slice(0, 30) (background, no await)
  → sessions list in context updated optimistically
```

### Login Flow (unchanged)

```
Login/Register
  → apiCreateSession(accessToken)
  → setSessionToken(session.token.access_token)
  → redirect to /chat
  → SessionContext loads session list on mount
  → new session appears at top of sidebar
```

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| History load fails | Show inline error in chat area; messages remain empty |
| Switch while streaming | Sidebar items disabled (pointer-events: none) during streaming |
| Empty sessions list | Sidebar shows empty state: "还没有对话记录" |
| First login (no history) | Normal empty state in ChatPanel |
| Session token expired (401 on GET /messages) | Clear auth, redirect to /login |
| Session name already customized | Auto-name skipped (check if name matches default pattern `Session YYYY-MM-DD`) |

---

## Storage Strategy

- `jh_access_token` — user-level JWT, used for session list and session creation
- `jh_session_token` — current active session JWT, updated on switch
- Session list is not persisted to localStorage; re-fetched on every chat page mount

---

## Out of Scope

- Session deletion UI (backend supports it, not exposed in this iteration)
- Manual session renaming UI (backend supports it, auto-naming covers the primary need)
- Search/filter sessions
- Session export
