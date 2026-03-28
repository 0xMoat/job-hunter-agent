"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { isAuthenticated, clearAuth, getAccessToken } from "@/lib/auth"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { SessionSidebar } from "@/components/chat/SessionSidebar"
import { KanbanBoard } from "@/components/tracker/KanbanBoard"
import { SystemPromptModal } from "@/components/settings/SystemPromptModal"
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
          <span className="font-heading italic text-lg tracking-tight text-[var(--text)]">
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
          <div className="flex items-center gap-1">
            <button
              onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
              aria-label="Switch language"
              className="text-xs font-body font-medium text-[var(--text-3)]
                         hover:text-[var(--text-2)] px-3 py-1.5 rounded-full
                         hover:bg-black/5 transition-colors tracking-wide"
            >
              {t('lang_toggle')}
            </button>
            <button
              onClick={() => setShowSettings(true)}
              aria-label={t('settings_aria') as string}
              className="w-8 h-8 flex items-center justify-center rounded-full
                         text-[var(--text-3)] hover:text-[var(--text-2)]
                         hover:bg-black/5 transition-colors text-base"
            >
              ⚙
            </button>
            <button
              onClick={handleLogout}
              className="text-xs font-body text-[var(--text-3)] hover:text-[var(--text-2)]
                         px-3 py-1.5 rounded-full hover:bg-black/5 transition-colors"
            >
              {t('logout')}
            </button>
          </div>
        </nav>
      </div>

      {showSettings && (
        <SystemPromptModal
          accessToken={getAccessToken() ?? ""}
          onClose={() => setShowSettings(false)}
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
          <KanbanBoard />
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
