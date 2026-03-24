// Domain types for the Job Hunter Agent frontend.

export type MessageRole = "user" | "assistant"
export type ApplicationStatus = "applied" | "interviewing" | "rejected" | "offer"

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
}

export interface StreamChunk {
  type: "text" | "tool_call" | "tool_result" | "done"
  content: string
  tool_name?: string
  tool_call_id?: string
  done: boolean
}

export interface Application {
  id: number
  user_id: number
  company: string
  title: string
  url?: string
  status: ApplicationStatus
  applied_date: string
  notes?: string
  updated_at: string
  created_at: string
}

export interface JobListing {
  id: number
  user_id: number
  title: string
  company: string
  location: string
  url: string
  snippet: string
  found_date: string
  is_read: boolean
}
