"use client"

import { useLanguage } from "@/contexts/LanguageContext"

/* ------------------------------------------------------------------ */
/*  Stage 01 — Discover (mirrors JobSearchResultCard)                  */
/* ------------------------------------------------------------------ */

function DiscoverMockup() {
  const { locale } = useLanguage()
  const isZh = locale === "zh-CN"

  const rows = isZh
    ? [
        { title: "AI 产品经理", snippet: "负责 LLM 应用产品的 0 → 1，3+ 年产品经验…", domain: "bytedance.com", state: "checked" },
        { title: "高级产品经理 - AI", snippet: "带领团队推进 AI 增值服务的落地…", domain: "alibaba.com", state: "checked" },
        { title: "AI Product Lead", snippet: "Build and scale Moonshot's consumer AI…", domain: "moonshot.cn", state: "saved" },
      ]
    : [
        { title: "AI Product Manager", snippet: "Own LLM app 0 → 1, 3+ yrs PM exp…", domain: "bytedance.com", state: "checked" },
        { title: "Senior PM - AI", snippet: "Lead AI monetization features to launch…", domain: "alibaba.com", state: "checked" },
        { title: "AI Product Lead", snippet: "Build and scale Moonshot's consumer AI…", domain: "moonshot.cn", state: "saved" },
      ]

  const intro = isZh
    ? "3 条强匹配已按你的偏好重排，第 1 条与你的 LLM 产品经验对齐度最高。"
    : "3 strong matches reranked for your profile — row 1 aligns best with your LLM PM experience."

  return (
    <div className="w-full rounded-xl bg-white border border-[var(--border)] overflow-hidden shadow-[0_6px_30px_rgba(15,23,42,0.05)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]">
        <span className="w-[7px] h-[7px] rounded-full bg-emerald-500 flex-shrink-0" />
        <span className="font-body font-semibold text-xs text-[var(--text-2)]">Job Search</span>
        <span className="font-mono text-[10px] text-[var(--text-3)] truncate">
          {isZh ? "AI 产品经理 · 上海" : "AI Product Manager · Shanghai"}
        </span>
        <span className="ml-auto font-mono text-[10px] text-[var(--text-3)]">
          {isZh ? "3 条结果" : "3 results"}
        </span>
      </div>

      {/* AI intro banner */}
      <div className="flex items-start gap-2 px-4 py-2.5 text-[11px] leading-relaxed
                      bg-[#eeebff] text-[#2c2a7a] border-b border-[var(--border)]">
        <span aria-hidden="true">💡</span>
        <span>{intro}</span>
      </div>

      {/* Result rows */}
      <div className="divide-y divide-[var(--border)]">
        {rows.map((r, i) => {
          const isSaved = r.state === "saved"
          const isChecked = r.state === "checked"
          return (
            <div
              key={i}
              className={`flex gap-3 px-4 py-2.5 ${
                isSaved ? "opacity-60" : isChecked ? "bg-[var(--accent)]/[0.04]" : ""
              }`}
            >
              <div className="pt-0.5 flex-shrink-0">
                {isSaved ? (
                  <span className="flex items-center justify-center w-4 h-4 rounded bg-emerald-500 text-white text-[10px]">
                    ✓
                  </span>
                ) : (
                  <span
                    className={`flex items-center justify-center w-4 h-4 rounded border ${
                      isChecked
                        ? "bg-[var(--accent)] border-[var(--accent)] text-[var(--accent-fg)] text-[10px]"
                        : "border-[var(--border-strong)]"
                    }`}
                  >
                    {isChecked && "✓"}
                  </span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="font-body font-semibold text-xs text-[var(--text)] leading-snug line-clamp-1">
                  {r.title}
                </p>
                <p className="font-body text-[10px] text-[var(--text-3)] mt-0.5 line-clamp-1 leading-relaxed">
                  {r.snippet}
                </p>
                <span className="inline-block mt-1 font-mono text-[9px] text-[var(--accent)] opacity-60">
                  {r.domain} ↗
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between px-4 py-2.5 border-t border-[var(--border)] bg-black/[0.01]">
        <span className="font-body text-[10px] text-[var(--text-3)]">
          {isZh ? "已勾选 2 条" : "2 selected"}
        </span>
        <span className="font-body text-[10px] font-semibold px-3 py-1.5 rounded-lg text-[var(--accent-fg)] bg-[var(--accent)]">
          {isZh ? "保存到看板 (2)" : "Save to Kanban (2)"}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Stage 02 — Analyze (mirrors ApplicationDetailDrawer sections)      */
/* ------------------------------------------------------------------ */

function AnalyzeMockup() {
  const { locale } = useLanguage()
  const isZh = locale === "zh-CN"

  const dims = isZh
    ? [
        { label: "技能匹配", score: 9, reason: "Python / LLM / 产品方法论完整" },
        { label: "经验匹配", score: 8, reason: "3 年 PM 经验，略低于 5 年偏好" },
        { label: "领域契合", score: 10, reason: "AI 消费级产品背景高度契合" },
        { label: "软性要求", score: 7, reason: "跨团队协作证据充分" },
      ]
    : [
        { label: "Skills", score: 9, reason: "Python / LLM / PM methodology covered" },
        { label: "Experience", score: 8, reason: "3 yrs PM, slightly below 5-yr pref" },
        { label: "Domain fit", score: 10, reason: "Consumer AI product exp aligns" },
        { label: "Soft req.", score: 7, reason: "Cross-team collaboration shown" },
      ]

  const questions = isZh
    ? [
        { q: "介绍一次你主导 LLM 产品从 0 到 1 的经历", f: "项目主导能力" },
        { q: "如何衡量一个 AI 助手产品的核心指标？", f: "北极星指标设计" },
      ]
    : [
        { q: "Tell us about leading an LLM product from 0 to 1", f: "Ownership" },
        { q: "How do you measure an AI assistant's core metrics?", f: "Metric design" },
      ]

  return (
    <div className="w-full rounded-xl bg-white border border-[var(--border)] p-4 shadow-[0_6px_30px_rgba(15,23,42,0.05)]">
      {/* Match section */}
      <div className="mb-4">
        <h4 className="font-body font-semibold text-[11px] text-[var(--text)] uppercase tracking-wide mb-2">
          {isZh ? "匹配度" : "JD Match"}
        </h4>
        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-[11px] text-[var(--text-3)]">{isZh ? "总分" : "Total"}</span>
          <span className="text-2xl font-semibold tabular-nums text-[var(--text)]">90</span>
          <span className="text-xs text-[var(--text-3)]">/ 100</span>
        </div>
        <div className="space-y-1.5">
          {dims.map((d, i) => {
            const pct = Math.round((d.score / 10) * 100)
            return (
              <div key={i} className="space-y-0.5">
                <div className="flex items-center justify-between text-[10px] font-body">
                  <span className="text-[var(--text-2)]">{d.label}</span>
                  <span className="tabular-nums text-[var(--text-3)]">{d.score}/10</span>
                </div>
                <div className="h-1.5 bg-black/[0.06] rounded-full overflow-hidden">
                  <div className="h-full bg-[#7c6af5]" style={{ width: `${pct}%` }} />
                </div>
                <p className="text-[10px] text-[var(--text-3)] leading-snug">{d.reason}</p>
              </div>
            )
          })}
        </div>
      </div>

      {/* Divider */}
      <div className="border-t border-[var(--border)] my-3" />

      {/* Interview questions */}
      <div>
        <h4 className="font-body font-semibold text-[11px] text-[var(--text)] uppercase tracking-wide mb-2">
          {isZh ? "面试问题" : "Interview Q"}
        </h4>
        <ol className="list-decimal pl-5 space-y-1.5">
          {questions.map((item, i) => (
            <li key={i} className="text-[11px] text-[var(--text)] leading-relaxed">
              <p>{item.q}</p>
              <p className="text-[10px] text-[var(--text-3)] mt-0.5">🎯 {item.f}</p>
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Stage 03 — Tailor (mirrors Resume Studio + PDF button)             */
/* ------------------------------------------------------------------ */

function TailorMockup() {
  const { locale } = useLanguage()
  const isZh = locale === "zh-CN"

  const markdown = isZh
    ? `# 林昊 · AI 产品经理
上海 · lin.hao@example.com · (+86) 138-XXXX-1234

## 工作经历

**字节跳动  |  高级产品经理**   2024 — 至今
- 主导 LLM 助手产品从 0 到 1，月活达 200 万
- 设计多轮对话评估框架，用户留存提升 34%
- 与算法 / 工程 / 设计三方协同，推动 12 个大版本上线

**Moonshot AI  |  产品经理**   2022 — 2024
- 负责长文本模型 C 端产品线…`
    : `# Lin Hao · AI Product Manager
Shanghai · lin.hao@example.com · (+86) 138-XXXX-1234

## Experience

**ByteDance  |  Senior Product Manager**   2024 — Present
- Led LLM assistant product 0 → 1 to 2M MAU
- Designed multi-turn eval framework, +34% retention
- Cross-functional work across ML / Eng / Design for 12 major releases

**Moonshot AI  |  Product Manager**   2022 — 2024
- Owned the long-context model C-side product line…`

  return (
    <div className="w-full rounded-xl bg-white border border-[var(--border)] p-4 shadow-[0_6px_30px_rgba(15,23,42,0.05)]">
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-blue-500" />
          <span className="font-body text-[10px] font-semibold text-[var(--text-2)] uppercase tracking-widest">
            Resume Studio
          </span>
        </div>
        <span className="font-body text-[10px] text-[var(--text-3)]">
          {isZh ? "已匹配 6 项关键词" : "6 keywords matched"}
        </span>
      </div>

      {/* Markdown body */}
      <pre className="font-body text-[10.5px] text-[var(--text-2)] whitespace-pre-wrap
                      leading-relaxed bg-black/[0.03] rounded-lg p-3 max-h-56 overflow-hidden">
        {markdown}
      </pre>

      {/* PDF button + signed-link hint */}
      <div className="flex items-center justify-between mt-3">
        <span className="font-mono text-[9px] text-[var(--text-3)]">
          {isZh ? "签名链接 · 24h 有效" : "Signed URL · 24h expiry"}
        </span>
        <span className="inline-flex items-center gap-1 text-[11px] font-body
                         bg-[#7c6af5] text-white rounded-full px-3 py-1.5">
          📄 {isZh ? "下载 PDF" : "Download PDF"}
        </span>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Stage 04 — Execute (mirrors PlanTimeline + PlanStepRow)            */
/* ------------------------------------------------------------------ */

function ExecuteMockup() {
  const { locale } = useLanguage()
  const isZh = locale === "zh-CN"

  const steps = isZh
    ? [
        { s: "done", t: "拉取看板上 3 张待处理卡片" },
        { s: "done", t: "调研字节跳动（卡片 #12）" },
        { s: "done", t: "评估卡片 #12 的匹配度" },
        { s: "done", t: "生成卡片 #12 缺口分析" },
        { s: "running", t: "为卡片 #12 润色简历" },
        { s: "pending", t: "生成 PDF（卡片 #12）" },
        { s: "pending", t: "对卡片 #13 重复研究与润色流程" },
      ]
    : [
        { s: "done", t: "Fetch 3 pending cards from the kanban" },
        { s: "done", t: "Research ByteDance (card #12)" },
        { s: "done", t: "Score match for card #12" },
        { s: "done", t: "Generate skill gap for card #12" },
        { s: "running", t: "Tailor resume for card #12" },
        { s: "pending", t: "Generate PDF (card #12)" },
        { s: "pending", t: "Repeat research + tailor flow on card #13" },
      ]

  return (
    <div className="w-full rounded-xl bg-white border border-[var(--border)] p-4 shadow-[0_6px_30px_rgba(15,23,42,0.05)]">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] pb-2 mb-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium bg-indigo-100 text-indigo-700">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
            Running
          </span>
          <span className="truncate font-body text-[10px] text-zinc-600">
            <span className="font-mono text-zinc-500">trigger_resume_studio_skill</span>
            {" · "}Step 5
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 font-mono text-[10px] text-zinc-500">
          <span>5 / 7</span>
          <span>·</span>
          <span>01:42</span>
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        <div className="pointer-events-none absolute bottom-3 left-[5px] top-3 w-px bg-zinc-200" />
        {steps.map((s, i) => {
          const isDone = s.s === "done"
          const isRunning = s.s === "running"
          const isPending = s.s === "pending"
          return (
            <div key={i} className="relative flex gap-3 py-1">
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
                  <span className="w-5 shrink-0 font-mono text-[9px] text-zinc-400">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span
                    className={`flex-1 text-[11px] leading-relaxed ${
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
                    <span className="shrink-0 font-mono text-[9px] text-indigo-600">
                      01:08 running…
                    </span>
                  )}
                </div>
                {isRunning && (
                  <div className="mt-1 ml-7 rounded-md border-l-2 border-indigo-400 bg-zinc-50/80 px-2 py-1 font-mono text-[10px] leading-relaxed text-zinc-600">
                    <span className="text-indigo-600">→ Resume Studio</span>
                    <span className="text-zinc-500">
                      {' {application_id: 12, jd: "AI PM @ ByteDance"…'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Stage 05 — Track (mirrors KanbanBoard with real KanbanCard shape)  */
/* ------------------------------------------------------------------ */

function TrackMockup() {
  const { locale } = useLanguage()
  const isZh = locale === "zh-CN"

  const columns = [
    {
      label: isZh ? "待处理" : "Pending",
      count: 4,
      cards: [
        {
          company: "字节跳动",
          title: isZh ? "AI 产品经理" : "AI Product Manager",
          score: 92,
          badges: 2,
          source: "chat",
        },
        {
          company: "Moonshot AI",
          title: isZh ? "高级产品经理" : "Senior PM",
          score: 84,
          badges: 3,
          source: "scheduler",
        },
      ],
    },
    {
      label: isZh ? "已完成" : "Completed",
      count: 2,
      cards: [
        {
          company: "阿里巴巴",
          title: isZh ? "AI 产品专家" : "AI PM Expert",
          score: 88,
          badges: 5,
          source: "chat",
        },
      ],
    },
    {
      label: isZh ? "不匹配" : "Not a Match",
      count: 1,
      cards: [],
    },
  ]

  const badgeLabels = isZh
    ? ["公司调研", "缺口", "面试", "简历", "PDF"]
    : ["Research", "Gap", "Interview", "Resume", "PDF"]

  return (
    <div className="w-full rounded-xl bg-white border border-[var(--border)] p-3 shadow-[0_6px_30px_rgba(15,23,42,0.05)]">
      <div className="flex gap-2.5">
        {columns.map((col, ci) => (
          <div key={ci} className="flex-1 flex flex-col min-w-0">
            {/* Column header */}
            <div className="flex items-center justify-between mb-2 px-1">
              <span className="font-body text-[10px] font-medium text-[var(--text-2)]">
                {col.label}
              </span>
              <span className="font-body text-[9px] text-[var(--text-3)]">{col.count}</span>
            </div>

            {/* Cards */}
            <div className="space-y-1.5">
              {col.cards.map((c, i) => {
                const matchClass =
                  c.score >= 80
                    ? "bg-[#dcfce7] text-[#16a34a]"
                    : c.score >= 60
                      ? "bg-[#fef9c3] text-[#a16207]"
                      : "bg-black/5 text-[#999]"
                const sourceClass =
                  c.source === "scheduler"
                    ? "bg-[#ede9ff] text-[#7c6af5]"
                    : "bg-[#fef3c7] text-[#b45309]"
                return (
                  <div
                    key={i}
                    className="bg-white rounded-lg p-2 border border-[var(--border)] shadow-sm"
                  >
                    <div className="flex items-start justify-between gap-1 mb-0.5">
                      <span className="font-body font-semibold text-[10px] text-[var(--text)] leading-tight truncate">
                        {c.company}
                      </span>
                      <div className="flex items-center gap-1 shrink-0">
                        <span
                          className={`text-[8px] font-body rounded-full px-1.5 py-0.5 font-semibold tabular-nums ${matchClass}`}
                        >
                          {isZh ? "匹配度" : "Match"} {c.score}
                        </span>
                        <span
                          className={`text-[8px] font-body rounded-full px-1.5 py-0.5 ${sourceClass}`}
                        >
                          {c.source === "scheduler"
                            ? isZh
                              ? "调度"
                              : "Auto"
                            : isZh
                              ? "对话"
                              : "Chat"}
                        </span>
                      </div>
                    </div>
                    <p className="font-body text-[9px] text-[var(--text-3)] mb-1.5 line-clamp-1">
                      {c.title}
                    </p>
                    {c.badges > 0 && (
                      <div className="flex flex-wrap gap-0.5">
                        {badgeLabels.slice(0, c.badges).map((b, bi) => (
                          <span
                            key={bi}
                            className="inline-flex items-center gap-0.5 text-[8px] font-body
                                       rounded-full px-1.5 py-0.5 bg-emerald-50 text-emerald-700
                                       border border-emerald-100"
                          >
                            <span aria-hidden="true">✓</span>
                            {b}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
              {col.cards.length === 0 && (
                <div className="h-14 rounded-lg bg-black/[0.02] border border-dashed border-[var(--border)]" />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Mockup registry                                                   */
/* ------------------------------------------------------------------ */

const mockups = [DiscoverMockup, AnalyzeMockup, TailorMockup, ExecuteMockup, TrackMockup]

/* ------------------------------------------------------------------ */
/*  Section                                                           */
/* ------------------------------------------------------------------ */

export default function Features() {
  const { t } = useLanguage()

  const stages = [
    { tag: t("lp_stage_01_tag"), title: t("lp_feat_01_title"), description: t("lp_feat_01_desc") },
    { tag: t("lp_stage_02_tag"), title: t("lp_feat_02_title"), description: t("lp_feat_02_desc") },
    { tag: t("lp_stage_03_tag"), title: t("lp_feat_03_title"), description: t("lp_feat_03_desc") },
    { tag: t("lp_stage_04_tag"), title: t("lp_feat_04_title"), description: t("lp_feat_04_desc") },
    { tag: t("lp_stage_05_tag"), title: t("lp_feat_05_title"), description: t("lp_feat_05_desc") },
  ]

  return (
    <section
      id="features"
      className="relative py-32 max-w-6xl mx-auto px-6 sm:px-8 lg:px-12"
    >
      {/* Section heading */}
      <h2 className="font-heading text-4xl sm:text-5xl md:text-6xl tracking-tight text-[--text] mb-8 max-w-[620px]">
        {t("lp_feat_title_1")}
        <br />
        <em className="italic">{t("lp_feat_title_2")}</em>
      </h2>
      <p className="font-body text-lg sm:text-xl text-[--text-2] mb-24 max-w-[520px] leading-relaxed">
        {t("lp_feat_sub")}
      </p>

      {/* Stage rows — alternating layout */}
      <div className="space-y-24 md:space-y-36">
        {stages.map((stage, index) => {
          const isEven = index % 2 === 1
          const Mockup = mockups[index]
          return (
            <div key={stage.title} className="feature-row">
              <div
                className={`flex flex-col gap-8 md:gap-12 ${
                  isEven ? "md:flex-row-reverse" : "md:flex-row"
                } md:items-center`}
              >
                {/* Text block */}
                <div className={`flex-1 ${isEven ? "md:pl-8 lg:pl-16" : "md:pr-8 lg:pr-16"}`}>
                  {/* Stage index + tag */}
                  <div className="flex items-baseline gap-3 mb-4">
                    <span className="font-mono text-sm tracking-widest text-[--text-3]">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="font-body text-xs uppercase tracking-[0.2em] text-[--text-3]">
                      —
                    </span>
                    <span className="font-heading italic text-base text-[--accent]">
                      {stage.tag}
                    </span>
                  </div>

                  <h3 className="font-heading text-3xl sm:text-4xl text-[--text] mb-4 leading-tight">
                    {stage.title}
                  </h3>

                  <p className="font-body text-base sm:text-lg text-[--text-2] leading-relaxed max-w-[440px]">
                    {stage.description}
                  </p>
                </div>

                {/* Mockup */}
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
