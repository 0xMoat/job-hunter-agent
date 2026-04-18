"use client"

import { useLanguage } from "@/contexts/LanguageContext"
import { MessageBubble } from "@/components/chat/MessageBubble"
import type { ChatMessage, PlanExecuteView, ToolCallEntry } from "@/lib/types"

// Unmistakably fake URLs — use example.com so no one mistakes these for
// real listings during demos.
const JOB_URLS = [
  "https://example.com/demo/job/001",
  "https://example.com/demo/job/002",
  "https://example.com/demo/job/003",
]

function buildJobSearchEntry(locale: string): ToolCallEntry {
  const resultsZh = [
    {
      title: "【演示】AI 工程师 · 示例科技 · 上海",
      link: JOB_URLS[0],
      snippet: "【教学样例】这是为引导教学提供的演示职位，非真实岗位。负责 LLM Agent 研发。",
    },
    {
      title: "【演示】Agent 平台主管 · 样本网络 · 上海",
      link: JOB_URLS[1],
      snippet: "【教学样例】用于展示 JD 卡片交互的演示数据。Python/LangChain 技术栈。",
    },
    {
      title: "【演示】LLM 应用工程师 · 演示智能 · 上海",
      link: JOB_URLS[2],
      snippet: "【教学样例】示例职位描述，实际投递请使用真实简历。RAG + 工具调用方向。",
    },
  ]
  const resultsEn = [
    {
      title: "[DEMO] AI Engineer · Demo Corp · San Francisco",
      link: JOB_URLS[0],
      snippet: "[Sample] Tutorial-only listing — not a real job. LLM agent R&D focus.",
    },
    {
      title: "[DEMO] Agent Platform Lead · Sample Labs · San Francisco",
      link: JOB_URLS[1],
      snippet: "[Sample] Shown for tutorial purposes. Python/LangChain stack.",
    },
    {
      title: "[DEMO] LLM Applications Engineer · Example AI · San Francisco",
      link: JOB_URLS[2],
      snippet: "[Sample] Demonstration listing. RAG + tool calling.",
    },
  ]
  const payload = {
    keywords: "Agent Engineer",
    location: locale === "zh-CN" ? "上海" : "San Francisco",
    intro_text: locale === "zh-CN"
      ? "这里展示了 3 个**演示职位**（仅用于教学）。勾选任意几个即可模拟保存到看板。"
      : "Showing 3 **demo listings** (tutorial-only). Tick any to simulate saving to the kanban.",
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

interface Props {
  onJumpToTopCard?: () => void | Promise<void>
}

export function TutorialSessionContent({ onJumpToTopCard }: Props) {
  const { t, locale } = useLanguage()
  const jobSearch = buildJobSearchEntry(locale)
  const peToolCall = buildPlanExecuteToolCall(t)
  const planView = buildPlanView(t)

  const m1u = buildMsg("tut-u-1", "user", t("tut_user_1"))
  // Single assistant turn with the search tool call + text; follow-up chips
  // render on this same bubble because savedUrlsInKanban intersects the
  // tool-call's result URLs.
  const m1a = buildMsg("tut-a-1", "assistant", t("tut_assistant_2"), [jobSearch])
  const m2u = buildMsg("tut-u-2", "user", t("tut_user_2"))
  const m3a = buildMsg("tut-a-3", "assistant", "", [peToolCall], planView)

  const noop = () => {}

  return (
    <div className="flex flex-col gap-4 px-5 py-4">
      <MessageBubble message={m1u} />
      <MessageBubble
        message={m1a}
        savedUrlsInKanban={new Set(JOB_URLS)}
        onPickFollowupPrompt={noop}
      />
      <MessageBubble message={m2u} />
      <MessageBubble message={m3a} onJumpToTopCard={onJumpToTopCard} />
    </div>
  )
}
