"use client"

import { useState, useRef } from "react"

interface Props {
  onSend: (text: string) => void
  disabled: boolean
}

export function ChatInput({ onSend, disabled }: Props) {
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

  return (
    <form
      onSubmit={handleSubmit}
      className="flex items-end gap-2 p-3 border-t border-slate-700"
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={1}
        placeholder="输入消息… (Enter 发送，Shift+Enter 换行)"
        className="flex-1 resize-none rounded-xl bg-slate-700 px-4 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:opacity-50 min-h-[44px] max-h-[120px] leading-relaxed"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="px-4 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-xl text-sm font-medium transition-colors min-h-[44px]"
      >
        {disabled ? "…" : "发送"}
      </button>
    </form>
  )
}
