"use client"

const palettes = [
  {
    name: "A. Cool Neutral",
    desc: "Linear / Notion 风格 — 干净、专业、无情绪干扰",
    bg: "#F7F7F5",
    card: "#FFFFFF",
    text: "#1A1A1A",
    text2: "rgba(26,26,26,0.55)",
    text3: "rgba(26,26,26,0.35)",
    accent: "#1A1A1A",
    accentFg: "#F7F7F5",
    border: "rgba(0,0,0,0.08)",
  },
  {
    name: "B. Soft Sage",
    desc: "清新、沉稳、有信任感 — 求职场景很贴合",
    bg: "#F0F2ED",
    card: "#FAFBF8",
    text: "#1C2418",
    text2: "rgba(28,36,24,0.50)",
    text3: "rgba(28,36,24,0.32)",
    accent: "#2D3B24",
    accentFg: "#F0F2ED",
    border: "rgba(28,36,24,0.08)",
  },
  {
    name: "C. Cool Blue",
    desc: "Vercel / Stripe 方向 — 科技感强，精密可靠",
    bg: "#F5F7FA",
    card: "#FFFFFF",
    text: "#0F172A",
    text2: "rgba(15,23,42,0.50)",
    text3: "rgba(15,23,42,0.32)",
    accent: "#0F172A",
    accentFg: "#F5F7FA",
    border: "rgba(15,23,42,0.08)",
  },
  {
    name: "D. Warm Ivory",
    desc: "极简化暖色 — 保留温度但更白净现代",
    bg: "#FAFAF7",
    card: "#FFFFFF",
    text: "#18181B",
    text2: "rgba(24,24,27,0.50)",
    text3: "rgba(24,24,27,0.32)",
    accent: "#18181B",
    accentFg: "#FAFAF7",
    border: "rgba(0,0,0,0.06)",
  },
]

function MiniMockup({ p }: { p: (typeof palettes)[0] }) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ background: p.card, border: `1px solid ${p.border}` }}
    >
      {/* Mock header */}
      <div
        className="flex items-center gap-1.5 px-3 py-2"
        style={{ borderBottom: `1px solid ${p.border}` }}
      >
        <div className="w-1.5 h-1.5 rounded-full" style={{ background: "#4ade80" }} />
        <span style={{ fontFamily: "'Barlow', sans-serif", fontSize: 9, color: p.text2 }}>
          AI Agent 在线
        </span>
      </div>
      {/* User msg */}
      <div className="flex justify-end px-3 pt-2">
        <div
          className="rounded-lg px-2.5 py-1"
          style={{ background: p.accent, color: p.accentFg, fontSize: 10, fontFamily: "'Barlow', sans-serif" }}
        >
          帮我找 AI 产品经理岗位
        </div>
      </div>
      {/* Tool card */}
      <div className="px-3 py-2">
        <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${p.border}` }}>
          <div
            className="flex items-center gap-1.5 px-2.5 py-1"
            style={{ background: `color-mix(in srgb, ${p.text} 3%, transparent)`, borderBottom: `1px solid ${p.border}` }}
          >
            <div className="w-1 h-1 rounded-full" style={{ background: "#4ade80" }} />
            <span style={{ fontFamily: "'Barlow', sans-serif", fontSize: 8, color: p.text3, textTransform: "uppercase", letterSpacing: "0.05em" }}>
              Job Search
            </span>
            <span style={{ fontFamily: "'Barlow', sans-serif", fontSize: 8, color: p.text3, marginLeft: "auto" }}>
              12 results
            </span>
          </div>
          {[
            { t: "AI 产品经理", c: "字节跳动", m: 95 },
            { t: "高级产品经理", c: "阿里巴巴", m: 88 },
          ].map((j) => (
            <div
              key={j.t}
              className="flex items-center gap-2 px-2.5 py-1.5"
              style={{ borderBottom: `1px solid ${p.border}` }}
            >
              <div className="flex-1">
                <div style={{ fontFamily: "'Barlow', sans-serif", fontSize: 10, fontWeight: 500, color: p.text }}>{j.t}</div>
                <div style={{ fontFamily: "'Barlow', sans-serif", fontSize: 8, color: p.text3 }}>{j.c}</div>
              </div>
              <span
                className="rounded-full px-1.5 py-0.5"
                style={{
                  fontSize: 8,
                  fontFamily: "'Barlow', sans-serif",
                  fontWeight: 500,
                  background: j.m >= 90 ? "#ecfdf5" : "#fffbeb",
                  color: j.m >= 90 ? "#059669" : "#d97706",
                }}
              >
                {j.m}%
              </span>
            </div>
          ))}
        </div>
      </div>
      {/* AI reply */}
      <div className="flex justify-start px-3 pb-3">
        <div
          className="rounded-lg px-2.5 py-1"
          style={{
            background: `color-mix(in srgb, ${p.text} 4%, transparent)`,
            color: p.text,
            fontSize: 10,
            fontFamily: "'Barlow', sans-serif",
          }}
        >
          字节跳动匹配度 95%，定制简历？
        </div>
      </div>
    </div>
  )
}

export default function PalettePage() {
  return (
    <div style={{ background: "#E8E4DD", minHeight: "100vh", padding: "40px 24px" }}>
      <h1
        style={{
          fontFamily: "'Instrument Serif', serif",
          fontStyle: "italic",
          fontSize: "2.5rem",
          color: "#141210",
          textAlign: "center",
          marginBottom: 8,
        }}
      >
        配色方案对比
      </h1>
      <p
        style={{
          fontFamily: "'Barlow', sans-serif",
          fontSize: 16,
          color: "rgba(20,18,16,0.5)",
          textAlign: "center",
          marginBottom: 48,
        }}
      >
        每个方案展示：背景 → 标题 → 正文 → CTA 按钮 → 产品卡片
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 32,
          maxWidth: 1400,
          margin: "0 auto",
        }}
      >
        {palettes.map((p) => (
          <div
            key={p.name}
            className="rounded-2xl overflow-hidden"
            style={{
              background: p.bg,
              border: `1px solid ${p.border}`,
              boxShadow: "0 4px 24px rgba(0,0,0,0.06)",
            }}
          >
            {/* Section preview */}
            <div style={{ padding: "32px 28px 24px" }}>
              {/* Palette name */}
              <h2
                style={{
                  fontFamily: "'Instrument Serif', serif",
                  fontStyle: "italic",
                  fontSize: "1.75rem",
                  color: p.text,
                  marginBottom: 4,
                  lineHeight: 1.2,
                }}
              >
                {p.name}
              </h2>
              <p
                style={{
                  fontFamily: "'Barlow', sans-serif",
                  fontSize: 13,
                  color: p.text2,
                  marginBottom: 20,
                  lineHeight: 1.5,
                }}
              >
                {p.desc}
              </p>

              {/* Hero preview */}
              <h3
                style={{
                  fontFamily: "'Instrument Serif', serif",
                  fontStyle: "italic",
                  fontWeight: 700,
                  fontSize: "1.5rem",
                  color: p.text,
                  lineHeight: 1.1,
                  marginBottom: 8,
                }}
              >
                你的 AI 求职搭档，
                <br />
                <span style={{ color: p.text3 }}>全程陪跑</span>
              </h3>
              <p
                style={{
                  fontFamily: "'Barlow', sans-serif",
                  fontSize: 13,
                  color: p.text2,
                  marginBottom: 16,
                  lineHeight: 1.6,
                }}
              >
                智能搜索职位、研究公司、定制简历、追踪申请进度
              </p>

              {/* CTA buttons */}
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 24 }}>
                <button
                  style={{
                    fontFamily: "'Barlow', sans-serif",
                    fontSize: 13,
                    fontWeight: 500,
                    background: p.accent,
                    color: p.accentFg,
                    border: "none",
                    borderRadius: 9999,
                    padding: "10px 24px",
                    cursor: "pointer",
                  }}
                >
                  免费开始使用
                </button>
                <span
                  style={{
                    fontFamily: "'Barlow', sans-serif",
                    fontSize: 13,
                    color: p.text2,
                    textDecoration: "underline",
                    textUnderlineOffset: 4,
                  }}
                >
                  了解更多
                </span>
              </div>

              {/* Powered by badges */}
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 24 }}>
                <span style={{ fontFamily: "'Barlow', sans-serif", fontSize: 11, color: p.text3 }}>
                  Powered by
                </span>
                {["DeepSeek", "LangGraph", "mem0"].map((n) => (
                  <span
                    key={n}
                    style={{
                      fontFamily: "'Barlow', sans-serif",
                      fontSize: 10,
                      fontWeight: 500,
                      color: p.text2,
                      background: `color-mix(in srgb, ${p.text} 4%, transparent)`,
                      border: `1px solid ${p.border}`,
                      borderRadius: 9999,
                      padding: "3px 10px",
                    }}
                  >
                    {n}
                  </span>
                ))}
              </div>

              {/* Product mockup */}
              <MiniMockup p={p} />
            </div>

            {/* Color swatches */}
            <div
              style={{
                display: "flex",
                borderTop: `1px solid ${p.border}`,
              }}
            >
              {[
                { label: "bg", color: p.bg },
                { label: "card", color: p.card },
                { label: "text", color: p.text },
                { label: "accent", color: p.accent },
                { label: "border", color: p.border },
              ].map((s) => (
                <div
                  key={s.label}
                  style={{
                    flex: 1,
                    padding: "10px 0",
                    textAlign: "center",
                    borderRight: `1px solid ${p.border}`,
                  }}
                >
                  <div
                    style={{
                      width: 20,
                      height: 20,
                      borderRadius: 6,
                      background: s.color,
                      border: "1px solid rgba(0,0,0,0.1)",
                      margin: "0 auto 4px",
                    }}
                  />
                  <div
                    style={{
                      fontFamily: "'Barlow', sans-serif",
                      fontSize: 9,
                      color: p.text3,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                    }}
                  >
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
