"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { isAuthenticated, clearAuth } from "@/lib/auth"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { SessionSidebar } from "@/components/chat/SessionSidebar"
import { ApplicationTracker } from "@/components/tracker/ApplicationTracker"
import { ListingsPanel } from "@/components/listings/ListingsPanel"
import { SessionProvider } from "@/contexts/SessionContext"
import { useLanguage } from "@/contexts/LanguageContext"

type Tab = "chat" | "picks"

function ChatPageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t, locale, setLocale } = useLanguage()

  const [tab, setTab] = useState<Tab>(() => {
    const p = searchParams.get("tab")
    return p === "picks" ? "picks" : "chat"
  })
  const [ready] = useState(() => isAuthenticated())
  const [streaming, setStreaming] = useState(false)

  useEffect(() => {
    if (!ready) {
      router.replace("/login")
    }
  }, [ready, router])

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
              { key: "picks" as Tab, label: t('tab_picks') },
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
              onClick={handleLogout}
              className="text-xs font-body text-[var(--text-3)] hover:text-[var(--text-2)]
                         px-3 py-1.5 rounded-full hover:bg-black/5 transition-colors"
            >
              {t('logout')}
            </button>
          </div>
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden px-4 pb-4">
        {tab === "chat" ? (
          <div className="h-full flex gap-3">
            {/* Session sidebar */}
            <SessionSidebar streaming={streaming} />

            {/* Chat + tracker */}
            <div className="flex-1 min-w-0 overflow-hidden flex gap-4">
              <div className="flex-1 min-w-0 overflow-hidden">
                <ChatPanel onStreamingChange={setStreaming} />
              </div>
              <div className="w-72 xl:w-80 flex-shrink-0 overflow-hidden">
                <ApplicationTracker />
              </div>
            </div>
          </div>
        ) : (
          <ListingsPanel />
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
