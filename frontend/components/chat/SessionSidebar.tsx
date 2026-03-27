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
              const displayName = session.name || t('sidebar_unnamed')
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
