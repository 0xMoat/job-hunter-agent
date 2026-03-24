"use client"

import { useState, useCallback, useRef } from "react"
import { apiStreamChat } from "@/lib/api"
import { getSessionToken } from "@/lib/auth"
import type { ChatMessage, StreamChunk, ToolCallEntry } from "@/lib/types"

function makeId(): string {
  return Math.random().toString(36).slice(2)
}

export function useChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const streamingMsgIdRef = useRef<string | null>(null)

  const sendMessage = useCallback(
    async (userText: string) => {
      const sessionToken = getSessionToken()
      if (!sessionToken || !userText.trim()) return

      setError(null)

      // Build user message
      const userMsg: ChatMessage = {
        id: makeId(),
        role: "user",
        textContent: userText.trim(),
        toolCalls: [],
      }

      // API messages: all prior messages + new user message (text only)
      const apiMessages = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.textContent || "(tool interaction)",
      }))

      setMessages((prev) => [...prev, userMsg])

      // Placeholder assistant message (will be filled by stream)
      const assistantId = makeId()
      streamingMsgIdRef.current = assistantId
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", textContent: "", toolCalls: [] },
      ])

      setStreaming(true)
      try {
        const response = await apiStreamChat(apiMessages, sessionToken)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        if (!response.body) throw new Error("No response body")

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split("\n")
          buffer = lines.pop() ?? "" // keep incomplete last line

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue
            const jsonStr = line.slice(6).trim()
            if (!jsonStr) continue

            let chunk: StreamChunk
            try {
              chunk = JSON.parse(jsonStr)
            } catch {
              continue
            }

            if (chunk.type === "done") break

            if (chunk.type === "text" && chunk.content) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, textContent: m.textContent + chunk.content }
                    : m,
                ),
              )
            } else if (chunk.type === "tool_call" && chunk.tool_name) {
              const entry: ToolCallEntry = {
                toolCallId: chunk.tool_call_id ?? makeId(),
                toolName: chunk.tool_name,
                callingContent: chunk.content,
                status: "calling",
              }
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId
                    ? { ...m, toolCalls: [...m.toolCalls, entry] }
                    : m,
                ),
              )
            } else if (chunk.type === "tool_result" && chunk.tool_call_id) {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m
                  return {
                    ...m,
                    toolCalls: m.toolCalls.map((tc) =>
                      tc.toolCallId === chunk.tool_call_id
                        ? {
                            ...tc,
                            resultContent: chunk.content,
                            status: "done" as const,
                          }
                        : tc,
                    ),
                  }
                }),
              )
            }
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Stream failed")
        setMessages((prev) => prev.filter((m) => m.id !== assistantId))
      } finally {
        setStreaming(false)
        streamingMsgIdRef.current = null
      }
    },
    [messages],
  )

  const clearMessages = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return { messages, streaming, error, sendMessage, clearMessages }
}
