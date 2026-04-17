"use client"

import { useLanguage } from "@/contexts/LanguageContext"
import type { Application, InterviewQuestion, MatchBreakdown } from "@/lib/types"

interface ApplicationDetailDrawerProps {
  app: Application | null
  onClose: () => void
}

function parseBreakdown(raw: string | null | undefined): MatchBreakdown | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as MatchBreakdown
  } catch {
    return null
  }
}

function parseQuestions(raw: string | null | undefined): InterviewQuestion[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function EmptyHint() {
  const { t } = useLanguage()
  return <p className="text-[11px] text-[var(--text-3)] italic">{t("artifact_empty_hint")}</p>
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="font-body font-semibold text-xs text-[var(--text)] uppercase tracking-wide">
        {title}
      </h3>
      {children}
    </section>
  )
}

function TextSection({ text }: { text: string | null | undefined }) {
  if (!text || !text.trim()) return <EmptyHint />
  return (
    <pre className="font-body text-[12px] text-[var(--text-2)] whitespace-pre-wrap
                    leading-relaxed bg-black/[0.03] rounded-lg p-3 max-h-80 overflow-auto">
      {text}
    </pre>
  )
}

function QuestionsSection({ raw }: { raw: string | null | undefined }) {
  const qs = parseQuestions(raw)
  if (qs.length === 0) return <EmptyHint />
  return (
    <ol className="space-y-2 list-decimal pl-5">
      {qs.map((q, i) => (
        <li key={i} className="text-[12px] text-[var(--text)] leading-relaxed">
          <p>{q.question}</p>
          <p className="text-[11px] text-[var(--text-3)] mt-0.5">🎯 {q.focus}</p>
        </li>
      ))}
    </ol>
  )
}

function MatchSection({ app }: { app: Application }) {
  const { t } = useLanguage()
  const breakdown = parseBreakdown(app.match_breakdown)
  if (app.match_score == null && !breakdown) {
    return <EmptyHint />
  }
  return (
    <div className="space-y-2">
      {app.match_score != null && (
        <div className="flex items-baseline gap-2">
          <span className="text-[11px] text-[var(--text-3)]">{t("artifact_total_score")}</span>
          <span className="text-2xl font-semibold tabular-nums">{app.match_score}</span>
          <span className="text-xs text-[var(--text-3)]">/ 100</span>
        </div>
      )}
      {breakdown && (
        <div className="space-y-1.5">
          {(["skills", "experience", "domain", "soft"] as const).map((k) => {
            const dim = breakdown[k]
            const label = t(`artifact_breakdown_${k}`)
            const pct = Math.round((dim.score / 10) * 100)
            return (
              <div key={k} className="space-y-0.5">
                <div className="flex items-center justify-between text-[11px] font-body">
                  <span className="text-[var(--text-2)]">{label}</span>
                  <span className="tabular-nums text-[var(--text-3)]">{dim.score}/10</span>
                </div>
                <div className="h-1.5 bg-black/[0.06] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-[#7c6af5]"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="text-[11px] text-[var(--text-3)] leading-snug">{dim.reason}</p>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PdfSection({ app }: { app: Application }) {
  const { t } = useLanguage()
  if (!app.pdf_download_url) return <EmptyHint />
  return (
    <a
      href={app.pdf_download_url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs font-body
                 bg-[#7c6af5] text-white rounded-full px-3 py-1.5
                 hover:brightness-110 transition"
    >
      📄 {t("artifact_download_pdf")}
    </a>
  )
}

export function ApplicationDetailDrawer({ app, onClose }: ApplicationDetailDrawerProps) {
  const { t } = useLanguage()
  if (!app) return null
  return (
    <>
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed right-0 top-0 h-full w-[min(440px,90vw)] z-50
                   bg-white shadow-xl overflow-y-auto"
        role="dialog"
        aria-label="Application detail"
      >
        <header className="sticky top-0 bg-white border-b border-[var(--border)] px-4 py-3
                           flex items-center justify-between">
          <div>
            <h2 className="font-body font-semibold text-sm">{app.company}</h2>
            <p className="font-body text-[11px] text-[var(--text-3)]">{app.title}</p>
          </div>
          <button
            onClick={onClose}
            className="text-xs font-body text-[var(--text-3)] hover:text-[var(--text)]"
          >
            {t("artifact_close")}
          </button>
        </header>
        <div className="p-4 space-y-5">
          <Section title={t("artifact_match")}><MatchSection app={app} /></Section>
          <Section title={t("artifact_research")}><TextSection text={app.company_research_json} /></Section>
          <Section title={t("artifact_gap")}><TextSection text={app.gap_analysis_text} /></Section>
          <Section title={t("artifact_interview")}><QuestionsSection raw={app.interview_questions_json} /></Section>
          <Section title={t("artifact_tailored")}><TextSection text={app.tailored_resume_text} /></Section>
          <Section title={t("artifact_pdf")}><PdfSection app={app} /></Section>
        </div>
      </aside>
    </>
  )
}
