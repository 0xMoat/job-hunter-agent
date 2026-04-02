"use client"

import { useEffect, useRef } from "react"

/* ------------------------------------------------------------------ */
/*  Mini UI mockup components                                         */
/* ------------------------------------------------------------------ */

function SearchMockup() {
  const jobs = [
    { title: "高级前端工程师", company: "字节跳动", location: "北京", active: true },
    { title: "全栈开发工程师", company: "Stripe", location: "远程", active: true },
    { title: "AI 应用工程师", company: "Moonshot AI", location: "上海", active: false },
  ]

  return (
    <div className="aspect-video w-full rounded-2xl bg-[var(--card)] border border-[var(--border)] relative overflow-hidden p-4 sm:p-6">
      {/* Search bar */}
      <div className="flex items-center gap-2 rounded-full border border-[rgba(0,0,0,0.08)] bg-white/60 px-3 py-1.5 sm:px-4 sm:py-2 mb-3 sm:mb-4">
        <div className="w-3 h-3 sm:w-3.5 sm:h-3.5 rounded-full border-2 border-[--text-3] relative flex-shrink-0">
          <div className="absolute -bottom-0.5 -right-0.5 w-1 h-1 bg-[--text-3] rounded-full" />
        </div>
        <span className="font-body text-[10px] sm:text-xs text-[--text-3]">搜索职位、公司或关键词…</span>
      </div>

      {/* Job listing rows */}
      <div className="space-y-2 sm:space-y-2.5">
        {jobs.map((job, i) => (
          <div
            key={i}
            className="flex items-center gap-2 sm:gap-3 rounded-lg bg-[rgba(0,0,0,0.04)] px-3 py-2 sm:px-4 sm:py-2.5"
          >
            <div
              className={`w-1.5 h-1.5 sm:w-2 sm:h-2 rounded-full flex-shrink-0 ${
                job.active ? "bg-emerald-500" : "bg-[rgba(0,0,0,0.12)]"
              }`}
            />
            <div className="flex-1 min-w-0">
              <span className="font-body text-[10px] sm:text-xs font-medium text-[--text-2] block truncate">
                {job.title}
              </span>
              <span className="font-body text-[9px] sm:text-[10px] text-[--text-3]">{job.company}</span>
            </div>
            <span className="font-body text-[8px] sm:text-[10px] text-[--text-3] bg-[rgba(0,0,0,0.04)] rounded-full px-2 py-0.5 flex-shrink-0">
              {job.location}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function ResearchMockup() {
  const bars = [
    { label: "技术实力", width: "85%" },
    { label: "工作氛围", width: "72%" },
    { label: "薪酬福利", width: "90%" },
    { label: "成长空间", width: "65%" },
  ]

  return (
    <div className="aspect-video w-full rounded-2xl bg-[var(--card)] border border-[var(--border)] relative overflow-hidden p-4 sm:p-6">
      {/* Company header */}
      <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4">
        <div className="w-6 h-6 sm:w-8 sm:h-8 rounded-md bg-[--accent] flex-shrink-0" />
        <div>
          <span className="font-heading text-xs sm:text-sm font-medium text-[--text] block">Moonshot AI</span>
          <span className="font-body text-[9px] sm:text-[10px] text-[--text-3]">人工智能 · 北京</span>
        </div>
      </div>

      {/* Info rows */}
      <div className="space-y-1.5 sm:space-y-2 mb-3 sm:mb-4">
        {[
          { label: "融资阶段", value: "Series C" },
          { label: "员工规模", value: "5000+" },
          { label: "评分", value: "4.2 / 5" },
        ].map((item, i) => (
          <div key={i} className="flex items-center justify-between px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-md bg-[rgba(0,0,0,0.04)]">
            <span className="font-body text-[9px] sm:text-[10px] text-[--text-3]">{item.label}</span>
            <span className="font-body text-[10px] sm:text-xs font-medium text-[--text-2]">{item.value}</span>
          </div>
        ))}
      </div>

      {/* Bar chart */}
      <div className="space-y-1.5 sm:space-y-2">
        {bars.map((bar, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="font-body text-[8px] sm:text-[10px] text-[--text-3] w-10 sm:w-14 text-right flex-shrink-0">
              {bar.label}
            </span>
            <div className="flex-1 h-1.5 sm:h-2 rounded-full bg-[rgba(0,0,0,0.06)]">
              <div
                className="h-full rounded-full bg-[--accent]"
                style={{ width: bar.width, opacity: 0.7 }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ResumeMockup() {
  return (
    <div className="aspect-video w-full rounded-2xl bg-[var(--card)] border border-[var(--border)] relative overflow-hidden p-4 sm:p-6">
      {/* Document area */}
      <div className="h-full rounded-lg bg-white/50 p-3 sm:p-4 flex flex-col gap-2.5 sm:gap-3">
        {/* Section: 个人信息 */}
        <div>
          <span className="font-heading text-[10px] sm:text-xs font-medium text-[--text-2] block mb-1">个人信息</span>
          <div className="space-y-1">
            <div className="h-1 sm:h-1.5 w-3/4 rounded-full bg-[rgba(0,0,0,0.08)]" />
            <div className="h-1 sm:h-1.5 w-1/2 rounded-full bg-[rgba(0,0,0,0.06)]" />
          </div>
        </div>

        {/* Section: 工作经验 */}
        <div>
          <span className="font-heading text-[10px] sm:text-xs font-medium text-[--text-2] block mb-1">工作经验</span>
          <div className="space-y-1">
            <div className="h-1 sm:h-1.5 w-full rounded-full bg-[rgba(0,0,0,0.08)]" />
            <div className="h-1 sm:h-1.5 w-5/6 rounded-full bg-[rgba(0,0,0,0.06)]" />
            <div className="h-1 sm:h-1.5 w-2/3 rounded-full bg-[rgba(0,0,0,0.06)]" />
          </div>
        </div>

        {/* Section: 技能 — with AI suggestion highlight */}
        <div className="border-l-2 border-[--accent] pl-2 sm:pl-3 relative">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="font-heading text-[10px] sm:text-xs font-medium text-[--text-2]">技能</span>
            <span className="font-body text-[8px] sm:text-[9px] text-[--accent-fg] bg-[--accent] rounded px-1 py-px">
              AI 建议
            </span>
          </div>
          <div className="space-y-1">
            <div className="h-1 sm:h-1.5 w-4/5 rounded-full bg-[--accent] opacity-20" />
            <div className="h-1 sm:h-1.5 w-3/5 rounded-full bg-[--accent] opacity-15" />
          </div>
        </div>
      </div>
    </div>
  )
}

function KanbanMockup() {
  const columns = [
    {
      label: "已投递",
      cards: [
        { h: "h-5 sm:h-7" },
        { h: "h-7 sm:h-9" },
        { h: "h-4 sm:h-6" },
      ],
      cardColor: "bg-[rgba(0,0,0,0.06)]",
    },
    {
      label: "面试中",
      cards: [
        { h: "h-6 sm:h-8" },
        { h: "h-5 sm:h-7" },
      ],
      cardColor: "bg-[rgba(180,140,80,0.12)]",
    },
    {
      label: "已通过",
      cards: [
        { h: "h-7 sm:h-9" },
        { h: "h-5 sm:h-7" },
      ],
      cardColor: "bg-[--accent]",
    },
  ]

  return (
    <div className="aspect-video w-full rounded-2xl bg-[var(--card)] border border-[var(--border)] relative overflow-hidden p-4 sm:p-6">
      <div className="flex gap-2 sm:gap-3 h-full">
        {columns.map((col, i) => (
          <div key={i} className="flex-1 flex flex-col min-w-0">
            {/* Column header */}
            <div className="flex items-center justify-between mb-2 sm:mb-3">
              <span className="font-body text-[9px] sm:text-[10px] font-medium text-[--text-2]">{col.label}</span>
              <span className="font-body text-[8px] sm:text-[9px] text-[--text-3]">{col.cards.length}</span>
            </div>
            {/* Cards */}
            <div className="space-y-1.5 sm:space-y-2">
              {col.cards.map((card, j) => (
                <div
                  key={j}
                  className={`${card.h} w-full rounded-md ${
                    i === 2 ? "opacity-20" : ""
                  } ${col.cardColor}`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Mockup index                                                      */
/* ------------------------------------------------------------------ */

const mockups = [SearchMockup, ResearchMockup, ResumeMockup, KanbanMockup]

/* ------------------------------------------------------------------ */
/*  Feature data                                                      */
/* ------------------------------------------------------------------ */

const features = [
  {
    title: "智能职位搜索",
    description: "AI 理解你的背景和偏好，从多个平台精准匹配职位",
  },
  {
    title: "公司深度调研",
    description: "一键了解目标公司的文化、融资状况和员工评价",
  },
  {
    title: "AI 简历工坊",
    description: "根据职位描述自动定制你的简历，突出匹配亮点",
  },
  {
    title: "申请追踪看板",
    description: "可视化管理所有求职进度，不再遗漏任何机会",
  },
]

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export default function Features() {
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
      { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
    )

    const items = sectionRef.current?.querySelectorAll(".feature-row")
    items?.forEach((item) => observer.observe(item))

    return () => observer.disconnect()
  }, [])

  return (
    <section
      id="features"
      ref={sectionRef}
      className="relative py-32 max-w-6xl mx-auto px-6 sm:px-8 lg:px-12"
    >
      {/* Section heading */}
      <h2 className="font-heading text-4xl sm:text-5xl md:text-6xl tracking-tight text-[--text] mb-8 max-w-[600px]">
        一个 AI 搭档，
        <br />
        <em className="italic">全部搞定</em>
      </h2>
      <p className="font-body text-lg sm:text-xl text-[--text-2] mb-24 max-w-[480px] leading-relaxed">
        从发现机会到拿下 Offer，每一步都有 AI 在你身边。
      </p>

      {/* Feature rows — alternating layout */}
      <div className="space-y-24 md:space-y-36">
        {features.map((feature, index) => {
          const isEven = index % 2 === 1
          const Mockup = mockups[index]
          return (
            <div
              key={feature.title}
              className="feature-row opacity-0 translate-y-10 transition-all duration-700 ease-out"
              style={{ transitionDelay: `${index * 100}ms` }}
            >
              <div
                className={`flex flex-col gap-8 md:gap-12 ${
                  isEven ? "md:flex-row-reverse" : "md:flex-row"
                } md:items-center`}
              >
                {/* Text block */}
                <div className={`flex-1 ${isEven ? "md:pl-8 lg:pl-16" : "md:pr-8 lg:pr-16"}`}>
                  {/* Small feature index */}
                  <span className="font-body text-sm font-500 tracking-widest text-[--text-3] uppercase mb-4 block">
                    0{index + 1}
                  </span>

                  <h3 className="font-heading text-3xl sm:text-4xl text-[--text] mb-4 leading-tight">
                    {feature.title}
                  </h3>

                  <p className="font-body text-base sm:text-lg text-[--text-2] leading-relaxed max-w-[420px]">
                    {feature.description}
                  </p>
                </div>

                {/* Feature mockup */}
                <div className="flex-1">
                  <Mockup />
                </div>
              </div>
            </div>
          )
        })}
      </div>

    </section>
  )
}
