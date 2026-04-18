import type { DriveStep } from "./driver"

type T = (key: string, ...args: unknown[]) => string

export function buildTourSteps(t: T): DriveStep[] {
  const base = (key: string): DriveStep["popover"] => ({
    title: t(`tour_${key}_title`),
    description: t(`tour_${key}_body`),
    nextBtnText: t("tour_next"),
    prevBtnText: t("tour_prev"),
    doneBtnText: t("tour_done"),
    showButtons: ["next", "previous", "close"],
  })

  return [
    { popover: base("welcome") },
    { element: '[data-tour="sidebar"]', popover: { ...base("sidebar"), side: "right", align: "start" } },
    { element: '[data-tour="chat"]', popover: { ...base("chat"), side: "left", align: "center" } },
    { element: '[data-tour="input"]', popover: { ...base("input"), side: "top", align: "center" } },
    { element: '[data-tour="tab-tracker"]', popover: { ...base("tab_tracker"), side: "bottom", align: "center" } },
    { element: '[data-tour="pe-timeline"]', popover: { ...base("pe"), side: "left", align: "center" } },
    { element: '[data-tour="settings"]', popover: { ...base("settings"), side: "bottom", align: "end" } },
    { popover: base("memory") },
    { popover: base("done") },
  ]
}
