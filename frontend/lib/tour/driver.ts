"use client"

import { driver as createDriver, type Driver, type DriveStep } from "driver.js"
import "driver.js/dist/driver.css"

let instance: Driver | null = null

interface StartTourOptions {
  doneBtnText?: string
  nextBtnText?: string
  prevBtnText?: string
}

export function startTour(
  steps: DriveStep[],
  onDone: () => void,
  opts: StartTourOptions = {},
) {
  instance?.destroy()
  instance = createDriver({
    showProgress: true,
    allowClose: true,
    animate: true,
    overlayOpacity: 0.55,
    // Global defaults — driver.js swaps nextBtnText -> doneBtnText on the
    // last step automatically when doneBtnText is provided here.
    doneBtnText: opts.doneBtnText,
    nextBtnText: opts.nextBtnText,
    prevBtnText: opts.prevBtnText,
    steps,
    onDestroyed: () => onDone(),
  })
  instance.drive()
}

export function stopTour() {
  instance?.destroy()
  instance = null
}

export type { DriveStep } from "driver.js"
