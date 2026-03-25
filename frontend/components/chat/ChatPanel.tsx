"use client"

import { useEffect, useRef } from "react"
import { MessageBubble } from "./MessageBubble"
import { ChatInput } from "./ChatInput"
import { useChat } from "@/hooks/useChat"
import { useLanguage } from "@/contexts/LanguageContext"

export function ChatPanel() {
  const { messages, streaming, error, sendMessage } = useChat()
  const { t } = useLanguage()
  const bottomRef = useRef<HTMLDivElement>(null)

  const QUICK_PROMPTS = [
    t('quick_prompt_1'),
    t('quick_prompt_2'),
    t('quick_prompt_3'),
  ]

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  return (
    /* Outer: glass-strong, NO overflow-hidden — preserves ::before gradient border */
    <div className="glass-strong rounded-3xl flex flex-col h-full">
      {/* Inner: overflow-hidden clips scroll without clipping the border */}
      <div className="flex flex-col h-full overflow-hidden">

        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-[var(--border)] flex-shrink-0">
          <div className="glass rounded-full inline-flex items-center gap-1.5 px-3 py-1 text-xs font-body font-medium text-[var(--text-2)] mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
            {t('chat_badge')}
          </div>
          <h2 className="font-heading italic text-xl tracking-tight text-[var(--text)] leading-none mb-0.5">
            {t('chat_title')}
          </h2>
          <p className="font-body font-light text-xs text-[var(--text-3)]">
            {t('chat_subtitle')}
          </p>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-5 max-w-xs mx-auto mt-12">
              <h3 className="font-heading italic text-2xl tracking-tight text-[var(--text)] text-center">
                {t('chat_empty_heading')}
              </h3>
              <p className="font-body font-light text-sm text-[var(--text-3)] text-center whitespace-pre-line">
                {t('chat_empty_sub')}
              </p>
              <div className="flex flex-col gap-2 w-full">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="glass rounded-full flex items-center justify-between
                               px-4 py-2.5 text-sm font-body font-normal
                               text-[var(--text-2)] hover:bg-white/80 transition-colors text-left"
                  >
                    <span>{prompt}</span>
                    <span className="text-[var(--text-3)] flex-shrink-0 ml-2" aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isStreaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
            />
          ))}

          <div aria-live="polite" aria-atomic="true">
            {streaming &&
              messages[messages.length - 1]?.role === "assistant" &&
              !messages[messages.length - 1]?.textContent && (
                <div className="flex items-center gap-2 px-3 py-2 text-[var(--text-3)] text-sm">
                  <span className="flex gap-1" aria-hidden="true">
                    <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:300ms]" />
                  </span>
                  <span className="text-xs">{t('chat_thinking')}</span>
                </div>
              )}
          </div>

          {error && (
            <div
              role="alert"
              className="text-red-600 text-sm bg-red-50 border border-red-200
                         rounded-xl px-4 py-2.5 mx-2 mt-2 font-body font-light"
            >
              ⚠ {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0">
          <ChatInput onSend={sendMessage} disabled={streaming} />
        </div>

      </div>
    </div>
  )
}
