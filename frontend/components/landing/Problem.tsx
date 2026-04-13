"use client"

import { useEffect, useRef } from "react"
import { useLanguage } from "@/contexts/LanguageContext"

/* ── Mini Visualization: Data Comparison (Pain Point 01) ── */
function MiniComparison() {
  const { locale } = useLanguage()
  const isZh = locale === "zh-CN"

  return (
    <div className="w-full max-w-[400px] glass rounded-xl p-4 font-body text-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-[--accent]" />
        <span className="text-[10px] font-semibold text-[--text-2] uppercase tracking-widest">
          {isZh ? "投递回复率" : "Reply Rate"}
        </span>
      </div>
      {/* Sent */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[--text-2] w-12 text-right shrink-0 text-xs">
          {isZh ? "投递" : "Sent"}
        </span>
        <div className="flex-1 h-5 rounded bg-[--border]">
          <div className="h-full rounded bg-[--text-3]" style={{ width: "100%" }} />
        </div>
        <span className="text-[--text] font-semibold w-10 tabular-nums text-right">100+</span>
      </div>
      {/* Replies */}
      <div className="flex items-center gap-3">
        <span className="text-[--text-2] w-12 text-right shrink-0 text-xs">
          {isZh ? "回复" : "Replies"}
        </span>
        <div className="flex-1 h-5 rounded bg-[--border]">
          <div className="h-full rounded bg-red-400" style={{ width: "3%" }} />
        </div>
        <span className="text-[--text] font-semibold w-10 tabular-nums text-right">3</span>
      </div>
      <p className="text-red-400 text-xs font-medium mt-2.5 text-right">
        {isZh ? "回复率不足 3%" : "Reply rate under 3%"}
      </p>
    </div>
  )
}

/* ── Mini Visualization: Time Bars (Pain Point 02) ── */
function MiniTimeBars() {
  const { locale } = useLanguage()
  const isZh = locale === "zh-CN"

  const items = [
    { label: isZh ? "简历 A" : "Resume A", hours: 2.0 },
    { label: isZh ? "简历 B" : "Resume B", hours: 1.5 },
    { label: isZh ? "简历 C" : "Resume C", hours: 2.5 },
    { label: isZh ? "简历 D" : "Resume D", hours: 1.0 },
  ]
  const maxHours = Math.max(...items.map((i) => i.hours))
  const totalHours = items.reduce((s, i) => s + i.hours, 0)

  return (
    <div className="w-full max-w-[400px] glass rounded-xl p-4 font-body text-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-[--accent]" />
        <span className="text-[10px] font-semibold text-[--text-2] uppercase tracking-widest">
          {isZh ? "定制耗时" : "Customization Time"}
        </span>
      </div>
      <div className="space-y-1.5">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-3">
            <span className="text-[--text-2] w-14 text-right shrink-0 text-xs">{item.label}</span>
            <div className="flex-1 h-4 rounded bg-[--border]">
              <div
                className="h-full rounded bg-amber-400"
                style={{ width: `${(item.hours / maxHours) * 100}%` }}
              />
            </div>
            <span className="text-[--text-2] w-12 text-xs tabular-nums text-right">{item.hours}h</span>
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between mt-3 pt-2.5 border-t border-[--border]">
        <span className="text-[--text-3] text-xs">
          {isZh ? `${items.length} 份简历` : `${items.length} resumes`}
        </span>
        <span className="text-amber-500 text-xs font-semibold">
          = {totalHours} {isZh ? "小时" : "hours"}
        </span>
      </div>
    </div>
  )
}

/* ── Mini Visualization: Status Tracker (Pain Point 03) ── */
function MiniTracker() {
  const { locale } = useLanguage()
  const isZh = locale === "zh-CN"

  const rows = isZh
    ? [
        { company: "字节跳动", stages: ["green", "green", "unknown"] as const },
        { company: "阿里巴巴", stages: ["green", "unknown", "unknown"] as const },
        { company: "腾讯", stages: ["green", "gray", "gray"] as const },
        { company: "美团", stages: ["green", "green", "unknown"] as const },
        { company: "小红书", stages: ["green", "unknown", "unknown"] as const },
        { company: "拼多多", stages: ["unknown", "unknown", "unknown"] as const },
      ]
    : [
        { company: "ByteDance", stages: ["green", "green", "unknown"] as const },
        { company: "Alibaba", stages: ["green", "unknown", "unknown"] as const },
        { company: "Tencent", stages: ["green", "gray", "gray"] as const },
        { company: "Meituan", stages: ["green", "green", "unknown"] as const },
        { company: "Xiaohongshu", stages: ["green", "unknown", "unknown"] as const },
        { company: "Pinduoduo", stages: ["unknown", "unknown", "unknown"] as const },
      ]

  return (
    <div className="w-full max-w-[400px] glass rounded-xl p-4 font-body text-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-[--accent]" />
        <span className="text-[10px] font-semibold text-[--text-2] uppercase tracking-widest">
          {isZh ? "申请追踪" : "Application Tracking"}
        </span>
      </div>
      <div className="grid grid-cols-[1fr_40px_40px_40px] gap-y-1.5 gap-x-2 items-center">
        {/* Header */}
        <span className="text-[--text-3] text-[10px] font-medium">
          {isZh ? "公司" : "Company"}
        </span>
        <span className="text-[--text-3] text-[10px] font-medium text-center">
          {isZh ? "投递" : "Applied"}
        </span>
        <span className="text-[--text-3] text-[10px] font-medium text-center">
          {isZh ? "面试" : "Interview"}
        </span>
        <span className="text-[--text-3] text-[10px] font-medium text-center">
          {isZh ? "结果" : "Result"}
        </span>

        {rows.map((row) => (
          <div key={row.company} className="contents">
            <span className="text-[--text-2] text-xs truncate">{row.company}</span>
            {row.stages.map((s, i) => (
              <span key={i} className="flex justify-center">
                {s === "unknown" ? (
                  <span className="text-orange-400 text-xs font-bold select-none">?</span>
                ) : s === "green" ? (
                  <span className="block w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.4)]" />
                ) : (
                  <span className="block w-2.5 h-2.5 rounded-full bg-[--border-strong]" />
                )}
              </span>
            ))}
          </div>
        ))}
      </div>
      <p className="text-orange-400 text-xs font-medium mt-3 text-right">
        {isZh ? "哪家到哪步了？" : "Lost track?"}
      </p>
    </div>
  )
}

const miniVisualizations = [
  <MiniComparison key="viz-01" />,
  <MiniTimeBars key="viz-02" />,
  <MiniTracker key="viz-03" />,
]

export default function Problem() {
  const sectionRef = useRef<HTMLElement>(null)
  const { t } = useLanguage()

  const painPoints = [
    { number: "01", title: t("lp_pain_01_title"), description: t("lp_pain_01_desc") },
    { number: "02", title: t("lp_pain_02_title"), description: t("lp_pain_02_desc") },
    { number: "03", title: t("lp_pain_03_title"), description: t("lp_pain_03_desc") },
  ]

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add("animate-in")
          }
        })
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    )

    const items = sectionRef.current?.querySelectorAll(".pain-point")
    items?.forEach((item) => observer.observe(item))

    return () => observer.disconnect()
  }, [])

  return (
    <section
      ref={sectionRef}
      className="relative py-32 max-w-6xl mx-auto px-6 sm:px-8 lg:px-12"
    >
      {/* Section heading */}
      <h2 className="font-heading text-4xl sm:text-5xl md:text-6xl tracking-tight text-[--text] mb-24 max-w-[560px]">
        {t("lp_problem_title")}<em className="not-italic text-[--text] font-heading italic">{t("lp_problem_title_em")}</em>
      </h2>

      {/* Pain points */}
      <div className="space-y-16 md:space-y-20">
        {painPoints.map((point, index) => (
          <div
            key={point.number}
            className="pain-point opacity-0 translate-y-8 transition-all duration-700 ease-out"
            style={{ transitionDelay: `${index * 120}ms` }}
          >
            <div
              className={`grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-16 items-center ${
                index === 1 ? "md:[direction:rtl] md:[&>*]:[direction:ltr]" : ""
              }`}
            >
              {/* Text side */}
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline gap-3">
                  <span className="font-body text-4xl sm:text-5xl font-300 text-[--text-3] leading-none select-none">
                    {point.number}
                  </span>
                  <h3 className="font-heading text-xl sm:text-2xl text-[--text] leading-snug">
                    {point.title}
                  </h3>
                </div>
                <p className="font-body text-base text-[--text-2] leading-relaxed">
                  {point.description}
                </p>
              </div>

              {/* Visualization side */}
              <div className="flex justify-center md:justify-start">
                {miniVisualizations[index]}
              </div>
            </div>
          </div>
        ))}
      </div>

    </section>
  )
}
