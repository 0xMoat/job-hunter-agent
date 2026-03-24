# Job Hunter Agent — Frontend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Next.js frontend for the Job Hunter Agent with SSE chat streaming, inline tool call visualization, application tracker dashboard, and daily job listings panel.

**Architecture:** `frontend/` directory at repo root. All interactive views are client components. Direct fetch to `http://localhost:8000` (CORS open on backend). POST + ReadableStream for SSE (not EventSource — backend uses POST). JWT tokens in localStorage: `access_token` for session creation, `session_token` for all agent API calls.

**Tech Stack:** Next.js 14 (app router), TypeScript, Tailwind CSS, pnpm

---

## Auth API Quick Reference

Key facts the implementer must know — these differ from typical patterns:

| Step | Method | Path | Body format | Returns |
|---|---|---|---|---|
| Register | POST | `/api/v1/auth/register` | JSON `{email, password}` | `{id, email, token: {access_token}}` |
| Login | POST | `/api/v1/auth/login` | **Form data** `username=&password=&grant_type=password` | `{access_token, token_type}` |
| Create session | POST | `/api/v1/auth/session` | — (Bearer access_token) | `{session_id, token: {access_token}}` |
| Agent calls | any | `/api/v1/chatbot/…` `/api/v1/applications` etc. | Bearer **session** token | — |

Password rules: ≥8 chars, at least one uppercase, lowercase, digit, special char (`!@#$%^&*(),.?":{}|<>`).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `frontend/package.json` | Create | Project deps (Next.js 14, Tailwind) |
| `frontend/next.config.ts` | Create | React strict mode |
| `frontend/tailwind.config.ts` | Create | Tailwind config |
| `frontend/app/layout.tsx` | Create | Root HTML layout |
| `frontend/app/globals.css` | Create | Tailwind directives + dark base |
| `frontend/app/page.tsx` | Create | Auth guard redirect |
| `frontend/app/login/page.tsx` | Create | Login + register form |
| `frontend/app/chat/page.tsx` | Create | Main app — tabs + split panel layout |
| `frontend/lib/types.ts` | Create | All TypeScript domain types |
| `frontend/lib/auth.ts` | Create | localStorage token helpers |
| `frontend/lib/api.ts` | Create | All fetch calls to backend |
| `frontend/hooks/useChat.ts` | Create | Chat state + SSE streaming + tool call tracking |
| `frontend/hooks/useApplications.ts` | Create | Applications CRUD state |
| `frontend/hooks/useListings.ts` | Create | Listings fetch state |
| `frontend/components/chat/ToolCallCard.tsx` | Create | Inline tool call + result card |
| `frontend/components/chat/MessageBubble.tsx` | Create | User/assistant message bubble |
| `frontend/components/chat/ChatInput.tsx` | Create | Auto-resize textarea + send button |
| `frontend/components/chat/ChatPanel.tsx` | Create | Chat container (messages list + input) |
| `frontend/components/tracker/ApplicationCard.tsx` | Create | Single application card with status dropdown |
| `frontend/components/tracker/ApplicationTracker.tsx` | Create | Right panel with status columns |
| `frontend/components/listings/ListingCard.tsx` | Create | Single listing card |
| `frontend/components/listings/ListingsPanel.tsx` | Create | Today's Picks full-width grid |

---

## Task 1: Bootstrap Next.js project

**Files:**
- Create: `frontend/` (entire directory)

- [ ] **Step 1: Scaffold with create-next-app**

Run from the repo root (`/Users/young/Downloads/repos/Job-Hunter-Agent`):

```bash
pnpm dlx create-next-app@latest frontend \
  --typescript \
  --tailwind \
  --app \
  --no-src-dir \
  --import-alias "@/*" \
  --eslint \
  --no-turbopack
```

Accept all defaults. This creates `frontend/` with Next.js 14, TypeScript, Tailwind, app router.

- [ ] **Step 2: Create component directories**

```bash
mkdir -p frontend/lib frontend/hooks \
  frontend/components/chat \
  frontend/components/tracker \
  frontend/components/listings
```

- [ ] **Step 3: Replace `frontend/app/globals.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

:root {
  --background: #0f172a;
  --foreground: #f1f5f9;
}

body {
  background-color: var(--background);
  color: var(--foreground);
}
```

- [ ] **Step 4: Verify dev server starts**

```bash
cd frontend && pnpm dev
```

Expected: Server starts on http://localhost:3000. No errors in terminal.

- [ ] **Step 5: Commit**

```bash
git add frontend/
git commit -m "feat: bootstrap Next.js frontend"
```

---

## Task 2: Shared lib — types, auth helpers, API client

**Files:**
- Create: `frontend/lib/types.ts`
- Create: `frontend/lib/auth.ts`
- Create: `frontend/lib/api.ts`

- [ ] **Step 1: Create `frontend/lib/types.ts`**

```typescript
// Domain types for the Job Hunter Agent frontend.

export type MessageRole = "user" | "assistant"
export type ApplicationStatus = "applied" | "interviewing" | "rejected" | "offer"

export interface ToolCallEntry {
  toolCallId: string
  toolName: string
  callingContent: string
  resultContent?: string
  status: "calling" | "done"
}

export interface ChatMessage {
  id: string
  role: MessageRole
  textContent: string
  toolCalls: ToolCallEntry[]
}

export interface StreamChunk {
  type: "text" | "tool_call" | "tool_result" | "done"
  content: string
  tool_name?: string
  tool_call_id?: string
  done: boolean
}

export interface Application {
  id: number
  user_id: number
  company: string
  title: string
  url?: string
  status: ApplicationStatus
  applied_date: string
  notes?: string
  updated_at: string
  created_at: string
}

export interface JobListing {
  id: number
  user_id: number
  title: string
  company: string
  location: string
  url: string
  snippet: string
  found_date: string
  is_read: boolean
}
```

- [ ] **Step 2: Create `frontend/lib/auth.ts`**

```typescript
// localStorage helpers for token management.
// All reads guard against SSR with typeof window checks.

const ACCESS_TOKEN_KEY = "jh_access_token"
const SESSION_TOKEN_KEY = "jh_session_token"

export function getAccessToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(ACCESS_TOKEN_KEY)
}

export function setAccessToken(token: string): void {
  localStorage.setItem(ACCESS_TOKEN_KEY, token)
}

export function getSessionToken(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(SESSION_TOKEN_KEY)
}

export function setSessionToken(token: string): void {
  localStorage.setItem(SESSION_TOKEN_KEY, token)
}

export function clearAuth(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(SESSION_TOKEN_KEY)
}

export function isAuthenticated(): boolean {
  return !!getSessionToken()
}
```

- [ ] **Step 3: Create `frontend/lib/api.ts`**

```typescript
// All fetch calls to the FastAPI backend.
// Set NEXT_PUBLIC_API_URL in .env.local to override the default.

import type { Application, JobListing } from "./types"

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

async function req(
  path: string,
  options: RequestInit = {},
  token?: string,
): Promise<Response> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  }
  if (token) headers["Authorization"] = `Bearer ${token}`

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers })
  if (!res.ok) {
    const body = await res.text().catch(() => "")
    throw new Error(body || `HTTP ${res.status}`)
  }
  return res
}

// ── Auth ──────────────────────────────────────────────────────────────────

// Register returns {id, email, token: {access_token, ...}}
export async function apiRegister(
  email: string,
  password: string,
): Promise<{ id: number; email: string; token: { access_token: string } }> {
  const res = await req("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  return res.json()
}

// Login uses form data (OAuth2PasswordRequestForm), NOT JSON.
// Returns {access_token, token_type, expires_at} (flat — no nested token object).
export async function apiLogin(
  email: string,
  password: string,
): Promise<{ access_token: string; token_type: string }> {
  const form = new URLSearchParams()
  form.set("username", email)
  form.set("password", password)
  form.set("grant_type", "password")

  const res = await req("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  })
  return res.json()
}

// Create a chat session with the access token.
// Returns {session_id, name, token: {access_token, ...}}
// Use token.access_token for all subsequent agent API calls.
export async function apiCreateSession(
  accessToken: string,
): Promise<{ session_id: string; name: string; token: { access_token: string } }> {
  const res = await req("/api/v1/auth/session", { method: "POST" }, accessToken)
  return res.json()
}

// ── Chat ──────────────────────────────────────────────────────────────────

// Returns a raw Response with a ReadableStream body for SSE consumption.
// Do NOT call .json() on this — read the body as a stream.
export function apiStreamChat(
  messages: Array<{ role: string; content: string }>,
  sessionToken: string,
): Promise<Response> {
  return fetch(`${BASE_URL}/api/v1/chatbot/chat/stream`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ messages }),
  })
}

// ── Applications ──────────────────────────────────────────────────────────

export async function apiListApplications(
  sessionToken: string,
): Promise<{ applications: Application[]; count: number }> {
  const res = await req("/api/v1/applications", {}, sessionToken)
  return res.json()
}

export async function apiAddApplication(
  sessionToken: string,
  data: { company: string; title: string; url?: string; notes?: string },
): Promise<Application> {
  const res = await req(
    "/api/v1/applications",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
    sessionToken,
  )
  return res.json()
}

export async function apiUpdateApplication(
  sessionToken: string,
  id: number,
  data: { status?: string; notes?: string },
): Promise<Application> {
  const res = await req(
    `/api/v1/applications/${id}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
    sessionToken,
  )
  return res.json()
}

export async function apiDeleteApplication(
  sessionToken: string,
  id: number,
): Promise<void> {
  await req(`/api/v1/applications/${id}`, { method: "DELETE" }, sessionToken)
}

// ── Listings ──────────────────────────────────────────────────────────────

export async function apiGetListings(
  sessionToken: string,
): Promise<{ listings: JobListing[]; count: number }> {
  const res = await req("/api/v1/listings", {}, sessionToken)
  return res.json()
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && pnpm tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/
git commit -m "feat: add types, auth helpers, and API client"
```

---

## Task 3: Auth page — login + register

**Files:**
- Modify: `frontend/app/layout.tsx`
- Create: `frontend/app/page.tsx`
- Create: `frontend/app/login/page.tsx`

- [ ] **Step 1: Replace `frontend/app/layout.tsx`**

```tsx
import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Job Hunter Agent",
  description: "AI-powered job hunting assistant",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 2: Create `frontend/app/page.tsx`** — auth guard redirect

```tsx
"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { isAuthenticated } from "@/lib/auth"

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    if (isAuthenticated()) {
      router.replace("/chat")
    } else {
      router.replace("/login")
    }
  }, [router])

  return null
}
```

- [ ] **Step 3: Create `frontend/app/login/page.tsx`**

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { apiRegister, apiLogin, apiCreateSession } from "@/lib/api"
import { setAccessToken, setSessionToken } from "@/lib/auth"

type Mode = "login" | "register"

export default function LoginPage() {
  const router = useRouter()
  const [mode, setMode] = useState<Mode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    try {
      let accessToken: string

      if (mode === "register") {
        const data = await apiRegister(email, password)
        accessToken = data.token.access_token
      } else {
        const data = await apiLogin(email, password)
        accessToken = data.access_token
      }

      setAccessToken(accessToken)

      // Create a chat session. The session token is used for all agent API calls.
      const session = await apiCreateSession(accessToken)
      setSessionToken(session.token.access_token)

      router.push("/chat")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to authenticate")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="w-full max-w-md p-8 bg-slate-800 rounded-xl shadow-2xl">
        <h1 className="text-2xl font-bold text-white mb-1">Job Hunter Agent</h1>
        <p className="text-slate-400 mb-6 text-sm">AI-powered job hunting assistant</p>

        <div className="flex gap-2 mb-6">
          {(["login", "register"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === m
                  ? "bg-blue-600 text-white"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              {m === "login" ? "Login" : "Register"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:outline-none focus:border-blue-500 text-sm"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:outline-none focus:border-blue-500 text-sm"
              placeholder={
                mode === "register"
                  ? "≥8 chars, A-Z, a-z, 0-9, special (!@#…)"
                  : "Your password"
              }
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors text-sm"
          >
            {loading
              ? "Please wait…"
              : mode === "login"
              ? "Login"
              : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Smoke test**

1. `cd frontend && pnpm dev`
2. Open http://localhost:3000 — should redirect to /login
3. Toggle between Login / Register — no errors
4. (Skip actual auth — backend not needed for this step)

- [ ] **Step 5: Commit**

```bash
git add frontend/app/
git commit -m "feat: add auth guard, login, and register page"
```

---

## Task 4: `useChat` hook — SSE streaming + tool call state

**Files:**
- Create: `frontend/hooks/useChat.ts`

The hook owns all chat state. It tracks `ChatMessage[]`, where each assistant message carries its `toolCalls: ToolCallEntry[]`. When a `tool_call` SSE chunk arrives, a new entry is appended to the current message. When `tool_result` arrives, it is matched to the existing entry by `tool_call_id` and marked done.

SSE line format from backend: `data: {"type": "...", "content": "...", ...}\n\n`

- [ ] **Step 1: Create `frontend/hooks/useChat.ts`**

```typescript
"use client"

import { useState, useCallback, useRef } from "react"
import { apiStreamChat } from "@/lib/api"
import { getSessionToken } from "@/lib/auth"
import type { ChatMessage, StreamChunk, ToolCallEntry } from "@/lib/types"

function makeId(): string {
  return Math.random().toString(36).slice(2)
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streamingMsgIdRef = useRef<string | null>(null)

  const sendMessage = useCallback(
    async (userText: string) => {
      const sessionToken = getSessionToken()
      if (!sessionToken || !userText.trim()) return

      setError(null)

      // Build user message
      const userMsg: ChatMessage = {
        id: makeId(),
        role: "user",
        textContent: userText.trim(),
        toolCalls: [],
      }

      // API messages: all prior messages + new user message (text only)
      const apiMessages = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.textContent || "(tool interaction)",
      }))

      setMessages((prev) => [...prev, userMsg])

      // Placeholder assistant message (will be filled by stream)
      const assistantId = makeId()
      streamingMsgIdRef.current = assistantId
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", textContent: "", toolCalls: [] },
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
          buffer = lines.pop() ?? "" // keep incomplete last line

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

            if (chunk.type === "done") break

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
                        ? {
                            ...tc,
                            resultContent: chunk.content,
                            status: "done" as const,
                          }
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
    [messages],
  )

  const clearMessages = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return { messages, streaming, error, sendMessage, clearMessages }
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && pnpm tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/hooks/useChat.ts
git commit -m "feat: add useChat hook with SSE streaming and tool call tracking"
```

---

## Task 5: Chat UI components

**Files:**
- Create: `frontend/components/chat/ToolCallCard.tsx`
- Create: `frontend/components/chat/MessageBubble.tsx`
- Create: `frontend/components/chat/ChatInput.tsx`
- Create: `frontend/components/chat/ChatPanel.tsx`

- [ ] **Step 1: Create `frontend/components/chat/ToolCallCard.tsx`**

```tsx
import type { ToolCallEntry } from "@/lib/types"

const TOOL_LABELS: Record<string, string> = {
  job_search_tool: "Job Search",
  company_research_tool: "Company Research",
  cover_letter_tool: "Cover Letter",
  application_tracker_tool: "Application Tracker",
  job_preferences_tool: "Preferences",
  duckduckgo_search: "Web Search",
}

interface Props {
  entry: ToolCallEntry
}

export function ToolCallCard({ entry }: Props) {
  const label = TOOL_LABELS[entry.toolName] ?? entry.toolName
  const isDone = entry.status === "done"

  return (
    <div className="my-1 rounded-lg border border-slate-600 bg-slate-800/60 text-xs overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-700/50">
        <span className="text-base">{isDone ? "✅" : "⚙️"}</span>
        <span className="font-mono text-slate-300 font-medium">{label}</span>
        {!isDone && (
          <span className="ml-auto text-slate-500 animate-pulse">running…</span>
        )}
      </div>
      {entry.resultContent && (
        <div className="px-3 py-1.5 text-slate-400 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed">
          {entry.resultContent}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create `frontend/components/chat/MessageBubble.tsx`**

```tsx
import { ToolCallCard } from "./ToolCallCard"
import type { ChatMessage } from "@/lib/types"

interface Props {
  message: ChatMessage
  isStreaming?: boolean
}

export function MessageBubble({ message, isStreaming }: Props) {
  const isUser = message.role === "user"

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div className="max-w-[85%]">
        {/* Tool call cards (assistant only, above text bubble) */}
        {message.toolCalls.length > 0 && (
          <div className="mb-2 space-y-1">
            {message.toolCalls.map((tc) => (
              <ToolCallCard key={tc.toolCallId} entry={tc} />
            ))}
          </div>
        )}

        {/* Text bubble */}
        {(message.textContent || isStreaming) && (
          <div
            className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              isUser
                ? "bg-blue-600 text-white rounded-br-sm"
                : "bg-slate-700 text-slate-100 rounded-bl-sm"
            }`}
          >
            {message.textContent}
            {isStreaming && (
              <span className="inline-block w-1 h-4 bg-current ml-0.5 animate-pulse rounded-sm align-middle" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `frontend/components/chat/ChatInput.tsx`**

```tsx
"use client"

import { useState, useRef } from "react"

interface Props {
  onSend: (text: string) => void
  disabled: boolean
}

export function ChatInput({ onSend, disabled }: Props) {
  const [text, setText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim() || disabled) return
    onSend(text)
    setText("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value)
    const el = e.target
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 120) + "px"
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 p-3 border-t border-slate-700"
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={1}
        placeholder="输入消息… (Enter 发送，Shift+Enter 换行)"
        className="flex-1 resize-none rounded-xl bg-slate-700 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 min-h-[44px] max-h-[120px] leading-relaxed"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors min-h-[44px]"
      >
        {disabled ? "…" : "发送"}
      </button>
    </form>
  )
}
```

- [ ] **Step 4: Create `frontend/components/chat/ChatPanel.tsx`**

```tsx
"use client"

import { useEffect, useRef } from "react"
import { MessageBubble } from "./MessageBubble"
import { ChatInput } from "./ChatInput"
import { useChat } from "@/hooks/useChat"

export function ChatPanel() {
  const { messages, streaming, error, sendMessage } = useChat()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <div className="px-4 py-3 border-b border-slate-700 flex-shrink-0">
        <h2 className="text-sm font-semibold text-slate-300">Agent Chat</h2>
        <p className="text-xs text-slate-500">Job-hunting specialist · tool calls shown inline</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="text-center text-slate-500 text-sm mt-12">
            <p className="text-3xl mb-3">👋</p>
            <p>Tell me your skills, target roles, and location.</p>
            <p className="text-xs mt-1 text-slate-600">
              Try: "帮我找上海的 agent engineer 岗位"
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isStreaming={
              streaming && i === messages.length - 1 && msg.role === "assistant"
            }
          />
        ))}
        {error && (
          <div className="text-red-400 text-xs bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 mx-2 mt-2">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex-shrink-0">
        <ChatInput onSend={sendMessage} disabled={streaming} />
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd frontend && pnpm tsc --noEmit
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/chat/
git commit -m "feat: add chat UI components (ToolCallCard, MessageBubble, ChatInput, ChatPanel)"
```

---

## Task 6: Application tracker

**Files:**
- Create: `frontend/hooks/useApplications.ts`
- Create: `frontend/components/tracker/ApplicationCard.tsx`
- Create: `frontend/components/tracker/ApplicationTracker.tsx`

- [ ] **Step 1: Create `frontend/hooks/useApplications.ts`**

```typescript
"use client"

import { useState, useCallback, useEffect } from "react"
import {
  apiListApplications,
  apiAddApplication,
  apiUpdateApplication,
  apiDeleteApplication,
} from "@/lib/api"
import { getSessionToken } from "@/lib/auth"
import type { Application, ApplicationStatus } from "@/lib/types"

export function useApplications() {
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = getSessionToken()
    if (!token) return
    setLoading(true)
    try {
      const data = await apiListApplications(token)
      setApplications(data.applications)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load applications")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const addApplication = useCallback(
    async (
      company: string,
      title: string,
      url?: string,
      notes?: string,
    ): Promise<Application | undefined> => {
      const token = getSessionToken()
      if (!token) return
      const app = await apiAddApplication(token, { company, title, url, notes })
      setApplications((prev) => [app, ...prev])
      return app
    },
    [],
  )

  const updateStatus = useCallback(
    async (id: number, status: ApplicationStatus): Promise<void> => {
      const token = getSessionToken()
      if (!token) return
      const updated = await apiUpdateApplication(token, id, { status })
      setApplications((prev) => prev.map((a) => (a.id === id ? updated : a)))
    },
    [],
  )

  const deleteApplication = useCallback(async (id: number): Promise<void> => {
    const token = getSessionToken()
    if (!token) return
    await apiDeleteApplication(token, id)
    setApplications((prev) => prev.filter((a) => a.id !== id))
  }, [])

  return {
    applications,
    loading,
    error,
    addApplication,
    updateStatus,
    deleteApplication,
    reload: load,
  }
}
```

- [ ] **Step 2: Create `frontend/components/tracker/ApplicationCard.tsx`**

```tsx
import type { Application, ApplicationStatus } from "@/lib/types"

const STATUS_COLORS: Record<ApplicationStatus, string> = {
  applied: "text-blue-400 bg-blue-900/30 border-blue-800",
  interviewing: "text-yellow-400 bg-yellow-900/30 border-yellow-800",
  rejected: "text-red-400 bg-red-900/30 border-red-800",
  offer: "text-green-400 bg-green-900/30 border-green-800",
}

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  applied: "Applied",
  interviewing: "Interviewing",
  rejected: "Rejected",
  offer: "Offer 🎉",
}

const ALL_STATUSES: ApplicationStatus[] = [
  "applied",
  "interviewing",
  "offer",
  "rejected",
]

interface Props {
  app: Application
  onStatusChange: (id: number, status: ApplicationStatus) => void
  onDelete: (id: number) => void
}

export function ApplicationCard({ app, onStatusChange, onDelete }: Props) {
  return (
    <div className="bg-slate-800 rounded-lg p-3 border border-slate-700 hover:border-slate-600 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{app.company}</p>
          <p className="text-xs text-slate-400 truncate">{app.title}</p>
        </div>
        <button
          onClick={() => onDelete(app.id)}
          className="text-slate-600 hover:text-red-400 transition-colors flex-shrink-0 text-xl leading-none pb-0.5"
          title="Delete"
        >
          ×
        </button>
      </div>

      {app.url && (
        <a
          href={app.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-400 hover:text-blue-300 truncate block mb-1.5"
        >
          {app.url}
        </a>
      )}

      <select
        value={app.status}
        onChange={(e) => onStatusChange(app.id, e.target.value as ApplicationStatus)}
        className={`w-full text-xs rounded px-1.5 py-1 border font-medium bg-transparent cursor-pointer ${STATUS_COLORS[app.status]}`}
      >
        {ALL_STATUSES.map((s) => (
          <option key={s} value={s} className="bg-slate-800 text-white">
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>

      <p className="text-xs text-slate-600 mt-1.5">{app.applied_date}</p>
    </div>
  )
}
```

- [ ] **Step 3: Create `frontend/components/tracker/ApplicationTracker.tsx`**

```tsx
"use client"

import { useState } from "react"
import { ApplicationCard } from "./ApplicationCard"
import { useApplications } from "@/hooks/useApplications"
import type { ApplicationStatus } from "@/lib/types"

const COLUMNS: { key: ApplicationStatus; label: string }[] = [
  { key: "applied", label: "Applied" },
  { key: "interviewing", label: "Interviewing" },
  { key: "offer", label: "Offer" },
  { key: "rejected", label: "Rejected" },
]

export function ApplicationTracker() {
  const {
    applications,
    loading,
    addApplication,
    updateStatus,
    deleteApplication,
  } = useApplications()

  const [showAdd, setShowAdd] = useState(false)
  const [company, setCompany] = useState("")
  const [title, setTitle] = useState("")
  const [url, setUrl] = useState("")

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!company.trim() || !title.trim()) return
    await addApplication(
      company.trim(),
      title.trim(),
      url.trim() || undefined,
    )
    setCompany("")
    setTitle("")
    setUrl("")
    setShowAdd(false)
  }

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-slate-300">Applications</h2>
          <p className="text-xs text-slate-500">{applications.length} tracked</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
        >
          + Add
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="px-3 py-3 border-b border-slate-700 space-y-2 flex-shrink-0"
        >
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company name *"
            required
            className="w-full px-2 py-1.5 text-xs bg-slate-700 text-white rounded border border-slate-600 focus:outline-none focus:border-blue-500"
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Job title *"
            required
            className="w-full px-2 py-1.5 text-xs bg-slate-700 text-white rounded border border-slate-600 focus:outline-none focus:border-blue-500"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="URL (optional)"
            type="url"
            className="w-full px-2 py-1.5 text-xs bg-slate-700 text-white rounded border border-slate-600 focus:outline-none focus:border-blue-500"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="flex-1 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Columns */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <p className="text-slate-500 text-xs text-center mt-6">Loading…</p>
        ) : (
          <div className="space-y-5">
            {COLUMNS.map(({ key, label }) => {
              const colApps = applications.filter((a) => a.status === key)
              return (
                <div key={key}>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    {label}{" "}
                    <span className="text-slate-600 font-normal">
                      ({colApps.length})
                    </span>
                  </p>
                  <div className="space-y-2">
                    {colApps.length === 0 ? (
                      <p className="text-xs text-slate-700 italic pl-1">
                        None yet
                      </p>
                    ) : (
                      colApps.map((app) => (
                        <ApplicationCard
                          key={app.id}
                          app={app}
                          onStatusChange={updateStatus}
                          onDelete={deleteApplication}
                        />
                      ))
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && pnpm tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/useApplications.ts frontend/components/tracker/
git commit -m "feat: add application tracker hook and components"
```

---

## Task 7: Today's Picks — listings

**Files:**
- Create: `frontend/hooks/useListings.ts`
- Create: `frontend/components/listings/ListingCard.tsx`
- Create: `frontend/components/listings/ListingsPanel.tsx`

- [ ] **Step 1: Create `frontend/hooks/useListings.ts`**

```typescript
"use client"

import { useState, useCallback, useEffect } from "react"
import { apiGetListings } from "@/lib/api"
import { getSessionToken } from "@/lib/auth"
import type { JobListing } from "@/lib/types"

export function useListings() {
  const [listings, setListings] = useState<JobListing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = getSessionToken()
    if (!token) return
    setLoading(true)
    try {
      const data = await apiGetListings(token)
      setListings(data.listings)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load listings",
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { listings, loading, error, reload: load }
}
```

- [ ] **Step 2: Create `frontend/components/listings/ListingCard.tsx`**

```tsx
import type { JobListing } from "@/lib/types"

interface Props {
  listing: JobListing
}

export function ListingCard({ listing }: Props) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 hover:border-slate-500 transition-colors flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-blue-400 hover:text-blue-300 transition-colors line-clamp-2 leading-snug"
        >
          {listing.title || "Untitled listing"}
        </a>
        <span className="flex-shrink-0 text-xs text-slate-600 mt-0.5">
          {listing.found_date}
        </span>
      </div>
      {(listing.company || listing.location) && (
        <p className="text-xs text-slate-400">
          {[listing.company, listing.location].filter(Boolean).join(" · ")}
        </p>
      )}
      {listing.snippet && (
        <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed">
          {listing.snippet}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Create `frontend/components/listings/ListingsPanel.tsx`**

```tsx
"use client"

import { ListingCard } from "./ListingCard"
import { useListings } from "@/hooks/useListings"

export function ListingsPanel() {
  const { listings, loading, error, reload } = useListings()

  return (
    <div className="h-full flex flex-col bg-slate-900">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-white">Today's Picks</h2>
          <p className="text-sm text-slate-500">
            {listings.length > 0
              ? `${listings.length} listings from daily search`
              : "Daily search results — updated every morning at 08:00"}
          </p>
        </div>
        <button
          onClick={reload}
          className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading && (
          <p className="text-slate-500 text-sm text-center mt-12">
            Loading listings…
          </p>
        )}
        {error && (
          <p className="text-red-400 text-sm text-center mt-12">{error}</p>
        )}
        {!loading && !error && listings.length === 0 && (
          <div className="text-center mt-20">
            <p className="text-4xl mb-4">📋</p>
            <p className="text-slate-400 text-sm font-medium">No listings yet</p>
            <p className="text-slate-600 text-xs mt-2 max-w-xs mx-auto leading-relaxed">
              Tell the agent your daily search preferences:
              <br />
              <span className="font-mono text-slate-500">
                "设置每日搜索：agent engineer，上海，fulltime"
              </span>
            </p>
          </div>
        )}
        {!loading && listings.length > 0 && (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
cd frontend && pnpm tsc --noEmit
```

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/hooks/useListings.ts frontend/components/listings/
git commit -m "feat: add listings hook and Today's Picks panel"
```

---

## Task 8: Main layout — `/chat` page

**Files:**
- Create: `frontend/app/chat/page.tsx`

This is the entry point once authenticated. It renders:
- Top nav bar with tabs (Chat | Today's Picks) and logout
- Chat tab: left chat panel + right tracker sidebar
- Today's Picks tab: full-width listings grid

- [ ] **Step 1: Create `frontend/app/chat/page.tsx`**

```tsx
"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { isAuthenticated, clearAuth } from "@/lib/auth"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { ApplicationTracker } from "@/components/tracker/ApplicationTracker"
import { ListingsPanel } from "@/components/listings/ListingsPanel"

type Tab = "chat" | "picks"

export default function ChatPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>("chat")
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login")
    } else {
      setReady(true)
    }
  }, [router])

  function handleLogout() {
    clearAuth()
    router.replace("/login")
  }

  if (!ready) return null

  return (
    <div className="h-screen flex flex-col bg-slate-900 overflow-hidden">
      {/* Top nav */}
      <nav className="flex items-center justify-between px-4 py-2 border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-1">
          <span className="text-white font-bold text-sm mr-3">🎯 Job Hunter</span>
          {(
            [
              { key: "chat", label: "Chat" },
              { key: "picks", label: "Today's Picks" },
            ] as { key: Tab; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === key
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={handleLogout}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-2 py-1 rounded hover:bg-slate-800"
        >
          Logout
        </button>
      </nav>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {tab === "chat" ? (
          <div className="h-full flex">
            {/* Chat panel — takes remaining width */}
            <div className="flex-1 min-w-0 overflow-hidden">
              <ChatPanel />
            </div>
            {/* Application tracker — fixed width sidebar */}
            <div className="w-72 xl:w-80 flex-shrink-0 overflow-hidden">
              <ApplicationTracker />
            </div>
          </div>
        ) : (
          <ListingsPanel />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify full TypeScript compilation**

```bash
cd frontend && pnpm tsc --noEmit
```

Expected: No errors.

- [ ] **Step 3: Full smoke test**

Prerequisites: backend running on http://localhost:8000 (`make dev` from repo root), frontend running (`cd frontend && pnpm dev`).

```
1. Open http://localhost:3000 → redirects to /login
2. Register: email=test@example.com, password=Test@1234 → redirects to /chat
3. Chat tab is active: left panel shows welcome message, right panel shows empty tracker
4. Type "你好" → agent responds as job-hunting specialist (no tool calls)
5. Type "帮我找上海的agent engineer工作" → SSE stream shows ⚙️ Job Search card while running, then ✅ when done, then text response
6. Click "Today's Picks" tab → empty state with instructions
7. In tracker: click "+ Add", enter company + title → card appears in "Applied" column
8. Change status via dropdown → card color updates
9. Click logout → redirects to /login, localStorage cleared
```

- [ ] **Step 4: Commit**

```bash
git add frontend/app/chat/
git commit -m "feat: add main chat page with tabs, auth guard, and panel layout"
```

---

## Notes

- Backend must be running on `http://localhost:8000`. Set `NEXT_PUBLIC_API_URL` in `frontend/.env.local` if using a different port.
- Daily listings appear after 08:00 once preferences are set via agent: "设置每日搜索：agent engineer，上海，fulltime"
- Each browser session creates a fresh chat session (no session persistence across page reloads — each login creates a new session). Conversation history across reloads would require persisting the session token AND the session_id for `get_chat_history` calls.
