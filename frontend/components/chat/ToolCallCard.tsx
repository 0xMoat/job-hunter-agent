import type { ToolCallEntry } from "@/lib/types"
import { useLanguage } from "@/contexts/LanguageContext"

const TOOL_LABELS: Record<string, string> = {
  job_search_tool: "Job Search",
  company_research_tool: "Company Research",
  cover_letter_tool: "Cover Letter",
  application_tracker_tool: "Application Tracker",
  job_preferences_tool: "Preferences",
  duckduckgo_search: "Web Search",
}

interface Props {
  entry: ToolCallEntry
}

export function ToolCallCard({ entry }: Props) {
  const { t } = useLanguage()
  const label = TOOL_LABELS[entry.toolName] ?? entry.toolName
  const isDone = entry.status === "done"

  return (
    <div className="glass rounded-xl my-1">
      <div className="overflow-hidden rounded-xl">
        {/* Header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
          <span
            className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${
              isDone
                ? "bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.4)]"
                : "bg-amber-400 animate-pulse"
            }`}
          />
          <span className="font-body font-medium text-sm text-[var(--text-2)]">
            {label}
          </span>
          {!isDone && (
            <span className="ml-auto font-body font-light text-xs text-[var(--text-3)] animate-pulse">
              {t('tool_running')}
            </span>
          )}
        </div>

        {/* Result body — Option C: left accent bar */}
        {entry.resultContent && (
          <div className="flex gap-2.5 px-3 py-2">
            <div className="w-[2.5px] self-stretch rounded-full bg-gradient-to-b from-[#141210] to-[#141210]/20 flex-shrink-0" />
            <p
              className="font-body font-normal text-sm leading-relaxed max-h-32 overflow-y-auto"
              style={{ color: "var(--text-strong-2)" }}
            >
              {entry.resultContent}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
