"use client"

import type { PlanExecuteSuggestion } from "@/lib/types"
import { useLanguage } from "@/contexts/LanguageContext"

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
  const { t } = useLanguage()
  if (suggestion.dismissed) return null

  const { savedCount, pendingCount } = suggestion
  const countSummary =
    pendingCount > savedCount
      ? t("pe_suggestion_saved_n_of_total", savedCount, pendingCount)
      : t("pe_suggestion_saved_n", savedCount)

  return (
    <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-4">
      <div className="mb-3 flex items-start gap-2 text-sm text-indigo-900">
        <span className="mt-0.5 shrink-0 text-base leading-none">💼</span>
        <span>
          {countSummary}
          <span className="mx-1">·</span>
          {t("pe_suggestion_prompt")}
        </span>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onAccept}
          disabled={disabled}
          className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {t("pe_suggestion_cta")}
        </button>
      </div>
    </div>
  )
}
