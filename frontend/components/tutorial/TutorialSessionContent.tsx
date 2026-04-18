"use client"

import { useLanguage } from "@/contexts/LanguageContext"
import { MessageBubble } from "@/components/chat/MessageBubble"
import type { ChatMessage, PlanExecuteView, ToolCallEntry } from "@/lib/types"

const JOB_URLS = [
  "https://example.com/job/001",
  "https://example.com/job/002",
  "https://example.com/job/003",
]

function buildJobSearchEntry(locale: string): ToolCallEntry {
  const resultsZh = [
    { title: "AI Engineer · 星云智能 · 上海", link: JOB_URLS[0],
      snippet: "5 年 LangGraph 经验，负责 Agent 产品研发，25-50k/月。" },
    { title: "Agentic Platform Lead · 洞见科技 · 上海", link: JOB_URLS[1],
      snippet: "主导 Agent 平台 0-1 搭建，技术栈 Python/LangChain，35-60k/月。" },
    { title: "LLM 应用工程师 · 智源研究院 · 上海", link: JOB_URLS[2],
      snippet: "RAG + 工具调用方向，熟悉 OpenAI / Anthropic API，30-55k/月。" },
  ]
  const resultsEn = [
    { title: "AI Engineer · Nebula Intelligence · San Francisco", link: JOB_URLS[0],
      snippet: "5+ yrs LangGraph; own agent product roadmap. $180-240k." },
    { title: "Agentic Platform Lead · Insight Tech · San Francisco", link: JOB_URLS[1],
      snippet: "0-1 agent platform; Python/LangChain stack. $200-260k." },
    { title: "LLM Applications Engineer · Beacon AI · San Francisco", link: JOB_URLS[2],
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

function buildPlanExecuteToolCall(t: (k: string, ...a: unknown[]) => string): ToolCallEntry {
  return {
    toolCallId: "tut-pe-1",
    toolName: "start_plan_execute",
    callingContent: JSON.stringify({ goal: t("tut_pe_goal") }, null, 2),
    resultContent: JSON.stringify({ ok: true }),
    status: "done",
  }
}

function buildPlanView(t: (k: string, ...a: unknown[]) => string): PlanExecuteView {
  return {
    steps: [
      { id: "tut-s1", text: t("tut_pe_plan_1"), status: "done" },
      { id: "tut-s2", text: t("tut_pe_plan_2"), status: "done" },
      { id: "tut-s3", text: t("tut_pe_plan_3"), status: "done" },
      { id: "tut-s4", text: t("tut_pe_plan_4"), status: "done" },
      { id: "tut-s5", text: t("tut_pe_plan_5"), status: "done" },
      { id: "tut-s6", text: t("tut_pe_plan_6"), status: "done" },
    ],
    finalResponse: t("tut_pe_final_md"),
    errorMsg: null,
    running: false,
    threadId: null,
    awaitingApproval: false,
    approvalRound: 0,
    revisionReason: null,
    cancelled: false,
  }
}

function buildMsg(
  id: string,
  role: "user" | "assistant",
  text: string,
  tools: ToolCallEntry[] = [],
  planExecute?: PlanExecuteView,
): ChatMessage {
  return { id, role, textContent: text, toolCalls: tools, planExecute }
}

export function TutorialSessionContent() {
  const { t, locale } = useLanguage()
  const jobSearch = buildJobSearchEntry(locale)
  const peToolCall = buildPlanExecuteToolCall(t)
  const planView = buildPlanView(t)

  const m1u = buildMsg("tut-u-1", "user", t("tut_user_1"))
  // Assistant's first turn: intro text + job_search_tool result card.
  const m1a = buildMsg("tut-a-1", "assistant", t("tut_assistant_1"), [jobSearch])
  // Assistant's second turn: short follow-up text; chips will render below it
  // because we pass savedUrlsInKanban matching the job-search result URLs.
  const m2a = buildMsg("tut-a-2", "assistant", t("tut_assistant_2"), [jobSearch])
  const m2u = buildMsg("tut-u-2", "user", t("tut_user_2"))
  // Assistant's final turn: start_plan_execute tool call + plan timeline view.
  const m3a = buildMsg("tut-a-3", "assistant", "", [peToolCall], planView)

  // Stub callback: the tutorial session is read-only, so chip clicks do nothing.
  const noop = () => {}

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <MessageBubble message={m1u} />
      <MessageBubble message={m1a} />
      <MessageBubble
        message={m2a}
        savedUrlsInKanban={new Set(JOB_URLS)}
        onPickFollowupPrompt={noop}
      />
      <MessageBubble message={m2u} />
      <MessageBubble message={m3a} />
    </div>
  )
}
