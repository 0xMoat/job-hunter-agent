"use client"

import type { PlanExecuteView } from "@/lib/types"
import { PlanStepCard } from "./PlanStepCard"
import { PlanApprovalCard } from "./PlanApprovalCard"

interface PlanTimelineViewProps {
  view: PlanExecuteView
  onApprove?: () => void
  onRevise?: (feedback: string) => void
  onCancel?: () => void
  actionsDisabled?: boolean
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

  let statusBadge: { label: string; className: string } | null = null
  if (view.errorMsg) {
    statusBadge = {
      label: "⚠ 出错",
      className: "bg-rose-100 text-rose-800 border-rose-300",
    }
  } else if (view.cancelled) {
    statusBadge = {
      label: "✗ 已取消",
      className: "bg-zinc-100 text-zinc-700 border-zinc-300",
    }
  } else if (view.finalResponse) {
    statusBadge = {
      label: "✓ 已完成",
      className: "bg-emerald-100 text-emerald-800 border-emerald-300",
    }
  } else if (view.awaitingApproval) {
    statusBadge = {
      label: `⏸ 等你确认 · 第 ${view.approvalRound} 轮`,
      className: "bg-indigo-100 text-indigo-800 border-indigo-300 animate-pulse",
    }
  } else if (view.running) {
    statusBadge = {
      label: "● 处理中…",
      className: "bg-indigo-100 text-indigo-800 border-indigo-300 animate-pulse",
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {(statusBadge || total > 0) && (
        <div className="flex items-center gap-3 text-sm">
          {statusBadge && (
            <span
              className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusBadge.className}`}
            >
              {statusBadge.label}
            </span>
          )}
          {total > 0 && (
            <div className="flex-1 text-zinc-600">
              <span>
                已完成 {completed} / 总 {total}
              </span>
              <div className="mt-1 h-1.5 w-48 rounded-full bg-zinc-200">
                <div
                  className="h-full rounded-full bg-indigo-600 transition-all"
                  style={{ width: `${total ? (completed / total) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {view.revisionReason && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-1.5 text-xs text-indigo-700">
          基于你的反馈已更新计划
        </div>
      )}

      {view.running && runningStep && (
        <div className="rounded-lg border border-indigo-300 bg-indigo-50 px-4 py-2 text-sm text-indigo-900">
          <span className="mr-2 inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
          正在执行 Step {runningIndex + 1}：{runningStep.text}
        </div>
      )}

      {view.errorMsg && (
        <div className="rounded border border-rose-400 bg-rose-50 px-4 py-2 text-sm text-rose-800">
          错误：{view.errorMsg}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {view.steps.map((s, i) => (
          <PlanStepCard key={s.id} step={s} position={i + 1} />
        ))}
      </div>

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
        <div className="rounded border border-emerald-400 bg-emerald-50 p-4">
          <div className="mb-2 font-semibold text-emerald-900">最终回复</div>
          <div className="whitespace-pre-wrap text-sm">{view.finalResponse}</div>
        </div>
      )}
    </div>
  )
}
