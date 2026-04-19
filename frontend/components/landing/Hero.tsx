"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
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

/* ── Rich product demo mockup — phases auto-advance so the viewer watches
       the agent discover → plan → execute → complete the whole loop:
         1 user1
         2 search card frame + intro banner
         3 search rows slotted (both already checked)
         4 saved footer + user2
         5..9 PE timeline: step N becomes running, N-1 becomes done
        10 plan all-done (pill flips emerald)
        11 completed kanban card reveal
       Phase ticks are tuned so the whole animation finishes in ~8s. ── */
function MockChat() {
  const { locale } = useLanguage()
  const isZh = locale === "zh-CN"
  const [phase, setPhase] = useState(0)

  useEffect(() => {
    const schedule = [
      400,  // 1: user1
      500,  // 2: search card + intro
      500,  // 3: rows appear UNCHECKED
      600,  // 4: checkboxes tick + "保存到看板" CTA surfaces
      700,  // 5: CTA "pressed" → footer flips to "已入库 ✓"
      500,  // 6: assistant plan bubble
      500,  // 7: user2
      500,  // 8: plan timeline mounts, step 1 running
      700,  // 9: step 1 done, step 2 running
      700,  // 10: step 2 done, step 3 running
      700,  // 11: step 3 done, step 4 running
      900,  // 12: step 4 done, step 5 running
      700,  // 13: all done
      500,  // 14: kanban card
    ]
    const timers: ReturnType<typeof setTimeout>[] = []
    let cum = 0
    schedule.forEach((d, i) => {
      cum += d
      timers.push(setTimeout(() => setPhase(i + 1), cum))
    })
    return () => {
      timers.forEach(clearTimeout)
    }
  }, [])

  const jobRows = isZh
    ? [
        { company: "字节跳动", title: "AI 产品经理" },
        { company: "阿里巴巴", title: "高级产品经理 - AI" },
      ]
    : [
        { company: "ByteDance", title: "AI Product Manager" },
        { company: "Alibaba", title: "Senior PM - AI" },
      ]

  const planSteps = isZh
    ? [
        { t: "调研字节跳动", tool: "Company Research" },
        { t: "评估匹配度（90 / 100）", tool: "Score JD Match" },
        { t: "生成缺口分析 + 面试问题", tool: "Analyze Gap" },
        { t: "为卡片 #12 润色简历", tool: "Resume Studio" },
        { t: "生成带签名链接的 PDF", tool: "Generate PDF" },
      ]
    : [
        { t: "Research ByteDance", tool: "Company Research" },
        { t: "Score JD match (90 / 100)", tool: "Score JD Match" },
        { t: "Generate skill gap + interview prep", tool: "Analyze Gap" },
        { t: "Tailor resume for card #12", tool: "Resume Studio" },
        { t: "Produce signed-URL PDF", tool: "Generate PDF" },
      ]

  const artifactBadges = isZh
    ? ["公司调研", "知识缺口", "面试问题", "润色简历", "简历 PDF"]
    : ["Research", "Skill gap", "Interview Q", "Tailored resume", "Resume PDF"]

  const PE_START = 8
  const PE_DONE = 13
  const stepStatus = (i: number): "done" | "running" | "pending" => {
    if (phase < PE_START) return "pending"
    const active = phase - PE_START
    if (active >= 5) return "done"
    if (i < active) return "done"
    if (i === active) return "running"
    return "pending"
  }

  const planCompleted = Math.min(
    5,
    Math.max(0, phase - PE_START) + (phase >= PE_DONE ? 1 : 0),
  )
  const allDone = phase >= PE_DONE
  const runningIdx =
    phase >= PE_START && phase < PE_DONE ? phase - PE_START : -1
  const runningTool =
    runningIdx >= 0 && runningIdx < planSteps.length
      ? planSteps[runningIdx].tool
      : null

  // Shape-preserving reveal — elements always occupy layout space so the
  // outer card's height stays fixed from mount; phase flips toggle
  // opacity + a small y-translate so the agent "appears" in place.
  const fade = (visible: boolean, delayMs = 0) => ({
    opacity: visible ? 1 : 0,
    transform: visible ? "translateY(0)" : "translateY(6px)",
    transition: `opacity 500ms ease-out ${delayMs}ms, transform 500ms ease-out ${delayMs}ms`,
  })

  return (
    <div className="flex flex-col gap-2 p-4 text-[var(--text)]">
      {/* Header — always visible */}
      <div className="flex items-center gap-2 pb-2 border-b border-[var(--border)]">
        <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]" />
        <span className="font-body text-xs font-medium text-[var(--text-2)] tracking-wide">
          {isZh ? "AI Agent 在线" : "AI Agent Online"}
        </span>
        <span className="ml-auto font-body text-xs text-[var(--text-3)] tracking-wide">
          Job Hunter Agent
        </span>
      </div>

      {/* User message 1 — always rendered, fades in at phase >= 1 */}
      <div className="flex justify-end" style={fade(phase >= 1)}>
        <div className="bg-[var(--accent)] text-[var(--accent-fg)] rounded-2xl rounded-br-sm px-3.5 py-2 text-[13px] font-body font-light max-w-[80%]">
          {isZh
            ? "找上海的 AI 产品经理，调研公司并润色简历"
            : "Find AI PM in Shanghai — research + tailor resume"}
        </div>
      </div>

      {/* Job Search result card — always in layout; inner pieces fade in */}
      <div
        className="bg-white rounded-xl border border-[var(--border)] overflow-hidden"
        style={fade(phase >= 2)}
      >
        <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)]">
          <span className="w-[7px] h-[7px] rounded-full bg-emerald-500 flex-shrink-0" />
          <span className="font-body font-semibold text-xs text-[var(--text-2)]">Job Search</span>
          <span className="font-mono text-[10px] text-[var(--text-3)] truncate">
            {isZh ? "AI 产品经理 · 上海" : "AI PM · Shanghai"}
          </span>
          <span className="ml-auto font-mono text-[10px] text-[var(--text-3)]">
            {isZh ? "2 条结果" : "2 results"}
          </span>
        </div>
        <div className="flex items-start gap-2 px-3.5 py-2 text-[11px] leading-relaxed
                        bg-[#eeebff] text-[#2c2a7a] border-b border-[var(--border)]">
          <span aria-hidden="true">💡</span>
          <span>
            {isZh
              ? "2 条强匹配按你的偏好重排，第 1 条对齐度最高。"
              : "2 strong matches reranked for your profile — row 1 aligns best."}
          </span>
        </div>
        <div className="divide-y divide-[var(--border)]">
          {jobRows.map((r, i) => {
            const rowChecked = phase >= 4
            return (
              <div
                key={i}
                className="flex gap-2.5 px-3 py-1.5 transition-colors duration-300"
                style={{
                  ...fade(phase >= 3, i * 120),
                  backgroundColor: rowChecked
                    ? "rgba(15,23,42,0.04)"
                    : "transparent",
                }}
              >
                <div className="pt-0.5 flex-shrink-0">
                  <span
                    className="flex items-center justify-center w-3.5 h-3.5 rounded border text-[9px]"
                    style={{
                      backgroundColor: rowChecked ? "var(--accent)" : "white",
                      borderColor: rowChecked
                        ? "var(--accent)"
                        : "var(--border-strong)",
                      color: "var(--accent-fg)",
                      transition:
                        "background-color 300ms ease-out, border-color 300ms ease-out",
                    }}
                  >
                    {rowChecked && "✓"}
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
        <div
          className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--border)] bg-black/[0.01]"
          style={fade(phase >= 4)}
        >
          <span className="font-body text-[10px] text-[var(--text-3)]">
            {phase >= 5
              ? isZh
                ? "已保存 2 条"
                : "2 saved"
              : isZh
                ? "已勾选 2 条"
                : "2 selected"}
          </span>
          {phase >= 5 ? (
            <span
              className="font-body text-[10px] font-semibold text-emerald-600"
              style={{ animation: "fade-rise 0.3s ease-out both" }}
            >
              {isZh ? "已入库 ✓" : "Saved ✓"}
            </span>
          ) : (
            <span
              className="font-body text-[10px] font-semibold px-2.5 py-1 rounded-lg text-[var(--accent-fg)] bg-[var(--accent)]"
              style={{
                animation: "fade-rise 0.3s ease-out both",
              }}
            >
              {isZh ? "保存到看板 (2)" : "Save to Kanban (2)"}
            </span>
          )}
        </div>
      </div>

      {/* Assistant plan bubble — lays out the steps it's proposing */}
      <div className="flex justify-start" style={fade(phase >= 6)}>
        <div
          className="bg-[var(--surface)] text-[var(--text)] rounded-2xl rounded-bl-sm px-3.5 py-2
                     text-[12.5px] font-body font-light max-w-[92%] leading-relaxed
                     border border-[var(--border)]"
        >
          {isZh
            ? "已保存 2 条。接下来我会完整调研字节 / 阿里巴巴，对每个 JD 打出 0 — 100 匹配度（含四维拆解），对比 JD 和你的简历找知识缺口，模拟可能的面试问题，再针对性润色简历并生成 PDF。要开始吗？"
            : "2 jobs saved. Next I'll research ByteDance / Alibaba in full, score each JD 0 — 100 (with a 4-axis breakdown), compare each JD to your resume for skill gaps, draft likely interview questions, then tailor the resume + generate a signed-URL PDF. Ready to go?"}
        </div>
      </div>

      {/* User message 2 */}
      <div className="flex justify-end" style={fade(phase >= 7)}>
        <div className="bg-[var(--accent)] text-[var(--accent-fg)] rounded-2xl rounded-br-sm px-3.5 py-2 text-[13px] font-body font-light max-w-[80%]">
          {isZh ? "好，都处理了吧" : "OK, take it from here"}
        </div>
      </div>

      {/* Plan-and-Execute timeline */}
      <div
        className="bg-white rounded-xl border border-[var(--border)] p-3"
        style={fade(phase >= PE_START)}
      >
          <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] pb-1.5 mb-1.5">
            <div className="flex min-w-0 items-center gap-2">
              {allDone ? (
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700">
                  {isZh ? "已完成" : "Done"}
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium bg-indigo-100 text-indigo-700">
                  <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
                  {isZh ? "执行中" : "Running"}
                </span>
              )}
              {runningTool && (
                <span className="truncate font-body text-[10px] text-zinc-600">
                  <span className="font-mono text-zinc-500">{runningTool}</span>
                  {" · "}Step {runningIdx + 1}
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1 font-mono text-[10px] text-zinc-500">
              <span>{planCompleted} / 5</span>
            </div>
          </div>

          <div className="relative">
            <div className="pointer-events-none absolute bottom-2 left-[4px] top-2 w-px bg-zinc-200" />
            {planSteps.map((s, i) => {
              const status = stepStatus(i)
              const isDone = status === "done"
              const isRunning = status === "running"
              const isPending = status === "pending"
              return (
                <div key={i} className="relative flex gap-2.5 py-[1.5px]">
                  <div className="relative z-10 mt-[6px] shrink-0">
                    {isDone && (
                      <span className="block h-2 w-2 rounded-full bg-emerald-500 ring-2 ring-white" />
                    )}
                    {isRunning && (
                      <span className="block h-2 w-2 rounded-full bg-indigo-500 ring-2 ring-white shadow-[0_0_0_4px_rgba(99,102,241,0.18)] animate-pulse" />
                    )}
                    {isPending && (
                      <span className="block h-2 w-2 rounded-full border-[1.5px] border-zinc-300 bg-white" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <span className="w-4 shrink-0 font-mono text-[9px] text-zinc-400">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <span
                        className={`flex-1 text-[11px] leading-snug transition-colors duration-300 ${
                          isDone
                            ? "text-zinc-500"
                            : isPending
                              ? "text-zinc-400"
                              : "font-medium text-zinc-800"
                        }`}
                      >
                        {s.t}
                      </span>
                      {isRunning && (
                        <span className="shrink-0 font-mono text-[9px] text-indigo-600 animate-pulse">
                          {isZh ? "运行中…" : "running…"}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Terminal preview — a single always-on log row so the timeline's
              height stays fixed; contents swap by phase. */}
          <div
            className="mt-1.5 rounded-md border-l-2 border-indigo-400 bg-zinc-50/80 px-2 py-1 font-mono text-[10px] leading-relaxed text-zinc-600 transition-opacity duration-300"
            style={{ opacity: phase >= PE_START ? 1 : 0 }}
          >
            {allDone ? (
              <span className="text-emerald-600">
                ✓ {isZh ? "全部完成 — 产物已回写看板" : "all done — artifacts written to kanban"}
              </span>
            ) : runningTool ? (
              <span className="text-indigo-600">→ {runningTool}</span>
            ) : (
              <span className="text-zinc-400">
                {isZh ? "(等待规划器输出)" : "(waiting for planner)"}
              </span>
            )}
          </div>
        </div>

      {/* Completed kanban card — condensed to two rows to keep the whole
          mock inside one viewport */}
      <div
        className="bg-white rounded-xl px-3 py-2 border border-[var(--border)] shadow-sm"
        style={fade(phase >= 14)}
      >
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="font-body font-semibold text-[13px] text-[var(--text)] leading-tight truncate">
              {isZh ? "字节跳动" : "ByteDance"}
            </span>
            <span className="font-body text-[11px] text-[var(--text-3)] truncate">
              · {isZh ? "AI 产品经理" : "AI Product Manager"}
            </span>
          </div>
          <span className="shrink-0 text-[10px] font-body rounded-full px-2 py-0.5 font-semibold tabular-nums bg-[#dcfce7] text-[#16a34a]">
            {isZh ? "匹配度" : "Match"} 92
          </span>
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1 min-w-0">
            {artifactBadges.map((b, bi) => (
              <span
                key={bi}
                className="inline-flex items-center gap-0.5 text-[10px] font-body
                           rounded-full px-1.5 py-0.5 bg-emerald-50 text-emerald-700
                           border border-emerald-100"
              >
                <span aria-hidden="true">✓</span>
                {b}
              </span>
            ))}
          </div>
          <span className="shrink-0 inline-flex items-center gap-1 text-[10px] font-body
                           bg-[#7c6af5] text-white rounded-full px-2.5 py-1">
            📄 {isZh ? "PDF" : "PDF"}
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

          {/* ── Right: animated product loop mockup ── */}
          <div className="animate-fade-rise-d4 relative">
            <div className="w-full rounded-2xl bg-[var(--card)] border border-[var(--border)] shadow-[0_8px_40px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.03)]">
              <MockChat />
            </div>

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
