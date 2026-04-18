const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"

async function fetchJson<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  })
  if (!res.ok) throw new Error(await res.text().catch(() => `HTTP ${res.status}`))
  return res.json() as Promise<T>
}

export interface TutorialStatus {
  has_tutorial_session: boolean
  tutorial_session_id: string | null
  tutorial_completed: boolean
  resume_is_default: boolean
}

export function apiTutorialStatus(accessToken: string) {
  return fetchJson<TutorialStatus>("/api/v1/tutorial/status", accessToken)
}

export function apiTutorialSeed(accessToken: string, locale: string) {
  return fetchJson<{ session_id: string; name: string }>(
    "/api/v1/tutorial/seed",
    accessToken,
    { method: "POST", body: JSON.stringify({ locale }) },
  )
}

export function apiTutorialReplay(accessToken: string, locale: string) {
  return fetchJson<{ session_id: string; name: string }>(
    "/api/v1/tutorial/replay",
    accessToken,
    { method: "POST", body: JSON.stringify({ locale }) },
  )
}

export function apiTutorialDismiss(accessToken: string) {
  return fetchJson<{ ok: boolean }>("/api/v1/tutorial/dismiss", accessToken, { method: "POST" })
}
