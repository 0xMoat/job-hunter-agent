"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { isAuthenticated, clearAuth } from "@/lib/auth"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { ApplicationTracker } from "@/components/tracker/ApplicationTracker"
import { ListingsPanel } from "@/components/listings/ListingsPanel"

type Tab = "chat" | "picks"

export default function ChatPage() {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>("chat")
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login")
    } else {
      setReady(true)
    }
  }, [router])

  function handleLogout() {
    clearAuth()
    router.replace("/login")
  }

  if (!ready) return null

  return (
    <div className="h-screen flex flex-col bg-slate-900 overflow-hidden">
      {/* Top nav */}
      <nav className="flex items-center justify-between px-4 py-2 border-b border-slate-700 flex-shrink-0">
        <div className="flex items-center gap-1">
          <span className="text-white font-bold text-sm mr-3">🎯 Job Hunter</span>
          {(
            [
              { key: "chat", label: "Chat" },
              { key: "picks", label: "Today's Picks" },
            ] as { key: Tab; label: string }[]
          ).map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                tab === key
                  ? "bg-blue-600 text-white"
                  : "text-slate-400 hover:text-white hover:bg-slate-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <button
          onClick={handleLogout}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-2 py-1 rounded hover:bg-slate-800"
        >
          Logout
        </button>
      </nav>

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        {tab === "chat" ? (
          <div className="h-full flex">
            {/* Chat panel — takes remaining width */}
            <div className="flex-1 min-w-0 overflow-hidden">
              <ChatPanel />
            </div>
            {/* Application tracker — fixed width sidebar */}
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
