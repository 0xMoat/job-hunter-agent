"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { isAuthenticated, clearAuth } from "@/lib/auth"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { ApplicationTracker } from "@/components/tracker/ApplicationTracker"
import { ListingsPanel } from "@/components/listings/ListingsPanel"
import { useLanguage } from "@/contexts/LanguageContext"

type Tab = "chat" | "picks"

export default function ChatPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t, locale, setLocale } = useLanguage()

  const [tab, setTab] = useState<Tab>(() => {
    const p = searchParams.get("tab")
    return p === "picks" ? "picks" : "chat"
  })
  const [ready, setReady] = useState(false)

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
      {/* Navbar wrapper — floating pill with page padding */}
      <div className="px-4 pt-3 pb-2 flex-shrink-0">
        <nav className="glass rounded-full px-5 py-2.5 flex items-center justify-between">
          {/* Brand */}
          <span className="font-heading italic text-lg tracking-tight text-[var(--text)]">
            Job Hunter ✦
          </span>

          {/* Tab list */}
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

          {/* Right controls */}
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
          <div className="h-full flex gap-4">
            <div className="flex-1 min-w-0 overflow-hidden">
              <ChatPanel />
            </div>
            <div className="w-72 xl:w-80 flex-shrink-0 overflow-hidden">
              <ApplicationTracker />
            </div>
          </div>
        ) : (
          <ListingsPanel />
        )}
      </div>
    </div>
  )
}
