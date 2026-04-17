"use client"

import { useState, useCallback, useEffect } from "react"
import {
  apiListApplications,
  apiAddApplication,
  apiDeleteApplication,
  apiMoveCard,
} from "@/lib/api"
import { getSessionToken } from "@/lib/auth"
import { onApplicationsInvalidated } from "@/lib/app-events"
import type { Application, ApplicationStatus } from "@/lib/types"

export function useApplications() {
  const [applications, setApplications] = useState<Application[]>([])
  const [archivedCount, setArchivedCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = getSessionToken()
    if (!token) return
    setLoading(true)
    try {
      const data = await apiListApplications(token)
      setApplications(data.applications)
      setArchivedCount(data.archived_count ?? 0)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load applications")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => onApplicationsInvalidated(() => { load() }), [load])

  const addApplication = useCallback(
    async (company: string, title: string, url?: string, status: ApplicationStatus = "pending"): Promise<Application | undefined> => {
      const token = getSessionToken()
      if (!token) return
      try {
        const app = await apiAddApplication(token, { company, title, url, status })
        setApplications((prev) => [app, ...prev])
        return app
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add application")
      }
    },
    [],
  )

  const moveCard = useCallback(
    async (id: number, newStatus: ApplicationStatus): Promise<void> => {
      const token = getSessionToken()
      if (!token) return
      // Optimistic update
      setApplications((prev) =>
        prev.map((a) => (a.id === id ? { ...a, status: newStatus } : a))
      )
      try {
        const updated = await apiMoveCard(token, id, newStatus)
        setApplications((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to move card")
        // Rollback on error
        load()
      }
    },
    [load],
  )

  const deleteApplication = useCallback(async (id: number): Promise<void> => {
    const token = getSessionToken()
    if (!token) return
    try {
      await apiDeleteApplication(token, id)
      setApplications((prev) => prev.filter((a) => a.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete application")
    }
  }, [])

  return {
    applications,
    archivedCount,
    loading,
    error,
    addApplication,
    moveCard,
    deleteApplication,
    reload: load,
  }
}
