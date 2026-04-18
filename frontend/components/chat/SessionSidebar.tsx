"use client"

import { useState } from "react"
import { useSession } from "@/contexts/SessionContext"
import { useLanguage } from "@/contexts/LanguageContext"
import type { Locale } from "@/lib/i18n"

function formatSessionDate(dateStr: string | undefined, locale: Locale): string {
  if (!dateStr) return ""
  const date = new Date(dateStr)
  const now = new Date()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterdayStart = new Date(todayStart.getTime() - 86400000)
  const sessionDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  const hh = String(date.getHours()).padStart(2, "0")
  const mm = String(date.getMinutes()).padStart(2, "0")
  const timeStr = `${hh}:${mm}`

  if (sessionDayStart.getTime() === todayStart.getTime()) return timeStr
  if (sessionDayStart.getTime() === yesterdayStart.getTime()) {
    return locale === "zh-CN" ? `昨天 ${timeStr}` : `Yesterday ${timeStr}`
  }
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}/${date.getDate()} ${timeStr}`
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
}

export function SessionSidebar({ streaming }: { streaming: boolean }) {
  const { sessions, currentSessionId, loading, langfuseUrlBase, switchSession, createSession, deleteSession } = useSession()
  const { t, locale } = useLanguage()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function handleDelete(e: React.MouseEvent, sessionId: string) {
    e.stopPropagation()
    if (deletingId) return
    setDeletingId(sessionId)
    try {
      await deleteSession(sessionId)
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <div className="flex-shrink-0 w-52" data-tour="sidebar">
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
              const displayName = session.name || t('sidebar_unnamed')
              const dateLabel = formatSessionDate(session.created_at, locale)
              const isDeleting = deletingId === session.session_id
              return (
                <div
                  key={session.session_id}
                  className={`group flex items-center rounded-xl mb-0.5 transition-colors ${
                    isActive
                      ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                      : "text-[var(--text-2)] hover:bg-black/5 hover:text-[var(--text)]"
                  }`}
                >
                  <button
                    onClick={() => switchSession(session.session_id)}
                    className="flex-1 text-left px-3 py-2 min-w-0"
                  >
                    <span className="flex items-center gap-1 text-xs font-body font-medium truncate">
                      <span className="truncate">{displayName}</span>
                      {session.is_tutorial && (
                        <span className="flex-shrink-0 inline-flex items-center rounded-full bg-indigo-100 text-indigo-700 px-1.5 py-0.5 text-[9px] font-medium">
                          {t('tutorial_badge')}
                        </span>
                      )}
                    </span>
                    {dateLabel && (
                      <span className={`block text-[10px] font-body mt-0.5 ${
                        isActive ? "opacity-70" : "opacity-50"
                      }`}>
                        {dateLabel}
                      </span>
                    )}
                  </button>
                  {langfuseUrlBase && (
                    <a
                      href={`${langfuseUrlBase}/sessions/${session.session_id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      aria-label="Langfuse trace"
                      className={`flex-shrink-0 p-1 rounded transition-opacity
                        opacity-0 group-hover:opacity-100
                        ${isActive
                          ? "hover:bg-white/20 text-[var(--accent-fg)]"
                          : "hover:bg-black/10 text-[var(--text-3)] hover:text-[var(--text-2)]"
                        }`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </a>
                  )}
                  <button
                    onClick={(e) => handleDelete(e, session.session_id)}
                    disabled={isDeleting}
                    aria-label={t('delete')}
                    className={`flex-shrink-0 mr-1.5 p-1 rounded transition-opacity
                      opacity-0 group-hover:opacity-100
                      disabled:opacity-30
                      ${isActive
                        ? "hover:bg-white/20 text-[var(--accent-fg)]"
                        : "hover:bg-black/10 text-[var(--text-3)] hover:text-[var(--text-2)]"
                      }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                </div>
              )
            })}
          </div>

        </div>
    </div>
  )
}
