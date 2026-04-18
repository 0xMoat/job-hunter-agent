"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { MessageBubble } from "./MessageBubble"
import { ChatInput } from "./ChatInput"
import { useChat } from "@/hooks/useChat"
import { useLanguage } from "@/contexts/LanguageContext"
import { useSession } from "@/contexts/SessionContext"
import { apiListApplications } from "@/lib/api"
import { getSessionToken, getAccessToken } from "@/lib/auth"
import { TutorialSessionContent } from "@/components/tutorial/TutorialSessionContent"
import { DefaultResumeBanner } from "@/components/tutorial/DefaultResumeBanner"
import { apiTutorialStatus } from "@/lib/api-tutorial"

<<<<<<< HEAD
export function ChatPanel({ onStreamingChange, onRequestOpenSettings }: { onStreamingChange?: (s: boolean) => void; onRequestOpenSettings?: () => void }) {
  const { currentSessionToken, currentSessionId, sessions, renameSession, langfuseUrlBase } = useSession()
=======
export function ChatPanel({ onStreamingChange }: { onStreamingChange?: (s: boolean) => void }) {
  const { currentSessionToken, currentSessionId, sessions, renameSession, langfuseUrlBase, loading: sessionLoading } = useSession()
>>>>>>> 4d0b172 (fix(chat-ui): lock input + prompt buttons while session list is loading)
  const currentSession = sessions.find((s) => s.session_id === currentSessionId)
  const isTutorial = currentSession?.is_tutorial === true
  const {
    messages,
    streaming,
    error,
    historyLoading,
    sendMessage,
    resumePlanExecute,
    pickPlanExecuteSuggestionPrompt,
  } = useChat({
    sessionToken: currentSessionToken,
    currentSessionId,
    currentSessionName: currentSession?.name ?? "",
    renameSession,
  })
  const { t } = useLanguage()
  const bottomRef = useRef<HTMLDivElement>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [kanbanUrls, setKanbanUrls] = useState<Set<string>>(new Set())
  const [resumeIsDefault, setResumeIsDefault] = useState(false)

  useEffect(() => {
    const token = getAccessToken()
    if (!token) return
    apiTutorialStatus(token)
      .then((s) => setResumeIsDefault(s.resume_is_default))
      .catch(() => {})
  }, [])

  const refreshKanban = useCallback(async () => {
    const token = getSessionToken()
    if (!token) return
    try {
      const { applications } = await apiListApplications(token)
      setPendingCount(applications.filter((a) => a.status === "pending").length)
      setKanbanUrls(
        new Set(
          applications
            .map((a) => a.url)
            .filter((u): u is string => typeof u === "string" && u.length > 0),
        ),
      )
    } catch {
      // silent
    }
  }, [])

  useEffect(() => {
    refreshKanban()
    // refetch after any streaming session ends (plan-execute may have mutated the board)
    if (!streaming) refreshKanban()
  }, [streaming, currentSessionId, refreshKanban])

  const handleSaved = useCallback(
    async (savedCount: number) => {
      if (savedCount <= 0) return
      // Refresh kanban state so the just-saved URLs surface in kanbanUrls and
      // the follow-up chip row inside JobSearchResultCard picks them up after
      // a page reload. No longer inserts a separate suggestion bubble — the
      // chips are rendered inline inside the result card.
      await refreshKanban()
    },
    [refreshKanban],
  )

  const QUICK_PROMPTS = [
    t('quick_prompt_1'),
    t('quick_prompt_2'),
    t('quick_prompt_3'),
  ]

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  useEffect(() => {
    onStreamingChange?.(streaming)
  }, [streaming, onStreamingChange])

  return (
    <div className="glass-strong rounded-3xl flex flex-col h-full" data-tour="chat">
      <div className="flex flex-col h-full overflow-hidden">

        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-[var(--border)] flex-shrink-0">
          <div className="flex items-center gap-2 mb-3">
            <div className="glass rounded-full inline-flex items-center gap-1.5 px-3 py-1 text-xs font-body font-medium text-[var(--text-2)]">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
              {t('chat_badge')}
            </div>
            {langfuseUrlBase && currentSessionId && (
              <a
                href={`${langfuseUrlBase}/sessions/${currentSessionId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="glass rounded-full inline-flex items-center gap-1 px-2.5 py-1
                           text-xs font-body font-medium text-[var(--text-3)]
                           hover:text-[var(--text-2)] transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
                Langfuse
              </a>
            )}
          </div>
          <h2 className="font-heading italic text-xl tracking-tight text-[var(--text)] leading-none mb-0.5">
            {t('chat_title')}
          </h2>
          <p className="font-body font-light text-xs text-[var(--text-3)]">
            {t('chat_subtitle')}
          </p>
        </div>

        {/* Default-resume banner */}
        {!isTutorial && resumeIsDefault && (
          <DefaultResumeBanner onOpenSettings={() => onRequestOpenSettings?.()} />
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {historyLoading && (
            <div className="flex items-center justify-center py-8 text-[var(--text-3)] text-sm font-body">
              <span className="flex gap-1 mr-2" aria-hidden="true">
                <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:300ms]" />
              </span>
            </div>
          )}

          {!historyLoading && messages.length === 0 && (
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
                    disabled={streaming || sessionLoading}
                    className="glass rounded-full flex items-center justify-between
                               px-4 py-2.5 text-sm font-body font-normal
                               text-[var(--text-2)] hover:bg-white/80 transition-colors text-left
                               disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <span>{prompt}</span>
                    <span className="text-[var(--text-3)] flex-shrink-0 ml-2" aria-hidden="true">↗</span>
                  </button>
                ))}
                {pendingCount > 0 && (() => {
                  const prompt = t('chat_auto_process_prompt', pendingCount)
                  return (
                    <button
                      onClick={() => sendMessage(prompt)}
                      disabled={streaming || sessionLoading}
                      className="glass rounded-full flex items-center justify-between
                                 px-4 py-2.5 text-sm font-body font-normal
                                 text-[var(--text-2)] hover:bg-white/80 transition-colors text-left
                                 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <span>{prompt}</span>
                      <span className="text-[var(--text-3)] flex-shrink-0 ml-2" aria-hidden="true">↗</span>
                    </button>
                  )
                })()}
              </div>
            </div>
          )}

          {isTutorial ? (
            <TutorialSessionContent />
          ) : (
            <>
              {messages.map((msg, i) => (
                <MessageBubble
                  key={msg.id}
                  message={msg}
                  isStreaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
                  onResume={(mid, args) => {
                    const threadId = msg.planExecute?.threadId
                    if (!threadId) return
                    resumePlanExecute(mid, {
                      threadId,
                      action: args.action,
                      feedback: args.feedback,
                    })
                  }}
                  onSuggestionTrigger={handleSaved}
                  onSuggestionPickPrompt={pickPlanExecuteSuggestionPrompt}
                  savedUrlsInKanban={kanbanUrls}
                  onPickFollowupPrompt={sendMessage}
                />
              ))}
            </>
          )}

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
<<<<<<< HEAD
          <ChatInput
            onSend={sendMessage}
            disabled={streaming}
            disabledHint={isTutorial ? t("tutorial_input_disabled") : undefined}
          />
=======
          <ChatInput onSend={sendMessage} disabled={streaming || sessionLoading} />
>>>>>>> 4d0b172 (fix(chat-ui): lock input + prompt buttons while session list is loading)
        </div>

      </div>
    </div>
  )
}
