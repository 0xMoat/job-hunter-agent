"use client"

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react"
import type { PlanExecuteView, PlanStep } from "@/lib/types"
import { PlanStepRow } from "./PlanStepCard"
import { PlanApprovalCard } from "./PlanApprovalCard"
import { computeWaves, buildCardColorMap, stepColor } from "./planUtils"
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

// ── SVG edge helpers ────────────────────────────────────────────────────────

interface Edge {
  from: string
  to: string
}

function collectEdges(steps: PlanStep[]): Edge[] {
  const edges: Edge[] = []
  for (const s of steps) {
    for (const dep of s.dependsOn || []) {
      edges.push({ from: dep, to: s.id })
    }
  }
  return edges
}

function edgeColor(sourceStep: PlanStep | undefined): {
  stroke: string
  dashArray: string
} {
  if (!sourceStep) return { stroke: "#475569", dashArray: "4 3" }
  switch (sourceStep.status) {
    case "done":
      return { stroke: "#22c55e", dashArray: "" }
    case "failed":
      return { stroke: "#ef4444", dashArray: "4 3" }
    default:
      return { stroke: "#475569", dashArray: "4 3" }
  }
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

  // ── SVG edge drawing ──────────────────────────────────────────────────────
  const containerRef = useRef<HTMLDivElement>(null)
  const stepRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const [svgLines, setSvgLines] = useState<
    { x1: number; y1: number; x2: number; y2: number; stroke: string; dashArray: string }[]
  >([])

  const setStepRef = useCallback(
    (id: string) => (el: HTMLDivElement | null) => {
      if (el) stepRefs.current.set(id, el)
      else stepRefs.current.delete(id)
    },
    [],
  )

  const stepMap = new Map(view.steps.map((s) => [s.id, s]))
  const edges = isMultiWave ? collectEdges(view.steps) : []

  // Measure positions and draw edges
  const measureEdges = useCallback(() => {
    if (!isMultiWave || edges.length === 0 || !containerRef.current) {
      setSvgLines([])
      return
    }
    const containerRect = containerRef.current.getBoundingClientRect()
    const lines: typeof svgLines = []
    for (const edge of edges) {
      const fromEl = stepRefs.current.get(edge.from)
      const toEl = stepRefs.current.get(edge.to)
      if (!fromEl || !toEl) continue
      const fromRect = fromEl.getBoundingClientRect()
      const toRect = toEl.getBoundingClientRect()
      const { stroke, dashArray } = edgeColor(stepMap.get(edge.from))
      // From bottom-center of source to top-center of target
      lines.push({
        x1: fromRect.left + fromRect.width / 2 - containerRect.left,
        y1: fromRect.bottom - containerRect.top,
        x2: toRect.left + toRect.width / 2 - containerRect.left,
        y2: toRect.top - containerRect.top,
        stroke,
        dashArray,
      })
    }
    setSvgLines(lines)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isMultiWave, edges.length, view.steps])

  useLayoutEffect(() => {
    measureEdges()
  }, [measureEdges])

  // Re-measure on window resize
  useEffect(() => {
    if (!isMultiWave) return
    const handler = () => measureEdges()
    window.addEventListener("resize", handler)
    return () => window.removeEventListener("resize", handler)
  }, [isMultiWave, measureEdges])

  // Build a global flat index for step numbering
  const stepNumberMap = new Map<string, number>()
  view.steps.forEach((s, i) => stepNumberMap.set(s.id, i + 1))

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
        <div className="relative" ref={containerRef}>
          {/* SVG overlay for dependency edges */}
          {svgLines.length > 0 && (
            <svg
              className="pointer-events-none absolute inset-0 z-0"
              style={{ width: "100%", height: "100%", overflow: "visible" }}
            >
              <defs>
                <marker
                  id="arrow-green"
                  markerWidth="6"
                  markerHeight="4"
                  refX="5"
                  refY="2"
                  orient="auto"
                >
                  <path d="M0,0 L6,2 L0,4" fill="#22c55e" />
                </marker>
                <marker
                  id="arrow-gray"
                  markerWidth="6"
                  markerHeight="4"
                  refX="5"
                  refY="2"
                  orient="auto"
                >
                  <path d="M0,0 L6,2 L0,4" fill="#475569" />
                </marker>
                <marker
                  id="arrow-red"
                  markerWidth="6"
                  markerHeight="4"
                  refX="5"
                  refY="2"
                  orient="auto"
                >
                  <path d="M0,0 L6,2 L0,4" fill="#ef4444" />
                </marker>
              </defs>
              {svgLines.map((line, i) => {
                const markerId =
                  line.stroke === "#22c55e"
                    ? "arrow-green"
                    : line.stroke === "#ef4444"
                      ? "arrow-red"
                      : "arrow-gray"
                // Use a slight bezier curve if horizontal offset is significant
                const dx = Math.abs(line.x2 - line.x1)
                const dy = line.y2 - line.y1
                if (dx > 20 && dy > 10) {
                  const midY = (line.y1 + line.y2) / 2
                  return (
                    <path
                      key={i}
                      d={`M${line.x1},${line.y1} C${line.x1},${midY} ${line.x2},${midY} ${line.x2},${line.y2}`}
                      fill="none"
                      stroke={line.stroke}
                      strokeWidth="1.2"
                      strokeDasharray={line.dashArray}
                      markerEnd={`url(#${markerId})`}
                      opacity="0.6"
                    />
                  )
                }
                return (
                  <line
                    key={i}
                    x1={line.x1}
                    y1={line.y1}
                    x2={line.x2}
                    y2={line.y2}
                    stroke={line.stroke}
                    strokeWidth="1.2"
                    strokeDasharray={line.dashArray}
                    markerEnd={`url(#${markerId})`}
                    opacity="0.6"
                  />
                )
              })}
            </svg>
          )}

          {isMultiWave ? (
            /* ── Wave-grouped layout ────────────────────────────────────── */
            <div className="flex flex-col gap-4">
              {waves.map((wave, wi) => (
                <div key={wi}>
                  {/* Wave label */}
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
                  {/* Steps in this wave — horizontal flex-wrap */}
                  <div className="flex flex-wrap gap-x-1.5 gap-y-1">
                    {wave.map((s) => {
                      const color = stepColor(s.id, cardColors)
                      return (
                        <div
                          key={s.id}
                          ref={setStepRef(s.id)}
                          className="min-w-0 flex-1 basis-60 rounded-md px-1.5 py-0.5"
                          style={{ backgroundColor: color.bg }}
                        >
                          <PlanStepRow
                            step={s}
                            position={stepNumberMap.get(s.id) ?? 0}
                            companyById={companyById}
                          />
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
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
          steps={view.steps}
          onApprove={onApprove}
          onRevise={onRevise}
          onCancel={onCancel}
          disabled={actionsDisabled}
          companyById={companyById}
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
