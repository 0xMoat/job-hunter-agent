"use client"

import Link from "next/link"
import { useLanguage } from "@/contexts/LanguageContext"

export default function FinalCTA() {
  const { t } = useLanguage()

  return (
    <section className="w-full max-w-6xl mx-auto px-6 sm:px-8 lg:px-12 py-24 lg:py-32">
      <div className="flex flex-col items-center text-center gap-8">
        <h2 className="font-heading italic text-[var(--text)] text-4xl sm:text-5xl lg:text-[3.5rem] tracking-tight leading-[1.15] max-w-2xl">
          {t("lp_cta_title")}
        </h2>

        <div className="flex flex-col sm:flex-row items-center gap-5 mt-2">
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)] font-body font-medium text-base px-8 py-4 transition-opacity hover:opacity-85 active:opacity-75"
          >
            {t("lp_cta_button")}
          </Link>

          <a
            href="https://github.com/0xMoat/job-hunter-agent"
            target="_blank"
            rel="noopener noreferrer"
            className="font-body text-[var(--text-2)] text-base font-medium underline underline-offset-4 decoration-[var(--text-3)] hover:text-[var(--text)] transition-colors"
          >
            {t("lp_cta_github")}
          </a>
        </div>
      </div>
    </section>
  )
}
