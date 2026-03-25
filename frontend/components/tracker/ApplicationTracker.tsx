"use client"

import { useState } from "react"
import { ApplicationCard } from "./ApplicationCard"
import { useApplications } from "@/hooks/useApplications"
import { useLanguage } from "@/contexts/LanguageContext"
import type { ApplicationStatus } from "@/lib/types"

const COLUMNS: { key: ApplicationStatus; labelKey: string }[] = [
  { key: "applied",      labelKey: "col_applied" },
  { key: "interviewing", labelKey: "col_interviewing" },
  { key: "offer",        labelKey: "col_offer" },
  { key: "rejected",     labelKey: "col_rejected" },
]

export function ApplicationTracker() {
  const { applications, loading, addApplication, updateStatus, deleteApplication } = useApplications()
  const { t } = useLanguage()

  const [showAdd, setShowAdd] = useState(false)
  const [company, setCompany] = useState("")
  const [title, setTitle] = useState("")
  const [url, setUrl] = useState("")

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!company.trim() || !title.trim()) return
    await addApplication(company.trim(), title.trim(), url.trim() || undefined)
    setCompany(""); setTitle(""); setUrl(""); setShowAdd(false)
  }

  return (
    /* Outer: glass-strong, NO overflow-hidden */
    <div className="glass-strong rounded-3xl flex flex-col h-full">
      {/* Inner: clips scroll content */}
      <div className="flex flex-col h-full overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div>
            <h2 className="font-heading italic text-xl tracking-tight text-[var(--text)] leading-none mb-0.5">
              {t('tracker_title')}
            </h2>
            <p className="font-body font-light text-xs text-[var(--text-3)]">
              {t('tracker_sub_n', applications.length)}
            </p>
          </div>
          <button
            onClick={() => setShowAdd(!showAdd)}
            aria-label={t('tracker_add')}
            className="bg-[var(--accent)] text-[var(--accent-fg)] rounded-full
                       px-4 py-2 text-xs font-body font-medium min-h-[32px]"
          >
            {t('tracker_add')}
          </button>
        </div>

        {/* Add form */}
        {showAdd && (
          <form
            onSubmit={handleAdd}
            className="px-4 py-3 border-b border-[var(--border)] space-y-2 flex-shrink-0"
          >
            <label htmlFor="app-company" className="sr-only">{t('form_company')}</label>
            <input
              id="app-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder={t('form_company')}
              required
              className="w-full px-3 py-2 text-xs font-body bg-black/[0.04] text-[var(--text)]
                         rounded-xl border border-[var(--border-strong)]
                         placeholder:text-[var(--text-3)]
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141210]/30"
            />
            <label htmlFor="app-title" className="sr-only">{t('form_title_field')}</label>
            <input
              id="app-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('form_title_field')}
              required
              className="w-full px-3 py-2 text-xs font-body bg-black/[0.04] text-[var(--text)]
                         rounded-xl border border-[var(--border-strong)]
                         placeholder:text-[var(--text-3)]
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141210]/30"
            />
            <label htmlFor="app-url" className="sr-only">{t('form_url')}</label>
            <input
              id="app-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('form_url')}
              type="url"
              className="w-full px-3 py-2 text-xs font-body bg-black/[0.04] text-[var(--text)]
                         rounded-xl border border-[var(--border-strong)]
                         placeholder:text-[var(--text-3)]
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141210]/30"
            />
            <div className="flex gap-2">
              <button type="submit"
                className="flex-1 py-1.5 text-xs font-body font-medium
                           bg-[var(--accent)] text-[var(--accent-fg)] rounded-full">
                {t('tracker_save')}
              </button>
              <button type="button" onClick={() => setShowAdd(false)}
                className="flex-1 py-1.5 text-xs font-body
                           glass text-[var(--text-2)] rounded-full">
                {t('tracker_cancel')}
              </button>
            </div>
          </form>
        )}

        {/* Columns */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <p className="font-body font-light text-xs text-[var(--text-3)] text-center mt-6">
              {t('tracker_loading')}
            </p>
          ) : (
            <div className="space-y-5">
              {COLUMNS.map(({ key, labelKey }) => {
                const colApps = applications.filter((a) => a.status === key)
                return (
                  <div key={key}>
                    <p className="font-body font-semibold text-[10px] uppercase tracking-widest
                                  text-[var(--text-3)] mb-2">
                      {t(labelKey)}{" "}
                      <span className="font-normal">({colApps.length})</span>
                    </p>
                    <div className="space-y-2">
                      {colApps.length === 0 ? (
                        <p className="font-body font-light text-xs text-[var(--text-3)] italic pl-1">
                          {t('tracker_empty_col')}
                        </p>
                      ) : (
                        colApps.map((app) => (
                          <ApplicationCard
                            key={app.id}
                            app={app}
                            onStatusChange={updateStatus}
                            onDelete={deleteApplication}
                          />
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
