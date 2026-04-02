"use client"

import Hero from "@/components/landing/Hero"
import Problem from "@/components/landing/Problem"
import Features from "@/components/landing/Features"
import HowItWorks from "@/components/landing/HowItWorks"
import Memory from "@/components/landing/Memory"
import FAQ from "@/components/landing/FAQ"
import FinalCTA from "@/components/landing/FinalCTA"
import Footer from "@/components/landing/Footer"
import Link from "next/link"
import { isAuthenticated } from "@/lib/auth"
import { useEffect, useState } from "react"

function Navbar() {
  const [authed, setAuthed] = useState(false)

  useEffect(() => {
    setAuthed(isAuthenticated())
  }, [])

  return (
    <nav className="fixed top-0 left-0 right-0 z-50">
      <div
        className="mx-auto max-w-6xl mt-4 px-6 py-3 rounded-full flex items-center justify-between bg-[rgba(232,228,221,0.95)] border border-[var(--border)]"
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
            功能
          </a>
          <a
            href="#faq"
            className="hidden sm:inline font-body text-sm font-medium text-[var(--text-2)] hover:text-[var(--text)] transition-colors"
          >
            FAQ
          </a>
          <Link
            href={authed ? "/chat" : "/login"}
            className="font-body text-sm font-medium bg-[var(--accent)] text-[var(--accent-fg)] rounded-full px-5 py-2 hover:opacity-90 transition-opacity"
          >
            {authed ? "进入应用" : "免费开始"}
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
      <Memory />
      <FAQ />
      <FinalCTA />
      <Footer />
    </main>
  )
}
