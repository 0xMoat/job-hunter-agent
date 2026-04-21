"use client"

import { useState } from "react"
import type { PlanStep } from "@/lib/types"
import { pillLabel } from "./PlanStepCard"
import { computeWaves, buildCardColorMap, stepColor } from "./planUtils"
import { useLanguage } from "@/contexts/LanguageContext"

interface PlanApprovalCardProps {
  round: number
  steps?: PlanStep[]
  onApprove: () => void
  onRevise: (feedback: string) => void
  onCancel: () => void
  disabled?: boolean
  companyById?: Record<number, string>
}

export function PlanApprovalCard({
  round,
  steps,
  onApprove,
  onRevise,
  onCancel,
  disabled = false,
  companyById,
}: PlanApprovalCardProps) {
  const { t } = useLanguage()
  const [revising, setRevising] = useState(false)
  const [feedback, setFeedback] = useState("")

  const waves = steps ? computeWaves(steps) : []
  const isMultiWave = waves.length > 1
  const cardColors = steps ? buildCardColorMap(steps) : new Map()

  if (revising) {
    return (
      <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-4">
        <div className="mb-2 text-sm font-medium text-indigo-900">
          告诉 Planner 要改什么：
        </div>
        <textarea
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
          placeholder="例如：不要调研 X 公司，直接写信"
          className="w-full resize-none rounded border border-indigo-200 bg-white/80 p-2 text-sm focus:border-indigo-500 focus:outline-none"
          rows={3}
          disabled={disabled}
        />
        <div className="mt-3 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => {
              setRevising(false)
              setFeedback("")
            }}
            disabled={disabled}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
          >
            返回
          </button>
          <button
            type="button"
            onClick={() => {
              const trimmed = feedback.trim()
              if (!trimmed) return
              onRevise(trimmed)
              setRevising(false)
              setFeedback("")
            }}
            disabled={disabled || !feedback.trim()}
            className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            提交反馈
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-medium text-indigo-900">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
        等你确认 · 第 {round} 轮
      </div>

      {/* DAG preview — pill layout per wave */}
      {isMultiWave && steps && (
        <div className="mb-3 rounded-md border border-indigo-200 bg-white/60 px-3 py-2">
          <div className="mb-2 text-[10px] font-medium text-indigo-600">
            {t("pe_approval_dag_title")} · {steps.length} 步
          </div>
          <div className="flex flex-col gap-2">
            {waves.map((wave, wi) => (
              <div key={wi}>
                <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-indigo-500">
                  Wave {wi + 1} · {wave.length > 1 ? "并行" : ""}
                </div>
                <div className="flex flex-wrap gap-1">
                  {wave.map((s) => {
                    const color = stepColor(s.id, cardColors)
                    return (
                      <span
                        key={s.id}
                        className="rounded-full px-2 py-0.5 text-[10px] font-medium"
                        style={{
                          backgroundColor: color.bg,
                          color: color.text,
                          border: `1px solid ${color.border}`,
                        }}
                      >
                        {pillLabel(s.text, companyById)}
                      </span>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-2 text-[9px] text-indigo-400">
            同一 Wave 内的步骤并行执行
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={disabled}
          className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
        >
          ✗ 取消
        </button>
        <button
          type="button"
          onClick={() => setRevising(true)}
          disabled={disabled}
          className="rounded-full border border-indigo-300 bg-white px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
        >
          ✎ 提修改意见
        </button>
        <button
          type="button"
          onClick={onApprove}
          disabled={disabled}
          className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          ✓ 批准执行
        </button>
      </div>
    </div>
  )
}
