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

  // Applied to welcome/memory/done steps that have no target element.
  // CSS in globals.css hides the overlay SVG + popover arrow when this class
  // is present so the popover sits cleanly in the middle of the viewport.
  const centered = "tour-centered"

  return [
    { popover: { ...popover("welcome"), popoverClass: centered } },
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
      popover: { ...popover("memory"), popoverClass: centered },
      onDeselected: () => actions.closeSettings?.(),
    },
    {
      element: '[data-tour="sidebar-replay"]',
      popover: { ...popover("replay"), side: "top", align: "center" },
    },
    { popover: { ...popover("done"), popoverClass: centered } },
  ]
}
