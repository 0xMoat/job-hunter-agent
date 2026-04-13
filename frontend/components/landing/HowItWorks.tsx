"use client"

import { useLanguage } from "@/contexts/LanguageContext"

export default function HowItWorks() {
  const { t } = useLanguage()

  const steps = [
    { number: "1", title: t("lp_how_step1_title"), description: t("lp_how_step1_desc") },
    { number: "2", title: t("lp_how_step2_title"), description: t("lp_how_step2_desc") },
    { number: "3", title: t("lp_how_step3_title"), description: t("lp_how_step3_desc") },
  ]

  return (
    <section className="py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        {/* Section heading */}
        <h2 className="font-heading text-3xl md:text-4xl tracking-tight text-[var(--text)] mb-20 md:mb-28">
          {t("lp_how_title_1")}{" "}
          <span className="italic">{t("lp_how_title_2")}</span>
        </h2>

        {/* Steps grid */}
        <div className="relative grid grid-cols-1 md:grid-cols-3 gap-16 md:gap-0">
          {/* Connecting line — desktop only */}
          <div
            className="hidden md:block absolute top-[52px] left-[10%] right-[10%] h-px bg-[var(--border-strong)]"
            aria-hidden="true"
          />

          {steps.map((step, i) => (
            <div
              key={step.number}
              className={`relative ${
                i > 0 ? "md:pl-12" : ""
              } ${i < steps.length - 1 ? "md:pr-12" : ""}`}
            >
              {/* Large decorative number */}
              <span
                className="font-heading italic text-[5.5rem] md:text-[7rem] leading-none text-[var(--text-3)] select-none block"
                aria-hidden="true"
              >
                {step.number}
              </span>

              {/* Title */}
              <h3 className="font-heading text-xl md:text-2xl text-[var(--text)] mt-4 mb-3">
                {step.title}
              </h3>

              {/* Description */}
              <p className="font-body text-base text-[var(--text-2)] leading-relaxed max-w-xs">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
