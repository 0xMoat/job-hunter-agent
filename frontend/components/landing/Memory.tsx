"use client"

import { useLanguage } from "@/contexts/LanguageContext"

export default function Memory() {
  const { t } = useLanguage()

  const bullets = [
    { highlight: t("lp_mem_01_highlight"), detail: t("lp_mem_01_detail") },
    { highlight: t("lp_mem_02_highlight"), detail: t("lp_mem_02_detail") },
    { highlight: t("lp_mem_03_highlight"), detail: t("lp_mem_03_detail") },
  ]

  return (
    <section className="py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        <div className="relative overflow-hidden rounded-3xl bg-[var(--accent)] text-[var(--accent-fg)] px-8 md:px-16 py-16 md:py-24">
          {/* Decorative background quote mark */}
          <span
            className="absolute top-8 right-8 md:right-16 font-heading italic text-[12rem] md:text-[20rem] leading-none select-none pointer-events-none"
            style={{ color: "rgba(255,255,255,0.04)" }}
            aria-hidden="true"
          >
            &ldquo;
          </span>

          {/* Content */}
          <div className="relative z-10 max-w-2xl">
            {/* Heading */}
            <h2 className="font-heading italic text-3xl md:text-5xl tracking-tight leading-tight mb-4">
              {t("lp_mem_title")}
            </h2>

            {/* Subtext */}
            <p className="font-body text-base md:text-lg mb-14 md:mb-20" style={{ color: "rgba(239,236,230,0.55)" }}>
              {t("lp_mem_sub")}
            </p>

            {/* Bullet points */}
            <ul className="space-y-8 md:space-y-10">
              {bullets.map((item) => (
                <li key={item.highlight}>
                  <p className="font-body text-lg md:text-xl leading-snug">
                    <span className="font-medium">{item.highlight}</span>
                    <span className="mx-2" style={{ color: "rgba(239,236,230,0.3)" }} aria-hidden="true">
                      &mdash;
                    </span>
                    <span style={{ color: "rgba(239,236,230,0.6)" }}>
                      {item.detail}
                    </span>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
