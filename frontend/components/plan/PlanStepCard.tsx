"use client"

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
  return (
    <div
      className={`rounded-lg border px-4 py-3 transition-colors ${STATUS_STYLES[step.status]}`}
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0 font-mono text-lg leading-none">
          {STATUS_ICON[step.status]}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Step {step.index + 1}</div>
          <div className="mt-1 text-sm opacity-90">{step.text}</div>
          {step.result && (
            <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-white/60 p-2 text-xs">
              {step.result}
            </pre>
          )}
        </div>
      </div>
    </div>
  )
}
