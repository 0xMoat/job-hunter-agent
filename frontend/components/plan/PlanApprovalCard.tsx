"use client"

import { useState } from "react"

interface PlanApprovalCardProps {
  round: number
  onApprove: () => void
  onRevise: (feedback: string) => void
  onCancel: () => void
  disabled?: boolean
}

export function PlanApprovalCard({
  round,
  onApprove,
  onRevise,
  onCancel,
  disabled = false,
}: PlanApprovalCardProps) {
  const [revising, setRevising] = useState(false)
  const [feedback, setFeedback] = useState("")

  if (revising) {
    return (
      <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-4">
        <div className="mb-2 text-sm font-medium text-indigo-900">
          告诉 Planner 要改什么：
        </div>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="例如：不要调研 X 公司，直接写信"
          className="w-full resize-none rounded border border-indigo-200 bg-white/80 p-2 text-sm focus:border-indigo-500 focus:outline-none"
          rows={3}
          disabled={disabled}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setRevising(false)
              setFeedback("")
            }}
            disabled={disabled}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            返回
          </button>
          <button
            type="button"
            onClick={() => {
              const trimmed = feedback.trim()
              if (!trimmed) return
              onRevise(trimmed)
              setRevising(false)
              setFeedback("")
            }}
            disabled={disabled || !feedback.trim()}
            className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            提交反馈
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-indigo-900">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
        等你确认 · 第 {round} 轮
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          ✗ 取消
        </button>
        <button
          type="button"
          onClick={() => setRevising(true)}
          disabled={disabled}
          className="rounded-full border border-indigo-300 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
        >
          ✎ 提修改意见
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={disabled}
          className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          ✓ 批准执行
        </button>
      </div>
    </div>
  )
}
