"use client"

import { useState, useEffect, useRef, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { isAuthenticated, clearAuth, getAccessToken, getUser, getSessionToken } from "@/lib/auth"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { SessionSidebar } from "@/components/chat/SessionSidebar"
import { KanbanBoard } from "@/components/tracker/KanbanBoard"
import { SettingsModal } from "@/components/settings/SettingsModal"
import { SessionProvider } from "@/contexts/SessionContext"
import { TourProvider, useTour } from "@/contexts/TourContext"
import { useLanguage } from "@/contexts/LanguageContext"
import { apiListApplications } from "@/lib/api"

type Tab = "chat" | "tracker"
type SettingsTab = "prompt" | "resume" | "search"

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
  const [initialSettingsTab, setInitialSettingsTab] = useState<SettingsTab>("prompt")
  const [kanbanRefreshKey, setKanbanRefreshKey] = useState(0)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [focusAppId, setFocusAppId] = useState<number | null>(null)
  const userMenuRef = useRef<HTMLDivElement>(null)
  const user = getUser()
  const { registerActions } = useTour()

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

  function handleJumpToCard(id: number) {
    setFocusAppId(id)
    handleTabChange("tracker")
  }

  useEffect(() => {
    registerActions({
      openSettings: () => setShowSettings(true),
      setSettingsTab: (t) => setInitialSettingsTab(t),
      closeSettings: () => setShowSettings(false),
      switchToTracker: () => handleTabChange("tracker"),
      switchToChat: () => handleTabChange("chat"),
      closeDrawer: () => setFocusAppId(null),
      openFirstKanbanCard: async () => {
        const token = getSessionToken()
        if (!token) return
        try {
          const { applications } = await apiListApplications(token)
          const pick =
            applications.find((a) => a.source === "tutorial") ??
            applications
              .filter((a) => a.status === "pending" && typeof a.match_score === "number")
              .sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0))[0]
          if (pick) setFocusAppId(pick.id)
        } catch {
          /* ignore */
        }
      },
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerActions])

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
                data-tour={key === "tracker" ? "tab-tracker" : undefined}
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
                data-tour="settings"
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
          activeTab={initialSettingsTab}
          onSearchComplete={() => setKanbanRefreshKey((k) => k + 1)}
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-hidden px-4 pb-4">
        {/* Both panels stay mounted so in-flight chat + P&E state survive tab switches. */}
        <div className={`h-full ${tab === "chat" ? "flex gap-3" : "hidden"}`}>
          <SessionSidebar streaming={streaming} />
          <div className="flex-1 min-w-0 overflow-hidden">
            <ChatPanel
              onStreamingChange={setStreaming}
              onRequestOpenSettings={() => setShowSettings(true)}
              onJumpToCard={handleJumpToCard}
            />
          </div>
        </div>
        <div className={`h-full ${tab === "tracker" ? "" : "hidden"}`}>
          <KanbanBoard
            key={kanbanRefreshKey}
            focusAppId={focusAppId}
            onFocusConsumed={() => setFocusAppId(null)}
          />
        </div>
      </div>
    </div>
  )
}

export default function ChatPage() {
  return (
    <SessionProvider>
      <TourProvider>
        <Suspense>
          <ChatPageInner />
        </Suspense>
      </TourProvider>
    </SessionProvider>
  )
}
