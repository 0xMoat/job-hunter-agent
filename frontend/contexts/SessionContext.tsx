"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react"
import { apiCreateSession, apiDeleteSession, apiGetLangfuseUrlBase, apiGetSessions, type SessionItem } from "@/lib/api"
import {
  getAccessToken,
  getSessionId,
  getSessionToken,
  setSessionId,
  setSessionToken,
} from "@/lib/auth"

interface SessionContextValue {
  sessions: SessionItem[]
  currentSessionId: string | null
  currentSessionToken: string | null
  loading: boolean
  langfuseUrlBase: string | null
  switchSession: (id: string) => void
  createSession: () => Promise<void>
  renameSession: (id: string, name: string) => void
  deleteSession: (id: string) => Promise<void>
}

const SessionContext = createContext<SessionContextValue | null>(null)

export function SessionProvider({
  children,
  initialSessionId,
  onSessionChange,
}: {
  children: React.ReactNode
  /** URL-provided session id — takes precedence over localStorage on first load. */
  initialSessionId?: string | null
  /** Called when the active session changes, so the parent can sync the URL. */
  onSessionChange?: (sessionId: string) => void
}) {
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [currentSessionToken, setCurrentSessionToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [langfuseUrlBase, setLangfuseUrlBase] = useState<string | null>(null)

  useEffect(() => {
    const accessToken = getAccessToken()
    if (!accessToken) {
      setLoading(false)
      return
    }

    apiGetLangfuseUrlBase(accessToken).then(setLangfuseUrlBase).catch(() => {})

    apiGetSessions(accessToken)
      .then((list) => {
        setSessions(list)
        const preferredId = initialSessionId || getSessionId()
        const match = preferredId ? list.find((s) => s.session_id === preferredId) : list[0]
        if (match) {
          setCurrentSessionId(match.session_id)
          setCurrentSessionToken(match.token.access_token)
        }
      })
      .catch(() => {
        // sessions list unavailable — fall back to stored tokens in localStorage
        const storedToken = getSessionToken()
        const storedId = getSessionId()
        if (storedToken && storedId) {
          setCurrentSessionId(storedId)
          setCurrentSessionToken(storedToken)
        }
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
      onSessionChange?.(id)
    },
    [sessions, onSessionChange],
  )

  const createSession = useCallback(async () => {
    const accessToken = getAccessToken()
    if (!accessToken) return
    // No silent-return guard: if the user clicked, respect it. Button is
    // already `disabled={loading || streaming}` which prevents double-clicks.
    // Empty shells can be cleaned up by the user or a backend sweep later.
    setLoading(true)
    try {
      const session = await apiCreateSession(accessToken)
      const newItem = {
        session_id: session.session_id,
        name: session.name,
        token: session.token,
        is_tutorial: (session as Partial<SessionItem>).is_tutorial ?? false,
      } as SessionItem
      setSessions((prev) => [newItem, ...prev])
      setCurrentSessionId(session.session_id)
      setCurrentSessionToken(session.token.access_token)
      setSessionToken(session.token.access_token)
      setSessionId(session.session_id)
      onSessionChange?.(session.session_id)
    } finally {
      setLoading(false)
    }
  }, [onSessionChange])

  const renameSession = useCallback((id: string, name: string) => {
    setSessions((prev) =>
      prev.map((s) => (s.session_id === id ? { ...s, name } : s)),
    )
  }, [])

  const deleteSession = useCallback(
    async (id: string) => {
      const target = sessions.find((s) => s.session_id === id)
      if (!target) return
      await apiDeleteSession(target.token.access_token, id)
      const remaining = sessions.filter((s) => s.session_id !== id)
      setSessions(remaining)
      if (id === currentSessionId) {
        if (remaining.length > 0) {
          const next = remaining[0]
          setCurrentSessionId(next.session_id)
          setCurrentSessionToken(next.token.access_token)
          setSessionToken(next.token.access_token)
          setSessionId(next.session_id)
          onSessionChange?.(next.session_id)
        } else {
          setCurrentSessionId(null)
          setCurrentSessionToken(null)
        }
      }
    },
    [sessions, currentSessionId],
  )

  return (
    <SessionContext.Provider
      value={{
        sessions,
        currentSessionId,
        currentSessionToken,
        loading,
        langfuseUrlBase,
        switchSession,
        createSession,
        renameSession,
        deleteSession,
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
