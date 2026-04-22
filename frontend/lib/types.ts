// Domain types for the Job Hunter Agent frontend.

export type MessageRole = "user" | "assistant"

export type ApplicationStatus =
  | "pending"
  | "applied"
  | "interviewing"
  | "completed"
  | "not_a_match"

export const KANBAN_COLUMNS: { status: ApplicationStatus; labelKey: string }[] = [
  { status: "pending",      labelKey: "col_pending" },
  { status: "applied",      labelKey: "col_applied" },
  { status: "completed",    labelKey: "col_completed" },
  { status: "not_a_match",  labelKey: "col_not_a_match" },
]

// "applied" and "interviewing" both render in the "applied" column
export function toColumnStatus(status: ApplicationStatus): ApplicationStatus {
  if (status === "interviewing") return "applied"
  return status
}

export interface ToolCallEntry {
  toolCallId: string
  toolName: string
  callingContent: string
  resultContent?: string
  status: "calling" | "done"
}

export interface ThinkingEntry {
  /** Ordered list of node names that have been entered */
  nodeSequence: string[]
  /** Accumulated reasoning text from analyze node */
  reasoningText: string
  /** Currently active node name, null when between nodes */
  currentNode: string | null
  /** Map of completed node name → duration_ms */
  doneNodes: Record<string, number>
}

export interface PlanExecuteView {
  steps: PlanStep[]
  finalResponse: string | null
  errorMsg: string | null
  running: boolean
  // ── HITL ──
  threadId: string | null
  awaitingApproval: boolean
  approvalRound: number
  revisionReason: string | null
  cancelled: boolean
}

export interface PlanExecuteSuggestion {
  /** Chip prompts shown in the bubble, in display order. */
  prompts: string[]
  /** Inserted-jobs count; still surfaced in the header for context. */
  savedCount: number
  pendingCount: number
  dismissed: boolean
}

export interface ChatMessage {
  id: string
  role: MessageRole
  textContent: string
  toolCalls: ToolCallEntry[]
  thinking?: ThinkingEntry
  timestamp?: Date
  planExecute?: PlanExecuteView
  planExecuteSuggestion?: PlanExecuteSuggestion
}

export interface StreamChunk {
  type: "text" | "tool_call" | "tool_result" | "reasoning_chunk" | "node_enter" | "node_exit" | "done"
  content: string
  tool_name?: string
  tool_call_id?: string
  calling_args?: string
  done: boolean
  node_name?: string
  duration_ms?: number
}

export interface Application {
  id: number
  user_id: number
  company: string
  title: string
  url?: string
  status: ApplicationStatus
  applied_date?: string
  notes?: string
  snippet?: string
  found_date?: string
  source: "scheduler" | "manual" | "chat" | "tutorial"
  archived_at?: string
  updated_at: string
  match_score?: number | null
  company_research_json?: string | null
  tailored_resume_text?: string | null
  pdf_download_url?: string | null
  pdf_created_at?: string | null
  match_breakdown?: string | null
  gap_analysis_text?: string | null
  interview_questions_json?: string | null
  artifacts_updated_at?: string | null
}

export interface MatchBreakdown {
  skills: { score: number; reason: string }
  experience: { score: number; reason: string }
  domain: { score: number; reason: string }
  soft: { score: number; reason: string }
}

export interface InterviewQuestion {
  question: string
  focus: string
}

// ── Plan-and-Execute ───────────────────────────────────────────────────────

export type PlanStepStatus = "pending" | "running" | "done" | "failed" | "skipped"

export interface PlanLiveToolCall {
  id: string
  name: string
  /** Accumulated JSON args (may be partial mid-stream). */
  args: string
  /** Populated once the corresponding ToolMessage arrives. */
  result?: string
}

export interface PlanStep {
  id: string
  text: string
  status: PlanStepStatus
  result?: string
  /** Live LLM text fragments for the step's ReAct final answer. */
  liveText?: string
  /** Live tool invocations + their eventual results. */
  toolCalls?: PlanLiveToolCall[]
  /** Server-side step start time (ms since epoch). Used by the UI timer so
   *  stall detection survives page reloads. */
  startedAt?: number
  dependsOn?: string[]
  /** Backend-measured execution duration in milliseconds. Set on completion. */
  durationMs?: number
}

export interface PlanStepDescriptor {
  id: string
  text: string
  depends_on?: string[]
}

export type PlanStreamChunk =
  | { type: "plan_created"; steps: PlanStepDescriptor[]; done: false }
  | { type: "step_started"; id: string; started_at_utc?: string; done: false }
  | { type: "step_completed"; id: string; result: string; duration_ms?: number; done: false }
  | { type: "plan_updated"; remaining: PlanStepDescriptor[]; done: false }
  | {
      type: "awaiting_approval"
      thread_id: string
      plan: PlanStepDescriptor[]
      round: number
      done: true
    }
  | { type: "plan_revised"; plan: PlanStepDescriptor[]; reason: string; done: false }
  | { type: "final_response"; content: string; done: true }
  | { type: "error"; message: string; done: true }
  | { type: "interrupted"; message: string; done: true }
  // ── live executor events ──
  | { type: "step_text_delta"; step_id: string; delta: string; done: false }
  | {
      type: "step_tool_call"
      step_id: string
      tool_call_id: string
      /** Present on the first chunk for a given tool call. */
      tool_name?: string
      args_delta: string
      done: false
    }
  | {
      type: "step_tool_result"
      step_id: string
      tool_call_id: string
      tool_name?: string
      content: string
      done: false
    }
  | { type: "wave_started"; wave: number; step_ids: string[]; done: false }
  | { type: "step_skipped"; id: string; reason: string; done: false }
