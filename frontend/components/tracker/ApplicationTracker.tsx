"use client"

import { useState } from "react"
import { ApplicationCard } from "./ApplicationCard"
import { useApplications } from "@/hooks/useApplications"
import type { ApplicationStatus } from "@/lib/types"

const COLUMNS: { key: ApplicationStatus; label: string }[] = [
  { key: "applied", label: "Applied" },
  { key: "interviewing", label: "Interviewing" },
  { key: "offer", label: "Offer" },
  { key: "rejected", label: "Rejected" },
]

export function ApplicationTracker() {
  const {
    applications,
    loading,
    addApplication,
    updateStatus,
    deleteApplication,
  } = useApplications()

  const [showAdd, setShowAdd] = useState(false)
  const [company, setCompany] = useState("")
  const [title, setTitle] = useState("")
  const [url, setUrl] = useState("")

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!company.trim() || !title.trim()) return
    await addApplication(
      company.trim(),
      title.trim(),
      url.trim() || undefined,
    )
    setCompany("")
    setTitle("")
    setUrl("")
    setShowAdd(false)
  }

  return (
    <div className="flex flex-col h-full bg-slate-900 border-l border-slate-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 flex-shrink-0">
        <div>
          <h2 className="text-sm font-semibold text-slate-300">Applications</h2>
          <p className="text-xs text-slate-500">{applications.length} tracked</p>
        </div>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs px-2.5 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
        >
          + Add
        </button>
      </div>

      {/* Add form */}
      {showAdd && (
        <form
          onSubmit={handleAdd}
          className="px-3 py-3 border-b border-slate-700 space-y-2 flex-shrink-0"
        >
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="Company name *"
            required
            className="w-full px-2 py-1.5 text-xs bg-slate-700 text-white rounded border border-slate-600 focus:outline-none focus:border-blue-500"
          />
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Job title *"
            required
            className="w-full px-2 py-1.5 text-xs bg-slate-700 text-white rounded border border-slate-600 focus:outline-none focus:border-blue-500"
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="URL (optional)"
            type="url"
            className="w-full px-2 py-1.5 text-xs bg-slate-700 text-white rounded border border-slate-600 focus:outline-none focus:border-blue-500"
          />
          <div className="flex gap-2">
            <button
              type="submit"
              className="flex-1 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => setShowAdd(false)}
              className="flex-1 py-1.5 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 rounded transition-colors"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Columns */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <p className="text-slate-500 text-xs text-center mt-6">Loading…</p>
        ) : (
          <div className="space-y-5">
            {COLUMNS.map(({ key, label }) => {
              const colApps = applications.filter((a) => a.status === key)
              return (
                <div key={key}>
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                    {label}{" "}
                    <span className="text-slate-600 font-normal">
                      ({colApps.length})
                    </span>
                  </p>
                  <div className="space-y-2">
                    {colApps.length === 0 ? (
                      <p className="text-xs text-slate-700 italic pl-1">
                        None yet
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
  )
}
