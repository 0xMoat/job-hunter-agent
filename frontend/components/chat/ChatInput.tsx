"use client"

import { useState, useRef } from "react"
import { useLanguage } from "@/contexts/LanguageContext"

interface Props {
  onSend: (text: string) => void
  disabled: boolean
  disabledHint?: string
}

export function ChatInput({ onSend, disabled, disabledHint }: Props) {
  const { t } = useLanguage()
  const [text, setText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim() || disabled) return
    onSend(text)
    setText("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value)
    const el = e.target
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 120) + "px"
  }

  if (disabledHint) {
    return (
      <div
        data-tour="input"
        className="glass flex items-center justify-center p-4 rounded-b-3xl"
      >
        <p className="text-sm font-body text-[var(--text-3)] text-center">{disabledHint}</p>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="glass flex items-end gap-2 p-3 rounded-b-3xl"
      data-tour="input"
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={1}
        placeholder={t('chat_placeholder')}
        className="flex-1 resize-none rounded-xl bg-black/[0.04] px-4 py-2.5
                   font-body font-light text-sm text-[var(--text)]
                   placeholder:text-[var(--text-3)]
                   border border-[var(--border-strong)]
                   focus-visible:outline-none focus-visible:ring-2
                   focus-visible:ring-[#141210]/30
                   disabled:opacity-50 min-h-[44px] max-h-[120px] leading-relaxed"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="px-4 py-2.5 bg-[var(--accent)] hover:opacity-90
                   disabled:bg-[var(--border-strong)] disabled:text-[var(--text-3)]
                   disabled:cursor-not-allowed
                   text-[var(--accent-fg)] rounded-xl
                   font-body font-medium text-sm transition-opacity min-h-[44px]"
      >
        {disabled ? t('chat_sending') : t('chat_send')}
      </button>
    </form>
  )
}
