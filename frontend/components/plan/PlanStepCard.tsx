"use client"

import { useEffect, useRef, useState } from "react"
import type { PlanStep } from "@/lib/types"

const STATUS_STYLES: Record<PlanStep["status"], string> = {
  pending: "border-zinc-300 bg-zinc-50 text-zinc-500",
  running: "border-blue-400 bg-blue-50 text-blue-700 animate-pulse",
  done: "border-emerald-500 bg-emerald-50 text-emerald-800",
  failed: "border-rose-500 bg-rose-50 text-rose-800",
}

const STATUS_ICON: Record<PlanStep["status"], string> = {
  pending: "○",
  running: "◐",
  done: "✓",
  failed: "✗",
}

const TOOL_LABELS: Record<string, string> = {
  job_search_tool: "Job Search",
  company_research_tool: "Company Research",
  cover_letter_tool: "Cover Letter",
  application_tracker_tool: "Application Tracker",
  job_preferences_tool: "Preferences",
  duckduckgo_search: "Web Search",
}

function previewArgs(args: string): string {
  if (!args) return ""
  const trimmed = args.length > 120 ? args.slice(0, 120) + "…" : args
  return trimmed
}

function previewResult(result: string): string {
  if (!result) return ""
  // Keep the card from ballooning with long tool outputs; the final
  // step_completed result is where the full text lives anyway.
  const clipped = result.length > 400 ? result.slice(0, 400) + "…" : result
  return clipped
}

export function PlanStepCard({ step, position }: { step: PlanStep; position: number }) {
  const isRunning = step.status === "running"
  const hasResult = Boolean(step.result && step.result.length > 0)
  const hasLive = Boolean(
    (step.liveText && step.liveText.length > 0) || (step.toolCalls && step.toolCalls.length > 0),
  )
  // Running steps auto-expand so the user sees tokens stream in.
  // Completed steps collapse by default — the user can still expand to
  // inspect the final result.
  const [expanded, setExpanded] = useState(isRunning || hasLive)
  const wasRunningRef = useRef(isRunning)
  useEffect(() => {
    // When a step enters running state (after mounting as pending), expand it.
    // When it leaves running state (done/failed), collapse it so the list stays tidy.
    if (isRunning && !wasRunningRef.current) setExpanded(true)
    if (!isRunning && wasRunningRef.current) setExpanded(false)
    wasRunningRef.current = isRunning
  }, [isRunning])
  const canExpand = hasResult || hasLive

  return (
    <div
      className={`rounded-lg border px-4 py-3 transition-colors ${STATUS_STYLES[step.status]}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 font-mono text-lg leading-none">
          {STATUS_ICON[step.status]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium">Step {position}</div>
            {canExpand && (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="shrink-0 text-xs font-medium opacity-70 hover:opacity-100 underline-offset-2 hover:underline cursor-pointer"
              >
                {expanded ? "收起 ▲" : "查看过程 ▼"}
              </button>
            )}
          </div>
          <div className="mt-1 text-sm opacity-90">{step.text}</div>

          {expanded && (
            <div className="mt-2 flex flex-col gap-2">
              {/* Live tool calls — shown on running + completed steps */}
              {step.toolCalls && step.toolCalls.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  {step.toolCalls.map((tc) => {
                    const label = tc.name ? (TOOL_LABELS[tc.name] ?? tc.name) : "tool"
                    const running = !tc.result
                    return (
                      <div
                        key={tc.id}
                        className="rounded-md border border-white/70 bg-white/80 px-2.5 py-1.5 text-xs"
                      >
                        <div className="flex items-center gap-1.5 text-zinc-800">
                          <span
                            className={`inline-block h-1.5 w-1.5 rounded-full ${
                              running ? "animate-pulse bg-amber-400" : "bg-emerald-500"
                            }`}
                          />
                          <span className="font-semibold">{label}</span>
                          {tc.name && (
                            <span className="font-mono text-[10px] text-zinc-500">
                              {tc.name}
                            </span>
                          )}
                          {running && (
                            <span className="ml-auto text-[10px] italic text-zinc-500">
                              调用中…
                            </span>
                          )}
                        </div>
                        {tc.args && (
                          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-snug text-zinc-600">
                            {previewArgs(tc.args)}
                          </pre>
                        )}
                        {tc.result && (
                          <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] leading-snug text-zinc-700">
                            {previewResult(tc.result)}
                          </pre>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Live token stream */}
              {isRunning && step.liveText && step.liveText.length > 0 && (
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-white/70 p-2 font-mono text-[11px] leading-relaxed text-zinc-800">
                  {step.liveText}
                  <span className="ml-0.5 inline-block h-3 w-1 translate-y-0.5 animate-pulse bg-zinc-700" />
                </pre>
              )}

              {/* Final result (completed / failed steps) */}
              {!isRunning && hasResult && (
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded bg-white/70 p-2 text-xs leading-relaxed">
                  {step.result}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
