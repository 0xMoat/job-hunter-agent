"use client"

import type { PlanExecuteView } from "@/lib/types"
import { PlanStepCard } from "./PlanStepCard"

export function PlanTimelineView({ view }: { view: PlanExecuteView }) {
  const completed = view.steps.filter((s) => s.status === "done" || s.status === "failed").length
  const total = view.steps.length

  return (
    <div className="flex flex-col gap-4">
      {/* Progress bar */}
      {total > 0 && (
        <div className="text-sm text-zinc-600">
          <span>已完成 {completed} / 总 {total}</span>
          <div className="mt-1 h-1.5 w-48 rounded-full bg-zinc-200">
            <div
              className="h-full rounded-full bg-indigo-600 transition-all"
              style={{ width: `${total ? (completed / total) * 100 : 0}%` }}
            />
          </div>
        </div>
      )}

      {/* Error banner */}
      {view.errorMsg && (
        <div className="rounded border border-rose-400 bg-rose-50 px-4 py-2 text-sm text-rose-800">
          错误：{view.errorMsg}
        </div>
      )}

      {/* Step list */}
      <div className="flex flex-col gap-2">
        {view.steps.map((s) => (
          <PlanStepCard key={s.index} step={s} />
        ))}
      </div>

      {/* Final response */}
      {view.finalResponse && (
        <div className="rounded border border-emerald-400 bg-emerald-50 p-4">
          <div className="mb-2 font-semibold text-emerald-900">最终回复</div>
          <div className="whitespace-pre-wrap text-sm">{view.finalResponse}</div>
        </div>
      )}
    </div>
  )
}
