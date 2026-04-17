"use client"

import { useState } from "react"
import { DndContext, DragEndEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core"
import { KanbanColumn } from "./KanbanColumn"
import { ApplicationDetailDrawer } from "./ApplicationDetailDrawer"
import { useApplications } from "@/hooks/useApplications"
import { useLanguage } from "@/contexts/LanguageContext"
import { KANBAN_COLUMNS, toColumnStatus } from "@/lib/types"
import type { ApplicationStatus } from "@/lib/types"

export function KanbanBoard() {
  const { applications, archivedCount, loading, addApplication, moveCard, deleteApplication } = useApplications()
  const { t } = useLanguage()
  const [detailAppId, setDetailAppId] = useState<number | null>(null)
  const detailApp = detailAppId != null ? applications.find((a) => a.id === detailAppId) ?? null : null

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over) return
    const cardId = active.id as number
    const targetStatus = over.id as ApplicationStatus
    const card = applications.find((a) => a.id === cardId)
    if (!card) return
    // If target column is "applied", preserve "interviewing" status for cards already interviewing
    const newStatus: ApplicationStatus =
      targetStatus === "applied" && card.status === "interviewing"
        ? "interviewing"
        : targetStatus
    if (card.status === newStatus) return
    moveCard(cardId, newStatus)
  }

  if (loading) {
    return (
      <div className="glass-strong rounded-3xl flex items-center justify-center h-full">
        <p className="font-body font-light text-sm text-[var(--text-3)]">{t("kanban_loading")}</p>
      </div>
    )
  }

  return (
    <>
      <div className="glass-strong rounded-3xl flex flex-col h-full overflow-hidden">
        <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
          <div className="flex gap-3 flex-1 overflow-x-auto p-4">
            {KANBAN_COLUMNS.map(({ status, labelKey }) => {
              const colCards = applications.filter(
                (a) => toColumnStatus(a.status) === status
              )
              const displayCards =
                status === "pending"
                  ? [...colCards].sort((a, b) => {
                      if (a.match_score == null && b.match_score == null) return 0
                      if (a.match_score == null) return 1
                      if (b.match_score == null) return -1
                      return b.match_score - a.match_score
                    })
                  : colCards
              return (
                <KanbanColumn
                  key={status}
                  status={status}
                  labelKey={labelKey}
                  cards={displayCards}
                  archivedCount={status === "pending" ? archivedCount : undefined}
                  onDelete={deleteApplication}
                  onOpenDetail={setDetailAppId}
                  onAddCard={(company, title, url) => addApplication(company, title, url, status).then(() => undefined)}
                />
              )
            })}
          </div>
        </DndContext>
      </div>
      <ApplicationDetailDrawer app={detailApp} onClose={() => setDetailAppId(null)} />
    </>
  )
}
