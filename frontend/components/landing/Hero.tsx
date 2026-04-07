"use client"

import { useEffect } from "react"
import Link from "next/link"
import { CardContainer, CardBody, CardItem } from "@/components/ui/3d-card"

/* ── Inject keyframes via useEffect (Next.js strips inline <style> on hydration) ── */
const HERO_CSS_ID = "hero-css"
function useHeroCss() {
  useEffect(() => {
    if (document.getElementById(HERO_CSS_ID)) return
    const style = document.createElement("style")
    style.id = HERO_CSS_ID
    style.textContent = `
      @keyframes fade-rise {
        from { opacity: 0; transform: translateY(24px); }
        to   { opacity: 1; transform: translateY(0); }
      }
      @keyframes slideInRight {
        from { opacity: 0; transform: translateX(20px); }
        to   { opacity: 1; transform: translateX(0); }
      }
      @keyframes progressFill {
        from { width: 0%; }
        to   { width: 70%; }
      }
      .animate-fade-rise       { animation: fade-rise 0.8s ease-out both; }
      .animate-fade-rise-d1    { animation: fade-rise 0.8s ease-out 0.12s both; }
      .animate-fade-rise-d2    { animation: fade-rise 0.8s ease-out 0.24s both; }
      .animate-fade-rise-d3    { animation: fade-rise 0.8s ease-out 0.36s both; }
      .animate-fade-rise-d4    { animation: fade-rise 0.8s ease-out 0.18s both; }
    `
    document.head.appendChild(style)
  }, [])
}

/* ── Job search result row ── */
function JobRow({ title, company, location, match, color, delay }: {
  title: string; company: string; location: string; match: number; color: string; delay: string
}) {
  return (
    <div
      className="flex items-center justify-between py-2.5 border-b border-[var(--border)] last:border-0"
      style={{ animation: "slideInRight 0.5s ease-out both", animationDelay: delay }}
    >
      <div>
        <div className="font-body text-sm font-semibold text-[var(--text)]">{title}</div>
        <div className="font-body text-xs text-[var(--text-3)]">{company}·{location}</div>
      </div>
      <span className={`font-body text-xs font-semibold italic ${color}`}>
        {match}% 匹配
      </span>
    </div>
  )
}

/* ── Rich product demo mockup ── */
function MockChat() {
  return (
    <div className="flex flex-col gap-3 p-5 text-[var(--text)]">
      {/* Header */}
      <div className="flex items-center gap-2 pb-3 border-b border-[var(--border)]">
        <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
        <span className="font-body text-xs font-medium text-[var(--text-2)] tracking-wide">
          AI Agent 在线
        </span>
        <span className="ml-auto font-body text-xs text-[var(--text-3)] tracking-wide">
          Job Hunter Agent
        </span>
      </div>

      {/* User message 1 */}
      <div className="flex justify-end">
        <div className="bg-[var(--accent)] text-[var(--accent-fg)] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm font-body font-light max-w-[80%]">
          帮我找上海的 AI 产品经理岗位
        </div>
      </div>

      {/* Job Search results card */}
      <div
        className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4"
        style={{ animation: "fade-rise 0.6s ease-out 0.3s both" }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="font-body text-[10px] font-semibold text-[var(--text-2)] uppercase tracking-widest">
              Job Search
            </span>
          </div>
          <span className="font-body text-[10px] text-[var(--text-3)]">12 results</span>
        </div>
        <JobRow title="AI 产品经理" company="字节跳动" location="上海" match={95} color="text-emerald-600" delay="0.5s" />
        <JobRow title="高级产品经理 - AI" company="阿里巴巴" location="上海" match={88} color="text-orange-500" delay="0.65s" />
        <JobRow title="AI Product Lead" company="Moonshot AI" location="上海" match={82} color="text-orange-500" delay="0.8s" />
      </div>

      {/* Assistant message */}
      <div className="flex justify-start">
        <div
          className="bg-[var(--surface)] text-[var(--text)] rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm font-body font-light max-w-[85%] leading-relaxed border border-[var(--border)]"
          style={{ animation: "fade-rise 0.5s ease-out 0.9s both" }}
        >
          找到 <span className="font-semibold">12 个</span>匹配岗位。字节跳动的匹配度最高，需要我帮你定制简历吗？
        </div>
      </div>

      {/* User message 2 */}
      <div
        className="flex justify-end"
        style={{ animation: "fade-rise 0.5s ease-out 1.2s both" }}
      >
        <div className="bg-[var(--accent)] text-[var(--accent-fg)] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm font-body font-light max-w-[80%]">
          好的，定制简历
        </div>
      </div>

      {/* Resume Studio card */}
      <div
        className="bg-[var(--surface)] rounded-xl border border-[var(--border)] p-4"
        style={{ animation: "fade-rise 0.6s ease-out 1.5s both" }}
      >
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            <span className="font-body text-[10px] font-semibold text-[var(--text-2)] uppercase tracking-widest">
              Resume Studio
            </span>
          </div>
          <span className="font-body text-[10px] text-[var(--text-3)] animate-pulse">正在生成...</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-12 rounded bg-[var(--bg)] border border-[var(--border)] flex flex-col items-start justify-center px-1.5 gap-1 flex-shrink-0">
            <div className="w-5 h-[2px] bg-[var(--text-3)] rounded-full" />
            <div className="w-full h-[2px] bg-[var(--text-3)] rounded-full" />
            <div className="w-4 h-[2px] bg-blue-400 rounded-full" />
            <div className="w-full h-[2px] bg-blue-400 rounded-full" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-body text-sm font-semibold text-[var(--text)]">AI 产品经理 - 字节跳动</div>
            <div className="font-body text-xs text-[var(--text-3)] mt-0.5">已匹配 6 项技能关键词，优化 3 段经历描述</div>
            <div className="mt-2 h-1.5 bg-[var(--border)] rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 rounded-full"
                style={{ animation: "progressFill 2s ease-out 1.8s both" }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Hero Section ── */
export default function Hero() {
  useHeroCss()

  return (
    <section className="relative min-h-screen flex items-center overflow-hidden">

      {/* ── Fullscreen video background ── */}
      <video
        src="https://d8j0ntlcm91z4.cloudfront.net/user_38xzZboKViGWJOttwIXH07lWA1P/hf_20260314_131748_f2ca2a28-fed7-44c8-b9a9-bd9acdd5ec31.mp4"
        autoPlay
        loop
        muted
        playsInline
        className="absolute inset-0 w-full h-full object-cover z-0 pointer-events-none"
        style={{ opacity: 0.4, filter: "saturate(0.4)" }}
      />

      {/* ── Content ── */}
      <div className="relative z-10 w-full max-w-6xl mx-auto px-6 sm:px-8 lg:px-12 py-20 lg:py-28">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">

          {/* ── Left: Copy ── */}
          <div className="flex flex-col gap-8 max-w-xl">
            <h1
              className="animate-fade-rise font-heading italic font-bold text-[var(--text)] leading-[1.1] tracking-tight"
              style={{ fontSize: "clamp(2.5rem, 5vw, 4rem)" }}
            >
              你的 AI 求职搭档，
              <br />
              从搜索到 Offer 全程陪跑
            </h1>

            <p className="animate-fade-rise-d1 font-body text-[var(--text-2)] text-lg sm:text-xl font-light leading-relaxed">
              AI 驱动的一站式求职平台 — 智能搜索职位、研究公司、定制简历、追踪申请进度
            </p>

            <div className="animate-fade-rise-d2 flex flex-wrap items-center gap-4">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)] font-body font-medium text-base px-8 py-3.5 transition-all hover:opacity-85 hover:scale-[1.03] active:opacity-75"
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

            <div className="animate-fade-rise-d3 flex items-center gap-3 pt-4">
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

          {/* ── Right: 3D Product mockup ── */}
          <div className="animate-fade-rise-d4 relative">
            <CardContainer className="w-full" containerClassName="w-full">
              <CardBody className="relative w-full">
                <CardItem translateZ={60} className="w-full">
                  <div className="w-full rounded-2xl bg-[var(--card)] border border-[var(--border)] shadow-[0_8px_40px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.03)]">
                    <MockChat />
                  </div>
                </CardItem>
              </CardBody>
            </CardContainer>

            <div
              className="absolute -z-10 inset-0 -m-6 rounded-3xl"
              style={{
                background: "radial-gradient(ellipse 80% 70% at 60% 40%, rgba(15,23,42,0.04) 0%, transparent 70%)",
              }}
            />
          </div>
        </div>
      </div>
    </section>
  )
}
