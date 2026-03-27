// All fetch calls to the FastAPI backend.
// Set NEXT_PUBLIC_API_URL in .env.local to override the default.

import type { Application, JobListing } from "./types"

export interface SessionItem {
  session_id: string
  name: string
  token: {
    access_token: string
    token_type: string
    expires_at: string
  }
  created_at?: string
}

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

// ── Sessions ──────────────────────────────────────────────────────────────

export async function apiGetSessions(
  accessToken: string,
): Promise<SessionItem[]> {
  const res = await req("/api/v1/auth/sessions", {}, accessToken)
  return res.json()
}

// Authorization uses the session JWT (not user JWT).
// The sessionId in the path must match the session encoded in sessionToken.
export async function apiDeleteSession(
  sessionToken: string,
  sessionId: string,
): Promise<void> {
  await req(
    `/api/v1/auth/session/${sessionId}`,
    { method: "DELETE" },
    sessionToken,
  )
}

export interface HistoryToolCall {
  tool_call_id: string
  tool_name: string
  calling_args: string
  result?: string
}

export interface HistoryMessageItem {
  role: string
  content: string
  tool_calls: HistoryToolCall[]
}

export async function apiGetMessages(
  sessionToken: string,
): Promise<HistoryMessageItem[]> {
  const res = await req("/api/v1/chatbot/messages", {}, sessionToken)
  const data = await res.json()
  return data.messages
}

// ── Settings ──────────────────────────────────────────────────────────────

export interface SystemPromptResponse {
  prompt: string
  is_default: boolean
}

export async function apiGetLangfuseUrlBase(
  accessToken: string,
): Promise<string | null> {
  const res = await req("/api/v1/settings/langfuse-url", {}, accessToken)
  const data = await res.json()
  return data.url_base ?? null
}

export async function apiGetSystemPrompt(
  accessToken: string,
): Promise<SystemPromptResponse> {
  const res = await req("/api/v1/settings/system-prompt", {}, accessToken)
  return res.json()
}

// Throws with the server's `detail` string on 422 validation failure.
export async function apiSaveSystemPrompt(
  accessToken: string,
  prompt: string,
): Promise<SystemPromptResponse> {
  const res = await fetch(`${BASE_URL}/api/v1/settings/system-prompt`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ prompt }),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(body.detail || `HTTP ${res.status}`)
  }
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
