"use client"

import { useEffect, useRef } from "react"

const painPoints = [
  {
    number: "01",
    title: "海投 100 份简历，回复寥寥",
    description:
      "精心打磨的简历石沉大海，投递数量上去了，质量却跟不上。没有针对性的投递策略，再多努力也是无用功。",
  },
  {
    number: "02",
    title: "每家公司都要定制简历，太费时间",
    description:
      "逐字修改经历描述、调整关键词、重新排版——一份简历就要花掉一个晚上。重复劳动消磨的不只是时间，还有信心。",
  },
  {
    number: "03",
    title: "投了哪些公司？进度到哪了？全凭记忆",
    description:
      "Excel 记了一半就忘了更新，面试时间和公司名字开始混淆。当机会越多，管理混乱带来的代价也越大。",
  },
]

/* ── Mini Visualization: Data Comparison (Pain Point 01) ── */
function MiniComparison() {
  return (
    <div className="w-full max-w-[400px] glass rounded-xl p-4 font-body text-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-[--accent]" />
        <span className="text-[10px] font-semibold text-[--text-2] uppercase tracking-widest">投递回复率</span>
      </div>
      {/* Sent */}
      <div className="flex items-center gap-3 mb-2">
        <span className="text-[--text-2] w-12 text-right shrink-0 text-xs">投递</span>
        <div className="flex-1 h-5 rounded bg-[--border]">
          <div className="h-full rounded bg-[--text-3]" style={{ width: "100%" }} />
        </div>
        <span className="text-[--text] font-semibold w-10 tabular-nums text-right">100+</span>
      </div>
      {/* Replies */}
      <div className="flex items-center gap-3">
        <span className="text-[--text-2] w-12 text-right shrink-0 text-xs">回复</span>
        <div className="flex-1 h-5 rounded bg-[--border]">
          <div className="h-full rounded bg-red-400" style={{ width: "3%" }} />
        </div>
        <span className="text-[--text] font-semibold w-10 tabular-nums text-right">3</span>
      </div>
      <p className="text-red-400 text-xs font-medium mt-2.5 text-right">
        回复率不足 3%
      </p>
    </div>
  )
}

/* ── Mini Visualization: Time Bars (Pain Point 02) ── */
function MiniTimeBars() {
  const items = [
    { label: "简历 A", hours: 2.0 },
    { label: "简历 B", hours: 1.5 },
    { label: "简历 C", hours: 2.5 },
    { label: "简历 D", hours: 1.0 },
  ]
  const maxHours = Math.max(...items.map((i) => i.hours))
  const totalHours = items.reduce((s, i) => s + i.hours, 0)

  return (
    <div className="w-full max-w-[400px] glass rounded-xl p-4 font-body text-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-[--accent]" />
        <span className="text-[10px] font-semibold text-[--text-2] uppercase tracking-widest">定制耗时</span>
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
        <span className="text-[--text-3] text-xs">{items.length} 份简历</span>
        <span className="text-amber-500 text-xs font-semibold">= {totalHours} 小时</span>
      </div>
    </div>
  )
}

/* ── Mini Visualization: Status Tracker (Pain Point 03) ── */
function MiniTracker() {
  const rows = [
    { company: "字节跳动", stages: ["green", "green", "unknown"] },
    { company: "阿里巴巴", stages: ["green", "unknown", "unknown"] },
    { company: "腾讯", stages: ["green", "gray", "gray"] },
    { company: "美团", stages: ["green", "green", "unknown"] },
    { company: "小红书", stages: ["green", "unknown", "unknown"] },
    { company: "拼多多", stages: ["unknown", "unknown", "unknown"] },
  ] as const

  return (
    <div className="w-full max-w-[400px] glass rounded-xl p-4 font-body text-sm">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-1.5 h-1.5 rounded-full bg-[--accent]" />
        <span className="text-[10px] font-semibold text-[--text-2] uppercase tracking-widest">申请追踪</span>
      </div>
      <div className="grid grid-cols-[1fr_40px_40px_40px] gap-y-1.5 gap-x-2 items-center">
        {/* Header */}
        <span className="text-[--text-3] text-[10px] font-medium">公司</span>
        <span className="text-[--text-3] text-[10px] font-medium text-center">投递</span>
        <span className="text-[--text-3] text-[10px] font-medium text-center">面试</span>
        <span className="text-[--text-3] text-[10px] font-medium text-center">结果</span>

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
        哪家到哪步了？
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
        求职，不该<em className="not-italic text-[--text] font-heading italic">这么难</em>
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
