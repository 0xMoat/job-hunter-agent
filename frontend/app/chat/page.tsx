"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { isAuthenticated, clearAuth, getAccessToken, getUser } from "@/lib/auth"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { SessionSidebar } from "@/components/chat/SessionSidebar"
import { KanbanBoard } from "@/components/tracker/KanbanBoard"
import { SettingsModal } from "@/components/settings/SettingsModal"
import { SessionProvider } from "@/contexts/SessionContext"
import { useLanguage } from "@/contexts/LanguageContext"

type Tab = "chat" | "tracker"

function ChatPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t, locale, setLocale } = useLanguage()

  const [tab, setTab] = useState<Tab>(() => {
    const p = searchParams.get("tab")
    return p === "tracker" ? "tracker" : "chat"
  })
  const [ready, setReady] = useState(false)
  const [streaming, setStreaming] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [kanbanRefreshKey, setKanbanRefreshKey] = useState(0)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const user = getUser()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setShowUserMenu(false)
      }
    }
    if (showUserMenu) document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [showUserMenu])

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login")
    } else {
      setReady(true)
    }
  }, [router])

  function handleTabChange(key: Tab) {
    setTab(key)
    router.replace(`?tab=${key}`, { scroll: false })
  }

  function handleLogout() {
    clearAuth()
    router.replace("/login")
  }

  if (!ready) return null

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Navbar */}
      <div className="px-4 pt-3 pb-2 flex-shrink-0">
        <nav className="glass rounded-full px-5 py-2.5 flex items-center justify-between">
          <span className="flex-1 font-heading italic text-lg tracking-tight text-[var(--text)]">
            Job Hunter ✦
          </span>
          <div role="tablist" className="flex items-center gap-1">
            {([
              { key: "chat" as Tab, label: t('tab_chat') },
              { key: "tracker" as Tab, label: t('tab_tracker') },
            ]).map(({ key, label }) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => handleTabChange(key)}
                className={`rounded-full px-4 py-1.5 text-sm font-body font-medium transition-colors ${
                  tab === key
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "text-[var(--text-2)] hover:bg-black/5 hover:text-[var(--text)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex-1 flex items-center justify-end gap-2">
            <button
              onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
              aria-label="Switch language"
              className="text-xs font-body font-medium text-[var(--text-3)]
                         hover:text-[var(--text-2)] px-3 py-1.5 rounded-full
                         hover:bg-black/5 transition-colors tracking-wide cursor-pointer"
            >
              {t('lang_toggle')}
            </button>
            <div ref={userMenuRef} className="relative">
              <button
                onClick={() => setShowUserMenu((v) => !v)}
                className="flex items-center gap-2 rounded-full px-2 py-1 hover:bg-black/5 transition-colors cursor-pointer"
              >
                {user?.avatar_url && (
                  <img
                    src={user.avatar_url}
                    alt=""
                    className="w-7 h-7 rounded-full"
                    referrerPolicy="no-referrer"
                  />
                )}
                {user?.name && (
                  <span className="text-xs font-body font-medium text-[var(--text-2)] max-w-[100px] truncate">
                    {user.name}
                  </span>
                )}
              </button>
              {showUserMenu && (
                <div className="absolute right-0 top-full mt-2 w-36 bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-lg py-1 z-50">
                  <button
                    onClick={() => { setShowSettings(true); setShowUserMenu(false) }}
                    className="w-full text-left px-4 py-2 text-sm font-body text-[var(--text-2)] hover:bg-black/5 transition-colors cursor-pointer"
                  >
                    {t('settings_title')}
                  </button>
                  <button
                    onClick={() => { handleLogout(); setShowUserMenu(false) }}
                    className="w-full text-left px-4 py-2 text-sm font-body text-[var(--text-2)] hover:bg-black/5 transition-colors cursor-pointer"
                  >
                    {t('logout')}
                  </button>
                </div>
              )}
            </div>
          </div>
        </nav>
      </div>

      {showSettings && (
        <SettingsModal
          accessToken={getAccessToken() ?? ""}
          onClose={() => setShowSettings(false)}
          onSearchComplete={() => setKanbanRefreshKey((k) => k + 1)}
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden px-4 pb-4">
        {tab === "chat" ? (
          <div className="h-full flex gap-3">
            <SessionSidebar streaming={streaming} />
            <div className="flex-1 min-w-0 overflow-hidden">
              <ChatPanel onStreamingChange={setStreaming} />
            </div>
          </div>
        ) : (
          <KanbanBoard key={kanbanRefreshKey} />
        )}
      </div>
    </div>
  )
}

export default function ChatPage() {
  return (
    <SessionProvider>
      <Suspense>
        <ChatPageInner />
      </Suspense>
    </SessionProvider>
  )
}
