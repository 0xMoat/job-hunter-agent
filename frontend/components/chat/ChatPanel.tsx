"use client"

import { useEffect, useRef } from "react"
import { MessageBubble } from "./MessageBubble"
import { ChatInput } from "./ChatInput"
import { useChat } from "@/hooks/useChat"

export function ChatPanel() {
  const { messages, streaming, error, sendMessage } = useChat()
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  return (
    <div className="flex flex-col h-full bg-slate-900">
      <div className="px-4 py-3 border-b border-slate-700 flex-shrink-0">
        <h2 className="text-sm font-semibold text-slate-300">Agent Chat</h2>
        <p className="text-xs text-slate-500">Job-hunting specialist · tool calls shown inline</p>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="text-center text-slate-500 text-sm mt-12">
            <p className="text-3xl mb-3">👋</p>
            <p>Tell me your skills, target roles, and location.</p>
            <p className="text-xs mt-1 text-slate-600">
              Try: "帮我找上海的 agent engineer 岗位"
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            isStreaming={
              streaming && i === messages.length - 1 && msg.role === "assistant"
            }
          />
        ))}
        {error && (
          <div className="text-red-400 text-xs bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 mx-2 mt-2">
            {error}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <div className="flex-shrink-0">
        <ChatInput onSend={sendMessage} disabled={streaming} />
      </div>
    </div>
  )
}
