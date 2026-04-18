"use client"

import { useEffect } from "react"
import Link from "next/link"
import { CardContainer, CardBody, CardItem } from "@/components/ui/3d-card"
import { useLanguage } from "@/contexts/LanguageContext"

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
      .animate-fade-rise       { animation: fade-rise 0.8s ease-out both; }
      .animate-fade-rise-d1    { animation: fade-rise 0.8s ease-out 0.12s both; }
      .animate-fade-rise-d2    { animation: fade-rise 0.8s ease-out 0.24s both; }
      .animate-fade-rise-d3    { animation: fade-rise 0.8s ease-out 0.36s both; }
      .animate-fade-rise-d4    { animation: fade-rise 0.8s ease-out 0.18s both; }
    `
    document.head.appendChild(style)
  }, [])
}

/* ── Rich product demo mockup (mirrors real Chat + JobSearchResultCard +
       Resume Studio output) ── */
function MockChat() {
  const { locale } = useLanguage()
  const isZh = locale === "zh-CN"

  const rows = isZh
    ? [
        { company: "字节跳动", title: "AI 产品经理", state: "checked" },
        { company: "阿里巴巴", title: "高级产品经理 - AI", state: "checked" },
        { company: "Moonshot AI", title: "AI Product Lead", state: "idle" },
      ]
    : [
        { company: "ByteDance", title: "AI Product Manager", state: "checked" },
        { company: "Alibaba", title: "Senior PM - AI", state: "checked" },
        { company: "Moonshot AI", title: "AI Product Lead", state: "idle" },
      ]

  const resumeMd = isZh
    ? `# 林昊 · AI 产品经理
## 工作经历
**字节跳动  |  高级 PM**   2024 — 至今
- 主导 LLM 助手产品 0 → 1，月活 200 万`
    : `# Lin Hao · AI PM
## Experience
**ByteDance  |  Senior PM**   2024 — Present
- Led LLM assistant 0 → 1 to 2M MAU`

  return (
    <div className="flex flex-col gap-3 p-5 text-[var(--text)]">
      {/* Header */}
      <div className="flex items-center gap-2 pb-3 border-b border-[var(--border)]">
        <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
        <span className="font-body text-xs font-medium text-[var(--text-2)] tracking-wide">
          {isZh ? "AI Agent 在线" : "AI Agent Online"}
        </span>
        <span className="ml-auto font-body text-xs text-[var(--text-3)] tracking-wide">
          Job Hunter Agent
        </span>
      </div>

      {/* User message 1 */}
      <div className="flex justify-end">
        <div className="bg-[var(--accent)] text-[var(--accent-fg)] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm font-body font-light max-w-[80%]">
          {isZh ? "帮我找上海的 AI 产品经理岗位" : "Find AI PM roles in Shanghai"}
        </div>
      </div>

      {/* Job Search result card — mirror real JobSearchResultCard */}
      <div
        className="bg-white rounded-xl border border-[var(--border)] overflow-hidden"
        style={{ animation: "fade-rise 0.6s ease-out 0.3s both" }}
      >
        <div className="flex items-center gap-2 px-3.5 py-2 border-b border-[var(--border)]">
          <span className="w-[7px] h-[7px] rounded-full bg-emerald-500 flex-shrink-0" />
          <span className="font-body font-semibold text-xs text-[var(--text-2)]">Job Search</span>
          <span className="font-mono text-[10px] text-[var(--text-3)] truncate">
            {isZh ? "AI 产品经理 · 上海" : "AI PM · Shanghai"}
          </span>
          <span className="ml-auto font-mono text-[10px] text-[var(--text-3)]">
            {isZh ? "3 条结果" : "3 results"}
          </span>
        </div>
        <div className="flex items-start gap-2 px-3.5 py-2 text-[11px] leading-relaxed
                        bg-[#eeebff] text-[#2c2a7a] border-b border-[var(--border)]">
          <span aria-hidden="true">💡</span>
          <span>
            {isZh
              ? "3 条强匹配已按你的偏好重排，第 1 条对齐度最高。"
              : "3 strong matches reranked for your profile — row 1 aligns best."}
          </span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {rows.map((r, i) => {
            const checked = r.state === "checked"
            return (
              <div
                key={i}
                className={`flex gap-2.5 px-3.5 py-2 ${
                  checked ? "bg-[var(--accent)]/[0.04]" : ""
                }`}
              >
                <div className="pt-0.5 flex-shrink-0">
                  <span
                    className={`flex items-center justify-center w-3.5 h-3.5 rounded border ${
                      checked
                        ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] text-[9px]"
                        : "border-[var(--border-strong)]"
                    }`}
                  >
                    {checked && "✓"}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-body font-semibold text-xs text-[var(--text)] leading-snug line-clamp-1">
                    {r.title}
                  </p>
                  <p className="font-body text-[10px] text-[var(--text-3)] leading-relaxed">
                    {r.company}
                  </p>
                </div>
              </div>
            )
          })}
        </div>
        <div className="flex items-center justify-between px-3.5 py-2 border-t border-[var(--border)] bg-black/[0.01]">
          <span className="font-body text-[10px] text-[var(--text-3)]">
            {isZh ? "已勾选 2 条" : "2 selected"}
          </span>
          <span className="font-body text-[10px] font-semibold px-2.5 py-1 rounded-lg text-[var(--accent-fg)] bg-[var(--accent)]">
            {isZh ? "保存到看板 (2)" : "Save to Kanban (2)"}
          </span>
        </div>
      </div>

      {/* Assistant message */}
      <div className="flex justify-start">
        <div
          className="bg-[var(--surface)] text-[var(--text)] rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm font-body font-light max-w-[85%] leading-relaxed border border-[var(--border)]"
          style={{ animation: "fade-rise 0.5s ease-out 0.9s both" }}
        >
          {isZh ? (
            <>
              已保存 <span className="font-semibold">2 个</span>
              职位到看板。想让我针对字节那条做公司调研 + 简历润色吗？
            </>
          ) : (
            <>
              Saved <span className="font-semibold">2</span> jobs to the kanban.
              Want me to research ByteDance and tailor your resume for that role?
            </>
          )}
        </div>
      </div>

      {/* User message 2 */}
      <div
        className="flex justify-end"
        style={{ animation: "fade-rise 0.5s ease-out 1.2s both" }}
      >
        <div className="bg-[var(--accent)] text-[var(--accent-fg)] rounded-2xl rounded-br-sm px-4 py-2.5 text-sm font-body font-light max-w-[80%]">
          {isZh ? "好的，开始吧" : "Yes, go ahead"}
        </div>
      </div>

      {/* Resume Studio output — markdown body + purple PDF pill */}
      <div
        className="bg-white rounded-xl border border-[var(--border)] p-3.5"
        style={{ animation: "fade-rise 0.6s ease-out 1.5s both" }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[#7c6af5]" />
            <span className="font-body text-[10px] font-semibold text-[var(--text-2)] uppercase tracking-widest">
              Resume Studio
            </span>
          </div>
          <span className="font-body text-[10px] text-[var(--text-3)]">
            {isZh ? "已匹配 6 项关键词" : "6 keywords matched"}
          </span>
        </div>
        <pre className="font-body text-[10.5px] text-[var(--text-2)] whitespace-pre-wrap
                        leading-relaxed bg-black/[0.03] rounded-lg p-2.5 max-h-28 overflow-hidden">
          {resumeMd}
        </pre>
        <div className="flex items-center justify-between mt-2">
          <span className="font-mono text-[9px] text-[var(--text-3)]">
            {isZh ? "签名链接 · 24h 有效" : "Signed URL · 24h"}
          </span>
          <span className="inline-flex items-center gap-1 text-[10px] font-body
                           bg-[#7c6af5] text-white rounded-full px-2.5 py-1">
            📄 {isZh ? "下载 PDF" : "Download PDF"}
          </span>
        </div>
      </div>
    </div>
  )
}

/* ── Hero Section ── */
export default function Hero() {
  useHeroCss()
  const { t } = useLanguage()

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
              {t("lp_hero_title_1")}
              <br />
              {t("lp_hero_title_2")}
            </h1>

            <p className="animate-fade-rise-d1 font-body text-[var(--text-2)] text-lg sm:text-xl font-light leading-relaxed">
              {t("lp_hero_sub")}
            </p>

            <div className="animate-fade-rise-d2 flex flex-wrap items-center gap-4">
              <Link
                href="/login"
                className="inline-flex items-center justify-center rounded-full bg-[var(--accent)] text-[var(--accent-fg)] font-body font-medium text-base px-8 py-3.5 transition-all hover:opacity-85 hover:scale-[1.03] active:opacity-75"
              >
                {t("lp_hero_cta")}
              </Link>
              <a
                href="#features"
                className="font-body text-[var(--text-2)] text-base font-medium underline underline-offset-4 decoration-[var(--text-3)] hover:text-[var(--text)] transition-colors"
              >
                {t("lp_hero_learn_more")}
              </a>
            </div>

            <div className="animate-fade-rise-d3 flex items-center gap-3 pt-4">
              <span className="font-body text-sm text-[var(--text-3)] tracking-wide">
                Powered by
              </span>
              <div className="flex items-center gap-2.5">
                {["Claude", "LangGraph", "mem0"].map((name) => (
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
