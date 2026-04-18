"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { useLanguage } from "@/contexts/LanguageContext"
import { buildTourSteps } from "@/lib/tour/steps"
import { startTour, stopTour } from "@/lib/tour/driver"
import { apiTutorialDismiss, apiTutorialStatus } from "@/lib/api-tutorial"
import { getAccessToken } from "@/lib/auth"

interface TourContextValue {
  start: () => void
  stop: () => void
  hasAutoStarted: boolean
}

const TourContext = createContext<TourContextValue | null>(null)

const LOCAL_DONE_KEY = "jh_tour_done"

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage()
  const hasAutoStartedRef = useRef(false)
  const [hasAutoStarted, setHasAutoStarted] = useState(false)

  const finish = useCallback(() => {
    localStorage.setItem(LOCAL_DONE_KEY, "1")
    const token = getAccessToken()
    if (token) apiTutorialDismiss(token).catch(() => {})
  }, [])

  const start = useCallback(() => {
    const steps = buildTourSteps(t)
    startTour(steps, finish)
  }, [t, finish])

  const stop = useCallback(() => {
    stopTour()
    finish()
  }, [finish])

  // Always point `startRef` at the latest `start` so the mount-only
  // auto-start effect can invoke it with current i18n/locale without
  // re-subscribing (which would cancel the pending 600 ms timer).
  const startRef = useRef(start)
  useEffect(() => {
    startRef.current = start
  })

  useEffect(() => {
    if (hasAutoStartedRef.current) return
    hasAutoStartedRef.current = true
    const token = getAccessToken()
    if (!token) return
    if (localStorage.getItem(LOCAL_DONE_KEY) === "1") return

    let cancelled = false
    apiTutorialStatus(token)
      .then((status) => {
        if (cancelled) return
        if (status.tutorial_completed) {
          localStorage.setItem(LOCAL_DONE_KEY, "1")
          return
        }
        setTimeout(() => {
          if (cancelled) return
          startRef.current()
          setHasAutoStarted(true)
        }, 600)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <TourContext.Provider value={{ start, stop, hasAutoStarted }}>
      {children}
    </TourContext.Provider>
  )
}

export function useTour() {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error("useTour must be used within TourProvider")
  return ctx
}
