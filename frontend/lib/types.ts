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

export interface ChatMessage {
  id: string
  role: MessageRole
  textContent: string
  toolCalls: ToolCallEntry[]
  timestamp?: Date
}

export interface StreamChunk {
  type: "text" | "tool_call" | "tool_result" | "done"
  content: string
  tool_name?: string
  tool_call_id?: string
  calling_args?: string
  done: boolean
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
  source: "scheduler" | "manual"
  archived_at?: string
  updated_at: string
}
