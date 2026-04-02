"use client"

import { useState } from "react"

const faqItems = [
  {
    q: "这个产品免费吗？",
    a: "是的，目前完全免费使用。我们提供 AI 职位搜索、公司调研、简历定制和申请追踪等全部功能。",
  },
  {
    q: "我的数据安全吗？",
    a: "你的数据存储在加密的数据库中，我们不会与第三方共享你的个人信息。你可以随时删除你的账户和所有相关数据。",
  },
  {
    q: "支持哪些招聘平台？",
    a: "目前支持搜索 LinkedIn、Indeed、BOSS直聘、拉勾网等主流平台的职位信息。",
  },
  {
    q: "和直接用 ChatGPT 有什么区别？",
    a: "Job Hunter Agent 专为求职场景设计，具备长期记忆、职位搜索工具、简历定制和申请追踪等专业功能，不需要每次重复描述你的背景。",
  },
  {
    q: "支持英文求职吗？",
    a: "支持！AI 可以用中文或英文与你对话，搜索全球职位，并用相应语言生成求职信和简历。",
  },
]

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      className={`shrink-0 transition-transform duration-300 ease-out ${open ? "rotate-180" : ""}`}
    >
      <path
        d="M5 7.5L10 12.5L15 7.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export default function FAQ() {
  const [openSet, setOpenSet] = useState<Set<number>>(new Set())

  function toggle(index: number) {
    setOpenSet((prev) => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  return (
    <section id="faq" className="w-full max-w-6xl mx-auto px-6 sm:px-8 lg:px-12 py-20 lg:py-28">
      <div className="max-w-2xl">
        <h2 className="font-heading italic text-[var(--text)] text-3xl sm:text-4xl lg:text-5xl tracking-tight mb-12 lg:mb-16">
          常见问题
        </h2>

        <div className="flex flex-col">
          {faqItems.map((item, i) => {
            const isOpen = openSet.has(i)
            return (
              <div key={i} className="border-b border-[var(--border)]">
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  className="w-full flex items-center justify-between gap-4 py-5 text-left cursor-pointer group"
                >
                  <span className="font-body text-[var(--text)] text-base sm:text-lg font-medium leading-snug group-hover:text-[var(--text-2)] transition-colors">
                    {item.q}
                  </span>
                  <ChevronIcon open={isOpen} />
                </button>

                <div
                  className="grid transition-[grid-template-rows] duration-300 ease-out"
                  style={{
                    gridTemplateRows: isOpen ? "1fr" : "0fr",
                  }}
                >
                  <div className="overflow-hidden">
                    <p className="font-body text-[var(--text-2)] text-base font-light leading-relaxed pb-5">
                      {item.a}
                    </p>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
