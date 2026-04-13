"use client"

import { useLanguage } from "@/contexts/LanguageContext"

interface Testimonial {
  zh: string
  en: string
  name: string
  role: string
  avatar: string
}

const row1: Testimonial[] = [
  {
    zh: "用了两周就拿到了 3 个面试，AI 帮我针对每个岗位定制简历，省了大量时间。以前海投 100 份才有 1 个回复。",
    en: "Used it for two weeks and landed 3 interviews. The AI tailored my resume for each role — saved me hours. Before this I'd send 100 apps and hear back from maybe one.",
    name: "Marcus Chen",
    role: "Frontend Engineer · San Francisco",
    avatar: "https://i.pravatar.cc/80?img=11",
  },
  {
    zh: "最惊喜的是长期记忆功能——换了新会话它还记得我的背景，不用每次重复介绍自己。感觉像有个真人助手。",
    en: "The long-term memory blew my mind — it remembered my background across sessions without me repeating anything. Feels like having an actual career coach.",
    name: "Sarah Mitchell",
    role: "Product Manager · New York",
    avatar: "https://i.pravatar.cc/80?img=32",
  },
  {
    zh: "公司调研功能帮我避开了一个评价很差的公司，面试前对目标公司了如指掌，面试官都惊了。",
    en: "Company research helped me dodge a toxic workplace. Went into every interview knowing the funding stage, culture reviews, and team size. The interviewer was impressed.",
    name: "James Rodriguez",
    role: "Data Scientist · Austin",
    avatar: "https://i.pravatar.cc/80?img=53",
  },
  {
    zh: "投了 30 多家公司全部用看板管理，再也不会漏掉任何一个进度更新。这才是求职该有的效率。",
    en: "Applied to 30+ companies and tracked every single one on the kanban board. Never missed a follow-up again. This is how job hunting should work.",
    name: "Priya Sharma",
    role: "Backend Developer · London",
    avatar: "https://i.pravatar.cc/80?img=44",
  },
  {
    zh: "简历工坊功能太强了，根据 JD 自动调整关键词和经历排序，ATS 通过率明显提升。",
    en: "The resume studio is incredible — it automatically adjusts keywords and reorders experience to match each JD. My ATS pass rate went through the roof.",
    name: "Daniel Park",
    role: "DevOps Engineer · Seattle",
    avatar: "https://i.pravatar.cc/80?img=60",
  },
]

const row2: Testimonial[] = [
  {
    zh: "AI 写的求职信比我自己写的好太多了，而且它了解我的背景后越写越精准，第三封就拿到了回复。",
    en: "The cover letters it writes are way better than what I could do myself. After it learned my background, each one got more precise. Got a response on the third try.",
    name: "Alex Thompson",
    role: "ML Engineer · Remote",
    avatar: "https://i.pravatar.cc/80?img=59",
  },
  {
    zh: "作为留学生找工作很迷茫，这个工具帮我理解了招聘平台的逻辑，两个月内顺利入职。",
    en: "As an international student job hunting was overwhelming. This tool decoded the whole process for me — had an offer within two months.",
    name: "Yuki Tanaka",
    role: "UX Designer · Tokyo",
    avatar: "https://i.pravatar.cc/80?img=25",
  },
  {
    zh: "每天早上自动推送匹配职位，比我自己刷招聘 App 高效 10 倍。已经推荐给了整个求职群。",
    en: "Every morning it pushes matched positions to me automatically. 10x more efficient than scrolling through job boards myself. Already recommended it to my entire cohort.",
    name: "Sophie Laurent",
    role: "Marketing Manager · Paris",
    avatar: "https://i.pravatar.cc/80?img=5",
  },
  {
    zh: "面试前用公司调研跑一遍，薪资范围、技术栈、团队规模全都有，谈 offer 的时候特别有底气。",
    en: "Before every interview I ran the company research tool — salary ranges, tech stack, team size, all there. Negotiated my offer with total confidence.",
    name: "David Kim",
    role: "Full-stack Developer · Toronto",
    avatar: "https://i.pravatar.cc/80?img=68",
  },
  {
    zh: "从海投到精准投递的转变太大了，AI 帮我筛掉了不匹配的岗位，每一份申请都有质量。",
    en: "Went from spray-and-pray to targeted applications. The AI filtered out bad fits so every application I sent actually mattered. Quality over quantity.",
    name: "Emma Wilson",
    role: "iOS Developer · Berlin",
    avatar: "https://i.pravatar.cc/80?img=9",
  },
]

const scrollStyles = `
@keyframes scroll-left {
  0%   { transform: translateX(0); }
  100% { transform: translateX(-50%); }
}
@keyframes scroll-right {
  0%   { transform: translateX(-50%); }
  100% { transform: translateX(0); }
}
`

function Card({ item, locale }: { item: Testimonial; locale: string }) {
  const quote = locale === "zh-CN" ? item.zh : item.en
  return (
    <div className="flex flex-col justify-between w-[320px] shrink-0 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-5">
      <p className="font-body text-[14px] text-[var(--text)] leading-relaxed mb-5">
        &ldquo;{quote}&rdquo;
      </p>
      <div className="flex items-center gap-3">
        <img
          src={item.avatar}
          alt={item.name}
          className="w-8 h-8 rounded-full object-cover shrink-0"
          loading="lazy"
        />
        <div>
          <div className="font-body text-[13px] font-medium text-[var(--text)]">{item.name}</div>
          <div className="font-body text-[11px] text-[var(--text-3)]">{item.role}</div>
        </div>
      </div>
    </div>
  )
}

function ScrollTrack({
  items,
  direction,
  duration,
  locale,
}: {
  items: Testimonial[]
  direction: "left" | "right"
  duration: string
  locale: string
}) {
  const doubled = [...items, ...items]
  return (
    <div
      className="flex gap-4 w-max"
      style={{ animation: `scroll-${direction} ${duration} linear infinite` }}
      onMouseEnter={(e) => { e.currentTarget.style.animationPlayState = "paused" }}
      onMouseLeave={(e) => { e.currentTarget.style.animationPlayState = "running" }}
    >
      {doubled.map((item, i) => (
        <Card key={`${item.name}-${i}`} item={item} locale={locale} />
      ))}
    </div>
  )
}

export default function Testimonials() {
  const { locale, t } = useLanguage()

  return (
    <section className="py-24 md:py-32 overflow-hidden">
      <style>{scrollStyles}</style>

      <div className="mx-auto max-w-6xl px-6 sm:px-8 lg:px-12 mb-12 md:mb-16">
        <h2 className="font-heading italic text-3xl sm:text-4xl md:text-5xl tracking-tight text-[var(--text)]">
          {t("lp_testimonials_title")}
        </h2>
      </div>

      <div className="relative">
        <div className="absolute left-0 top-0 bottom-0 w-16 sm:w-28 z-10 pointer-events-none" style={{ background: "linear-gradient(to right, var(--bg), transparent)" }} />
        <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-28 z-10 pointer-events-none" style={{ background: "linear-gradient(to left, var(--bg), transparent)" }} />

        <div className="flex flex-col gap-4">
          <ScrollTrack items={row1} direction="left" duration="45s" locale={locale} />
          <ScrollTrack items={row2} direction="right" duration="50s" locale={locale} />
        </div>
      </div>
    </section>
  )
}
