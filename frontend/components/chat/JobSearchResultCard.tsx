"use client"

import { useState } from "react"
import type { ToolCallEntry } from "@/lib/types"
import { apiBatchCreateApplications } from "@/lib/api"
import { getSessionToken } from "@/lib/auth"

interface JobResult {
  title: string
  link: string
  snippet: string
}

interface Props {
  entry: ToolCallEntry
}

function parseResults(entry: ToolCallEntry): { keywords: string; results: JobResult[] } {
  try {
    const data = JSON.parse(entry.resultContent ?? "{}")
    const keywords = [data.keywords, data.location].filter(Boolean).join(" · ")
    const results: JobResult[] = (data.results ?? []).filter(
      (r: JobResult) => r.link && r.link.length > 0,
    )
    return { keywords, results }
  } catch {
    return { keywords: "", results: [] }
  }
}

export function JobSearchResultCard({ entry }: Props) {
  const { keywords, results } = parseResults(entry)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle")
  const [savedUrls, setSavedUrls] = useState<Set<string>>(new Set())
  const [feedback, setFeedback] = useState("")

  const toggle = (idx: number) => {
    if (status !== "idle") return
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const handleSave = async () => {
    const token = getSessionToken()
    if (!token || selected.size === 0) return
    setStatus("saving")
    try {
      const listings = Array.from(selected).map((idx) => {
        const r = results[idx]
        return {
          title: r.title,
          company: "",
          url: r.link,
          snippet: r.snippet,
          source: "chat",
        }
      })
      const res = await apiBatchCreateApplications(token, listings)
      const newSaved = new Set(savedUrls)
      listings.forEach((l) => newSaved.add(l.url))
      setSavedUrls(newSaved)
      setSelected(new Set())
      setStatus("saved")
      if (res.skipped > 0) {
        setFeedback(`已保存 ${res.inserted} 条，${res.skipped} 条已存在`)
      } else {
        setFeedback(`已保存 ${res.inserted} 条到看板`)
      }
    } catch {
      setStatus("idle")
      setFeedback("保存失败，请重试")
    }
  }

  if (results.length === 0) {
    return (
      <div className="glass rounded-xl my-1 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-[var(--text-2)]">
          <span className="w-[7px] h-[7px] rounded-full bg-green-500 flex-shrink-0" />
          <span className="font-body font-semibold">Job Search</span>
          {keywords && <span className="font-mono text-xs text-[var(--text-3)]">{keywords}</span>}
        </div>
        <p className="mt-2 text-xs font-body text-[var(--text-3)] italic">未找到相关职位</p>
      </div>
    )
  }

  return (
    <div className="glass rounded-xl my-1 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
        <span className="w-[7px] h-[7px] rounded-full bg-green-500 flex-shrink-0" />
        <span className="font-body font-semibold text-sm text-[var(--text-2)]">Job Search</span>
        {keywords && (
          <span className="font-mono text-xs text-[var(--text-3)] truncate">{keywords}</span>
        )}
        <span className="ml-auto font-mono text-xs text-[var(--text-3)]">{results.length} 条结果</span>
      </div>

      {/* Result list */}
      <div className="divide-y divide-[var(--border)]">
        {results.map((r, idx) => {
          const isSaved = savedUrls.has(r.link)
          const isSelected = selected.has(idx)
          return (
            <label
              key={idx}
              className={`flex gap-3 px-4 py-3 cursor-pointer transition-colors ${
                isSaved
                  ? "opacity-60 cursor-default"
                  : isSelected
                    ? "bg-[var(--accent)]/[0.04]"
                    : "hover:bg-black/[0.02]"
              }`}
              onClick={(e) => {
                if (isSaved) {
                  e.preventDefault()
                  return
                }
                toggle(idx)
              }}
            >
              {/* Checkbox */}
              <div className="pt-0.5 flex-shrink-0">
                {isSaved ? (
                  <span className="flex items-center justify-center w-4 h-4 rounded bg-green-500 text-white text-[10px]">
                    ✓
                  </span>
                ) : (
                  <span
                    className={`flex items-center justify-center w-4 h-4 rounded border transition-colors ${
                      isSelected
                        ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] text-[10px]"
                        : "border-[var(--border-strong)]"
                    }`}
                  >
                    {isSelected && "✓"}
                  </span>
                )}
              </div>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <p className="font-body font-semibold text-sm text-[var(--text)] leading-snug line-clamp-1">
                  {r.title}
                </p>
                <p className="font-body text-xs text-[var(--text-3)] mt-0.5 line-clamp-2 leading-relaxed">
                  {r.snippet}
                </p>
                <a
                  href={r.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-block mt-1 font-mono text-[10px] text-[var(--accent)] opacity-60 hover:opacity-100 truncate max-w-[280px]"
                >
                  {(() => { try { return new URL(r.link).hostname } catch { return r.link } })()} ↗
                </a>
              </div>
            </label>
          )
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--border)] bg-black/[0.01]">
        {feedback && (
          <span className="font-body text-xs text-[var(--text-3)]">{feedback}</span>
        )}
        {!feedback && <span />}
        {status === "saved" ? (
          <span className="font-body text-xs font-semibold text-green-600">已保存 ✓</span>
        ) : (
          <button
            onClick={handleSave}
            disabled={selected.size === 0 || status === "saving"}
            className={`font-body text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              selected.size === 0 || status === "saving"
                ? "text-[var(--text-3)] bg-black/[0.03] cursor-not-allowed"
                : "text-[var(--accent-fg)] bg-[var(--accent)] hover:opacity-90 cursor-pointer"
            }`}
          >
            {status === "saving"
              ? "保存中..."
              : `保存到看板${selected.size > 0 ? ` (${selected.size})` : ""}`}
          </button>
        )}
      </div>
    </div>
  )
}
