"use client"

import Hero from "@/components/landing/Hero"
import Problem from "@/components/landing/Problem"
import Features from "@/components/landing/Features"
import HowItWorks from "@/components/landing/HowItWorks"
import Testimonials from "@/components/landing/Testimonials"
import Memory from "@/components/landing/Memory"
import FAQ from "@/components/landing/FAQ"
import FinalCTA from "@/components/landing/FinalCTA"
import Footer from "@/components/landing/Footer"
import Link from "next/link"
import { isAuthenticated } from "@/lib/auth"
import { useEffect, useState } from "react"
import { useLanguage } from "@/contexts/LanguageContext"

function LanguageToggle() {
  const { locale, setLocale, t } = useLanguage()

  return (
    <button
      type="button"
      onClick={() => setLocale(locale === "zh-CN" ? "en" : "zh-CN")}
      className="hidden sm:inline-flex items-center gap-1.5 font-body text-sm font-medium text-[var(--text-2)] hover:text-[var(--text)] transition-colors cursor-pointer"
      aria-label="Switch language"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
      {t("lang_toggle")}
    </button>
  )
}

function Navbar() {
  const [authed, setAuthed] = useState(false)
  const { t } = useLanguage()

  useEffect(() => {
    setAuthed(isAuthenticated())
  }, [])

  return (
    <nav className="fixed top-0 left-0 right-0 z-50">
      <div
        className="mx-auto max-w-6xl mt-4 px-6 py-3 rounded-full flex items-center justify-between bg-[rgba(245,247,250,0.95)] border border-[var(--border)]"
      >
        <Link
          href="/"
          className="font-heading italic text-xl tracking-tight text-[var(--text)]"
        >
          Job Hunter Agent
        </Link>

        <div className="flex items-center gap-6">
          <a
            href="#features"
            className="hidden sm:inline font-body text-sm font-medium text-[var(--text-2)] hover:text-[var(--text)] transition-colors"
          >
            {t("lp_nav_features")}
          </a>
          <a
            href="#faq"
            className="hidden sm:inline font-body text-sm font-medium text-[var(--text-2)] hover:text-[var(--text)] transition-colors"
          >
            FAQ
          </a>
          <LanguageToggle />
          <Link
            href={authed ? "/chat" : "/login"}
            className="font-body text-sm font-medium bg-[var(--accent)] text-[var(--accent-fg)] rounded-full px-5 py-2 hover:opacity-90 transition-opacity"
          >
            {authed ? t("lp_nav_open_app") : t("lp_nav_get_started")}
          </Link>
        </div>
      </div>
    </nav>
  )
}

export default function Home() {
  return (
    <main className="min-h-screen">
      <Navbar />
      <Hero />
      <Problem />
      <Features />
      <HowItWorks />
      <Testimonials />
      <Memory />
      <FAQ />
      <FinalCTA />
      <Footer />
    </main>
  )
}
