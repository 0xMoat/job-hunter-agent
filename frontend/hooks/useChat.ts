"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { apiGetMessages, apiStreamChat, apiUpdateSessionName } from "@/lib/api"
import type { ChatMessage, StreamChunk, ToolCallEntry } from "@/lib/types"

function makeId(): string {
  return Math.random().toString(36).slice(2)
}

interface UseChatOptions {
  sessionToken: string | null
  currentSessionId: string | null
  currentSessionName: string
  renameSession: (id: string, name: string) => void
}

export function useChat({
  sessionToken,
  currentSessionId,
  currentSessionName,
  renameSession,
}: UseChatOptions) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const streamingMsgIdRef = useRef<string | null>(null)

  // Load history whenever the session changes
  useEffect(() => {
    if (!sessionToken) return
    setMessages([])
    setError(null)
    setHistoryLoading(true)

    apiGetMessages(sessionToken)
      .then((raw) => {
        const loaded: ChatMessage[] = raw
          .filter((m) => m.role !== "system")
          .map((m) => ({
            id: makeId(),
            role: m.role as ChatMessage["role"],
            textContent: m.content,
            toolCalls: [],
            timestamp: undefined,
          }))
        setMessages(loaded)
      })
      .catch(() => {
        setError("Failed to load conversation history")
      })
      .finally(() => setHistoryLoading(false))
  }, [sessionToken])

  const sendMessage = useCallback(
    async (userText: string) => {
      if (!sessionToken || !userText.trim()) return

      setError(null)

      // Auto-name: if session has no name yet, use the first message
      const isFirstMessage = messages.length === 0
      if (isFirstMessage && currentSessionId && currentSessionName === "") {
        const name = userText.trim().slice(0, 30)
        apiUpdateSessionName(sessionToken, currentSessionId, name).catch(() => {
          // silently ignore
        })
        renameSession(currentSessionId, name)
      }

      const userMsg: ChatMessage = {
        id: makeId(),
        role: "user",
        textContent: userText.trim(),
        toolCalls: [],
        timestamp: new Date(),
      }

      const apiMessages = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.textContent || "(tool interaction)",
      }))

      setMessages((prev) => [...prev, userMsg])

      const assistantId = makeId()
      streamingMsgIdRef.current = assistantId
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: "assistant", textContent: "", toolCalls: [], timestamp: new Date() },
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
          buffer = lines.pop() ?? ""

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

            if (chunk.type === "done") {
              if (chunk.content) {
                setError(chunk.content)
                setMessages((prev) => prev.filter((m) => m.id !== assistantId))
              }
              break
            }

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
                        ? { ...tc, resultContent: chunk.content, status: "done" as const }
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
    [messages, sessionToken, currentSessionId, currentSessionName, renameSession],
  )

  const clearMessages = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return { messages, streaming, error, historyLoading, sendMessage, clearMessages }
}
