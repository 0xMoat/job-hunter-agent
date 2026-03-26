# System Prompt Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow each user to view and edit their personal system prompt via a ⚙ modal in the chat navbar, with changes persisted per-user in the database.

**Architecture:** A new `system_prompt TEXT` column on the `users` table stores each user's custom prompt (NULL = use default). A new `/api/v1/settings/system-prompt` router (authenticated with user-level JWT) handles GET/PUT/DELETE. The LangGraph agent reads the custom prompt at request time via `configurable`, falling back to `system.md` if none is set. The frontend shows a modal with a read-only preview on top and an editable textarea below.

**Tech Stack:** Python / FastAPI / SQLModel / PostgreSQL · LangGraph · Next.js / TypeScript / Tailwind CSS

**Spec:** `docs/superpowers/specs/2026-03-26-system-prompt-editor-design.md`

---

### Task 1: Add `system_prompt` column to User model + run DB migration

**Files:**
- Modify: `app/models/user.py`

- [ ] **Step 1: Add the column to the User model**

  In `app/models/user.py`, add the import and the field so SQLModel knows about it:

  ```python
  # At top of file, ensure Optional is imported:
  from typing import Optional, TYPE_CHECKING, List

  # In the User class body, after hashed_password:
  system_prompt: Optional[str] = Field(default=None)
  ```

- [ ] **Step 2: Run the DB migration manually**

  The project uses `SQLModel.metadata.create_all()` which only creates new tables — it won't add columns to existing ones. Run this once against your Postgres database:

  ```bash
  # If running via Docker (OrbStack):
  docker exec -it <postgres-container-name> psql -U <POSTGRES_USER> -d <POSTGRES_DB> \
    -c "ALTER TABLE IF EXISTS \"user\" ADD COLUMN IF NOT EXISTS system_prompt TEXT;"

  # Or connect directly:
  psql postgresql://<user>:<pass>@localhost:<port>/<db> \
    -c "ALTER TABLE IF EXISTS \"user\" ADD COLUMN IF NOT EXISTS system_prompt TEXT;"
  ```

  Note: SQLModel defaults the table name to `"user"` (lowercase model class name). Adjust if yours differs.

- [ ] **Step 3: Verify column exists**

  ```bash
  psql postgresql://<user>:<pass>@localhost:<port>/<db> \
    -c "\d \"user\""
  ```

  Expected: `system_prompt | text | ` appears in the column listing.

- [ ] **Step 4: Commit**

  ```bash
  git add app/models/user.py
  git commit -m "feat: add system_prompt column to User model"
  ```

---

### Task 2: Add `update_user_system_prompt` to DatabaseService

**Files:**
- Modify: `app/services/database.py`

- [ ] **Step 1: Add the method**

  After `get_user_by_email` (around line 120), add:

  ```python
  async def update_user_system_prompt(self, user_id: int, prompt: Optional[str]) -> User:
      """Set or clear a user's custom system prompt.

      Args:
          user_id: The ID of the user to update.
          prompt: The new system prompt, or None to reset to default.

      Returns:
          User: The updated user.

      Raises:
          HTTPException: If the user is not found.
      """
      with Session(self.engine) as session:
          user = session.get(User, user_id)
          if not user:
              raise HTTPException(status_code=404, detail="User not found")
          user.system_prompt = prompt
          session.add(user)
          session.commit()
          session.refresh(user)
          logger.info("user_system_prompt_updated", user_id=user_id, is_custom=prompt is not None)
          return user
  ```

- [ ] **Step 2: Verify the app still starts**

  ```bash
  make dev
  ```

  Expected: no import errors, server starts on port 8000.

- [ ] **Step 3: Commit**

  ```bash
  git add app/services/database.py
  git commit -m "feat: add update_user_system_prompt to DatabaseService"
  ```

---

### Task 3: Add rate-limit config entry + create settings API router

**Files:**
- Modify: `app/core/config.py`
- Create: `app/api/v1/settings.py`
- Modify: `app/api/v1/api.py`

- [ ] **Step 1: Add rate-limit key to config**

  In `app/core/config.py`, inside the `default_endpoints` dict (around line 186–194), add one entry:

  ```python
  default_endpoints = {
      "chat": ["30 per minute"],
      "chat_stream": ["20 per minute"],
      "messages": ["50 per minute"],
      "register": ["10 per hour"],
      "login": ["20 per minute"],
      "root": ["10 per minute"],
      "health": ["20 per minute"],
      "settings": ["30 per minute"],   # ← add this line
  }
  ```

- [ ] **Step 2: Create the settings router**

  Create `app/api/v1/settings.py`:

  ```python
  """User settings endpoints — system prompt management."""

  import os
  import re
  from typing import Optional

  from fastapi import APIRouter, Depends, HTTPException, Request
  from pydantic import BaseModel, Field

  from app.api.v1.auth import get_current_user
  from app.core.config import settings
  from app.core.limiter import limiter
  from app.core.logging import logger
  from app.models.user import User
  from app.services.database import DatabaseService

  router = APIRouter()
  db_service = DatabaseService()

  _SYSTEM_MD_PATH = os.path.join(
      os.path.dirname(__file__), "..", "..", "core", "prompts", "system.md"
  )
  _ALLOWED_VARS = {"agent_name", "long_term_memory", "current_date_and_time"}
  _REQUIRED_VARS = {"long_term_memory", "current_date_and_time"}


  def _read_default_prompt() -> str:
      """Read system.md raw (no formatting)."""
      with open(_SYSTEM_MD_PATH, "r") as f:
          return f.read()


  def _validate_prompt(prompt: str) -> Optional[str]:
      """Return an error string if prompt is invalid, else None."""
      found = set(re.findall(r"\{(\w+)\}", prompt))
      missing = _REQUIRED_VARS - found
      if missing:
          return f"Missing required variable(s): {', '.join('{' + v + '}' for v in sorted(missing))}"
      unknown = found - _ALLOWED_VARS
      if unknown:
          return f"Unknown variable(s): {', '.join('{' + v + '}' for v in sorted(unknown))}. Allowed: {', '.join('{' + v + '}' for v in sorted(_ALLOWED_VARS))}"
      return None


  class SystemPromptRequest(BaseModel):
      prompt: str = Field(..., max_length=10000)


  class SystemPromptResponse(BaseModel):
      prompt: str
      is_default: bool


  @router.get("/system-prompt", response_model=SystemPromptResponse)
  @limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
  async def get_system_prompt(
      request: Request,
      user: User = Depends(get_current_user),
  ):
      """Get the current user's system prompt."""
      if user.system_prompt:
          return SystemPromptResponse(prompt=user.system_prompt, is_default=False)
      return SystemPromptResponse(prompt=_read_default_prompt(), is_default=True)


  @router.put("/system-prompt", response_model=SystemPromptResponse)
  @limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
  async def save_system_prompt(
      request: Request,
      body: SystemPromptRequest,
      user: User = Depends(get_current_user),
  ):
      """Save a custom system prompt for the current user."""
      error = _validate_prompt(body.prompt)
      if error:
          raise HTTPException(status_code=422, detail=error)
      updated = await db_service.update_user_system_prompt(user.id, body.prompt)
      logger.info("system_prompt_saved", user_id=user.id)
      return SystemPromptResponse(prompt=updated.system_prompt, is_default=False)


  @router.delete("/system-prompt", response_model=SystemPromptResponse)
  @limiter.limit(settings.RATE_LIMIT_ENDPOINTS["settings"][0])
  async def reset_system_prompt(
      request: Request,
      user: User = Depends(get_current_user),
  ):
      """Reset the current user's system prompt to the default."""
      await db_service.update_user_system_prompt(user.id, None)
      logger.info("system_prompt_reset", user_id=user.id)
      return SystemPromptResponse(prompt=_read_default_prompt(), is_default=True)
  ```

- [ ] **Step 3: Register the router in `app/api/v1/api.py`**

  ```python
  from app.api.v1.settings import router as settings_router
  # ...
  api_router.include_router(settings_router, prefix="/settings", tags=["settings"])
  ```

- [ ] **Step 4: Smoke-test the endpoints**

  ```bash
  make dev
  # In another terminal — replace <ACCESS_TOKEN> with a real token from login:
  curl -s http://localhost:8000/api/v1/settings/system-prompt \
    -H "Authorization: Bearer <ACCESS_TOKEN>" | python3 -m json.tool
  ```

  Expected: `{"prompt": "...", "is_default": true}` — the raw `system.md` content.

- [ ] **Step 5: Commit**

  ```bash
  git add app/core/config.py app/api/v1/settings.py app/api/v1/api.py
  git commit -m "feat: add settings API router with system prompt GET/PUT/DELETE"
  ```

---

### Task 4: Thread custom prompt into the LangGraph agent

**Files:**
- Modify: `app/api/v1/chatbot.py`
- Modify: `app/core/langgraph/graph.py`

- [ ] **Step 1: Add `db_service` to `chatbot.py` and fetch user on each request**

  In `app/api/v1/chatbot.py`, add imports and the module-level instance:

  ```python
  from app.services.database import DatabaseService
  # after `agent = LangGraphAgent()`:
  db_service = DatabaseService()
  ```

  In the `chat` handler, add before `agent.get_response(...)`:

  ```python
  user = await db_service.get_user(session.user_id)
  custom_prompt = user.system_prompt if user else None
  ```

  Update the `agent.get_response(...)` call:

  ```python
  result = await agent.get_response(
      chat_request.messages, session.id,
      user_id=session.user_id,
      custom_system_prompt=custom_prompt,
  )
  ```

  In the `chat_stream` handler, do the same before `agent.get_stream_response(...)`:

  ```python
  user = await db_service.get_user(session.user_id)
  custom_prompt = user.system_prompt if user else None
  # ...
  async for chunk in agent.get_stream_response(
      chat_request.messages, session.id,
      user_id=session.user_id,
      custom_system_prompt=custom_prompt,
  ):
  ```

- [ ] **Step 2: Add `custom_system_prompt` parameter to `graph.py`**

  In `app/core/langgraph/graph.py`, update `get_response` signature:

  ```python
  async def get_response(
      self,
      messages: list[Message],
      session_id: str,
      user_id: Optional[str] = None,
      custom_system_prompt: Optional[str] = None,
  ) -> list[dict]:
  ```

  Add to its `config` dict:

  ```python
  config = {
      "configurable": {
          "thread_id": session_id,
          "user_id": user_id,
          "custom_system_prompt": custom_system_prompt,
      },
      ...
  }
  ```

  Do the same for `get_stream_response`:

  ```python
  async def get_stream_response(
      self,
      messages: list[Message],
      session_id: str,
      user_id: Optional[str] = None,
      custom_system_prompt: Optional[str] = None,
  ) -> AsyncGenerator[str, None]:
  ```

  Add `"custom_system_prompt": custom_system_prompt` to its `config["configurable"]` dict.

- [ ] **Step 3: Apply custom prompt in the `_chat` node**

  In the `_chat` method, replace the line:

  ```python
  SYSTEM_PROMPT = load_system_prompt(long_term_memory=state.long_term_memory)
  ```

  with:

  ```python
  custom = config["configurable"].get("custom_system_prompt")
  if custom:
      try:
          from datetime import datetime
          SYSTEM_PROMPT = custom.format(
              agent_name=settings.PROJECT_NAME + " Agent",
              long_term_memory=state.long_term_memory,
              current_date_and_time=datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
          )
      except KeyError:
          logger.warning(
              "custom_prompt_format_error_falling_back",
              session_id=config["configurable"]["thread_id"],
          )
          SYSTEM_PROMPT = load_system_prompt(long_term_memory=state.long_term_memory)
  else:
      SYSTEM_PROMPT = load_system_prompt(long_term_memory=state.long_term_memory)
  ```

- [ ] **Step 4: Verify chat still works end-to-end**

  ```bash
  make dev
  # Send a chat message with a session token — confirm normal response still comes through.
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add app/api/v1/chatbot.py app/core/langgraph/graph.py
  git commit -m "feat: thread custom_system_prompt through LangGraph agent"
  ```

---

### Task 5: Add frontend API functions

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add types and functions**

  Append to `frontend/lib/api.ts`:

  ```typescript
  // ── Settings ──────────────────────────────────────────────────────────────

  export interface SystemPromptResponse {
    prompt: string
    is_default: boolean
  }

  export async function apiGetSystemPrompt(
    accessToken: string,
  ): Promise<SystemPromptResponse> {
    const res = await req("/api/v1/settings/system-prompt", {}, accessToken)
    return res.json()
  }

  export async function apiSaveSystemPrompt(
    accessToken: string,
    prompt: string,
  ): Promise<SystemPromptResponse> {
    const res = await req(
      "/api/v1/settings/system-prompt",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      },
      accessToken,
    )
    return res.json()
  }

  export async function apiResetSystemPrompt(
    accessToken: string,
  ): Promise<SystemPromptResponse> {
    const res = await req(
      "/api/v1/settings/system-prompt",
      { method: "DELETE" },
      accessToken,
    )
    return res.json()
  }
  ```

  Note: the existing `req()` helper throws on non-ok responses, so callers get an `Error` with the server's body as message — the modal will use `error.message` to show 422 details.

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/lib/api.ts
  git commit -m "feat: add system prompt API functions to frontend"
  ```

---

### Task 6: Build the SystemPromptModal component

**Files:**
- Create: `frontend/components/settings/SystemPromptModal.tsx`

- [ ] **Step 1: Create the component**

  Create `frontend/components/settings/SystemPromptModal.tsx`:

  ```tsx
  "use client"

  import { useEffect, useState } from "react"
  import {
    apiGetSystemPrompt,
    apiSaveSystemPrompt,
    apiResetSystemPrompt,
  } from "@/lib/api"
  import { useLanguage } from "@/contexts/LanguageContext"

  const ALLOWED_VARS = new Set(["agent_name", "long_term_memory", "current_date_and_time"])

  const PREVIEW_VALUES: Record<string, string> = {
    agent_name: "Job Hunter Agent",
    long_term_memory: "(用户记忆)",
    current_date_and_time: new Date().toLocaleString(),
  }

  /** Replace known vars with preview values; highlight unknown vars in amber. */
  function renderPreview(template: string): string {
    return template.replace(/\{(\w+)\}/g, (match, varName) => {
      if (varName in PREVIEW_VALUES) return PREVIEW_VALUES[varName]
      return `<mark style="background:#fef3c7;color:#92400e;border-radius:2px;padding:0 2px">${match}</mark>`
    })
  }

  interface Props {
    onClose: () => void
    accessToken: string
  }

  export function SystemPromptModal({ onClose, accessToken }: Props) {
    const { t } = useLanguage()
    const [draft, setDraft] = useState("")
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
      apiGetSystemPrompt(accessToken)
        .then((res) => setDraft(res.prompt))
        .catch(() => setError("Failed to load system prompt"))
        .finally(() => setLoading(false))
    }, [accessToken])

    async function handleSave() {
      setSaving(true)
      setError(null)
      try {
        await apiSaveSystemPrompt(accessToken, draft)
        onClose()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Save failed")
      } finally {
        setSaving(false)
      }
    }

    async function handleReset() {
      setSaving(true)
      setError(null)
      try {
        const res = await apiResetSystemPrompt(accessToken)
        setDraft(res.prompt)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Reset failed")
      } finally {
        setSaving(false)
      }
    }

    return (
      /* Backdrop */
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <div className="glass-strong rounded-3xl w-full max-w-2xl mx-4 flex flex-col overflow-hidden shadow-2xl"
             style={{ maxHeight: "80vh" }}>

          {/* Header */}
          <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between flex-shrink-0">
            <h2 className="font-heading italic text-lg tracking-tight text-[var(--text)]">
              系统提示词
            </h2>
            <button
              onClick={onClose}
              className="text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors text-xl leading-none"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center py-12">
              <span className="text-[var(--text-3)] text-sm font-body">加载中…</span>
            </div>
          ) : (
            <div className="flex flex-col flex-1 overflow-hidden">

              {/* Preview */}
              <div className="flex-1 overflow-hidden flex flex-col border-b border-[var(--border)]">
                <div className="px-4 py-1.5 text-[9px] font-body font-bold tracking-widest uppercase text-[var(--text-3)] bg-black/[0.02] flex-shrink-0">
                  预览（运行时效果）
                </div>
                <pre
                  className="flex-1 overflow-y-auto px-4 py-3 font-mono text-[11px] leading-relaxed text-[var(--text)] whitespace-pre-wrap break-words"
                  dangerouslySetInnerHTML={{ __html: renderPreview(draft) }}
                />
              </div>

              {/* Editor */}
              <div className="flex-1 overflow-hidden flex flex-col">
                <div className="px-4 py-1.5 text-[9px] font-body font-bold tracking-widest uppercase text-[var(--text-3)] bg-black/[0.02] flex-shrink-0">
                  编辑模板
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => { setDraft(e.target.value); setError(null) }}
                  className="flex-1 resize-none px-4 py-3 font-mono text-[11px] leading-relaxed
                             text-[var(--text)] bg-transparent outline-none overflow-y-auto"
                  spellCheck={false}
                />
              </div>

              {/* Inline error */}
              {error && (
                <div className="px-4 py-2 text-xs font-body text-red-600 bg-red-50 border-t border-red-100">
                  ⚠ {error}
                </div>
              )}

              {/* Footer */}
              <div className="px-4 py-3 border-t border-[var(--border)] flex items-center justify-between flex-shrink-0">
                <button
                  onClick={handleReset}
                  disabled={saving}
                  className="text-xs font-body text-[var(--text-3)] hover:text-[var(--text-2)]
                             px-3 py-1.5 rounded-full hover:bg-black/5 transition-colors disabled:opacity-50"
                >
                  重置为默认
                </button>
                <div className="flex gap-2">
                  <button
                    onClick={onClose}
                    className="text-xs font-body text-[var(--text-3)] hover:text-[var(--text-2)]
                               px-3 py-1.5 rounded-full hover:bg-black/5 transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="text-xs font-body font-medium px-4 py-1.5 rounded-full
                               bg-[var(--accent)] text-[var(--accent-fg)] hover:opacity-90
                               transition-opacity disabled:opacity-50"
                  >
                    {saving ? "保存中…" : "保存"}
                  </button>
                </div>
              </div>

            </div>
          )}
        </div>
      </div>
    )
  }
  ```

- [ ] **Step 2: Commit**

  ```bash
  git add frontend/components/settings/SystemPromptModal.tsx
  git commit -m "feat: add SystemPromptModal component"
  ```

---

### Task 7: Wire the modal into the navbar

**Files:**
- Modify: `frontend/app/chat/page.tsx`

- [ ] **Step 1: Import and add state**

  In `frontend/app/chat/page.tsx`:

  1. Add the modal import:
     ```tsx
     import { SystemPromptModal } from "@/components/settings/SystemPromptModal"
     ```

  2. Extend the **existing** `@/lib/auth` import line (do NOT add a new import line — it already imports `isAuthenticated` and `clearAuth`):
     ```tsx
     import { isAuthenticated, clearAuth, getAccessToken } from "@/lib/auth"
     ```

  Inside `ChatPageInner`, add state:

  ```tsx
  const [showSettings, setShowSettings] = useState(false)
  ```

- [ ] **Step 2: Add the ⚙ button to the navbar**

  In the navbar's right-side `<div className="flex items-center gap-1">`, add the gear button before the language toggle:

  ```tsx
  <button
    onClick={() => setShowSettings(true)}
    aria-label="系统提示词设置"
    className="text-xs font-body font-medium text-[var(--text-3)]
               hover:text-[var(--text-2)] px-3 py-1.5 rounded-full
               hover:bg-black/5 transition-colors"
  >
    ⚙
  </button>
  ```

- [ ] **Step 3: Render the modal**

  At the bottom of the returned JSX (inside the outermost `<div>`), add:

  ```tsx
  {showSettings && (
    <SystemPromptModal
      onClose={() => setShowSettings(false)}
      accessToken={getAccessToken() ?? ""}
    />
  )}
  ```

- [ ] **Step 4: Verify end-to-end in browser**

  1. Start frontend: `cd frontend && pnpm dev`
  2. Log in — confirm ⚙ icon appears in navbar.
  3. Click ⚙ — modal opens, preview and textarea both show current `system.md` content.
  4. Edit the textarea, click **保存** — API call succeeds, modal closes.
  5. Re-open modal — textarea shows the saved custom prompt.
  6. Click **重置为默认** — textarea reverts to `system.md` content.
  7. Send a chat message — confirm the agent uses the custom prompt (check backend logs for `custom_prompt_format_error_falling_back` absence).

- [ ] **Step 5: Commit**

  ```bash
  git add frontend/app/chat/page.tsx
  git commit -m "feat: add system prompt editor modal to chat navbar"
  ```
