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
