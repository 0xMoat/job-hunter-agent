"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { isAuthenticated, getSessionToken } from "@/lib/auth"
import { PlanTimeline } from "@/components/plan/PlanTimeline"

export default function AutoProcessPage() {
  const router = useRouter()
  const [token, setToken] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login")
      return
    }
    const t = getSessionToken()
    if (!t) {
      router.replace("/chat")
      return
    }
    setToken(t)
    setReady(true)
  }, [router])

  if (!ready || !token) return null

  return (
    <main className="min-h-screen bg-[var(--bg)] p-8">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-[var(--text)]">自动处理今日推荐</h1>
            <p className="mt-1 text-sm text-[var(--text-2)]">
              由 Plan-and-Execute Agent 逐步完成：规划 → 研究 → 写信 → 存档 → 汇总。
            </p>
          </div>
          <Link
            href="/chat"
            className="rounded-full border px-3 py-1.5 text-sm text-[var(--text-2)] hover:bg-black/5"
          >
            ← 返回对话
          </Link>
        </div>
        <PlanTimeline token={token} />
      </div>
    </main>
  )
}
