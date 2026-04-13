"use client"

import Link from "next/link"
import { useLanguage } from "@/contexts/LanguageContext"

export default function Footer() {
  const { t } = useLanguage()

  return (
    <footer className="w-full max-w-6xl mx-auto px-6 sm:px-8 lg:px-12">
      <div className="border-t border-[var(--border)] py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="font-heading italic text-[var(--text)] text-lg">
            Job Hunter Agent
          </span>
          <span className="font-body text-[var(--text-3)] text-sm">
            &copy; 2026
          </span>
        </div>

        <nav className="flex items-center gap-6">
          <a
            href="https://github.com/0xMoat/job-hunter-agent"
            target="_blank"
            rel="noopener noreferrer"
            className="font-body text-sm text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors"
          >
            GitHub
          </a>
          <a
            href="https://github.com/0xMoat/job-hunter-agent/issues"
            target="_blank"
            rel="noopener noreferrer"
            className="font-body text-sm text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors"
          >
            {t("lp_footer_feedback")}
          </a>
          <Link
            href="/privacy"
            className="font-body text-sm text-[var(--text-3)] hover:text-[var(--text-2)] transition-colors"
          >
            {t("lp_footer_privacy")}
          </Link>
        </nav>
      </div>
    </footer>
  )
}
