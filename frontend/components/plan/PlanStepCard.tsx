"use client"

import { useEffect, useRef, useState } from "react"
import type { PlanStep } from "@/lib/types"

const TOOL_LABELS: Record<string, string> = {
  job_search_tool: "Job Search",
  company_research_tool: "Company Research",
  application_tracker_tool: "Application Tracker",
  job_preferences_tool: "Preferences",
  duckduckgo_search: "Web Search",
  score_jd_match: "Score JD Match",
  analyze_jd_gap: "Analyze Gap",
  generate_interview_questions: "Interview Questions",
  save_company_research: "Save Research",
  save_tailored_resume: "Save Resume",
  generate_resume_pdf: "Generate PDF",
  trigger_resume_studio_skill: "Resume Studio",
}

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name
}

function fmtDuration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

export function humanizePlanStepText(
  text: string,
  companyById?: Record<number, string>,
): string {
  return text.replace(/application_id\s*[:=]\s*(\d+)/g, (_m, raw: string) => {
    const id = Number(raw)
    const company = companyById?.[id]
    return company ? `${company}（#${id}）` : `卡片 #${id}`
  })
}

/**
 * One step rendered as a single-line feed entry — replaces the previous
 * large-card layout so a 17-step plan fits on one screen. The active step
 * expands inline with a mono tool-log preview so the user can see the
 * agent is actually working (Variant B from the mock comparison).
 */
export function PlanStepRow({
  step,
  position,
  companyById,
}: {
  step: PlanStep
  position: number
  companyById?: Record<number, string>
}) {
  const isRunning = step.status === "running"
  const isDone = step.status === "done"
  const isFailed = step.status === "failed"
  const isPending = step.status === "pending"

  // Step-level elapsed. Prefer the server-emitted start time (survives page
  // refresh); fall back to the first local render that saw `running` for
  // legacy cached steps emitted before the server started sending it.
  const STALL_THRESHOLD_SECONDS = 600 // 10 min — container restart / LLM hang
  const localStartRef = useRef<number | null>(null)
  const [now, setNow] = useState(Date.now())
  if (isRunning && step.startedAt == null && localStartRef.current === null) {
    localStartRef.current = Date.now()
  }
  useEffect(() => {
    if (!isRunning) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [isRunning])
  const startOrigin = step.startedAt ?? localStartRef.current
  const elapsed = startOrigin ? Math.floor((now - startOrigin) / 1000) : 0
  const isStalled = isRunning && elapsed > STALL_THRESHOLD_SECONDS

  const hasToolCalls = Boolean(step.toolCalls && step.toolCalls.length > 0)
  const hasLiveText = Boolean(step.liveText && step.liveText.length > 0)
  const hasResult = Boolean(step.result && step.result.length > 0)
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="group relative flex gap-3 py-1.5">
      {/* Status marker dot — the vertical connector line is drawn by the
          parent timeline container behind this dot. */}
      <div className="relative z-10 mt-[7px] shrink-0">
        {isDone && (
          <span className="block h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white" />
        )}
        {isFailed && (
          <span className="block h-2.5 w-2.5 rounded-full bg-rose-500 ring-2 ring-white" />
        )}
        {isRunning && !isStalled && (
          <span className="block h-2.5 w-2.5 rounded-full bg-indigo-500 ring-2 ring-white shadow-[0_0_0_4px_rgba(99,102,241,0.18)] animate-pulse" />
        )}
        {isStalled && (
          <span className="block h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-white shadow-[0_0_0_4px_rgba(251,191,36,0.22)]" />
        )}
        {isPending && (
          <span className="block h-2.5 w-2.5 rounded-full border-[1.5px] border-zinc-300 bg-white" />
        )}
      </div>

      {/* Body */}
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="w-5 shrink-0 font-mono text-[10px] text-zinc-400">
            {String(position).padStart(2, "0")}
          </span>
          <span
            className={`flex-1 text-xs leading-relaxed ${
              isDone
                ? "text-zinc-500"
                : isPending
                  ? "text-zinc-400"
                  : isFailed
                    ? "text-rose-700"
                    : "font-medium text-zinc-800"
            }`}
          >
            {humanizePlanStepText(step.text, companyById)}
          </span>
          {isRunning && !isStalled && (
            <span className="shrink-0 font-mono text-[10px] text-indigo-600">
              {fmtDuration(elapsed)} running…
            </span>
          )}
          {isStalled && (
            <span
              className="shrink-0 font-mono text-[10px] text-amber-700"
              title="超过 10 分钟无更新，服务可能在该步骤期间重启。请重新发起处理。"
            >
              {fmtDuration(elapsed)} 可能已中断
            </span>
          )}
          {isDone && hasResult && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="shrink-0 cursor-pointer font-mono text-[10px] text-zinc-400 hover:text-zinc-700"
              aria-label={expanded ? "收起" : "展开结果"}
            >
              {expanded ? "▾" : "▸"}
            </button>
          )}
        </div>

        {/* Live log for the active step — tool call name + streaming args +
            streaming text. This is the "agent is alive" signal. */}
        {isRunning && (hasToolCalls || hasLiveText) && (
          <div className="mt-1.5 ml-7 rounded-md border-l-2 border-indigo-400 bg-zinc-50/80 px-2.5 py-1.5 font-mono text-[10.5px] leading-relaxed text-zinc-600">
            {step.toolCalls?.map((tc) => {
              const argsPreview = tc.args
                ? tc.args.length > 80
                  ? tc.args.slice(0, 80) + "…"
                  : tc.args
                : ""
              return (
                <div key={tc.id} className="break-all">
                  <span className="text-indigo-600">→ {toolLabel(tc.name)}</span>
                  {argsPreview && <span className="text-zinc-500"> {argsPreview}</span>}
                </div>
              )
            })}
            {hasLiveText && (
              <div className="whitespace-pre-wrap break-words">
                {step.liveText}
                <span className="ml-0.5 inline-block h-3 w-1 translate-y-0.5 animate-pulse bg-indigo-500" />
              </div>
            )}
          </div>
        )}

        {/* Expanded final result on done steps */}
        {isDone && expanded && hasResult && (
          <div className="mt-1.5 ml-7 rounded-md bg-zinc-50 px-2.5 py-1.5">
            <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words font-mono text-[10.5px] leading-relaxed text-zinc-700">
              {step.result}
            </pre>
          </div>
        )}
      </div>
    </div>
  )
}

export { PlanStepRow as PlanStepCard }
