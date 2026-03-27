"use client"

import { useState, useRef, useEffect } from "react"
import type { ToolCallEntry } from "@/lib/types"
import { useLanguage } from "@/contexts/LanguageContext"
import { highlightJson } from "@/lib/highlightJson"

const TOOL_LABELS: Record<string, string> = {
  job_search_tool: "Job Search",
  company_research_tool: "Company Research",
  cover_letter_tool: "Cover Letter",
  application_tracker_tool: "Application Tracker",
  job_preferences_tool: "Preferences",
  duckduckgo_search: "Web Search",
}

/** Extracts the first string/number key-value from a JSON string for the header preview. */
function extractKeyParamPreview(callingContent: string): string {
  if (!callingContent) return ""
  try {
    const parsed = JSON.parse(callingContent)
    if (typeof parsed !== "object" || parsed === null) return ""
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") return `${key}: "${value}"`
      if (typeof value === "number") return `${key}: ${value}`
    }
    return ""
  } catch {
    return ""
  }
}

interface Props {
  entry: ToolCallEntry
  isStreaming?: boolean
}

export function ToolCallCard({ entry, isStreaming }: Props) {
  const { t } = useLanguage()
  const label = TOOL_LABELS[entry.toolName] ?? entry.toolName
  const isRunning = entry.status === "calling"
  const isDone = entry.status === "done"

  // Initialize expanded based on whether streaming is active at mount time.
  // Cards created during streaming start expanded; historical cards start collapsed.
  const [expanded, setExpanded] = useState(isStreaming === true)

  // Auto-collapse when streaming ends, but only for cards that were streaming.
  // The ref guards against the effect firing redundantly on historical card mounts.
  const wasStreamingRef = useRef(isStreaming === true)
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setExpanded(false)
    }
    if (isStreaming) wasStreamingRef.current = true
  }, [isStreaming])

  const preview = extractKeyParamPreview(entry.callingContent)

  return (
    <div className="glass rounded-xl my-1">
      <div className="overflow-hidden rounded-xl">

        {/* Header */}
        <button
          onClick={() => !isRunning && setExpanded((e) => !e)}
          disabled={isRunning}
          aria-expanded={expanded}
          className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
            !isRunning ? "hover:bg-white/20 cursor-pointer" : "cursor-default"
          } ${expanded ? "border-b border-[var(--border)]" : ""}`}
        >
          {/* Status dot */}
          <span
            className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${
              isDone
                ? "bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.4)]"
                : "bg-amber-400 animate-pulse"
            }`}
          />

          {/* Tool name */}
          <span className="font-body font-semibold text-sm text-[var(--text-2)] flex-shrink-0">
            {label}
          </span>

          {/* Raw function name */}
          <span className="font-mono text-[10px] text-[var(--text-3)] bg-black/[0.06] px-1.5 py-0.5 rounded flex-shrink-0">
            {entry.toolName}
          </span>

          {/* Key param preview */}
          {preview && (
            <span className="font-mono text-xs text-[var(--text-3)] max-w-[180px] truncate flex-shrink min-w-0">
              {preview}
            </span>
          )}

          {/* Right side: running label OR expand/collapse toggle */}
          {isRunning ? (
            <span className="ml-auto font-body font-light text-xs text-[var(--text-3)] animate-pulse flex-shrink-0">
              {t("tool_running")}
            </span>
          ) : (
            <span className="ml-auto font-body text-xs text-[var(--text-3)] flex-shrink-0">
              {expanded ? `${t("tool_collapse")} ∧` : `${t("tool_expand")} ∨`}
            </span>
          )}
        </button>

        {/* Expanded body */}
        {expanded && (
          <>
            {/* Request section — hidden if callingContent is empty */}
            {entry.callingContent.length > 0 && (
              <div className="border-b border-[var(--border)]">
                <div className="px-3 py-1 text-[9px] font-body font-bold tracking-widest uppercase text-[var(--text-3)] bg-black/[0.02]">
                  {t("tool_request")}
                </div>
                <pre
                  className="px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--text-strong-2)] overflow-x-auto"
                  dangerouslySetInnerHTML={{ __html: highlightJson(entry.callingContent) }}
                />
              </div>
            )}

            {/* Response section — always shown when expanded */}
            <div>
              <div className="px-3 py-1 text-[9px] font-body font-bold tracking-widest uppercase text-[var(--text-3)] bg-black/[0.02] border-b border-[var(--border)]">
                {t("tool_response")}
              </div>
              {isRunning ? (
                /* Bounce-dot animation (same pattern as ChatPanel.tsx) */
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="flex gap-1" aria-hidden="true">
                    <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:300ms]" />
                  </span>
                  <span className="font-body text-xs italic text-[var(--text-3)]">
                    {t("tool_fetching")}
                  </span>
                </div>
              ) : entry.resultContent ? (
                <pre
                  className="px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--text-strong-2)] overflow-x-auto"
                  dangerouslySetInnerHTML={{ __html: highlightJson(entry.resultContent) }}
                />
              ) : (
                <p className="px-3 py-2 font-body text-xs italic text-[var(--text-3)]">
                  {t("tool_no_content")}
                </p>
              )}
            </div>
          </>
        )}

      </div>
    </div>
  )
}
