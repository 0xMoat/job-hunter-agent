import type { Application, ApplicationStatus } from "@/lib/types"

const STATUS_COLORS: Record<ApplicationStatus, string> = {
  applied: "text-blue-400 bg-blue-900/30 border-blue-800",
  interviewing: "text-yellow-400 bg-yellow-900/30 border-yellow-800",
  rejected: "text-red-400 bg-red-900/30 border-red-800",
  offer: "text-green-400 bg-green-900/30 border-green-800",
}

const STATUS_LABELS: Record<ApplicationStatus, string> = {
  applied: "Applied",
  interviewing: "Interviewing",
  rejected: "Rejected",
  offer: "Offer 🎉",
}

const ALL_STATUSES: ApplicationStatus[] = [
  "applied",
  "interviewing",
  "offer",
  "rejected",
]

interface Props {
  app: Application
  onStatusChange: (id: number, status: ApplicationStatus) => void
  onDelete: (id: number) => void
}

export function ApplicationCard({ app, onStatusChange, onDelete }: Props) {
  return (
    <div className="bg-slate-800 rounded-lg p-3 border border-slate-700 hover:border-slate-600 transition-colors">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          <p className="text-sm font-medium text-white truncate">{app.company}</p>
          <p className="text-xs text-slate-400 truncate">{app.title}</p>
        </div>
        <button
          onClick={() => onDelete(app.id)}
          className="text-slate-600 hover:text-red-400 transition-colors flex-shrink-0 text-xl leading-none pb-0.5"
          title="Delete"
        >
          ×
        </button>
      </div>

      {app.url && (
        <a
          href={app.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-400 hover:text-blue-300 truncate block mb-1.5"
        >
          {app.url}
        </a>
      )}

      <select
        value={app.status}
        onChange={(e) => onStatusChange(app.id, e.target.value as ApplicationStatus)}
        className={`w-full text-xs rounded px-1.5 py-1 border font-medium bg-transparent cursor-pointer ${STATUS_COLORS[app.status]}`}
      >
        {ALL_STATUSES.map((s) => (
          <option key={s} value={s} className="bg-slate-800 text-white">
            {STATUS_LABELS[s]}
          </option>
        ))}
      </select>

      <p className="text-xs text-slate-600 mt-1.5">{app.applied_date}</p>
    </div>
  )
}
