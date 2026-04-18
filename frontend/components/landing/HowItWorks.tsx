"use client"

import { useLanguage } from "@/contexts/LanguageContext"

export default function HowItWorks() {
  const { t } = useLanguage()

  const steps = [
    { number: "1", title: t("lp_how_step1_title"), description: t("lp_how_step1_desc") },
    { number: "2", title: t("lp_how_step2_title"), description: t("lp_how_step2_desc") },
    { number: "3", title: t("lp_how_step3_title"), description: t("lp_how_step3_desc") },
    { number: "4", title: t("lp_how_step4_title"), description: t("lp_how_step4_desc") },
    { number: "5", title: t("lp_how_step5_title"), description: t("lp_how_step5_desc") },
  ]

  return (
    <section className="py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        {/* Section heading */}
        <h2 className="font-heading text-3xl md:text-4xl tracking-tight text-[var(--text)] mb-20 md:mb-28">
          {t("lp_how_title_1")}{" "}
          <span className="italic">{t("lp_how_title_2")}</span>
        </h2>

        {/* Steps grid — 5 columns on lg+, stacks on smaller viewports */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-x-8 gap-y-14">
          {steps.map((step) => (
            <div key={step.number} className="relative">
              {/* Large decorative number */}
              <span
                className="font-heading italic text-[4.5rem] lg:text-[5.5rem] leading-none text-[var(--text-3)] select-none block"
                aria-hidden="true"
              >
                {step.number}
              </span>

              {/* Title */}
              <h3 className="font-heading text-xl lg:text-[1.35rem] text-[var(--text)] mt-3 mb-2 leading-snug">
                {step.title}
              </h3>

              {/* Description */}
              <p className="font-body text-sm lg:text-[0.95rem] text-[var(--text-2)] leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
