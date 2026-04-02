"use client"

const bullets = [
  {
    highlight: "不用每次重复介绍自己",
    detail: "你的背景、技能和偏好被安全存储",
  },
  {
    highlight: "个性化推荐越来越精准",
    detail: "AI 从每次互动中学习你的偏好",
  },
  {
    highlight: "无缝衔接每次对话",
    detail: "打开新会话，AI 依然记得你是谁",
  },
]

export default function Memory() {
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
              AI 记住你的一切偏好
            </h2>

            {/* Subtext */}
            <p className="font-body text-base md:text-lg mb-14 md:mb-20" style={{ color: "rgba(239,236,230,0.55)" }}>
              跨会话长期记忆，越用越懂你
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
