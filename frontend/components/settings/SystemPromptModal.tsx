"use client"

import { useState, useEffect, useMemo } from "react"
import type { ReactNode } from "react"
import {
  apiGetSystemPrompt,
  apiSaveSystemPrompt,
  apiResetSystemPrompt,
} from "@/lib/api"

interface SystemPromptModalProps {
  onClose: () => void
  accessToken: string
}

function renderPreview(template: string): ReactNode[] {
  const now = new Date().toLocaleString("zh-CN")
  const substitutions: Record<string, string> = {
    long_term_memory: "(用户记忆)",
    current_date_and_time: now,
    agent_name: "Job Hunter Agent",
  }

  const parts = template.split(/(\{[^}]+\})/)
  return parts.map((part, i) => {
    const match = part.match(/^\{(\w+)\}$/)
    if (match) {
      const key = match[1]
      if (key in substitutions) {
        return (
          <span
            key={i}
            className="bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-300 rounded px-0.5"
          >
            {substitutions[key]}
          </span>
        )
      }
      // Unknown variable — amber warning
      return (
        <span
          key={i}
          className="bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 rounded px-0.5"
        >
          {part}
        </span>
      )
    }
    return part
  })
}

export function SystemPromptModal({ onClose, accessToken }: SystemPromptModalProps) {
  const [draft, setDraft] = useState("")
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const busy = saving || resetting

  useEffect(() => {
    apiGetSystemPrompt(accessToken)
      .then((r) => setDraft(r.prompt))
      .catch((e) => setSaveError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false))
  }, [accessToken])

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      await apiSaveSystemPrompt(accessToken, draft)
      onClose()
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "保存失败")
    } finally {
      setSaving(false)
    }
  }

  async function handleReset() {
    setResetting(true)
    setSaveError(null)
    try {
      const r = await apiResetSystemPrompt(accessToken)
      setDraft(r.prompt)
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "重置失败")
    } finally {
      setResetting(false)
    }
  }

  const preview = useMemo(() => renderPreview(draft), [draft])

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal panel */}
      <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="system-prompt-modal-title"
      >
        <div className="relative w-full max-w-2xl rounded-2xl bg-[var(--bg-1,white)] dark:bg-[var(--bg-1,#1e1e2e)] shadow-2xl border border-[var(--border-1,#e5e7eb)] dark:border-[var(--border-1,#313244)] flex flex-col max-h-[90vh]">

          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-1,#e5e7eb)] dark:border-[var(--border-1,#313244)] flex-shrink-0">
            <h2
              id="system-prompt-modal-title"
              className="text-base font-heading font-semibold text-[var(--text,#111827)] dark:text-[var(--text,#cdd6f4)]"
            >
              系统提示词
            </h2>
            <button
              onClick={onClose}
              aria-label="关闭"
              className="text-[var(--text-3,#9ca3af)] hover:text-[var(--text-2,#6b7280)] transition-colors rounded-full w-8 h-8 flex items-center justify-center hover:bg-black/5 dark:hover:bg-white/5"
            >
              ✕
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
            {loading ? (
              <div className="text-sm text-[var(--text-3,#9ca3af)] text-center py-8">
                加载中…
              </div>
            ) : (
              <>
                {/* Preview section */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-body font-medium text-[var(--text-2,#6b7280)] dark:text-[var(--text-2,#a6adc8)] uppercase tracking-wide">
                    预览（运行时效果）
                  </label>
                  <div
                    className="font-mono text-xs overflow-y-auto max-h-48 whitespace-pre-wrap rounded-xl bg-[var(--bg-2,#f9fafb)] dark:bg-[var(--bg-2,#181825)] border border-[var(--border-1,#e5e7eb)] dark:border-[var(--border-1,#313244)] px-3 py-2.5 text-[var(--text,#111827)] dark:text-[var(--text,#cdd6f4)] leading-relaxed"
                  >
                    {preview}
                  </div>
                </div>

                {/* Editor section */}
                <div className="flex flex-col gap-1.5">
                  <label
                    htmlFor="system-prompt-textarea"
                    className="text-xs font-body font-medium text-[var(--text-2,#6b7280)] dark:text-[var(--text-2,#a6adc8)] uppercase tracking-wide"
                  >
                    编辑模板
                  </label>
                  <textarea
                    id="system-prompt-textarea"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    disabled={busy}
                    className="font-mono text-sm min-h-[200px] w-full resize-y rounded-xl bg-[var(--bg-2,#f9fafb)] dark:bg-[var(--bg-2,#181825)] border border-[var(--border-1,#e5e7eb)] dark:border-[var(--border-1,#313244)] px-3 py-2.5 text-[var(--text,#111827)] dark:text-[var(--text,#cdd6f4)] placeholder-[var(--text-3,#9ca3af)] focus:outline-none focus:ring-2 focus:ring-[var(--accent,#6366f1)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  />

                  {/* Inline error */}
                  {saveError && (
                    <p className="text-xs text-red-500 dark:text-red-400 mt-0.5">
                      {saveError}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Footer */}
          {!loading && (
            <div className="flex items-center justify-between px-6 py-4 border-t border-[var(--border-1,#e5e7eb)] dark:border-[var(--border-1,#313244)] flex-shrink-0">
              {/* Left: Reset */}
              <button
                onClick={handleReset}
                disabled={busy}
                className="text-sm font-body text-[var(--text-3,#9ca3af)] hover:text-[var(--text-2,#6b7280)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors px-3 py-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/5"
              >
                {resetting ? "重置中…" : "重置为默认"}
              </button>

              {/* Right: Cancel + Save */}
              <div className="flex items-center gap-2">
                <button
                  onClick={onClose}
                  disabled={busy}
                  className="text-sm font-body text-[var(--text-2,#6b7280)] hover:text-[var(--text,#111827)] dark:hover:text-[var(--text,#cdd6f4)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors px-4 py-1.5 rounded-full hover:bg-black/5 dark:hover:bg-white/5"
                >
                  取消
                </button>
                <button
                  onClick={handleSave}
                  disabled={busy}
                  className="text-sm font-body font-medium px-4 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {saving ? "保存中…" : "保存"}
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </>
  )
}
