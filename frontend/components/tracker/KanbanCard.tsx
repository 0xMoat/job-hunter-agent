"use client"

import { useDraggable } from "@dnd-kit/core"
import { CSS } from "@dnd-kit/utilities"
import { useLanguage } from "@/contexts/LanguageContext"
import type { Application } from "@/lib/types"

interface KanbanCardProps {
  app: Application
  onDelete: (id: number) => void
}

export function KanbanCard({ app, onDelete }: KanbanCardProps) {
  const { t } = useLanguage()
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: app.id,
  })

  const style = {
    transform: CSS.Translate.toString(transform),
    opacity: isDragging ? 0.4 : 1,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className="bg-white rounded-xl p-3 shadow-sm border border-[var(--border)]
                 cursor-grab active:cursor-grabbing select-none
                 hover:shadow-md transition-shadow"
    >
      {/* Company + source badge */}
      <div className="flex items-start justify-between gap-2 mb-0.5">
        <span className="font-body font-semibold text-sm text-[var(--text)] leading-tight">
          {app.company || "—"}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {app.match_score != null && (
            <span
              className={[
                "text-[10px] font-body rounded-full px-2 py-0.5 font-semibold tabular-nums",
                app.match_score >= 80
                  ? "bg-[#dcfce7] text-[#16a34a]"
                  : app.match_score >= 60
                  ? "bg-[#fef9c3] text-[#a16207]"
                  : "bg-black/5 text-[#999]",
              ].join(" ")}
            >
              {app.match_score}
            </span>
          )}
          <span
            className={`shrink-0 text-[10px] font-body rounded-full px-2 py-0.5 ${
              app.source === "scheduler"
                ? "bg-[#ede9ff] text-[#7c6af5]"
                : app.source === "chat"
                  ? "bg-[#fef3c7] text-[#b45309]"
                  : "bg-[#f0f9f0] text-[#5a9a5a]"
            }`}
          >
            {app.source === "scheduler"
              ? t("card_source_scheduler")
              : app.source === "chat"
                ? t("card_source_chat")
                : t("card_source_manual")}
          </span>
        </div>
      </div>

      {/* Title */}
      <p className="font-body text-xs text-[var(--text-2)] mb-1">{app.title}</p>

      {/* Date */}
      <p className="font-body text-[10px] text-[var(--text-3)] mb-2">
        {app.found_date ?? app.applied_date ?? ""}
      </p>

      {/* Snippet */}
      {app.snippet && (
        <p className="font-body text-[11px] text-[var(--text-2)] bg-black/[0.03]
                      rounded-lg px-2 py-1.5 leading-relaxed mb-2
                      line-clamp-3">
          {app.snippet}
        </p>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between mt-1">
        <button
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(app.id) }}
          className="text-[10px] font-body text-[var(--text-3)] hover:text-red-500
                     transition-colors"
        >
          {t("delete")}
        </button>
        {app.url && (
          <a
            href={app.url}
            target="_blank"
            rel="noopener noreferrer"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="text-[10px] font-body text-[#7c6af5] hover:underline"
          >
            {t("card_view_job")}
          </a>
        )}
      </div>
    </div>
  )
}
