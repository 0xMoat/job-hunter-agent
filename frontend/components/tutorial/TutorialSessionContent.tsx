"use client"

import { useLanguage } from "@/contexts/LanguageContext"
import { MessageBubble } from "@/components/chat/MessageBubble"
import { PlanTimelineView } from "@/components/plan/PlanTimeline"
import type { ChatMessage, PlanExecuteView, ToolCallEntry } from "@/lib/types"

function buildJobSearchEntry(locale: string): ToolCallEntry {
  const resultsZh = [
    { title: "AI Engineer · 星云智能 · 上海", link: "https://example.com/job/001",
      snippet: "5 年 LangGraph 经验，负责 Agent 产品研发，25-50k/月。" },
    { title: "Agentic Platform Lead · 洞见科技 · 上海", link: "https://example.com/job/002",
      snippet: "主导 Agent 平台 0-1 搭建，技术栈 Python/LangChain，35-60k/月。" },
    { title: "LLM 应用工程师 · 智源研究院 · 上海", link: "https://example.com/job/003",
      snippet: "RAG + 工具调用方向，熟悉 OpenAI / Anthropic API，30-55k/月。" },
  ]
  const resultsEn = [
    { title: "AI Engineer · Nebula Intelligence · San Francisco", link: "https://example.com/job/001",
      snippet: "5+ yrs LangGraph; own agent product roadmap. $180-240k." },
    { title: "Agentic Platform Lead · Insight Tech · San Francisco", link: "https://example.com/job/002",
      snippet: "0-1 agent platform; Python/LangChain stack. $200-260k." },
    { title: "LLM Applications Engineer · Beacon AI · San Francisco", link: "https://example.com/job/003",
      snippet: "RAG + tool calling; OpenAI/Anthropic API expertise. $190-250k." },
  ]
  const payload = {
    keywords: "Agent Engineer",
    location: locale === "zh-CN" ? "上海" : "San Francisco",
    intro_text: locale === "zh-CN"
      ? "这是我为你找到的 3 个职位，勾选你感兴趣的即可保存到看板。"
      : "Here are 3 matching roles — tick the ones you'd like and I'll save them to your kanban.",
    results: locale === "zh-CN" ? resultsZh : resultsEn,
  }
  return {
    toolCallId: "tut-job-search-1",
    toolName: "job_search_tool",
    callingContent: JSON.stringify({ query: payload.keywords, location: payload.location }),
    resultContent: JSON.stringify(payload),
    status: "done",
  }
}

function buildMsg(id: string, role: "user" | "assistant", text: string, tools: ToolCallEntry[] = []): ChatMessage {
  return {
    id,
    role,
    textContent: text,
    toolCalls: tools,
  }
}

function buildPlanView(t: (key: string, ...args: unknown[]) => string): PlanExecuteView {
  return {
    steps: [
      { id: "tut-s1", text: t("tut_pe_plan_1"), status: "done" },
      { id: "tut-s2", text: t("tut_pe_plan_2"), status: "done" },
      { id: "tut-s3", text: t("tut_pe_plan_3"), status: "done" },
    ],
    finalResponse: t("tut_assistant_done"),
    errorMsg: null,
    running: false,
    threadId: null,
    awaitingApproval: false,
    approvalRound: 0,
    revisionReason: null,
    cancelled: false,
  }
}

export function TutorialSessionContent() {
  const { t, locale } = useLanguage()
  const jobSearch = buildJobSearchEntry(locale)

  const m1u = buildMsg("tut-u-1", "user", t("tut_user_1"))
  const m1a = buildMsg("tut-a-1", "assistant", t("tut_assistant_1"), [jobSearch])
  const m2a = buildMsg("tut-a-2", "assistant", t("tut_assistant_2"))
  const m2u = buildMsg("tut-u-2", "user", t("tut_user_2"))
  const mDone = buildMsg("tut-a-3", "assistant", t("tut_assistant_done"))

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <MessageBubble message={m1u} />
      <MessageBubble message={m1a} />
      <MessageBubble message={m2a} />
      <MessageBubble message={m2u} />

      <PlanTimelineView view={buildPlanView(t)} />

      <MessageBubble message={mDone} />
    </div>
  )
}
