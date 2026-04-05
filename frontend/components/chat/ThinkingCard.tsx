"use client"

import { useState, useRef, useEffect } from "react"
import type { ThinkingEntry } from "@/lib/types"

interface Props {
  entry: ThinkingEntry
  isStreaming?: boolean
}

/** Human-readable label for node names. */
const NODE_LABELS: Record<string, string> = {
  chat: "Chat",
  tool_call: "Tool",
}

export function ThinkingCard({ entry, isStreaming }: Props) {
  const isActive = entry.currentNode !== null

  // Start expanded during streaming, auto-collapse when streaming ends
  const [expanded, setExpanded] = useState(isStreaming === true)
  const wasStreamingRef = useRef(isStreaming === true)
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setExpanded(false)
    }
    if (isStreaming) wasStreamingRef.current = true
  }, [isStreaming])

  // Don't render if reasoning is empty (simple conversation / "direct")
  if (!entry.reasoningText) {
    return null
  }

  return (
    <div className="glass rounded-xl my-1">
      <div className="overflow-hidden rounded-xl">

        {/* Header */}
        <button
          onClick={() => !isActive && setExpanded((e) => !e)}
          disabled={isActive}
          aria-expanded={expanded}
          className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
            !isActive ? "hover:bg-white/20 cursor-pointer" : "cursor-default"
          } ${expanded ? "border-b border-[var(--border)]" : ""}`}
        >
          {/* Status dot */}
          <span
            className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${
              isActive
                ? "bg-indigo-400 animate-pulse"
                : "bg-indigo-500 shadow-[0_0_5px_rgba(99,102,241,0.4)]"
            }`}
          />

          {/* Label */}
          <span className="font-body font-semibold text-sm text-[var(--text-2)] flex-shrink-0">
            🧠 Thinking
          </span>

          {/* Node badge sequence */}
          <span className="flex items-center gap-1 flex-shrink-0">
            {entry.nodeSequence.map((node, i) => {
              const isDone = node in entry.doneNodes
              const isCurrent = node === entry.currentNode
              return (
                <span key={node} className="flex items-center gap-1">
                  {i > 0 && <span className="text-[var(--text-3)] text-[10px]">→</span>}
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-semibold ${
                      isDone
                        ? "bg-indigo-500/20 text-indigo-300"
                        : isCurrent
                        ? "bg-amber-500/20 text-amber-300 animate-pulse"
                        : "bg-white/5 text-[var(--text-3)]"
                    }`}
                  >
                    {NODE_LABELS[node] ?? node}
                  </span>
                </span>
              )
            })}
          </span>

          {/* Right: running or expand/collapse */}
          {isActive ? (
            <span className="ml-auto font-body font-light text-xs text-[var(--text-3)] animate-pulse flex-shrink-0">
              Running…
            </span>
          ) : (
            <span className="ml-auto font-body text-xs text-[var(--text-3)] flex-shrink-0">
              {expanded ? "Collapse ∧" : "Expand ∨"}
            </span>
          )}
        </button>

        {/* Expanded body */}
        {expanded && (
          <div className="px-3 py-2.5">
            {/* Reasoning text */}
            <div className="max-h-64 overflow-y-auto mb-2">
              <p className="font-body text-xs text-[var(--text-3)] italic leading-relaxed">
                {entry.reasoningText}
                {isActive && (
                  <span className="inline-block w-1 h-3 bg-current ml-0.5 animate-pulse rounded-sm align-middle" />
                )}
              </p>
            </div>

            {/* Node timing list */}
            {entry.nodeSequence.length > 0 && (
              <div className="flex flex-col gap-1 border-t border-[var(--border)] pt-2">
                {entry.nodeSequence.map((node) => {
                  const ms = entry.doneNodes[node]
                  const isCurrent = node === entry.currentNode
                  return (
                    <div key={node} className="flex items-center gap-2">
                      <span
                        className={`text-[10px] ${
                          ms !== undefined ? "text-indigo-400" : isCurrent ? "text-amber-400 animate-pulse" : "text-[var(--text-3)]"
                        }`}
                      >
                        {ms !== undefined ? "✓" : isCurrent ? "⟳" : "○"}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--text-2)]">
                        {NODE_LABELS[node] ?? node}
                      </span>
                      {ms !== undefined ? (
                        <span className="ml-auto font-mono text-[9px] text-[var(--text-3)]">
                          {ms}ms
                        </span>
                      ) : isCurrent ? (
                        <span className="ml-auto font-mono text-[9px] text-amber-400 animate-pulse">
                          running
                        </span>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  )
}
