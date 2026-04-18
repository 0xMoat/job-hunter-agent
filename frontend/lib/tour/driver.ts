"use client"

import { driver as createDriver, type Driver, type DriveStep } from "driver.js"
import "driver.js/dist/driver.css"

let instance: Driver | null = null

export function startTour(steps: DriveStep[], onDone: () => void) {
  instance?.destroy()
  instance = createDriver({
    showProgress: true,
    allowClose: true,
    animate: true,
    overlayOpacity: 0.55,
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
