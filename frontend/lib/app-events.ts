"use client"

/**
 * App-wide event bus for cross-component signals that don't justify
 * lifting state into a Context. Uses window CustomEvent under the hood.
 */

const APPLICATIONS_INVALIDATED = "app:applications_invalidated"

export function emitApplicationsInvalidated(): void {
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent(APPLICATIONS_INVALIDATED))
}

export function onApplicationsInvalidated(handler: () => void): () => void {
  if (typeof window === "undefined") return () => {}
  window.addEventListener(APPLICATIONS_INVALIDATED, handler)
  return () => window.removeEventListener(APPLICATIONS_INVALIDATED, handler)
}
