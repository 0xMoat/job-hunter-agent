import type { DriveStep } from "./driver"

type T = (key: string, ...args: unknown[]) => string

export interface TourActions {
  openSettings: () => void
  setSettingsTab: (tab: "prompt" | "resume" | "search") => void
  closeSettings: () => void
  switchToTracker: () => void
  switchToChat: () => void
  switchToTutorialSession: () => void
  openFirstKanbanCard: () => void
  closeDrawer: () => void
}

export function buildTourSteps(t: T, actions: Partial<TourActions> = {}): DriveStep[] {
  const popover = (key: string): DriveStep["popover"] => ({
    title: t(`tour_${key}_title`),
    description: t(`tour_${key}_body`),
    nextBtnText: t("tour_next"),
    prevBtnText: t("tour_prev"),
    doneBtnText: t("tour_done"),
    showButtons: ["next", "previous", "close"],
  })

  // Ensure the tutorial session is active for any chat-anchored step.
  const enterTutorialSession = () => actions.switchToTutorialSession?.()

  // Driver.js renders a 20×20 default cutout in the overlay when a step has
  // no real target element — visible as a white square mid-screen. Strip the
  // cutout sub-path from the overlay SVG for these "centered" steps.
  const eraseStageCutout = () => {
    const path = document.querySelector("body > svg > path") as SVGPathElement | null
    if (!path) return
    const d = path.getAttribute("d") ?? ""
    // Keep only the first sub-path (the full-viewport rect); drop the 2nd M... sub-path.
    const firstOnly = d.split(/\s*M/).filter(Boolean)[0]
    if (firstOnly) path.setAttribute("d", "M" + firstOnly)
  }

  return [
    {
      element: "#jh-tour-center-anchor",
      popover: popover("welcome"),
      onHighlighted: eraseStageCutout,
    },
    {
      element: '[data-tour="sidebar"]',
      popover: { ...popover("sidebar"), side: "right", align: "start" },
      onHighlightStarted: enterTutorialSession,
    },
    {
      element: '[data-tour="chat"]',
      popover: { ...popover("chat"), side: "left", align: "center" },
      onHighlightStarted: enterTutorialSession,
    },
    {
      element: '[data-tour="input"]',
      popover: { ...popover("input"), side: "top", align: "center" },
    },
    {
      element: '[data-tour="job-search-card"]',
      popover: { ...popover("jd_save"), side: "right", align: "start" },
      onHighlightStarted: enterTutorialSession,
    },
    {
      element: '[data-tour="pe-timeline"]',
      popover: { ...popover("pe"), side: "left", align: "center" },
      onHighlightStarted: enterTutorialSession,
    },
    {
      element: '[data-tour="tab-tracker"]',
      popover: { ...popover("tab_tracker"), side: "bottom", align: "center" },
      onHighlightStarted: () => actions.switchToTracker?.(),
    },
    {
      element: '[data-tour="kanban-first-card"]',
      popover: { ...popover("kanban_card"), side: "right", align: "start" },
    },
    {
      element: '[data-tour="drawer"]',
      popover: { ...popover("drawer"), side: "left", align: "start" },
      onHighlightStarted: () => actions.openFirstKanbanCard?.(),
    },
    {
      element: '[data-tour="drawer-artifacts"]',
      popover: { ...popover("drawer_artifacts"), side: "left", align: "center" },
    },
    {
      element: '[data-tour="drawer-match"]',
      popover: { ...popover("drawer_match"), side: "left", align: "center" },
      onDeselected: () => {
        actions.closeDrawer?.()
        actions.switchToChat?.()
      },
    },
    {
      element: '[data-tour="settings"]',
      popover: { ...popover("settings"), side: "bottom", align: "end" },
      onHighlightStarted: () => actions.openSettings?.(),
    },
    {
      element: '[data-tour="settings-tab-prompt"]',
      popover: { ...popover("settings_prompt"), side: "bottom", align: "start" },
      onHighlightStarted: () => actions.setSettingsTab?.("prompt"),
    },
    {
      element: '[data-tour="settings-tab-resume"]',
      popover: { ...popover("settings_resume"), side: "bottom", align: "start" },
      onHighlightStarted: () => actions.setSettingsTab?.("resume"),
    },
    {
      element: "#jh-tour-center-anchor",
      popover: popover("memory"),
      onHighlighted: eraseStageCutout,
      onDeselected: () => actions.closeSettings?.(),
    },
    {
      element: '[data-tour="sidebar-replay"]',
      popover: { ...popover("replay"), side: "top", align: "center" },
    },
    {
      element: "#jh-tour-center-anchor",
      popover: popover("done"),
      onHighlighted: eraseStageCutout,
    },
  ]
}
