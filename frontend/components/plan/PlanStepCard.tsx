"use client"

import { useState } from "react"
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

export function PlanStepCard({ step }: { step: PlanStep }) {
  // Expand by default while running; collapse once done/failed.
  const [expanded, setExpanded] = useState(step.status === "running")
  const hasResult = Boolean(step.result && step.result.length > 0)

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
            <div className="text-sm font-medium">Step {step.index + 1}</div>
            {hasResult && (
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
          {hasResult && expanded && (
            <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap rounded bg-white/70 p-2 text-xs leading-relaxed">
              {step.result}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
