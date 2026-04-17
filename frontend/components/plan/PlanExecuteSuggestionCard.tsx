"use client"

import type { PlanExecuteSuggestion } from "@/lib/types"
import { useLanguage } from "@/contexts/LanguageContext"

interface PlanExecuteSuggestionCardProps {
  suggestion: PlanExecuteSuggestion
  onPick: (promptText: string) => void
  disabled?: boolean
}

export function PlanExecuteSuggestionCard({
  suggestion,
  onPick,
  disabled = false,
}: PlanExecuteSuggestionCardProps) {
  const { t } = useLanguage()
  if (suggestion.dismissed) return null

  const { prompts, savedCount } = suggestion
  if (prompts.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-[var(--text-3)]">
        {t("pe_suggestion_header", savedCount)}
      </div>
      <div className="flex flex-col gap-2">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            disabled={disabled}
            className="group flex items-center justify-between gap-3 rounded-full border border-[var(--border-1)] bg-white px-4 py-2 text-left text-sm text-[var(--text-1)] shadow-sm transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft,#f5f6ff)] disabled:opacity-50 disabled:hover:border-[var(--border-1)] disabled:hover:bg-white"
          >
            <span className="truncate">{prompt}</span>
            <span className="shrink-0 text-[var(--text-3)] transition group-hover:text-[var(--accent)]">
              ↗
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
