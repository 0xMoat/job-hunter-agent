"use client"

import { useState } from "react"
import { useLanguage } from "@/contexts/LanguageContext"

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      className={`shrink-0 transition-transform duration-300 ease-out ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M5 7.5L10 12.5L15 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function FAQ() {
  const [openSet, setOpenSet] = useState<Set<number>>(new Set())
  const { t } = useLanguage()

  const faqItems = [
    { q: t("lp_faq_01_q"), a: t("lp_faq_01_a") },
    { q: t("lp_faq_02_q"), a: t("lp_faq_02_a") },
    { q: t("lp_faq_03_q"), a: t("lp_faq_03_a") },
    { q: t("lp_faq_04_q"), a: t("lp_faq_04_a") },
    { q: t("lp_faq_05_q"), a: t("lp_faq_05_a") },
  ]

  function toggle(index: number) {
    setOpenSet((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  return (
    <section id="faq" className="w-full max-w-6xl mx-auto px-6 sm:px-8 lg:px-12 py-20 lg:py-28">
      <div className="max-w-2xl">
        <h2 className="font-heading italic text-[var(--text)] text-3xl sm:text-4xl lg:text-5xl tracking-tight mb-12 lg:mb-16">
          {t("lp_faq_title")}
        </h2>

        <div className="flex flex-col">
          {faqItems.map((item, i) => {
            const isOpen = openSet.has(i)
            return (
              <div key={i} className="border-b border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  className="w-full flex items-center justify-between gap-4 py-5 text-left cursor-pointer group"
                >
                  <span className="font-body text-[var(--text)] text-base sm:text-lg font-medium leading-snug group-hover:text-[var(--text-2)] transition-colors">
                    {item.q}
                  </span>
                  <ChevronIcon open={isOpen} />
                </button>

                <div
                  className="grid transition-[grid-template-rows] duration-300 ease-out"
                  style={{
                    gridTemplateRows: isOpen ? "1fr" : "0fr",
                  }}
                >
                  <div className="overflow-hidden">
                    <p className="font-body text-[var(--text-2)] text-base font-light leading-relaxed pb-5">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
