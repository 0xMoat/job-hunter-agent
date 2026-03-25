import type { Application, ApplicationStatus } from "@/lib/types"
import { useLanguage } from "@/contexts/LanguageContext"

const STATUS_CLASSES: Record<ApplicationStatus, string> = {
  applied:      "text-blue-600 bg-blue-50 border-blue-100",
  interviewing: "text-amber-600 bg-amber-50 border-amber-100",
  rejected:     "text-red-600 bg-red-50 border-red-100",
  offer:        "text-green-600 bg-green-50 border-green-100",
}

const ALL_STATUSES: ApplicationStatus[] = ["applied", "interviewing", "offer", "rejected"]

interface Props {
  app: Application
  onStatusChange: (id: number, status: ApplicationStatus) => void
  onDelete: (id: number) => void
}

export function ApplicationCard({ app, onStatusChange, onDelete }: Props) {
  const { t } = useLanguage()

  const statusLabelKey: Record<ApplicationStatus, string> = {
    applied:      'status_applied',
    interviewing: 'status_interviewing',
    offer:        'status_offer',
    rejected:     'status_rejected',
  }

  return (
    <div className="bg-white/50 rounded-2xl p-3 border border-[var(--border)] hover:border-[var(--border-strong)] transition-colors">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          <p className="font-body font-medium text-sm text-[var(--text)] truncate">{app.company}</p>
          <p className="font-body font-light text-xs text-[var(--text-2)] truncate">{app.title}</p>
        </div>
        <button
          onClick={() => onDelete(app.id)}
          aria-label={t('delete')}
          className="text-[var(--text-3)] hover:text-red-500 transition-colors
                     flex-shrink-0 text-xl leading-none pb-0.5"
        >
          ×
        </button>
      </div>

      {app.url && (
        <a
          href={app.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-body font-light text-xs text-blue-600 hover:text-blue-500 truncate block mb-1.5"
        >
          {app.url}
        </a>
      )}

      <select
        value={app.status}
        onChange={(e) => onStatusChange(app.id, e.target.value as ApplicationStatus)}
        className={`w-full text-xs rounded-full px-3 py-1 border font-body font-medium
                    bg-transparent cursor-pointer appearance-none ${STATUS_CLASSES[app.status]}`}
      >
        {ALL_STATUSES.map((s) => (
          <option key={s} value={s} className="bg-white text-[var(--text)]">
            {t(statusLabelKey[s])}
          </option>
        ))}
      </select>

      <p className="font-body font-light text-[10px] text-[var(--text-3)] mt-1.5">
        {app.applied_date}
      </p>
    </div>
  )
}
