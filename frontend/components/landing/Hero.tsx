"use client"

import Link from "next/link"

/* ── Staggered entrance keyframes ── */
const fadeUpKeyframes = `
@keyframes fadeUp {
  from {
    opacity: 0;
    transform: translateY(24px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
`

function AnimStyle() {
  return <style>{fadeUpKeyframes}</style>
}

/* ── Chat mockup message bubbles ── */
function MockChat() {
  return (
    <div className="flex flex-col gap-3 p-6">
      {/* Header bar */}
      <div className="flex items-center gap-2 pb-3 border-b border-[var(--border)]">
        <div className="w-2.5 h-2.5 rounded-full bg-[var(--text-3)]" />
        <div className="w-2.5 h-2.5 rounded-full bg-[var(--text-3)]" />
        <div className="w-2.5 h-2.5 rounded-full bg-[var(--text-3)]" />
        <span className="ml-auto font-body text-xs text-[var(--text-3)] tracking-wide">
          Job Hunter Agent
        </span>
      </div>

      {/* User message */}
      <div className="flex justify-end">
        <div className="bg-[var(--accent)] text-[var(--accent-fg)] rounded-[16px] rounded-br-[4px] px-4 py-2.5 text-sm font-body font-light max-w-[75%]">
          帮我找一下上海的 AI 产品经理岗位
        </div>
      </div>

      {/* Assistant message */}
      <div className="flex justify-start">
        <div className="bg-white/60 text-[var(--text)] rounded-[16px] rounded-bl-[4px] px-4 py-2.5 text-sm font-body font-light max-w-[80%] leading-relaxed">
          已为你搜索到 <span className="font-medium">12 个匹配岗位</span>，包括字节跳动、阿里巴巴等公司。需要我帮你分析哪些最适合你的背景吗？
        </div>
      </div>

      {/* User follow-up */}
      <div className="flex justify-end">
        <div className="bg-[var(--accent)] text-[var(--accent-fg)] rounded-[16px] rounded-br-[4px] px-4 py-2.5 text-sm font-body font-light max-w-[75%]">
          帮我定制简历，匹配字节的那个岗位
        </div>
      </div>

      {/* Assistant working indicator */}
      <div className="flex justify-start">
        <div className="bg-white/60 text-[var(--text)] rounded-[16px] rounded-bl-[4px] px-4 py-2.5 text-sm font-body font-light max-w-[80%]">
          <span className="inline-flex gap-1 items-center text-[var(--text-2)]">
            正在分析岗位要求
            <span className="inline-flex gap-0.5">
              <span className="w-1 h-1 rounded-full bg-[var(--text-3)] animate-pulse" />
              <span className="w-1 h-1 rounded-full bg-[var(--text-3)] animate-pulse [animation-delay:150ms]" />
              <span className="w-1 h-1 rounded-full bg-[var(--text-3)] animate-pulse [animation-delay:300ms]" />
            </span>
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── Hero Section ── */
export default function Hero() {
  return (
    <section className="relative min-h-[90vh] flex items-center overflow-hidden">
      <AnimStyle />

      <div className="w-full max-w-6xl mx-auto px-6 sm:px-8 lg:px-12 py-20 lg:py-28">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">

          {/* ── Left: Copy ── */}
          <div className="flex flex-col gap-8 max-w-xl">
            {/* Headline */}
            <h1
              className="font-heading italic font-bold text-[var(--text)] leading-[1.1] tracking-tight"
              style={{
                fontSize: "clamp(2.5rem, 5vw, 4rem)",
                animation: "fadeUp 0.8s ease-out both",
              }}
            >
              你的 AI 求职搭档，
              <br />
              从搜索到 Offer 全程陪跑
            </h1>

            {/* Subheadline */}
            <p
              className="font-body text-[var(--text-2)] text-lg sm:text-xl font-light leading-relaxed"
              style={{
                animation: "fadeUp 0.8s ease-out both",
                animationDelay: "0.12s",
              }}
            >
              AI 驱动的一站式求职平台 — 智能搜索职位、研究公司、定制简历、追踪申请进度
            </p>

            {/* CTAs */}
            <div
              className="flex flex-wrap items-center gap-4"
              style={{
                animation: "fadeUp 0.8s ease-out both",
                animationDelay: "0.24s",
              }}
            >
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)] font-body font-medium text-base px-8 py-3.5 transition-opacity hover:opacity-85 active:opacity-75"
              >
                免费开始使用
              </Link>

              <a
                href="#features"
                className="font-body text-[var(--text-2)] text-base font-medium underline underline-offset-4 decoration-[var(--text-3)] hover:text-[var(--text)] transition-colors"
              >
                了解更多
              </a>
            </div>

            {/* Social proof */}
            <div
              className="flex items-center gap-3 pt-4"
              style={{
                animation: "fadeUp 0.8s ease-out both",
                animationDelay: "0.36s",
              }}
            >
              <span className="font-body text-sm text-[var(--text-3)] tracking-wide">
                Powered by
              </span>
              <div className="flex items-center gap-2.5">
                {["DeepSeek", "LangGraph", "mem0"].map((name) => (
                  <span
                    key={name}
                    className="font-body text-xs font-medium text-[var(--text-2)] bg-[var(--text)]/[0.04] rounded-full px-3 py-1"
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* ── Right: Product mockup ── */}
          <div
            className="relative"
            style={{
              animation: "fadeUp 0.8s ease-out both",
              animationDelay: "0.18s",
            }}
          >
            <div className="aspect-video w-full rounded-2xl bg-[var(--card)] border border-[var(--border)] shadow-[0_8px_40px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.03)] overflow-hidden">
              <MockChat />
            </div>

            {/* Subtle decorative gradient behind mockup */}
            <div
              className="absolute -z-10 inset-0 -m-6 rounded-3xl"
              style={{
                background:
                  "radial-gradient(ellipse 80% 70% at 60% 40%, rgba(20,18,16,0.03) 0%, transparent 70%)",
              }}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
