"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  apiGetMessages,
  apiStreamChat,
  apiUpdateSessionName,
  startPlanExecute as apiStartPlanExecute,
  resumePlanExecute as apiResumePlanExecute,
  type PlanExecuteResumeArgs,
} from "@/lib/api"
import type { ChatMessage, StreamChunk, ToolCallEntry, ThinkingEntry, PlanExecuteView, PlanStep, PlanStepStatus, PlanStreamChunk, PlanLiveToolCall } from "@/lib/types"
import { useLanguage } from "@/contexts/LanguageContext"
import { emitApplicationsInvalidated } from "@/lib/app-events"

function makeId(): string {
  return Math.random().toString(36).slice(2)
}

const PE_CACHE_PREFIX = "pe_session_"

function loadPlanExecuteCache(sessionId: string): ChatMessage[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(PE_CACHE_PREFIX + sessionId)
    if (!raw) return []
    const parsed = JSON.parse(raw) as ChatMessage[]
    // JSON serialization converts Date → string; MessageBubble calls
    // toLocaleTimeString on timestamp, so we must revive it.
    return parsed.map((m) => ({
      ...m,
      timestamp: m.timestamp ? new Date(m.timestamp) : undefined,
    }))
  } catch {
    return []
  }
}

function savePlanExecuteCache(sessionId: string, messages: ChatMessage[]): void {
  if (typeof window === "undefined") return
  const toCache = messages
    .filter((m) => {
      if (m.planExecute) return true
      if (m.planExecuteSuggestion && !m.planExecuteSuggestion.dismissed) return true
      return false
    })
    .map((m) => {
      // If PE is still running, snapshot it as non-running so a refresh shows
      // the last known state without attempting to reconnect the SSE stream.
      if (m.planExecute?.running) {
        return { ...m, planExecute: { ...m.planExecute, running: false } }
      }
      return m
    })
  try {
    if (toCache.length === 0) {
      localStorage.removeItem(PE_CACHE_PREFIX + sessionId)
    } else {
      localStorage.setItem(PE_CACHE_PREFIX + sessionId, JSON.stringify(toCache))
    }
  } catch {
    // silent: localStorage quota / JSON cycles etc
  }
}

function applyPlanChunkToMessage(
  setMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>,
  assistantId: string,
  chunk: PlanStreamChunk,
): void {
  if (chunk.type === "plan_created") {
    const steps: PlanStep[] = chunk.steps.map((s) => ({
      id: s.id,
      text: s.text,
      status: "pending" as const,
      dependsOn: s.depends_on || [],
    }))
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId && m.planExecute
          ? { ...m, planExecute: { ...m.planExecute, steps } }
          : m,
      ),
    )
    return
  }
  if (chunk.type === "step_started") {
    const startedAt = chunk.started_at_utc
      ? Date.parse(chunk.started_at_utc)
      : Date.now()
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId || !m.planExecute) return m
        return {
          ...m,
          planExecute: {
            ...m.planExecute,
            steps: m.planExecute.steps.map((s) =>
              s.id === chunk.id
                ? {
                    ...s,
                    status: "running" as const,
                    liveText: "",
                    toolCalls: [],
                    startedAt,
                  }
                : s,
            ),
          },
        }
      }),
    )
    return
  }
  if (chunk.type === "step_text_delta") {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId || !m.planExecute) return m
        return {
          ...m,
          planExecute: {
            ...m.planExecute,
            steps: m.planExecute.steps.map((s) =>
              s.id === chunk.step_id
                ? { ...s, liveText: (s.liveText ?? "") + chunk.delta }
                : s,
            ),
          },
        }
      }),
    )
    return
  }
  if (chunk.type === "step_tool_call") {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId || !m.planExecute) return m
        return {
          ...m,
          planExecute: {
            ...m.planExecute,
            steps: m.planExecute.steps.map((s) => {
              if (s.id !== chunk.step_id) return s
              const existing = s.toolCalls ?? []
              const idx = existing.findIndex((tc) => tc.id === chunk.tool_call_id)
              if (idx === -1) {
                // First fragment for this tool call — only emit an entry
                // once we know the tool name (server guarantees the first
                // chunk carries it). Otherwise create a placeholder so
                // args deltas aren't dropped.
                const next: PlanLiveToolCall = {
                  id: chunk.tool_call_id,
                  name: chunk.tool_name ?? "",
                  args: chunk.args_delta ?? "",
                }
                return { ...s, toolCalls: [...existing, next] }
              }
              const next = [...existing]
              next[idx] = {
                ...next[idx],
                name: next[idx].name || chunk.tool_name || "",
                args: next[idx].args + (chunk.args_delta ?? ""),
              }
              return { ...s, toolCalls: next }
            }),
          },
        }
      }),
    )
    return
  }
  if (chunk.type === "step_tool_result") {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId || !m.planExecute) return m
        return {
          ...m,
          planExecute: {
            ...m.planExecute,
            steps: m.planExecute.steps.map((s) => {
              if (s.id !== chunk.step_id) return s
              const existing = s.toolCalls ?? []
              const idx = existing.findIndex((tc) => tc.id === chunk.tool_call_id)
              if (idx === -1) return s
              const next = [...existing]
              next[idx] = { ...next[idx], result: chunk.content }
              return { ...s, toolCalls: next }
            }),
          },
        }
      }),
    )
    return
  }
  if (chunk.type === "step_completed") {
    const failed = chunk.result?.startsWith("FAILED")
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId || !m.planExecute) return m
        return {
          ...m,
          planExecute: {
            ...m.planExecute,
            steps: m.planExecute.steps.map((s) =>
              s.id === chunk.id
                ? {
                    ...s,
                    status: failed ? ("failed" as const) : ("done" as const),
                    result: chunk.result,
                    durationMs: chunk.duration_ms,
                  }
                : s,
            ),
          },
        }
      }),
    )
    return
  }
  if (chunk.type === "plan_updated") {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId || !m.planExecute) return m
        const doneOrFailed = m.planExecute.steps.filter(
          (s) => s.status === "done" || s.status === "failed",
        )
        const newRemaining: PlanStep[] = chunk.remaining.map((s, i) => ({
          id: s.id,
          text: s.text,
          status: i === 0 ? ("running" as const) : ("pending" as const),
        }))
        return {
          ...m,
          planExecute: {
            ...m.planExecute,
            steps: [...doneOrFailed, ...newRemaining],
          },
        }
      }),
    )
    return
  }
  if (chunk.type === "wave_started") {
    return  // Wave info is implicit from parallel step_started events
  }
  if (chunk.type === "step_skipped") {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId || !m.planExecute) return m
        return {
          ...m,
          planExecute: {
            ...m.planExecute,
            steps: m.planExecute.steps.map((s) =>
              s.id === chunk.id
                ? { ...s, status: "skipped" as PlanStepStatus, result: chunk.reason }
                : s,
            ),
          },
        }
      }),
    )
    return
  }
  if (chunk.type === "awaiting_approval") {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId || !m.planExecute) return m
        const steps: PlanStep[] = chunk.plan.map((s) => ({
          id: s.id,
          text: s.text,
          status: "pending" as const,
          dependsOn: s.depends_on || [],
        }))
        return {
          ...m,
          planExecute: {
            ...m.planExecute,
            steps,
            threadId: chunk.thread_id,
            awaitingApproval: true,
            approvalRound: chunk.round,
            running: false,
          },
        }
      }),
    )
    return
  }
  if (chunk.type === "plan_revised") {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== assistantId || !m.planExecute) return m
        const steps: PlanStep[] = chunk.plan.map((s) => ({
          id: s.id,
          text: s.text,
          status: "pending" as const,
          dependsOn: s.depends_on || [],
        }))
        return {
          ...m,
          planExecute: {
            ...m.planExecute,
            steps,
            revisionReason: chunk.reason,
          },
        }
      }),
    )
    return
  }
  if (chunk.type === "final_response") {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId && m.planExecute
          ? {
              ...m,
              planExecute: {
                ...m.planExecute,
                finalResponse: chunk.content,
                awaitingApproval: false,
                running: false,
                cancelled: chunk.content.startsWith("已取消"),
                // Any step still showing "running" when the PE loop ended
                // (e.g. replanner finished early) must drop the spinner so
                // the UI doesn't look half-done next to the final response.
                steps: m.planExecute.steps.map((s) =>
                  s.status === "running" ? { ...s, status: "done" as const } : s,
                ),
              },
            }
          : m,
      ),
    )
    emitApplicationsInvalidated()
    return
  }
  if (chunk.type === "error") {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId && m.planExecute
          ? {
              ...m,
              planExecute: {
                ...m.planExecute,
                errorMsg: chunk.message,
                awaitingApproval: false,
                running: false,
              },
            }
          : m,
      ),
    )
  }
  if (chunk.type === "interrupted") {
    // Server told us it's shutting down mid-run (SIGTERM / container
    // restart). Flip any still-running step to failed and freeze the
    // view so the user gets a clear signal instead of a stuck timer.
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId && m.planExecute
          ? {
              ...m,
              planExecute: {
                ...m.planExecute,
                errorMsg: chunk.message,
                awaitingApproval: false,
                running: false,
                steps: m.planExecute.steps.map((s) =>
                  s.status === "running" ? { ...s, status: "failed" as const } : s,
                ),
              },
            }
          : m,
      ),
    )
  }
}

interface UseChatOptions {
  sessionToken: string | null
  currentSessionId: string | null
  currentSessionName: string
  renameSession: (id: string, name: string) => void
  /** Skip history fetch; the tutorial session is rendered statically. */
  skipHistory?: boolean
}

export function useChat({
  sessionToken,
  currentSessionId,
  currentSessionName,
  renameSession,
  skipHistory,
}: UseChatOptions) {
  const { t } = useLanguage()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [streaming, setStreaming] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [historyLoading, setHistoryLoading] = useState(false)
  const streamingMsgIdRef = useRef<string | null>(null)
  // Gate that prevents the save-effect from wiping localStorage before
  // the initial history-load + cache-restore has completed.
  const hydratedRef = useRef(false)

  // Load history whenever the session changes
  useEffect(() => {
    if (!sessionToken) return
    hydratedRef.current = false
    setMessages([])
    setError(null)
    if (skipHistory) {
      // Tutorial session renders static content; nothing to fetch.
      hydratedRef.current = true
      setHistoryLoading(false)
      return
    }
    setHistoryLoading(true)

    apiGetMessages(sessionToken)
      .then((raw) => {
        const loaded: ChatMessage[] = raw
          .filter((m) => m.role === "user" || m.role === "assistant")
          .map((m) => ({
            id: makeId(),
            role: m.role as ChatMessage["role"],
            textContent: m.content,
            toolCalls: (m.tool_calls ?? []).map((tc) => ({
              toolCallId: tc.tool_call_id,
              toolName: tc.tool_name,
              callingContent: tc.calling_args,
              resultContent: tc.result,
              status: "done" as const,
            })),
            timestamp: undefined,
          }))
        // Merge cached P&E messages (terminal state only) at the end.
        // Order within this session is lost on refresh, but the pipeline
        // result is preserved so the user sees what was processed.
        const cached = currentSessionId ? loadPlanExecuteCache(currentSessionId) : []
        setMessages([...loaded, ...cached])
      })
      .catch(() => {
        setError("Failed to load conversation history")
      })
      .finally(() => {
        setHistoryLoading(false)
        hydratedRef.current = true
      })
  }, [sessionToken, currentSessionId, skipHistory])

  // Persist finished P&E bubbles to localStorage so they survive page refresh.
  // Gated on hydratedRef so we never wipe the cache with an empty initial state.
  useEffect(() => {
    if (!currentSessionId) return
    if (!hydratedRef.current) return
    savePlanExecuteCache(currentSessionId, messages)
  }, [messages, currentSessionId])

  const runPlanExecuteOnAssistant = useCallback(
    async (assistantId: string, goal: string) => {
      if (!sessionToken) return
      // Convert the current assistant placeholder into a PE view in place.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? {
                ...m,
                textContent: "",
                toolCalls: [],
                planExecute: {
                  steps: [],
                  finalResponse: null,
                  errorMsg: null,
                  running: true,
                  threadId: null,
                  awaitingApproval: false,
                  approvalRound: 0,
                  revisionReason: null,
                  cancelled: false,
                },
              }
            : m,
        ),
      )
      const setPlanError = (errorMsg: string) =>
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && m.planExecute
              ? {
                  ...m,
                  planExecute: {
                    ...m.planExecute,
                    errorMsg,
                    running: false,
                  },
                }
              : m,
          ),
        )
      try {
        const response = await apiStartPlanExecute(sessionToken, goal)
        if (!response.ok) {
          setPlanError(`HTTP ${response.status}`)
          return
        }
        if (!response.body) {
          setPlanError("No response body")
          return
        }
        const reader = response.body.getReader()
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
            let pc: PlanStreamChunk
            try {
              pc = JSON.parse(payload) as PlanStreamChunk
            } catch {
              continue
            }
            applyPlanChunkToMessage(setMessages, assistantId, pc)
          }
        }
      } catch (err) {
        // Trap errors here so they don't propagate to sendMessage's catch,
        // which would delete the already-converted PE bubble.
        setPlanError(err instanceof Error ? err.message : "Stream failed")
        return
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId && m.planExecute && m.planExecute.running
            ? { ...m, planExecute: { ...m.planExecute, running: false } }
            : m,
        ),
      )
    },
    [sessionToken],
  )

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

      // Only send the new user message — LangGraph's checkpointer already
      // holds the full conversation history.  Sending all messages would cause
      // add_messages to re-append duplicates to the checkpoint state.
      const apiMessages = [{ role: "user" as const, content: userText.trim() }]

      setMessages((prev) => [...prev, userMsg])

      const emptyThinking = (): ThinkingEntry => ({
        nodeSequence: [],
        reasoningText: "",
        currentNode: null,
        doneNodes: {},
      })

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
            } else if (
              chunk.type === "tool_result" &&
              chunk.tool_name === "start_plan_execute"
            ) {
              // Handoff marker from the meta-tool. Parse, then switch this
              // assistant message into a PE view fed by /plan-execute.
              let parsed: { __plan_execute_handoff__?: boolean; goal?: string } = {}
              try {
                parsed = JSON.parse(chunk.content || "{}")
              } catch {
                // Malformed marker — fall through to normal tool_result rendering.
              }
              if (parsed.__plan_execute_handoff__ && parsed.goal) {
                try {
                  await reader.cancel()
                } catch {
                  /* noop */
                }
                await runPlanExecuteOnAssistant(assistantId, parsed.goal)
                return
              }
              // Not a real handoff — let the normal tool_result handler run below by
              // re-entering the chain. Because we're inside an if/else if, just fall
              // through by doing nothing here; the existing tool_result handler
              // below will NOT re-match (same chunk). So manually apply the
              // generic tool_result update here as a fallback:
              if (chunk.tool_call_id) {
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
                              callingContent: chunk.calling_args ?? tc.callingContent,
                              status: "done" as const,
                            }
                          : tc,
                      ),
                    }
                  }),
                )
              }
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
                            callingContent: chunk.calling_args ?? tc.callingContent,
                            status: "done" as const,
                          }
                        : tc,
                    ),
                  }
                }),
              )
              if (
                chunk.tool_name &&
                /^(save_|score_|analyze_|generate_)/.test(chunk.tool_name)
              ) {
                emitApplicationsInvalidated()
              }
            } else if (chunk.type === "node_enter" && chunk.node_name) {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m
                  const thinking = m.thinking ?? emptyThinking()
                  return {
                    ...m,
                    thinking: {
                      ...thinking,
                      currentNode: chunk.node_name!,
                      nodeSequence: thinking.nodeSequence.includes(chunk.node_name!)
                        ? thinking.nodeSequence
                        : [...thinking.nodeSequence, chunk.node_name!],
                    },
                  }
                }),
              )
            } else if (chunk.type === "reasoning_chunk" && chunk.content) {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m
                  const thinking = m.thinking ?? emptyThinking()
                  return {
                    ...m,
                    thinking: { ...thinking, reasoningText: thinking.reasoningText + chunk.content },
                  }
                }),
              )
            } else if (chunk.type === "node_exit" && chunk.node_name) {
              setMessages((prev) =>
                prev.map((m) => {
                  if (m.id !== assistantId) return m
                  const thinking = m.thinking ?? emptyThinking()
                  return {
                    ...m,
                    thinking: {
                      ...thinking,
                      currentNode: null,
                      doneNodes: { ...thinking.doneNodes, [chunk.node_name!]: chunk.duration_ms ?? 0 },
                    },
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
    [messages, sessionToken, currentSessionId, currentSessionName, renameSession, runPlanExecuteOnAssistant],
  )

  const startPlanExecute = useCallback(
    async (goal?: string) => {
      if (!sessionToken) return

      setError(null)

      // Auto-name: same rule as sendMessage — first usage of an unnamed
      // session gets named, so the "new chat" guard in SessionContext
      // doesn't block future creations.
      const isFirstMessage = messages.length === 0
      if (isFirstMessage && currentSessionId && currentSessionName === "") {
        const name = "一键处理看板"
        apiUpdateSessionName(sessionToken, currentSessionId, name).catch(() => {
          // silently ignore
        })
        renameSession(currentSessionId, name)
      }

      // Push user message
      const userMsg: ChatMessage = {
        id: makeId(),
        role: "user",
        textContent: "自动处理看板上的待投递职位",
        toolCalls: [],
        timestamp: new Date(),
      }
      setMessages((prev) => [...prev, userMsg])

      // Push assistant placeholder with planExecute view
      const assistantId = makeId()
      const initialView: PlanExecuteView = {
        steps: [],
        finalResponse: null,
        errorMsg: null,
        running: true,
        threadId: null,
        awaitingApproval: false,
        approvalRound: 0,
        revisionReason: null,
        cancelled: false,
      }
      setMessages((prev) => [
        ...prev,
        {
          id: assistantId,
          role: "assistant",
          textContent: "",
          toolCalls: [],
          planExecute: initialView,
          timestamp: new Date(),
        },
      ])

      setStreaming(true)

      try {
        const response = await apiStartPlanExecute(sessionToken, goal)
        if (!response.ok) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId && m.planExecute
                ? { ...m, planExecute: { ...m.planExecute, errorMsg: `HTTP ${response.status}`, running: false } }
                : m,
            ),
          )
          return
        }
        if (!response.body) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId && m.planExecute
                ? { ...m, planExecute: { ...m.planExecute, errorMsg: "No response body", running: false } }
                : m,
            ),
          )
          return
        }

        const reader = response.body.getReader()
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

            applyPlanChunkToMessage(setMessages, assistantId, chunk)
          }
        }
      } catch (err) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && m.planExecute
              ? {
                  ...m,
                  planExecute: {
                    ...m.planExecute,
                    errorMsg: err instanceof Error ? err.message : "Stream failed",
                    running: false,
                  },
                }
              : m,
          ),
        )
      } finally {
        // Mark running=false on the placeholder if still running
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId && m.planExecute && m.planExecute.running
              ? { ...m, planExecute: { ...m.planExecute, running: false } }
              : m,
          ),
        )
        setStreaming(false)
      }
    },
    [messages, sessionToken, currentSessionId, currentSessionName, renameSession],
  )

  const insertPlanExecuteSuggestion = useCallback(
    (savedCount: number, pendingCount: number) => {
      if (savedCount <= 0) return
      const prompts: string[] = [
        t("pe_chip_research_and_tailor", savedCount),
        t("pe_chip_analyze_match"),
        t("pe_chip_prioritize_by_prefs"),
      ]
      setMessages((prev) => [
        ...prev,
        {
          id: makeId(),
          role: "assistant" as const,
          textContent: "",
          toolCalls: [],
          timestamp: new Date(),
          planExecuteSuggestion: {
            prompts,
            savedCount,
            pendingCount,
            dismissed: false,
          },
        },
      ])
    },
    [t],
  )

  const pickPlanExecuteSuggestionPrompt = useCallback(
    (suggestionMsgId: string, promptText: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === suggestionMsgId && m.planExecuteSuggestion
            ? {
                ...m,
                planExecuteSuggestion: {
                  ...m.planExecuteSuggestion,
                  dismissed: true,
                },
              }
            : m,
        ),
      )
      void sendMessage(promptText)
    },
    [sendMessage],
  )

  const resumePlanExecute = useCallback(
    async (assistantMsgId: string, args: PlanExecuteResumeArgs) => {
      if (!sessionToken) return

      // Flip bubble back to running while the stream is open.
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantMsgId && m.planExecute
            ? {
                ...m,
                planExecute: {
                  ...m.planExecute,
                  awaitingApproval: false,
                  running: true,
                  revisionReason: null,
                  errorMsg: null,
                },
              }
            : m,
        ),
      )
      setStreaming(true)

      let response: Response
      try {
        response = await apiResumePlanExecute(sessionToken, args)
      } catch (e) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId && m.planExecute
              ? {
                  ...m,
                  planExecute: {
                    ...m.planExecute,
                    errorMsg: (e as Error).message,
                    running: false,
                  },
                }
              : m,
          ),
        )
        setStreaming(false)
        return
      }
      if (!response.ok || !response.body) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId && m.planExecute
              ? {
                  ...m,
                  planExecute: {
                    ...m.planExecute,
                    errorMsg: `HTTP ${response.status}`,
                    running: false,
                  },
                }
              : m,
          ),
        )
        setStreaming(false)
        return
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      try {
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
            applyPlanChunkToMessage(setMessages, assistantMsgId, chunk)
          }
        }
      } finally {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsgId && m.planExecute && m.planExecute.running
              ? { ...m, planExecute: { ...m.planExecute, running: false } }
              : m,
          ),
        )
        setStreaming(false)
      }
    },
    [sessionToken],
  )

  const clearMessages = useCallback(() => {
    setMessages([])
    setError(null)
  }, [])

  return {
    messages,
    streaming,
    error,
    historyLoading,
    sendMessage,
    startPlanExecute,
    resumePlanExecute,
    insertPlanExecuteSuggestion,
    pickPlanExecuteSuggestionPrompt,
    clearMessages,
  }
}
