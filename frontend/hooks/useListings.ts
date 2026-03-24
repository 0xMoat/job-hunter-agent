"use client"

import { useState, useCallback, useEffect } from "react"
import { apiGetListings } from "@/lib/api"
import { getSessionToken } from "@/lib/auth"
import type { JobListing } from "@/lib/types"

export function useListings() {
  const [listings, setListings] = useState<JobListing[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const token = getSessionToken()
    if (!token) return
    setLoading(true)
    try {
      const data = await apiGetListings(token)
      setListings(data.listings)
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to load listings",
      )
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  return { listings, loading, error, reload: load }
}
