"use client"

const steps = [
  {
    number: "1",
    title: "告诉 AI 你的背景",
    description: "通过自然对话输入你的技能、经验和求职偏好",
  },
  {
    number: "2",
    title: "AI 搜索 + 精准匹配",
    description:
      "从 LinkedIn、BOSS直聘等平台自动搜索并推荐最适合你的职位",
  },
  {
    number: "3",
    title: "一键投递 + 全程追踪",
    description:
      "定制简历、撰写求职信，用看板管理每一个申请进度",
  },
]

export default function HowItWorks() {
  return (
    <section className="py-28 md:py-36">
      <div className="mx-auto max-w-6xl px-6">
        {/* Section heading */}
        <h2 className="font-heading text-3xl md:text-4xl tracking-tight text-[var(--text)] mb-20 md:mb-28">
          三步开始你的{" "}
          <span className="italic">AI 求职之旅</span>
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
