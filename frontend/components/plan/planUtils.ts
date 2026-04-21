import type { PlanStep } from "@/lib/types"

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
