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
- `POST /api/v1/auth/session` — create a new session (requires user JWT)
- `PATCH /api/v1/auth/session/{session_id}/name` — rename a session (requires **session JWT** for that session; sends `name` as `application/x-www-form-urlencoded`, not JSON)
- `GET /api/v1/chatbot/messages` — get full message history for a session (requires session JWT)

---

## Architecture

### SessionContext

New `contexts/SessionContext.tsx` — the single source of truth for session state.

```ts
interface SessionItem {
  session_id: string
  name: string
  token: {
    access_token: string
    token_type: string
    expires_at: string   // ISO datetime string
  }
}

interface SessionContextValue {
  sessions: SessionItem[]
  currentSessionId: string | null
  currentSessionToken: string | null   // the session JWT to use for chat API calls
  switchSession: (id: string) => void  // clears messages, updates token, triggers history load
  createSession: () => Promise<void>   // creates new session AND switches to it
  loading: boolean                     // true during initial sessions fetch and createSession
  renameSession: (id: string, name: string) => void  // optimistic update in sessions list
}
```

Initialization:
1. On mount, fetch `GET /sessions` using `jh_access_token`
2. Identify the current session using `jh_session_id` from localStorage (see Storage Strategy). Find the matching item in the sessions list to set `currentSessionId` and `currentSessionToken`.
3. Expose `switchSession` and `createSession` to children

`createSession()` behavior:
1. Call `POST /session` with user JWT
2. Add new session to the top of `sessions` list
3. Automatically switch to the new session (set `currentSessionToken`, update `jh_session_token`)

### useChat Changes

`useChat` is updated to accept `sessionToken: string | null` as a parameter (replacing internal `getSessionToken()` calls).

- **All** uses of the session token inside `sendMessage` and history loading must use the `sessionToken` prop — never call `getSessionToken()` from localStorage inside the hook
- When `sessionToken` changes (session switch), clear `messages` state immediately to avoid stale flash, then call `GET /messages` to load history
- History response is `ChatResponse { messages: Array<{ role: string, content: string }> }`. Map to `ChatMessage[]`:
  - Filter out messages with `role === "system"`
  - For each remaining message: `id = makeId()`, `role = msg.role`, `textContent = msg.content`, `toolCalls = []`, `timestamp = undefined`
- On first user message send, check if auto-naming is needed: `session.name === ""` (backend default is empty string per `Session` model). If yes, fire background `PATCH /session/:id/name` — see API notes below — then call `context.renameSession(id, name)` to update the sidebar optimistically
- All other logic (streaming, tool calls) remains unchanged

### SessionSidebar Component

New `components/chat/SessionSidebar.tsx`.

- Collapsible: default expanded (220px), collapsed to 0 with a visible toggle button (‹ / ›)
- Header: "＋ 新建对话" / "+ New Chat" button (use i18n keys `sidebar_new_chat`)
- Session list: each item shows name + relative date ("今天"/"Today", "昨天"/"Yesterday", or `MM/DD`)
- Active session highlighted with accent background
- While streaming, session items are non-interactive (`pointer-events: none`, reduced opacity)
- Empty state text: i18n key `sidebar_empty`

**New i18n keys required** (add to both `zh-CN` and `en` locales in `LanguageContext.tsx`):

| Key | zh-CN | en |
|-----|-------|----|
| `sidebar_new_chat` | ＋ 新建对话 | + New Chat |
| `sidebar_empty` | 还没有对话记录 | No conversations yet |
| `sidebar_today` | 今天 | Today |
| `sidebar_yesterday` | 昨天 | Yesterday |

---

## File Changes

| File | Change |
|------|--------|
| `contexts/SessionContext.tsx` | **New** — session list, current token, switch/create/rename actions |
| `components/chat/SessionSidebar.tsx` | **New** — collapsible sidebar UI |
| `hooks/useChat.ts` | **Modified** — accept `sessionToken: string \| null` param, load history on mount/switch, auto-name |
| `components/chat/ChatPanel.tsx` | **Modified** — read `sessionToken` from `SessionContext`, pass into `useChat(sessionToken)` |
| `lib/api.ts` | **Modified** — add `apiGetSessions`, `apiGetMessages`, `apiUpdateSessionName` |
| `contexts/LanguageContext.tsx` | **Modified** — add 4 new i18n keys |
| `lib/auth.ts` | **Modified** — add `jh_session_id` helpers (see Storage Strategy) |
| `app/chat/page.tsx` | **Modified** — wrap with `SessionContext.Provider`, add `SessionSidebar` |
| `app/login/page.tsx` | **Modified** — call `setSessionId(session.session_id)` after `apiCreateSession` |

---

## API Implementation Notes

### `apiGetSessions(accessToken: string): Promise<SessionItem[]>`
- `GET /api/v1/auth/sessions` with user JWT
- Returns `SessionResponse[]` from the backend; `SessionItem` is the frontend representation of `SessionResponse` — the shapes are identical (`session_id`, `name`, `token`). Cast/return directly as `SessionItem[]`.

### `apiGetMessages(sessionToken: string): Promise<Array<{ role: string; content: string }>>`
- `GET /api/v1/chatbot/messages` with session JWT
- Returns `ChatResponse { messages: [...] }`; caller should access `.messages`

### `apiUpdateSessionName(sessionToken: string, sessionId: string, name: string): Promise<void>`
- `PATCH /api/v1/auth/session/{sessionId}/name`
- **Authorization**: `Bearer <sessionToken>` (session JWT — NOT user JWT)
- **Content-Type**: `application/x-www-form-urlencoded` (same pattern as `apiLogin`)
- Body: `name=<encoded_name>` (URLSearchParams)
- The `sessionId` in the path and the session encoded in `sessionToken` must match

---

## Data Flow

### Session Switch

```
User clicks session in sidebar
  → SessionContext.switchSession(id)
  → messages cleared immediately (prevents stale flash)
  → currentSessionToken updated (from sessions list)
  → localStorage jh_session_token updated
  → useChat detects sessionToken change (useEffect dependency)
  → calls GET /messages with new session token
  → maps response to ChatMessage[], sets messages state
  → ChatInput enabled, user can continue
```

### Auto-Naming

```
User sends first message in a session with name === ""
  → sendMessage() fires as normal (streaming proceeds)
  → After user message appended to state:
      name = userText.trim().slice(0, 30)
      fire PATCH /session/:id/name (background, no await, uses sessionToken prop)
      context.renameSession(currentSessionId, name)  ← optimistic update in sidebar
```

### New Session Creation (from sidebar)

```
User clicks "+ 新建对话"
  → SessionContext.createSession()
  → POST /session with jh_access_token
  → new SessionItem prepended to sessions list
  → switchSession(newSession.session_id) called automatically
  → ChatPanel shows empty state, ready for input
```

### Login Flow (minor change: store session ID)

```
Login/Register
  → apiCreateSession(accessToken)
  → setSessionToken(session.token.access_token)
  → setSessionId(session.session_id)      ← new
  → redirect to /chat
  → SessionContext mounts, fetches session list
  → matches jh_session_id to find current session
  → new session found at top of sidebar
```

---

## Edge Cases

| Scenario | Handling |
|----------|----------|
| History load fails | Show inline error in chat area; messages remain empty |
| Switch while streaming | Sidebar items disabled (pointer-events: none) during streaming |
| Empty sessions list | Sidebar shows `sidebar_empty` i18n string |
| First login (no history) | GET /messages returns empty array; normal empty state in ChatPanel |
| Session token expired (401 on GET /messages) | Clear auth, redirect to /login |
| Auto-name: session already named | Skip — check `session.name === ""` (backend default is empty string) |
| Auto-name: background PATCH fails | Silently ignored; sidebar retains optimistic name; next message won't retry (non-critical) |
| `createSession` fails | Show error; current session unchanged |

---

## Storage Strategy

- `jh_access_token` — user-level JWT, used for session list and session creation
- `jh_session_token` — current active session JWT, updated on switch or new session creation
- `jh_session_id` — **new** plain string key storing the current session's ID (e.g. UUID). Used by `SessionContext` on mount to match the current session against the fetched sessions list without needing to decode the JWT. Updated together with `jh_session_token` on every switch or new session creation. Add `getSessionId()` / `setSessionId()` helpers to `lib/auth.ts`, and clear it in `clearAuth()`.
- Session list is not persisted to localStorage; re-fetched on every chat page mount

---

## Out of Scope

- Session deletion UI (backend supports it, not exposed in this iteration)
- Manual session renaming UI (backend supports it, auto-naming covers the primary need)
- Search/filter sessions
- Session export
