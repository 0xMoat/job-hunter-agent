"use client"

import { useState, useCallback, useEffect } from "react"
import {
  apiListApplications,
  apiAddApplication,
  apiUpdateApplication,
  apiDeleteApplication,
} from "@/lib/api"
import { getSessionToken } from "@/lib/auth"
import type { Application, ApplicationStatus } from "@/lib/types"

export function useApplications() {
  const [applications, setApplications] = useState<Application[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = getSessionToken()
    if (!token) return
    setLoading(true)
    try {
      const data = await apiListApplications(token)
      setApplications(data.applications)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load applications")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const addApplication = useCallback(
    async (
      company: string,
      title: string,
      url?: string,
      notes?: string,
    ): Promise<Application | undefined> => {
      const token = getSessionToken()
      if (!token) return
      try {
        const app = await apiAddApplication(token, { company, title, url, notes })
        setApplications((prev) => [app, ...prev])
        return app
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to add application")
      }
    },
    [],
  )

  const updateStatus = useCallback(
    async (id: number, status: ApplicationStatus): Promise<void> => {
      const token = getSessionToken()
      if (!token) return
      try {
        const updated = await apiUpdateApplication(token, id, { status })
        setApplications((prev) => prev.map((a) => (a.id === id ? updated : a)))
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to update application")
      }
    },
    [],
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
    loading,
    error,
    addApplication,
    updateStatus,
    deleteApplication,
    reload: load,
  }
}
