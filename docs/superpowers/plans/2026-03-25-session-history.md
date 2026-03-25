# Session History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a collapsible left sidebar listing all past conversations, with the ability to switch sessions, view full history, and continue any conversation.

**Architecture:** A new `SessionContext` holds the session list and current active session token. `useChat` is refactored to accept `sessionToken` as a prop and loads history on mount/switch. A new `SessionSidebar` component renders the collapsible panel.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind CSS, FastAPI backend (already deployed)

**Note:** This repo has no automated tests. Each task includes a manual verification step instead.

---

## File Map

| File | Status | Responsibility |
|------|--------|----------------|
| `frontend/lib/auth.ts` | Modify | Add `jh_session_id` localStorage helpers |
| `frontend/lib/api.ts` | Modify | Add `apiGetSessions`, `apiGetMessages`, `apiUpdateSessionName` |
| `frontend/lib/i18n.ts` | Modify | Add 4 sidebar i18n keys (zh-CN + en) |
| `frontend/contexts/SessionContext.tsx` | Create | Session list state, switch/create/rename actions |
| `frontend/hooks/useChat.ts` | Modify | Accept `sessionToken` param, load history, auto-name |
| `frontend/components/chat/ChatPanel.tsx` | Modify | Read `sessionToken` from SessionContext, pass to useChat |
| `frontend/components/chat/SessionSidebar.tsx` | Create | Collapsible sidebar UI |
| `frontend/app/chat/page.tsx` | Modify | Wrap with `SessionProvider`, add `SessionSidebar` |
| `frontend/app/login/page.tsx` | Modify | Store `session_id` to localStorage after session creation |

---

## Task 1: Extend auth helpers with session ID storage

**Files:**
- Modify: `frontend/lib/auth.ts`

- [ ] **Step 1: Add `jh_session_id` key and helpers**

  Open `frontend/lib/auth.ts` and add after the existing `SESSION_TOKEN_KEY` constant:

  ```ts
  const SESSION_ID_KEY = "jh_session_id"

  export function getSessionId(): string | null {
    if (typeof window === "undefined") return null
    return localStorage.getItem(SESSION_ID_KEY)
  }

  export function setSessionId(id: string): void {
    localStorage.setItem(SESSION_ID_KEY, id)
  }
  ```

  Also update `clearAuth()` to remove the new key:

  ```ts
  export function clearAuth(): void {
    localStorage.removeItem(ACCESS_TOKEN_KEY)
    localStorage.removeItem(SESSION_TOKEN_KEY)
    localStorage.removeItem(SESSION_ID_KEY)
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd frontend && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/lib/auth.ts
  git commit -m "feat: add jh_session_id localStorage helpers to auth"
  ```

---

## Task 2: Add API functions for session list, message history, and rename

**Files:**
- Modify: `frontend/lib/api.ts`

- [ ] **Step 1: Add `SessionItem` type and three new API functions**

  At the top of `frontend/lib/api.ts`, after the existing imports, add the `SessionItem` type:

  ```ts
  export interface SessionItem {
    session_id: string
    name: string
    token: {
      access_token: string
      token_type: string
      expires_at: string
    }
  }
  ```

  Then add three new functions at the end of the file (after the listings section):

  ```ts
  // ── Sessions ──────────────────────────────────────────────────────────────

  export async function apiGetSessions(
    accessToken: string,
  ): Promise<SessionItem[]> {
    const res = await req("/api/v1/auth/sessions", {}, accessToken)
    return res.json()
  }

  export async function apiGetMessages(
    sessionToken: string,
  ): Promise<Array<{ role: string; content: string }>> {
    const res = await req("/api/v1/chatbot/messages", {}, sessionToken)
    const data = await res.json()
    return data.messages
  }

  // IMPORTANT: name must be sent as application/x-www-form-urlencoded, NOT JSON.
  // Authorization uses the session JWT (not user JWT).
  // The sessionId in the path must match the session encoded in sessionToken.
  export async function apiUpdateSessionName(
    sessionToken: string,
    sessionId: string,
    name: string,
  ): Promise<void> {
    const form = new URLSearchParams()
    form.set("name", name)
    await req(
      `/api/v1/auth/session/${sessionId}/name`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form.toString(),
      },
      sessionToken,
    )
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd frontend && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/lib/api.ts
  git commit -m "feat: add apiGetSessions, apiGetMessages, apiUpdateSessionName"
  ```

---

## Task 3: Add i18n keys for sidebar strings

**Files:**
- Modify: `frontend/lib/i18n.ts`

- [ ] **Step 1: Add sidebar keys to both `zh` and `en` dicts**

  Open `frontend/lib/i18n.ts`. In the `zh` dict, after the `// Login` section, add:

  ```ts
  // Sidebar
  sidebar_new_chat: '＋ 新建对话',
  sidebar_empty: '还没有对话记录',
  sidebar_today: '今天',
  sidebar_yesterday: '昨天',
  ```

  In the same file, in the `en` dict, after the `// Login` section, add:

  ```ts
  // Sidebar
  sidebar_new_chat: '+ New Chat',
  sidebar_empty: 'No conversations yet',
  sidebar_today: 'Today',
  sidebar_yesterday: 'Yesterday',
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd frontend && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/lib/i18n.ts
  git commit -m "feat: add sidebar i18n keys (zh-CN + en)"
  ```

---

## Task 4: Create SessionContext

**Files:**
- Create: `frontend/contexts/SessionContext.tsx`

- [ ] **Step 1: Create the file**

  Create `frontend/contexts/SessionContext.tsx` with the following content:

  ```tsx
  "use client"

  import {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useState,
  } from "react"
  import { apiCreateSession, apiGetSessions, type SessionItem } from "@/lib/api"
  import {
    getAccessToken,
    getSessionId,
    setSessionId,
    setSessionToken,
  } from "@/lib/auth"

  interface SessionContextValue {
    sessions: SessionItem[]
    currentSessionId: string | null
    currentSessionToken: string | null
    loading: boolean
    switchSession: (id: string) => void
    createSession: () => Promise<void>
    renameSession: (id: string, name: string) => void
  }

  const SessionContext = createContext<SessionContextValue | null>(null)

  export function SessionProvider({ children }: { children: React.ReactNode }) {
    const [sessions, setSessions] = useState<SessionItem[]>([])
    const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
    const [currentSessionToken, setCurrentSessionToken] = useState<string | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => {
      const accessToken = getAccessToken()
      if (!accessToken) {
        setLoading(false)
        return
      }

      apiGetSessions(accessToken)
        .then((list) => {
          setSessions(list)
          const storedId = getSessionId()
          const match = storedId ? list.find((s) => s.session_id === storedId) : list[0]
          if (match) {
            setCurrentSessionId(match.session_id)
            setCurrentSessionToken(match.token.access_token)
          }
        })
        .catch(() => {
          // sessions list unavailable — proceed with whatever is in localStorage
        })
        .finally(() => setLoading(false))
    }, [])

    const switchSession = useCallback(
      (id: string) => {
        const target = sessions.find((s) => s.session_id === id)
        if (!target) return
        setCurrentSessionId(id)
        setCurrentSessionToken(target.token.access_token)
        setSessionToken(target.token.access_token)
        setSessionId(id)
      },
      [sessions],
    )

    const createSession = useCallback(async () => {
      const accessToken = getAccessToken()
      if (!accessToken) return
      setLoading(true)
      try {
        const session = await apiCreateSession(accessToken)
        const newItem: SessionItem = {
          session_id: session.session_id,
          name: session.name,
          token: session.token,
        }
        setSessions((prev) => [newItem, ...prev])
        setCurrentSessionId(session.session_id)
        setCurrentSessionToken(session.token.access_token)
        setSessionToken(session.token.access_token)
        setSessionId(session.session_id)
      } finally {
        setLoading(false)
      }
    }, [])

    const renameSession = useCallback((id: string, name: string) => {
      setSessions((prev) =>
        prev.map((s) => (s.session_id === id ? { ...s, name } : s)),
      )
    }, [])

    return (
      <SessionContext.Provider
        value={{
          sessions,
          currentSessionId,
          currentSessionToken,
          loading,
          switchSession,
          createSession,
          renameSession,
        }}
      >
        {children}
      </SessionContext.Provider>
    )
  }

  export function useSession() {
    const ctx = useContext(SessionContext)
    if (!ctx) throw new Error("useSession must be used within SessionProvider")
    return ctx
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd frontend && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/contexts/SessionContext.tsx
  git commit -m "feat: add SessionContext with session list, switch, create, rename"
  ```

---

## Task 5: Refactor useChat to accept sessionToken and load history

**Files:**
- Modify: `frontend/hooks/useChat.ts`

- [ ] **Step 1: Rewrite useChat.ts**

  Replace the entire file content with:

  ```ts
  "use client"

  import { useCallback, useEffect, useRef, useState } from "react"
  import { apiGetMessages, apiStreamChat, apiUpdateSessionName } from "@/lib/api"
  import type { ChatMessage, StreamChunk, ToolCallEntry } from "@/lib/types"

  function makeId(): string {
    return Math.random().toString(36).slice(2)
  }

  interface UseChatOptions {
    sessionToken: string | null
    currentSessionId: string | null
    currentSessionName: string
    renameSession: (id: string, name: string) => void
  }

  export function useChat({
    sessionToken,
    currentSessionId,
    currentSessionName,
    renameSession,
  }: UseChatOptions) {
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [streaming, setStreaming] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [historyLoading, setHistoryLoading] = useState(false)
    const streamingMsgIdRef = useRef<string | null>(null)

    // Load history whenever the session changes
    useEffect(() => {
      if (!sessionToken) return
      setMessages([])
      setError(null)
      setHistoryLoading(true)

      apiGetMessages(sessionToken)
        .then((raw) => {
          const loaded: ChatMessage[] = raw
            .filter((m) => m.role !== "system")
            .map((m) => ({
              id: makeId(),
              role: m.role as ChatMessage["role"],
              textContent: m.content,
              toolCalls: [],
              timestamp: undefined,
            }))
          setMessages(loaded)
        })
        .catch(() => {
          setError("Failed to load conversation history")
        })
        .finally(() => setHistoryLoading(false))
    }, [sessionToken])

    const sendMessage = useCallback(
      async (userText: string) => {
        if (!sessionToken || !userText.trim()) return

        setError(null)

        // Auto-name: if session has no name yet, use the first message
        const isFirstMessage = messages.length === 0
        if (isFirstMessage && currentSessionId && currentSessionName === "") {
          const name = userText.trim().slice(0, 30)
          apiUpdateSessionName(sessionToken, currentSessionId, name).catch(() => {
            // silently ignore
          })
          renameSession(currentSessionId, name)
        }

        const userMsg: ChatMessage = {
          id: makeId(),
          role: "user",
          textContent: userText.trim(),
          toolCalls: [],
          timestamp: new Date(),
        }

        const apiMessages = [...messages, userMsg].map((m) => ({
          role: m.role,
          content: m.textContent || "(tool interaction)",
        }))

        setMessages((prev) => [...prev, userMsg])

        const assistantId = makeId()
        streamingMsgIdRef.current = assistantId
        setMessages((prev) => [
          ...prev,
          { id: assistantId, role: "assistant", textContent: "", toolCalls: [], timestamp: new Date() },
        ])

        setStreaming(true)
        try {
          const response = await apiStreamChat(apiMessages, sessionToken)
          if (!response.ok) throw new Error(`HTTP ${response.status}`)
          if (!response.body) throw new Error("No response body")

          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ""

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue
              const jsonStr = line.slice(6).trim()
              if (!jsonStr) continue

              let chunk: StreamChunk
              try {
                chunk = JSON.parse(jsonStr)
              } catch {
                continue
              }

              if (chunk.type === "done") {
                if (chunk.content) {
                  setError(chunk.content)
                  setMessages((prev) => prev.filter((m) => m.id !== assistantId))
                }
                break
              }

              if (chunk.type === "text" && chunk.content) {
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, textContent: m.textContent + chunk.content }
                      : m,
                  ),
                )
              } else if (chunk.type === "tool_call" && chunk.tool_name) {
                const entry: ToolCallEntry = {
                  toolCallId: chunk.tool_call_id ?? makeId(),
                  toolName: chunk.tool_name,
                  callingContent: chunk.content,
                  status: "calling",
                }
                setMessages((prev) =>
                  prev.map((m) =>
                    m.id === assistantId
                      ? { ...m, toolCalls: [...m.toolCalls, entry] }
                      : m,
                  ),
                )
              } else if (chunk.type === "tool_result" && chunk.tool_call_id) {
                setMessages((prev) =>
                  prev.map((m) => {
                    if (m.id !== assistantId) return m
                    return {
                      ...m,
                      toolCalls: m.toolCalls.map((tc) =>
                        tc.toolCallId === chunk.tool_call_id
                          ? { ...tc, resultContent: chunk.content, status: "done" as const }
                          : tc,
                      ),
                    }
                  }),
                )
              }
            }
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : "Stream failed")
          setMessages((prev) => prev.filter((m) => m.id !== assistantId))
        } finally {
          setStreaming(false)
          streamingMsgIdRef.current = null
        }
      },
      [messages, sessionToken, currentSessionId, currentSessionName, renameSession],
    )

    const clearMessages = useCallback(() => {
      setMessages([])
      setError(null)
    }, [])

    return { messages, streaming, error, historyLoading, sendMessage, clearMessages }
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd frontend && npx tsc --noEmit
  ```
  Expected: errors from `ChatPanel.tsx` (calls `useChat()` with no args) — that's OK, will be fixed in Task 6.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/hooks/useChat.ts
  git commit -m "feat: refactor useChat — accept sessionToken, load history, auto-name"
  ```

---

## Task 6: Update ChatPanel to read session from context

**Files:**
- Modify: `frontend/components/chat/ChatPanel.tsx`

- [ ] **Step 1: Update ChatPanel to use SessionContext**

  Replace the import block and `useChat` call. The full updated file:

  ```tsx
  "use client"

  import { useEffect, useRef } from "react"
  import { MessageBubble } from "./MessageBubble"
  import { ChatInput } from "./ChatInput"
  import { useChat } from "@/hooks/useChat"
  import { useLanguage } from "@/contexts/LanguageContext"
  import { useSession } from "@/contexts/SessionContext"

  export function ChatPanel() {
    const { currentSessionToken, currentSessionId, sessions, renameSession } = useSession()
    const currentSession = sessions.find((s) => s.session_id === currentSessionId)
    const { messages, streaming, error, historyLoading, sendMessage } = useChat({
      sessionToken: currentSessionToken,
      currentSessionId,
      currentSessionName: currentSession?.name ?? "",
      renameSession,
    })
    const { t } = useLanguage()
    const bottomRef = useRef<HTMLDivElement>(null)

    const QUICK_PROMPTS = [
      t('quick_prompt_1'),
      t('quick_prompt_2'),
      t('quick_prompt_3'),
    ]

    useEffect(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" })
    }, [messages])

    return (
      <div className="glass-strong rounded-3xl flex flex-col h-full">
        <div className="flex flex-col h-full overflow-hidden">

          {/* Header */}
          <div className="px-5 pt-4 pb-3 border-b border-[var(--border)] flex-shrink-0">
            <div className="glass rounded-full inline-flex items-center gap-1.5 px-3 py-1 text-xs font-body font-medium text-[var(--text-2)] mb-3">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
              {t('chat_badge')}
            </div>
            <h2 className="font-heading italic text-xl tracking-tight text-[var(--text)] leading-none mb-0.5">
              {t('chat_title')}
            </h2>
            <p className="font-body font-light text-xs text-[var(--text-3)]">
              {t('chat_subtitle')}
            </p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {historyLoading && (
              <div className="flex items-center justify-center py-8 text-[var(--text-3)] text-sm font-body">
                <span className="flex gap-1 mr-2" aria-hidden="true">
                  <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:0ms]" />
                  <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:150ms]" />
                  <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:300ms]" />
                </span>
              </div>
            )}

            {!historyLoading && messages.length === 0 && (
              <div className="flex flex-col items-center gap-5 max-w-xs mx-auto mt-12">
                <h3 className="font-heading italic text-2xl tracking-tight text-[var(--text)] text-center">
                  {t('chat_empty_heading')}
                </h3>
                <p className="font-body font-light text-sm text-[var(--text-3)] text-center whitespace-pre-line">
                  {t('chat_empty_sub')}
                </p>
                <div className="flex flex-col gap-2 w-full">
                  {QUICK_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      onClick={() => sendMessage(prompt)}
                      className="glass rounded-full flex items-center justify-between
                                 px-4 py-2.5 text-sm font-body font-normal
                                 text-[var(--text-2)] hover:bg-white/80 transition-colors text-left"
                    >
                      <span>{prompt}</span>
                      <span className="text-[var(--text-3)] flex-shrink-0 ml-2" aria-hidden="true">↗</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((msg, i) => (
              <MessageBubble
                key={msg.id}
                message={msg}
                isStreaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
              />
            ))}

            <div aria-live="polite" aria-atomic="true">
              {streaming &&
                messages[messages.length - 1]?.role === "assistant" &&
                !messages[messages.length - 1]?.textContent && (
                  <div className="flex items-center gap-2 px-3 py-2 text-[var(--text-3)] text-sm">
                    <span className="flex gap-1" aria-hidden="true">
                      <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:0ms]" />
                      <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:150ms]" />
                      <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:300ms]" />
                    </span>
                    <span className="text-xs">{t('chat_thinking')}</span>
                  </div>
                )}
            </div>

            {error && (
              <div
                role="alert"
                className="text-red-600 text-sm bg-red-50 border border-red-200
                           rounded-xl px-4 py-2.5 mx-2 mt-2 font-body font-light"
              >
                ⚠ {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="flex-shrink-0">
            <ChatInput onSend={sendMessage} disabled={streaming} />
          </div>

        </div>
      </div>
    )
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd frontend && npx tsc --noEmit
  ```
  Expected: error about `SessionProvider` not wrapping the tree — that's OK, will be fixed in Task 8.

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/components/chat/ChatPanel.tsx
  git commit -m "feat: update ChatPanel to read session from SessionContext"
  ```

---

## Task 7: Build SessionSidebar component

**Files:**
- Create: `frontend/components/chat/SessionSidebar.tsx`

- [ ] **Step 1: Create the file**

  ```tsx
  "use client"

  import { useState } from "react"
  import { useSession } from "@/contexts/SessionContext"
  import { useLanguage } from "@/contexts/LanguageContext"

  export function SessionSidebar({ streaming }: { streaming: boolean }) {
    const { sessions, currentSessionId, loading, switchSession, createSession } = useSession()
    const { t } = useLanguage()
    const [collapsed, setCollapsed] = useState(false)

    return (
      <div className="flex-shrink-0 flex">
        {/* Sidebar panel */}
        <div
          className={`transition-all duration-200 overflow-hidden ${
            collapsed ? "w-0" : "w-52"
          }`}
        >
          <div className="glass-strong rounded-3xl h-full flex flex-col w-52 overflow-hidden">

            {/* New chat button */}
            <div className="px-3 pt-4 pb-2 flex-shrink-0">
              <button
                onClick={createSession}
                disabled={loading || streaming}
                className="w-full rounded-full px-3 py-2 text-sm font-body font-medium
                           bg-[var(--accent)] text-[var(--accent-fg)]
                           hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed
                           transition-opacity"
              >
                {t('sidebar_new_chat')}
              </button>
            </div>

            {/* Session list */}
            <div
              className={`flex-1 overflow-y-auto px-2 pb-3 ${
                streaming ? "pointer-events-none opacity-60" : ""
              }`}
            >
              {sessions.length === 0 && !loading && (
                <p className="text-xs font-body text-[var(--text-3)] text-center px-3 py-4">
                  {t('sidebar_empty')}
                </p>
              )}

              {sessions.map((session) => {
                const isActive = session.session_id === currentSessionId
                const displayName = session.name || session.session_id.slice(0, 8)
                return (
                  <button
                    key={session.session_id}
                    onClick={() => switchSession(session.session_id)}
                    className={`w-full text-left rounded-xl px-3 py-2 mb-0.5 transition-colors ${
                      isActive
                        ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                        : "text-[var(--text-2)] hover:bg-black/5 hover:text-[var(--text)]"
                    }`}
                  >
                    <span className="block text-xs font-body font-medium truncate">
                      {displayName}
                    </span>
                  </button>
                )
              })}
            </div>

          </div>
        </div>

        {/* Collapse toggle button */}
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className="self-center ml-1.5 flex-shrink-0
                     w-5 h-10 rounded-full glass
                     flex items-center justify-center
                     text-[var(--text-3)] hover:text-[var(--text-2)]
                     text-xs transition-colors"
        >
          {collapsed ? "›" : "‹"}
        </button>
      </div>
    )
  }
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  cd frontend && npx tsc --noEmit
  ```
  Expected: no new errors beyond the missing SessionProvider wrapper (fixed in Task 8).

- [ ] **Step 3: Commit**

  ```bash
  git add frontend/components/chat/SessionSidebar.tsx
  git commit -m "feat: add SessionSidebar collapsible component"
  ```

---

## Task 8: Wire everything together in the chat page

**Files:**
- Modify: `frontend/app/chat/page.tsx`

- [ ] **Step 1: Update chat page to include SessionProvider and SessionSidebar**

  Replace the full content of `frontend/app/chat/page.tsx`:

  ```tsx
  "use client"

  import { useState, useEffect } from "react"
  import { useRouter, useSearchParams } from "next/navigation"
  import { isAuthenticated, clearAuth } from "@/lib/auth"
  import { ChatPanel } from "@/components/chat/ChatPanel"
  import { SessionSidebar } from "@/components/chat/SessionSidebar"
  import { ApplicationTracker } from "@/components/tracker/ApplicationTracker"
  import { ListingsPanel } from "@/components/listings/ListingsPanel"
  import { SessionProvider } from "@/contexts/SessionContext"
  import { useLanguage } from "@/contexts/LanguageContext"

  type Tab = "chat" | "picks"

  function ChatPageInner() {
    const router = useRouter()
    const searchParams = useSearchParams()
    const { t, locale, setLocale } = useLanguage()

    const [tab, setTab] = useState<Tab>(() => {
      const p = searchParams.get("tab")
      return p === "picks" ? "picks" : "chat"
    })
    const [ready, setReady] = useState(false)
    // streaming state is lifted here so SessionSidebar can disable itself
    const [streaming, setStreaming] = useState(false)

    useEffect(() => {
      if (!isAuthenticated()) {
        router.replace("/login")
      } else {
        setReady(true)
      }
    }, [router])

    function handleTabChange(key: Tab) {
      setTab(key)
      router.replace(`?tab=${key}`, { scroll: false })
    }

    function handleLogout() {
      clearAuth()
      router.replace("/login")
    }

    if (!ready) return null

    return (
      <div className="h-screen flex flex-col overflow-hidden">
        {/* Navbar */}
        <div className="px-4 pt-3 pb-2 flex-shrink-0">
          <nav className="glass rounded-full px-5 py-2.5 flex items-center justify-between">
            <span className="font-heading italic text-lg tracking-tight text-[var(--text)]">
              Job Hunter ✦
            </span>
            <div role="tablist" className="flex items-center gap-1">
              {([
                { key: "chat" as Tab, label: t('tab_chat') },
                { key: "picks" as Tab, label: t('tab_picks') },
              ]).map(({ key, label }) => (
                <button
                  key={key}
                  role="tab"
                  aria-selected={tab === key}
                  onClick={() => handleTabChange(key)}
                  className={`rounded-full px-4 py-1.5 text-sm font-body font-medium transition-colors ${
                    tab === key
                      ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                      : "text-[var(--text-2)] hover:bg-black/5 hover:text-[var(--text)]"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
                aria-label="Switch language"
                className="text-xs font-body font-medium text-[var(--text-3)]
                           hover:text-[var(--text-2)] px-3 py-1.5 rounded-full
                           hover:bg-black/5 transition-colors tracking-wide"
              >
                {t('lang_toggle')}
              </button>
              <button
                onClick={handleLogout}
                className="text-xs font-body text-[var(--text-3)] hover:text-[var(--text-2)]
                           px-3 py-1.5 rounded-full hover:bg-black/5 transition-colors"
              >
                {t('logout')}
              </button>
            </div>
          </nav>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden px-4 pb-4">
          {tab === "chat" ? (
            <div className="h-full flex gap-3">
              {/* Session sidebar */}
              <SessionSidebar streaming={streaming} />

              {/* Chat + tracker */}
              <div className="flex-1 min-w-0 overflow-hidden flex gap-4">
                <div className="flex-1 min-w-0 overflow-hidden">
                  <ChatPanel onStreamingChange={setStreaming} />
                </div>
                <div className="w-72 xl:w-80 flex-shrink-0 overflow-hidden">
                  <ApplicationTracker />
                </div>
              </div>
            </div>
          ) : (
            <ListingsPanel />
          )}
        </div>
      </div>
    )
  }

  export default function ChatPage() {
    return (
      <SessionProvider>
        <ChatPageInner />
      </SessionProvider>
    )
  }
  ```

  Note: `ChatPanel` now receives an `onStreamingChange` prop — this must also be added to `ChatPanel.tsx` (see Step 2).

- [ ] **Step 2: Add `onStreamingChange` prop to ChatPanel**

  Update `frontend/components/chat/ChatPanel.tsx` — add the prop and call it when streaming state changes.

  Change the function signature:

  ```tsx
  export function ChatPanel({ onStreamingChange }: { onStreamingChange?: (s: boolean) => void }) {
  ```

  After the `useChat` destructuring, add a `useEffect` to propagate streaming state upward:

  ```tsx
  useEffect(() => {
    onStreamingChange?.(streaming)
  }, [streaming, onStreamingChange])
  ```

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  cd frontend && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/app/chat/page.tsx frontend/components/chat/ChatPanel.tsx
  git commit -m "feat: wire SessionProvider and SessionSidebar into chat page"
  ```

---

## Task 9: Update login page to store session ID

**Files:**
- Modify: `frontend/app/login/page.tsx`

- [ ] **Step 1: Import `setSessionId` and call it after session creation**

  In `frontend/app/login/page.tsx`, update the import line:

  ```ts
  import { setAccessToken, setSessionToken, setSessionId } from "@/lib/auth"
  ```

  Then add `setSessionId` call right after `setSessionToken`:

  ```ts
  setSessionToken(session.token.access_token)
  setSessionId(session.session_id)
  ```

- [ ] **Step 2: Verify TypeScript compiles with zero errors**

  ```bash
  cd frontend && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 3: Manual smoke test**

  Start the dev server: `cd frontend && pnpm dev`

  1. Open `http://localhost:3000/login` → register or login
  2. Verify redirect to `/chat`
  3. Verify sidebar appears on the left with the current session listed
  4. Send a message — verify streaming works and the sidebar session gets renamed to first 30 chars of message
  5. Click "＋ 新建对话" — verify a new session appears, the chat panel resets to empty
  6. Send a message in new session
  7. Click the old session in the sidebar — verify old messages are loaded from history
  8. Continue chatting from the old session — verify new messages append correctly
  9. Collapse the sidebar with ‹ button — verify panel hides; expand again with › button
  10. Refresh the page — verify the same session is still active and messages are loaded

- [ ] **Step 4: Commit**

  ```bash
  git add frontend/app/login/page.tsx
  git commit -m "feat: store session_id to localStorage after login/register"
  ```

---

## Task 10: Final TypeScript check and cleanup

- [ ] **Step 1: Full TypeScript check**

  ```bash
  cd frontend && npx tsc --noEmit
  ```
  Expected: no errors.

- [ ] **Step 2: ESLint check**

  ```bash
  cd frontend && pnpm lint
  ```
  Fix any errors (not warnings).

- [ ] **Step 3: Final commit if any lint fixes were needed**

  ```bash
  git add -p
  git commit -m "fix: resolve lint issues in session history implementation"
  ```
