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
      const newItem = {
        session_id: session.session_id,
        name: session.name,
        token: session.token,
      } as SessionItem
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
