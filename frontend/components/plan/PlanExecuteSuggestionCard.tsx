"use client"

import type { PlanExecuteSuggestion } from "@/lib/types"

interface PlanExecuteSuggestionCardProps {
  suggestion: PlanExecuteSuggestion
  onAccept: () => void
  disabled?: boolean
}

export function PlanExecuteSuggestionCard({
  suggestion,
  onAccept,
  disabled = false,
}: PlanExecuteSuggestionCardProps) {
  if (suggestion.dismissed) return null

  const { savedCount, pendingCount } = suggestion
  const countSummary =
    pendingCount > savedCount
      ? `已保存 ${savedCount} 个职位到看板，共 ${pendingCount} 条待处理`
      : `已保存 ${savedCount} 个职位到看板`

  return (
    <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm text-indigo-900">
        <span className="text-base leading-none">💼</span>
        <span>{countSummary}，要我现在帮你自动处理吗？</span>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onAccept}
          disabled={disabled}
          className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          ✓ 立即处理
        </button>
      </div>
    </div>
  )
}
