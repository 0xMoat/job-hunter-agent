"use client"

import { useEffect, useRef, useState } from "react"
import type { PlanExecuteView } from "@/lib/types"
import { PlanStepRow } from "./PlanStepCard"
import { PlanApprovalCard } from "./PlanApprovalCard"
import { computeWaves, buildCardColorMap, stepColor, extractCardLetter } from "./planUtils"
import { useLanguage } from "@/contexts/LanguageContext"

interface PlanTimelineViewProps {
  view: PlanExecuteView
  onApprove?: () => void
  onRevise?: (feedback: string) => void
  onCancel?: () => void
  actionsDisabled?: boolean
  /** Fired from the final-response CTA. The parent is expected to locate the
   * top-scored pending card, switch to the kanban tab, and open its drawer. */
  onJumpToTopCard?: () => void | Promise<void>
  /** Map of application_id → company name, used to render plan step text with
   * human-readable company labels instead of bare "#4" card ids. */
  companyById?: Record<number, string>
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

// ── Component ───────────────────────────────────────────────────────────────

export function PlanTimelineView({
  view,
  onApprove,
  onRevise,
  onCancel,
  actionsDisabled,
  onJumpToTopCard,
  companyById,
}: PlanTimelineViewProps) {
  const { t } = useLanguage()
  const [jumping, setJumping] = useState(false)
  const completed = view.steps.filter(
    (s) => s.status === "done" || s.status === "failed",
  ).length
  const total = view.steps.length
  const runningIndex = view.steps.findIndex((s) => s.status === "running")
  const runningStep = runningIndex >= 0 ? view.steps[runningIndex] : null
  const currentToolName =
    runningStep?.toolCalls?.[runningStep.toolCalls.length - 1]?.name

  // Plan-level elapsed timer — starts the first time we see the plan run.
  const planStartedRef = useRef<number | null>(null)
  const [now, setNow] = useState(Date.now())
  if ((view.running || completed > 0) && planStartedRef.current === null) {
    planStartedRef.current = Date.now()
  }
  useEffect(() => {
    if (!view.running) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [view.running])
  const elapsed = planStartedRef.current
    ? Math.floor((now - planStartedRef.current) / 1000)
    : 0

  let pill: { label: string; className: string; dot?: boolean } | null = null
  if (view.errorMsg) {
    pill = { label: t("pe_pill_error"), className: "bg-rose-100 text-rose-700" }
  } else if (view.cancelled) {
    pill = { label: t("pe_pill_cancelled"), className: "bg-zinc-100 text-zinc-600" }
  } else if (view.finalResponse) {
    pill = { label: t("pe_pill_completed"), className: "bg-emerald-100 text-emerald-700" }
  } else if (view.awaitingApproval) {
    pill = {
      label: t("pe_pill_awaiting", view.approvalRound),
      className: "bg-indigo-100 text-indigo-700",
    }
  } else if (view.running) {
    pill = {
      label: t("pe_pill_running"),
      className: "bg-indigo-100 text-indigo-700",
      dot: true,
    }
  }

  const showHeader = pill !== null || total > 0
  const waves = computeWaves(view.steps)
  const isMultiWave = waves.length > 1
  const cardColors = buildCardColorMap(view.steps)

  // Build a global flat index for step numbering
  const stepNumberMap = new Map<string, number>()
  view.steps.forEach((s, i) => stepNumberMap.set(s.id, i + 1))

  // Stable card column order — derived from first wave (which has one step per card)
  const cardOrder: string[] = []
  for (const s of view.steps) {
    const letter = extractCardLetter(s.id)
    if (letter && !cardOrder.includes(letter)) cardOrder.push(letter)
  }
  const numCards = cardOrder.length || 1

  return (
    <div className="flex flex-col gap-3" data-tour="pe-timeline">
      {showHeader && (
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-2.5">
          <div className="flex min-w-0 items-center gap-2">
            {pill && (
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${pill.className}`}
              >
                {pill.dot && (
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
                )}
                {pill.label}
              </span>
            )}
            {view.running && runningStep && (
              <span className="truncate font-body text-xs text-zinc-600">
                {currentToolName && (
                  <>
                    <span className="font-mono text-zinc-500">
                      {currentToolName}
                    </span>
                    {" · "}
                  </>
                )}
                Step {runningIndex + 1}
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2 font-mono text-[11px] text-zinc-500">
            {total > 0 && (
              <span>
                {completed} / {total}
              </span>
            )}
            {planStartedRef.current !== null && <span>· {fmtDuration(elapsed)}</span>}
          </div>
        </div>
      )}

      {view.revisionReason && (
        <div className="rounded-md bg-indigo-50 px-3 py-1.5 text-[11px] text-indigo-700">
          {t("pe_revision_updated")}
        </div>
      )}

      {view.errorMsg && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-1.5 text-[11px] text-rose-700">
          {t("pe_error_prefix")}: {view.errorMsg}
        </div>
      )}

      {total > 0 && (
        <div className="relative">

          {isMultiWave ? (
            /* ── Wave-grouped layout — CSS Grid aligned by card column ── */
            <div className="flex flex-col gap-3">
              {waves.map((wave, wi) => {
                // Group steps in this wave by card letter
                const stepsByCard = new Map<string, typeof wave>()
                const noCardSteps: typeof wave = []
                for (const s of wave) {
                  const letter = extractCardLetter(s.id)
                  if (letter) {
                    const arr = stepsByCard.get(letter) || []
                    arr.push(s)
                    stepsByCard.set(letter, arr)
                  } else {
                    noCardSteps.push(s)
                  }
                }
                // Non-card steps (e.g. summary) span full width
                if (noCardSteps.length > 0 && stepsByCard.size === 0) {
                  return (
                    <div key={wi}>
                      <div className="mb-1 flex items-center gap-2">
                        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                          {t("pe_wave_label", wi + 1)}
                        </span>
                      </div>
                      {noCardSteps.map((s) => {
                        const color = stepColor(s.id, cardColors)
                        return (
                          <div
                            key={s.id}
                            className="rounded-md px-1.5 py-0.5"
                            style={{ backgroundColor: color.bg }}
                          >
                            <PlanStepRow step={s} position={stepNumberMap.get(s.id) ?? 0} companyById={companyById} />
                          </div>
                        )
                      })}
                    </div>
                  )
                }

                return (
                  <div key={wi}>
                    <div className="mb-1 flex items-center gap-2">
                      <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-zinc-400">
                        {t("pe_wave_label", wi + 1)}
                      </span>
                      {wave.length > 1 && (
                        <span className="text-[10px] text-zinc-400">
                          {t("pe_parallel_steps", wave.length)}
                        </span>
                      )}
                    </div>
                    {/* Grid: one column per card, aligned across waves */}
                    <div
                      className="grid gap-x-1.5 gap-y-1"
                      style={{ gridTemplateColumns: `repeat(${numCards}, minmax(0, 1fr))` }}
                    >
                      {cardOrder.map((letter) => {
                        const steps = stepsByCard.get(letter) || []
                        const color = steps.length > 0 ? stepColor(steps[0].id, cardColors) : undefined
                        return (
                          <div
                            key={letter}
                            className="flex flex-col gap-0.5 rounded-md px-1.5 py-0.5"
                            style={{ backgroundColor: color?.bg }}
                          >
                            {steps.map((s) => (
                              <PlanStepRow
                                key={s.id}
                                step={s}
                                position={stepNumberMap.get(s.id) ?? 0}
                                companyById={companyById}
                              />
                            ))}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : (
            /* ── Flat serial layout (no deps — legacy compat) ──────────── */
            <div className="relative">
              {total > 1 && (
                <div className="pointer-events-none absolute bottom-3 left-[5px] top-3 w-px bg-zinc-200" />
              )}
              {view.steps.map((s, i) => (
                <PlanStepRow key={s.id} step={s} position={i + 1} companyById={companyById} />
              ))}
            </div>
          )}
        </div>
      )}

      {view.awaitingApproval && onApprove && onRevise && onCancel && (
        <PlanApprovalCard
          round={view.approvalRound}
          onApprove={onApprove}
          onRevise={onRevise}
          onCancel={onCancel}
          disabled={actionsDisabled}
        />
      )}

      {view.finalResponse && !view.cancelled && (
        <div className="mt-1 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2.5">
          <div className="mb-1 text-[11px] font-semibold text-emerald-700">
            {t("pe_final_response_label")}
          </div>
          <div className="whitespace-pre-wrap text-xs text-emerald-900">
            {view.finalResponse}
          </div>
          {onJumpToTopCard && (
            <button
              type="button"
              onClick={async () => {
                setJumping(true)
                try {
                  await onJumpToTopCard()
                } finally {
                  setJumping(false)
                }
              }}
              disabled={jumping}
              className="mt-2 inline-flex items-center gap-1 rounded-full
                         border border-emerald-300 bg-white px-3 py-1
                         text-[11px] font-medium text-emerald-800
                         hover:bg-emerald-50 disabled:opacity-50
                         disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              {jumping ? t("pe_jump_top_card_loading") : t("pe_jump_top_card")}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
