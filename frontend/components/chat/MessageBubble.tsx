import { ToolCallCard } from "./ToolCallCard"
import type { ChatMessage } from "@/lib/types"

interface Props {
  message: ChatMessage
  isStreaming?: boolean
}

export function MessageBubble({ message, isStreaming }: Props) {
  const isUser = message.role === "user"

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div className="max-w-[85%]">
        {/* Tool call cards (assistant only, above text bubble) */}
        {message.toolCalls.length > 0 && (
          <div className="mb-2 space-y-1">
            {message.toolCalls.map((tc) => (
              <ToolCallCard key={tc.toolCallId} entry={tc} />
            ))}
          </div>
        )}

        {/* Text bubble */}
        {(message.textContent || isStreaming) && (
          <div
            className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
              isUser
                ? "bg-blue-600 text-white rounded-br-sm"
                : "bg-slate-700 text-slate-100 rounded-bl-sm"
            }`}
          >
            {message.textContent}
            {isStreaming && (
              <span className="inline-block w-1 h-4 bg-current ml-0.5 animate-pulse rounded-sm align-middle" />
            )}
          </div>
        )}
      </div>
    </div>
  )
}
