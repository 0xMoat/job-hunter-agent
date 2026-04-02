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

      {/* Pain points — staggered list */}
      <div className="space-y-20 md:space-y-28">
        {painPoints.map((point, index) => (
          <div
            key={point.number}
            className="pain-point opacity-0 translate-y-8 transition-all duration-700 ease-out"
            style={{ transitionDelay: `${index * 120}ms` }}
          >
            <div
              className={`flex flex-col gap-4 ${
                index === 1 ? "md:ml-24 lg:ml-40" : index === 2 ? "md:ml-12 lg:ml-20" : ""
              }`}
            >
              {/* Large decorative number */}
              <span className="font-body text-7xl sm:text-8xl md:text-9xl font-300 text-[--text-3] leading-none select-none -mb-2">
                {point.number}
              </span>

              {/* Title */}
              <h3 className="font-heading text-2xl sm:text-3xl md:text-[2rem] text-[--text] leading-snug max-w-[520px]">
                {point.title}
              </h3>

              {/* Description */}
              <p className="font-body text-base sm:text-lg text-[--text-2] leading-relaxed max-w-[480px]">
                {point.description}
              </p>
            </div>
          </div>
        ))}
      </div>

    </section>
  )
}
