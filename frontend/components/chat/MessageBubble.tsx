import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ToolCallCard } from "./ToolCallCard"
import { JobSearchResultCard } from "./JobSearchResultCard"
import { ThinkingCard } from "./ThinkingCard"
import { ResumeDownloadCard } from "./ResumeDownloadCard"
import { ResumeDownloadLink } from "./ResumeDownloadLink"
import { PlanTimelineView } from "@/components/plan/PlanTimeline"
import type { ChatMessage } from "@/lib/types"
import { useLanguage } from "@/contexts/LanguageContext"

interface Props {
  message: ChatMessage
  isStreaming?: boolean
}

export function MessageBubble({ message, isStreaming }: Props) {
  const { locale } = useLanguage()
  const isUser = message.role === "user"

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div className="max-w-[85%]">
        {/* Thinking card (assistant only — hidden when reasoning is empty or "direct") */}
        {!isUser && message.thinking?.reasoningText && (
          <ThinkingCard entry={message.thinking} isStreaming={isStreaming} />
        )}

        {/* Tool call cards (assistant only) */}
        {message.toolCalls.length > 0 && (
          <div className="mb-2 space-y-1">
            {message.toolCalls.map((tc) =>
              tc.toolName === "job_search_tool" && tc.status === "done" ? (
                <JobSearchResultCard key={tc.toolCallId} entry={tc} />
              ) : tc.toolName === "generate_resume_pdf" && tc.status === "done" ? (
                <ResumeDownloadCard key={tc.toolCallId} entry={tc} />
              ) : (
                <ToolCallCard key={tc.toolCallId} entry={tc} isStreaming={isStreaming} />
              ),
            )}
          </div>
        )}

        {/* Plan-and-Execute timeline (assistant only) */}
        {!isUser && message.planExecute && (
          <div className="glass rounded-[18px] rounded-bl-[4px] px-4 py-3 text-sm">
            <PlanTimelineView view={message.planExecute} />
          </div>
        )}

        {/* Text bubble */}
        {!message.planExecute && (message.textContent || isStreaming) && (
          <div
            className={`rounded-[18px] px-4 py-2.5 text-sm leading-relaxed font-body ${
              isUser
                ? "bg-[var(--accent)] text-[var(--accent-fg)] rounded-br-[4px]"
                : "glass text-[var(--text)] font-light rounded-bl-[4px]"
            }`}
          >
            <div className="[&_li>p]:my-0 [&_li>p]:inline">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => {
                    if (href && /\/api\/v1\/resume\/download\//.test(href)) {
                      return <ResumeDownloadLink href={href}>{children}</ResumeDownloadLink>
                    }
                    return (
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline underline-offset-2 opacity-80 hover:opacity-100 break-all"
                      >
                        {children}
                      </a>
                    )
                  },
                  p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc pl-4 mb-1 space-y-0.5">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>,
                  li: ({ children }) => <li className="leading-snug">{children}</li>,
                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  code: ({ children }) => (
                    <code className="px-1 py-0.5 rounded text-xs font-mono bg-black/10">{children}</code>
                  ),
                }}
              >
                {message.textContent}
              </ReactMarkdown>
            </div>
            {isStreaming && (
              <span className="inline-block w-1 h-4 bg-current ml-0.5 animate-pulse rounded-sm align-middle" />
            )}
          </div>
        )}

        {/* Timestamp */}
        {message.timestamp && (
          <div className={`mt-1 text-[10px] font-body font-light text-[var(--text-3)] ${
            isUser ? "text-right" : "text-left"
          }`}>
            {message.timestamp.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>
    </div>
  )
}
