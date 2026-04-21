import type { PlanStep } from "@/lib/types"

/**
 * Muted color palette for distinguishing cards in the DAG view.
 * Each entry: { bg, text, border } as raw CSS values.
 */
export type CardColor = { bg: string; text: string; border: string }

const CARD_COLORS: CardColor[] = [
  { bg: "rgba(59,130,246,0.10)", text: "#1e40af", border: "rgba(59,130,246,0.25)" },   // blue
  { bg: "rgba(168,85,247,0.10)", text: "#6b21a8", border: "rgba(168,85,247,0.25)" },   // purple
  { bg: "rgba(20,184,166,0.10)", text: "#115e59", border: "rgba(20,184,166,0.25)" },   // teal
  { bg: "rgba(245,158,11,0.10)", text: "#92400e", border: "rgba(245,158,11,0.25)" },   // amber
  { bg: "rgba(239,68,68,0.10)",  text: "#991b1b", border: "rgba(239,68,68,0.25)" },    // red
  { bg: "rgba(34,197,94,0.10)",  text: "#166534", border: "rgba(34,197,94,0.25)" },    // green
  { bg: "rgba(236,72,153,0.10)", text: "#9d174d", border: "rgba(236,72,153,0.25)" },   // pink
  { bg: "rgba(99,102,241,0.10)", text: "#3730a3", border: "rgba(99,102,241,0.25)" },   // indigo
]

/** Neutral color for steps not tied to a specific card (e.g. summary). */
export const NEUTRAL_CARD_COLOR: CardColor = { bg: "rgba(100,116,139,0.10)", text: "#334155", border: "rgba(100,116,139,0.25)" }

/**
 * Extract the card letter from a step id like "A1" → "A", "B3" → "B".
 * Returns null for non-card steps like "Z" (summary).
 */
export function extractCardLetter(stepId: string): string | null {
  const match = stepId.match(/^([A-Y])(\d+)$/)
  return match ? match[1] : null
}

/**
 * Build a stable mapping from card letter → color, based on the order
 * cards appear in the plan.
 */
export function buildCardColorMap(steps: PlanStep[]): Map<string, CardColor> {
  const map = new Map<string, CardColor>()
  let colorIdx = 0
  for (const s of steps) {
    const letter = extractCardLetter(s.id)
    if (letter && !map.has(letter)) {
      map.set(letter, CARD_COLORS[colorIdx % CARD_COLORS.length])
      colorIdx++
    }
  }
  return map
}

/** Get the color for a step, given the card color map. */
export function stepColor(stepId: string, colorMap: Map<string, CardColor>): CardColor {
  const letter = extractCardLetter(stepId)
  if (letter && colorMap.has(letter)) return colorMap.get(letter)!
  return NEUTRAL_CARD_COLOR
}

/**
 * Compute topological waves from step dependencies.
 * Wave 0 = steps with no deps, wave N = all deps in waves < N.
 * Falls back to a single wave when no step has dependsOn.
 */
export function computeWaves(steps: PlanStep[]): PlanStep[][] {
  if (steps.length === 0) return []

  // If no step has dependsOn, fall back to a single wave (flat list compat)
  const hasDeps = steps.some((s) => s.dependsOn && s.dependsOn.length > 0)
  if (!hasDeps) return [steps]

  const waves: PlanStep[][] = []
  const assigned = new Set<string>()

  while (assigned.size < steps.length) {
    const wave = steps.filter(
      (s) =>
        !assigned.has(s.id) &&
        (s.dependsOn || []).every((d) => assigned.has(d)),
    )
    if (wave.length === 0) break // safety: avoid infinite loop on bad data
    wave.forEach((s) => assigned.add(s.id))
    waves.push(wave)
  }

  // If some steps were unreachable (bad dep data), push them as a final wave
  const remaining = steps.filter((s) => !assigned.has(s.id))
  if (remaining.length > 0) waves.push(remaining)

  return waves
}
