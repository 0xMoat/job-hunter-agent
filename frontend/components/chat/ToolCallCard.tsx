import type { ToolCallEntry } from "@/lib/types"

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
  const label = TOOL_LABELS[entry.toolName] ?? entry.toolName
  const isDone = entry.status === "done"

  return (
    <div className="my-1 rounded-lg border border-slate-600 bg-slate-800/60 text-xs overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-700/50">
        <span className="text-base">{isDone ? "✅" : "⚙️"}</span>
        <span className="font-mono text-slate-300 font-medium">{label}</span>
        {!isDone && (
          <span className="ml-auto text-slate-500 animate-pulse">running…</span>
        )}
      </div>
      {entry.resultContent && (
        <div className="px-3 py-1.5 text-slate-400 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto leading-relaxed">
          {entry.resultContent}
        </div>
      )}
    </div>
  )
}
