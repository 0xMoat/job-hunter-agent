"use client"

import { useState } from "react"
import { startPlanExecute } from "@/lib/api"
import type { PlanStep, PlanStreamChunk } from "@/lib/types"
import { PlanStepCard } from "./PlanStepCard"

interface PlanTimelineProps {
  token: string
  goal?: string
}

export function PlanTimeline({ token, goal }: PlanTimelineProps) {
  const [steps, setSteps] = useState<PlanStep[]>([])
  const [finalResponse, setFinalResponse] = useState<string | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  async function run() {
    setSteps([])
    setFinalResponse(null)
    setErrorMsg(null)
    setRunning(true)

    let res: Response
    try {
      res = await startPlanExecute(token, goal)
    } catch (e) {
      setErrorMsg((e as Error).message)
      setRunning(false)
      return
    }
    if (!res.ok || !res.body) {
      setErrorMsg(`HTTP ${res.status}`)
      setRunning(false)
      return
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ""

    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const blocks = buffer.split("\n\n")
      buffer = blocks.pop() ?? ""

      for (const block of blocks) {
        const line = block.split("\n").find((l) => l.startsWith("data: "))
        if (!line) continue
        const payload = line.slice(6).trim()
        if (!payload) continue
        let chunk: PlanStreamChunk
        try {
          chunk = JSON.parse(payload) as PlanStreamChunk
        } catch {
          continue
        }
        handleChunk(chunk, setSteps, setFinalResponse, setErrorMsg)
      }
    }
    setRunning(false)
  }

  const completed = steps.filter((s) => s.status === "done" || s.status === "failed").length
  const total = steps.length || 0

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <button
          onClick={run}
          disabled={running}
          className="rounded bg-indigo-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {running ? "运行中…" : "一键处理今日推荐"}
        </button>
        {total > 0 && (
          <div className="text-sm text-zinc-600">
            进度 {completed} / {total}
            <div className="mt-1 h-1.5 w-48 rounded-full bg-zinc-200">
              <div
                className="h-full rounded-full bg-indigo-600 transition-all"
                style={{ width: `${total ? (completed / total) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="rounded border border-rose-400 bg-rose-50 px-4 py-2 text-sm text-rose-800">
          错误：{errorMsg}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {steps.map((s) => (
          <PlanStepCard key={s.index} step={s} />
        ))}
      </div>

      {finalResponse && (
        <div className="rounded border border-emerald-400 bg-emerald-50 p-4">
          <div className="mb-2 font-semibold text-emerald-900">最终回复</div>
          <div className="whitespace-pre-wrap text-sm">{finalResponse}</div>
        </div>
      )}
    </div>
  )
}

function handleChunk(
  chunk: PlanStreamChunk,
  setSteps: React.Dispatch<React.SetStateAction<PlanStep[]>>,
  setFinal: (v: string) => void,
  setErr: (v: string) => void,
) {
  if (chunk.type === "plan_created") {
    setSteps(
      chunk.steps.map((text, i) => ({ index: i, text, status: "pending" as const })),
    )
    return
  }
  if (chunk.type === "step_started") {
    setSteps((prev) =>
      prev.map((s) => (s.index === chunk.index ? { ...s, status: "running" } : s)),
    )
    return
  }
  if (chunk.type === "step_completed") {
    const failed = chunk.result?.startsWith("FAILED")
    setSteps((prev) =>
      prev.map((s) =>
        s.index === chunk.index
          ? { ...s, status: failed ? "failed" : "done", result: chunk.result }
          : s,
      ),
    )
    return
  }
  if (chunk.type === "plan_updated") {
    setSteps((prev) => {
      const doneOrFailed = prev.filter(
        (s) => s.status === "done" || s.status === "failed",
      )
      const offset = doneOrFailed.length
      const newRemaining: PlanStep[] = chunk.remaining.map((text, i) => ({
        index: offset + i,
        text,
        status: "pending" as const,
      }))
      return [...doneOrFailed, ...newRemaining]
    })
    return
  }
  if (chunk.type === "final_response") {
    setFinal(chunk.content)
    return
  }
  if (chunk.type === "error") {
    setErr(chunk.message)
  }
}
