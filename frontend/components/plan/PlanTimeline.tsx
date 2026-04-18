"use client"

import { useEffect, useRef, useState } from "react"
import type { PlanExecuteView } from "@/lib/types"
import { PlanStepRow } from "./PlanStepCard"
import { PlanApprovalCard } from "./PlanApprovalCard"

interface PlanTimelineViewProps {
  view: PlanExecuteView
  onApprove?: () => void
  onRevise?: (feedback: string) => void
  onCancel?: () => void
  actionsDisabled?: boolean
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export function PlanTimelineView({
  view,
  onApprove,
  onRevise,
  onCancel,
  actionsDisabled,
}: PlanTimelineViewProps) {
  const completed = view.steps.filter(
    (s) => s.status === "done" || s.status === "failed",
  ).length
  const total = view.steps.length
  const runningIndex = view.steps.findIndex((s) => s.status === "running")
  const runningStep = runningIndex >= 0 ? view.steps[runningIndex] : null
  const currentToolName =
    runningStep?.toolCalls?.[runningStep.toolCalls.length - 1]?.name

  // Plan-level elapsed timer — starts the first time we see the plan run.
  const planStartedRef = useRef<number | null>(null)
  const [now, setNow] = useState(Date.now())
  if ((view.running || completed > 0) && planStartedRef.current === null) {
    planStartedRef.current = Date.now()
  }
  useEffect(() => {
    if (!view.running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [view.running])
  const elapsed = planStartedRef.current
    ? Math.floor((now - planStartedRef.current) / 1000)
    : 0

  let pill: { label: string; className: string; dot?: boolean } | null = null
  if (view.errorMsg) {
    pill = { label: "出错", className: "bg-rose-100 text-rose-700" }
  } else if (view.cancelled) {
    pill = { label: "已取消", className: "bg-zinc-100 text-zinc-600" }
  } else if (view.finalResponse) {
    pill = { label: "已完成", className: "bg-emerald-100 text-emerald-700" }
  } else if (view.awaitingApproval) {
    pill = {
      label: `等你确认 · 第 ${view.approvalRound} 轮`,
      className: "bg-indigo-100 text-indigo-700",
    }
  } else if (view.running) {
    pill = {
      label: "Running",
      className: "bg-indigo-100 text-indigo-700",
      dot: true,
    }
  }

  const showHeader = pill !== null || total > 0

  return (
    <div className="flex flex-col gap-3" data-tour="pe-timeline">
      {showHeader && (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {pill && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${pill.className}`}
              >
                {pill.dot && (
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
                )}
                {pill.label}
              </span>
            )}
            {view.running && runningStep && (
              <span className="truncate font-body text-xs text-zinc-600">
                {currentToolName && (
                  <>
                    <span className="font-mono text-zinc-500">
                      {currentToolName}
                    </span>
                    {" · "}
                  </>
                )}
                Step {runningIndex + 1}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-zinc-500">
            {total > 0 && (
              <span>
                {completed} / {total}
              </span>
            )}
            {planStartedRef.current !== null && <span>· {fmtDuration(elapsed)}</span>}
          </div>
        </div>
      )}

      {view.revisionReason && (
        <div className="rounded-md bg-indigo-50 px-3 py-1.5 text-[11px] text-indigo-700">
          基于你的反馈已更新计划
        </div>
      )}

      {view.errorMsg && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700">
          错误：{view.errorMsg}
        </div>
      )}

      {total > 0 && (
        <div className="relative">
          {total > 1 && (
            <div className="pointer-events-none absolute bottom-3 left-[5px] top-3 w-px bg-zinc-200" />
          )}
          {view.steps.map((s, i) => (
            <PlanStepRow key={s.id} step={s} position={i + 1} />
          ))}
        </div>
      )}

      {view.awaitingApproval && onApprove && onRevise && onCancel && (
        <PlanApprovalCard
          round={view.approvalRound}
          onApprove={onApprove}
          onRevise={onRevise}
          onCancel={onCancel}
          disabled={actionsDisabled}
        />
      )}

      {view.finalResponse && !view.cancelled && (
        <div className="mt-1 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <div className="mb-1 text-[11px] font-semibold text-emerald-700">
            最终回复
          </div>
          <div className="whitespace-pre-wrap text-xs text-emerald-900">
            {view.finalResponse}
          </div>
        </div>
      )}
    </div>
  )
}
