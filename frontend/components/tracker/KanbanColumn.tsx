"use client"

import { useState } from "react"
import { useDroppable } from "@dnd-kit/core"
import { KanbanCard } from "./KanbanCard"
import { useLanguage } from "@/contexts/LanguageContext"
import type { Application, ApplicationStatus } from "@/lib/types"

interface KanbanColumnProps {
  status: ApplicationStatus
  labelKey: string
  cards: Application[]
  archivedCount?: number
  onDelete: (id: number) => void
  onAddCard: (company: string, title: string, url?: string) => Promise<void>
}

const COLUMN_ACCENT: Record<ApplicationStatus, string> = {
  pending:      "text-[#7c6af5]",
  applied:      "text-[#2563eb]",
  interviewing: "text-[#2563eb]",
  completed:    "text-[#16a34a]",
  not_a_match:  "text-[#999]",
}

const BADGE_ACCENT: Record<ApplicationStatus, string> = {
  pending:      "bg-[#ede9ff] text-[#7c6af5]",
  applied:      "bg-[#dbeafe] text-[#2563eb]",
  interviewing: "bg-[#dbeafe] text-[#2563eb]",
  completed:    "bg-[#dcfce7] text-[#16a34a]",
  not_a_match:  "bg-black/5 text-[#999]",
}

export function KanbanColumn({
  status,
  labelKey,
  cards,
  archivedCount,
  onDelete,
  onAddCard,
}: KanbanColumnProps) {
  const { t } = useLanguage()
  const { setNodeRef, isOver } = useDroppable({ id: status })

  const [showAdd, setShowAdd] = useState(false)
  const [company, setCompany] = useState("")
  const [title, setTitle] = useState("")
  const [url, setUrl] = useState("")

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!company.trim() || !title.trim()) return
    await onAddCard(company.trim(), title.trim(), url.trim() || undefined)
    setCompany(""); setTitle(""); setUrl(""); setShowAdd(false)
  }

  return (
    <div
      ref={setNodeRef}
      className={`flex flex-col flex-1 min-w-0 rounded-2xl p-3 transition-colors
                  ${isOver ? "bg-white/50" : "bg-white/25"}`}
    >
      {/* Column header */}
      <div className="flex items-center justify-between mb-3 px-1">
        <span className={`font-body font-bold text-[10px] uppercase tracking-widest ${COLUMN_ACCENT[status]}`}>
          {t(labelKey)}
        </span>
        <span className={`font-body text-[10px] rounded-full px-2 py-0.5 ${BADGE_ACCENT[status]}`}>
          {cards.length}
        </span>
      </div>

      {/* Cards */}
      <div className="flex flex-col gap-2 flex-1 min-h-[120px]">
        {cards.map((card) => (
          <KanbanCard key={card.id} app={card} onDelete={onDelete} />
        ))}
      </div>

      {/* Archived hint — only shown in pending column when there are archived cards */}
      {status === "pending" && !!archivedCount && (
        <p className="font-body text-[10px] text-[var(--text-3)] italic text-center mt-2">
          {t("kanban_archived_n", archivedCount)}
        </p>
      )}

      {/* Add card form */}
      {showAdd ? (
        <form onSubmit={handleAdd} className="mt-2 space-y-1.5">
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder={t("form_company")}
            required
            className="w-full px-2.5 py-1.5 text-xs font-body bg-white rounded-lg
                       border border-[var(--border-strong)] text-[var(--text)]
                       placeholder:text-[var(--text-3)]
                       focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#141210]/20"
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("form_title_field")}
            required
            className="w-full px-2.5 py-1.5 text-xs font-body bg-white rounded-lg
                       border border-[var(--border-strong)] text-[var(--text)]
                       placeholder:text-[var(--text-3)]
                       focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#141210]/20"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t("form_url")}
            type="url"
            className="w-full px-2.5 py-1.5 text-xs font-body bg-white rounded-lg
                       border border-[var(--border-strong)] text-[var(--text)]
                       placeholder:text-[var(--text-3)]
                       focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#141210]/20"
          />
          <div className="flex gap-1.5">
            <button type="submit"
              className="flex-1 py-1.5 text-[11px] font-body font-medium
                         bg-[var(--accent)] text-[var(--accent-fg)] rounded-full">
              {t("tracker_save")}
            </button>
            <button type="button" onClick={() => setShowAdd(false)}
              className="flex-1 py-1.5 text-[11px] font-body
                         glass text-[var(--text-2)] rounded-full">
              {t("tracker_cancel")}
            </button>
          </div>
        </form>
      ) : (
        <button
          onClick={() => setShowAdd(true)}
          className="mt-2 w-full py-2 text-[11px] font-body text-[var(--text-3)]
                     border border-dashed border-[var(--border)] rounded-lg
                     hover:bg-white/60 hover:text-[var(--text-2)] transition-colors"
        >
          {t("kanban_add_card")}
        </button>
      )}
    </div>
  )
}
