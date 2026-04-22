import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ToolCallCard } from "./ToolCallCard"
import { JobSearchResultCard } from "./JobSearchResultCard"
import { ThinkingCard } from "./ThinkingCard"
import { ResumeDownloadCard } from "./ResumeDownloadCard"
import { ResumeDownloadLink } from "./ResumeDownloadLink"
import { PlanTimelineView } from "@/components/plan/PlanTimeline"
import { PlanExecuteSuggestionCard } from "@/components/plan/PlanExecuteSuggestionCard"
import type { ChatMessage, ToolCallEntry } from "@/lib/types"
import { useLanguage } from "@/contexts/LanguageContext"

function jobSearchResultUrls(tc: ToolCallEntry): string[] {
  try {
    const data = JSON.parse(tc.resultContent ?? "{}")
    return (data.results ?? [])
      .map((r: { link?: string }) => r?.link)
      .filter((u: unknown): u is string => typeof u === "string" && u.length > 0)
  } catch {
    return []
  }
}

interface Props {
  message: ChatMessage
  isStreaming?: boolean
  onResume?: (
    messageId: string,
    args: { action: "approve" | "revise" | "cancel"; feedback?: string },
  ) => void
  onSuggestionTrigger?: (savedCount: number) => void
  onSuggestionPickPrompt?: (id: string, prompt: string) => void
  savedUrlsInKanban?: Set<string>
  onPickFollowupPrompt?: (prompt: string) => void
  onJumpToTopCard?: () => void | Promise<void>
  /** Map of application_id → company name for humanizing plan step text. */
  companyById?: Record<number, string>
}

export function MessageBubble({
  message,
  isStreaming,
  onResume,
  onSuggestionTrigger,
  onSuggestionPickPrompt,
  savedUrlsInKanban,
  onPickFollowupPrompt,
  onJumpToTopCard,
  companyById,
}: Props) {
  const { locale, t } = useLanguage()
  const isUser = message.role === "user"

  // Follow-up chips show below the text bubble whenever a job_search_tool
  // result in this message contains at least one URL the user has already
  // saved to the kanban. Rehydrates across page reloads via savedUrlsInKanban.
  const jobSearchTool = !isUser
    ? message.toolCalls.find((tc) => tc.toolName === "job_search_tool" && tc.status === "done")
    : undefined
  const hasSavedFromThisSearch =
    !!jobSearchTool &&
    !!savedUrlsInKanban &&
    jobSearchResultUrls(jobSearchTool).some((u) => savedUrlsInKanban.has(u))
  const showFollowups = hasSavedFromThisSearch && !!onPickFollowupPrompt

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
                <JobSearchResultCard
                  key={tc.toolCallId}
                  entry={tc}
                  onSaved={onSuggestionTrigger}
                />
              ) : tc.toolName === "generate_resume_pdf" && tc.status === "done" ? (
                <ResumeDownloadCard key={tc.toolCallId} entry={tc} />
              ) : (
                <ToolCallCard key={tc.toolCallId} entry={tc} isStreaming={isStreaming} />
              ),
            )}
          </div>
        )}

        {/* Plan-Execute suggestion bubble (assistant only) */}
        {!isUser && message.planExecuteSuggestion && (
          <div className="mb-2">
            <PlanExecuteSuggestionCard
              suggestion={message.planExecuteSuggestion}
              onPick={(prompt) => onSuggestionPickPrompt?.(message.id, prompt)}
              disabled={isStreaming}
            />
          </div>
        )}

        {/* Plan-and-Execute timeline (assistant only) */}
        {!isUser && message.planExecute && (
          <div className="glass rounded-[18px] rounded-bl-[4px] px-4 py-3 text-sm">
            <PlanTimelineView
              view={message.planExecute!}
              onApprove={
                onResume ? () => onResume(message.id, { action: "approve" }) : undefined
              }
              onRevise={
                onResume
                  ? (feedback) => onResume(message.id, { action: "revise", feedback })
                  : undefined
              }
              onCancel={
                onResume ? () => onResume(message.id, { action: "cancel" }) : undefined
              }
              actionsDisabled={isStreaming}
              onJumpToTopCard={onJumpToTopCard}
              companyById={companyById}
            />
          </div>
        )}

        {/* Text bubble */}
        {!message.planExecute && !message.planExecuteSuggestion && (message.textContent || isStreaming) && (
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

        {/* Follow-up chips — sit below the assistant text bubble so the agent
            first answers in its own words, then the UI offers quick next moves.
            Chip clicks fire sendMessage, letting the agent decide whether to
            escalate to Plan-Execute (per system.md §5). */}
        {showFollowups && (
          <div className="mt-2 flex flex-col gap-1.5">
            {[
              t("pe_chip_research_and_tailor"),
              t("pe_chip_analyze_match"),
              t("pe_chip_prioritize_by_prefs"),
            ].map((p) => (
              <button
                key={p}
                onClick={() => onPickFollowupPrompt?.(p)}
                disabled={isStreaming}
                className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-white
                           px-3 py-1.5 text-xs font-body text-[var(--text-2)] hover:bg-white/70
                           hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors
                           disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <span>{p}</span>
                <span className="text-[var(--text-3)]" aria-hidden="true">↗</span>
              </button>
            ))}
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
