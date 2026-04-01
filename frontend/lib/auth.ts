// localStorage helpers for token and user profile management.
// All reads guard against SSR with typeof window checks.

const ACCESS_TOKEN_KEY = "jh_access_token"
const SESSION_TOKEN_KEY = "jh_session_token"
const SESSION_ID_KEY = "jh_session_id"
const USER_KEY = "jh_user"

export interface UserProfile {
  id: number
  email: string
  name: string
  avatar_url: string
}

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

export function getSessionId(): string | null {
  if (typeof window === "undefined") return null
  return localStorage.getItem(SESSION_ID_KEY)
}

export function setSessionId(id: string): void {
  localStorage.setItem(SESSION_ID_KEY, id)
}

export function getUser(): UserProfile | null {
  if (typeof window === "undefined") return null
  const raw = localStorage.getItem(USER_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as UserProfile
  } catch {
    return null
  }
}

export function setUser(user: UserProfile): void {
  localStorage.setItem(USER_KEY, JSON.stringify(user))
}

export function clearAuth(): void {
  localStorage.removeItem(ACCESS_TOKEN_KEY)
  localStorage.removeItem(SESSION_TOKEN_KEY)
  localStorage.removeItem(SESSION_ID_KEY)
  localStorage.removeItem(USER_KEY)
}

export function isAuthenticated(): boolean {
  return !!getSessionToken()
}
