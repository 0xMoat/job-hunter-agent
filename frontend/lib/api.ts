// All fetch calls to the FastAPI backend.
// Set NEXT_PUBLIC_API_URL in .env.local to override the default.

import type { Application, ApplicationStatus } from "./types"

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

export interface GoogleLoginResult {
  user: { id: number; email: string; name: string; avatar_url: string }
  token: { access_token: string; token_type: string; expires_at: string }
}

export async function apiGoogleLogin(
  credential: string,
): Promise<GoogleLoginResult> {
  const res = await req("/api/v1/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  })
  return res.json()
}

// Create a chat session with the access token.
// Returns {session_id, name, token: {access_token, ...}}
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
): Promise<{ applications: Application[]; count: number; archived_count: number }> {
  const res = await req("/api/v1/applications", {}, sessionToken)
  return res.json()
}

export async function apiAddApplication(
  sessionToken: string,
  data: { company: string; title: string; url?: string; notes?: string; status?: ApplicationStatus },
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
  data: { status?: ApplicationStatus; notes?: string },
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

export async function apiMoveCard(
  sessionToken: string,
  id: number,
  status: ApplicationStatus,
): Promise<Application> {
  return apiUpdateApplication(sessionToken, id, { status })
}

export async function apiDeleteApplication(
  sessionToken: string,
  id: number,
): Promise<void> {
  await req(`/api/v1/applications/${id}`, { method: "DELETE" }, sessionToken)
}

export async function apiBatchCreateApplications(
  sessionToken: string,
  listings: { title: string; company: string; url: string; snippet: string; source: string }[],
): Promise<{ inserted: number; skipped: number }> {
  const res = await req(
    "/api/v1/applications/batch",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listings }),
    },
    sessionToken,
  )
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

// ── Resume ────────────────────────────────────────────────────────────────

export async function apiGetResume(
  accessToken: string,
): Promise<{ resume_text: string | null }> {
  const res = await req("/api/v1/settings/resume", {}, accessToken)
  return res.json()
}

export async function apiSaveResume(
  accessToken: string,
  resume_text: string,
): Promise<{ resume_text: string | null }> {
  const res = await req(
    "/api/v1/settings/resume",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume_text }),
    },
    accessToken,
  )
  return res.json()
}

// ── Search config ─────────────────────────────────────────────────────────

export interface SearchConfig {
  target_sites: string
  schedule_enabled: boolean
  schedule_cron: string
}

export async function apiGetSearchConfig(accessToken: string): Promise<SearchConfig> {
  const res = await req("/api/v1/search/config", {}, accessToken)
  return res.json()
}

export async function apiSaveSearchConfig(
  accessToken: string,
  config: SearchConfig,
): Promise<SearchConfig> {
  const res = await req(
    "/api/v1/search/config",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    },
    accessToken,
  )
  return res.json()
}

export async function apiRunSearch(
  accessToken: string,
): Promise<{ inserted: number; skipped: number }> {
  const res = await req("/api/v1/search/run", { method: "POST" }, accessToken)
  return res.json()
}

// ── Plan-and-Execute ─────────────────────────────────────────────────────

export interface PlanExecuteResumeArgs {
  threadId: string
  action: "approve" | "revise" | "cancel"
  feedback?: string
}

export async function startPlanExecute(
  token: string,
  goal?: string,
): Promise<Response> {
  const body = goal ? JSON.stringify({ goal }) : JSON.stringify({})
  return fetch(`${BASE_URL}/api/v1/chatbot/plan-execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body,
  })
}

export async function resumePlanExecute(
  token: string,
  args: PlanExecuteResumeArgs,
): Promise<Response> {
  const body: Record<string, unknown> = {
    thread_id: args.threadId,
    resume_action: args.action,
  }
  if (args.action === "revise" && args.feedback) {
    body.feedback = args.feedback
  }
  return fetch(`${BASE_URL}/api/v1/chatbot/plan-execute`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  })
}
