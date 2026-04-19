"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import { useLanguage } from "@/contexts/LanguageContext"
import { buildTourSteps, type TourActions } from "@/lib/tour/steps"
import { startTour, stopTour } from "@/lib/tour/driver"
import { apiTutorialDismiss, apiTutorialStatus } from "@/lib/api-tutorial"
import { getAccessToken } from "@/lib/auth"

interface TourContextValue {
  start: () => void
  stop: () => void
  hasAutoStarted: boolean
  /** Page-level controllers register imperative actions the tour can trigger
   * during step transitions (open Settings modal, switch tabs, open drawer). */
  registerActions: (actions: Partial<TourActions>) => void
}

const TourContext = createContext<TourContextValue | null>(null)

const LOCAL_DONE_KEY = "jh_tour_done"

export const TOUR_CENTER_ANCHOR_ID = "jh-tour-center-anchor"

export function TourProvider({ children }: { children: React.ReactNode }) {
  const { t } = useLanguage()
  const hasAutoStartedRef = useRef(false)
  const [hasAutoStarted, setHasAutoStarted] = useState(false)

  // Mount a 1x1 invisible anchor at viewport center. Tour steps that don't
  // target a specific UI element use this so driver.js's stage cutout is
  // 1×1 (effectively invisible) instead of the default 20×20 white square.
  useEffect(() => {
    if (document.getElementById(TOUR_CENTER_ANCHOR_ID)) return
    const el = document.createElement("div")
    el.id = TOUR_CENTER_ANCHOR_ID
    el.style.cssText =
      "position:fixed;top:50%;left:50%;width:1px;height:1px;pointer-events:none;opacity:0;"
    document.body.appendChild(el)
    return () => {
      el.remove()
    }
  }, [])

  // Actions registered by page.tsx (open settings, switch tabs, etc).
  // Held in a ref so registration + reads don't trigger re-renders.
  const actionsRef = useRef<Partial<TourActions>>({})
  const registerActions = useCallback((actions: Partial<TourActions>) => {
    actionsRef.current = { ...actionsRef.current, ...actions }
  }, [])

  const finish = useCallback(() => {
    localStorage.setItem(LOCAL_DONE_KEY, "1")
    // Best-effort teardown of UI state the tour may have left open.
    actionsRef.current.closeDrawer?.()
    actionsRef.current.closeSettings?.()
    actionsRef.current.switchToChat?.()
    const token = getAccessToken()
    if (token) apiTutorialDismiss(token).catch(() => {})
  }, [])

  const start = useCallback(() => {
    const steps = buildTourSteps(t, actionsRef.current)
    startTour(steps, finish, {
      doneBtnText: t("tour_done"),
      nextBtnText: t("tour_next"),
      prevBtnText: t("tour_prev"),
    })
  }, [t, finish])

  const stop = useCallback(() => {
    stopTour()
    finish()
  }, [finish])

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
    <TourContext.Provider value={{ start, stop, hasAutoStarted, registerActions }}>
      {children}
    </TourContext.Provider>
  )
}

export function useTour() {
  const ctx = useContext(TourContext)
  if (!ctx) throw new Error("useTour must be used within TourProvider")
  return ctx
}
