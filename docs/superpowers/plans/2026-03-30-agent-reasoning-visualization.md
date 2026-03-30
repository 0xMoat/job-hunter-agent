# Agent 推理可视化 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在聊天界面新增可折叠的「思考过程」卡片，展示 LangGraph 新增 `analyze` 节点的推理文字及节点转换进度 badge。

**Architecture:** 在 LangGraph 图中 `chat` 节点前插入 `analyze` 节点（使用无工具绑定的独立 LLM），后端 SSE 流新增 `node_enter`/`reasoning_chunk`/`node_exit` 三种事件，前端新增 `ThinkingCard` 组件复用 `ToolCallCard` 折叠行为展示推理过程和节点 badge。

**Tech Stack:** FastAPI + LangGraph + langchain_openai（ChatOpenAI），Next.js + React，TypeScript，pnpm

**Spec:** `docs/superpowers/specs/2026-03-30-agent-reasoning-visualization-design.md`

---

## File Map

| 文件 | 操作 | 说明 |
|------|------|------|
| `app/schemas/graph.py` | 修改 | `GraphState` 新增 `reasoning: str = ""` 字段 |
| `app/schemas/chat.py` | 修改 | `StreamChunk` 扩展三种新 type 及 `node_name`/`duration_ms` 字段 |
| `app/core/langgraph/graph.py` | 修改 | 新增 imports、`_plain_llm`、`_analyze` 方法，更新图连线，更新 `get_stream_response()` |
| `frontend/lib/types.ts` | 修改 | 新增 `ThinkingEntry`，扩展 `ChatMessage` 和 `StreamChunk` |
| `frontend/hooks/useChat.ts` | 修改 | 处理三种新 SSE 事件，维护 `ThinkingEntry` 状态 |
| `frontend/components/chat/ThinkingCard.tsx` | 新建 | 可折叠思考卡片组件 |
| `frontend/components/chat/MessageBubble.tsx` | 修改 | 在工具卡片上方渲染 `ThinkingCard` |

---

## Task 1: 更新后端 Schema

**Files:**
- Modify: `app/schemas/graph.py:12-18`
- Modify: `app/schemas/chat.py:92-113`

- [ ] **Step 1: 在 `GraphState` 新增 `reasoning` 字段**

  打开 `app/schemas/graph.py`，在 `long_term_memory` 字段后新增：

  ```python
  reasoning: str = Field(default="", description="Reasoning plan from analyze node. Empty string means direct response.")
  ```

  完整类变为：
  ```python
  class GraphState(BaseModel):
      """State definition for the LangGraph Agent/Workflow."""

      messages: Annotated[list, add_messages] = Field(
          default_factory=list, description="The messages in the conversation"
      )
      long_term_memory: str = Field(default="", description="The long term memory of the conversation")
      reasoning: str = Field(default="", description="Reasoning plan from analyze node. Empty string means direct response.")
  ```

- [ ] **Step 2: 扩展 `StreamChunk`**

  打开 `app/schemas/chat.py`，将 `StreamChunk` 类替换为：

  ```python
  class StreamChunk(BaseModel):
      """A typed chunk in the SSE stream.

      Extends StreamResponse with a type field to distinguish text tokens from
      tool calls, tool results, reasoning chunks, and node transition events.

      Attributes:
          type: Chunk type.
          content: Text content or empty string.
          tool_name: Tool name (for tool_call and tool_result chunks).
          tool_call_id: Tool call correlation ID.
          node_name: Node name (for node_enter and node_exit chunks).
          duration_ms: Node execution duration in ms (for node_exit chunks).
          done: Whether this is the final chunk.
      """

      type: Literal[
          "text", "tool_call", "tool_result",
          "reasoning_chunk", "node_enter", "node_exit",
          "done"
      ] = Field(default="text", description="Chunk type")
      content: str = Field(default="", description="Chunk content")
      tool_name: Optional[str] = Field(default=None, description="Tool name")
      tool_call_id: Optional[str] = Field(default=None, description="Tool call ID")
      node_name: Optional[str] = Field(default=None, description="LangGraph node name")
      duration_ms: Optional[int] = Field(default=None, description="Node execution duration in ms")
      done: bool = Field(default=False, description="Whether the stream is complete")
  ```

  确认文件顶部已有 `from typing import Literal, Optional`（已有则跳过）。

- [ ] **Step 3: 验证 schema 无语法错误**

  ```bash
  cd /Users/young/Downloads/repos/Job-Hunter-Agent
  uv run python -c "from app.schemas.graph import GraphState; from app.schemas.chat import StreamChunk; print('OK')"
  ```

  Expected: `OK`

- [ ] **Step 4: Commit**

  ```bash
  git add app/schemas/graph.py app/schemas/chat.py
  git commit -m "feat: extend GraphState and StreamChunk for reasoning visualization"
  ```

---

## Task 2: 更新后端 LangGraph 图

**Files:**
- Modify: `app/core/langgraph/graph.py`

### Step 1: 更新 imports

- [ ] **Step 1.1: 检查并新增所需 import**

  打开 `app/core/langgraph/graph.py`，找到现有的 import 块：

  ```python
  from langchain_core.messages import (
      AIMessageChunk,
      BaseMessage,
      ToolMessage,
      convert_to_openai_messages,
  )
  ```

  新增 `HumanMessage` 和 `SystemMessage`：

  ```python
  from langchain_core.messages import (
      AIMessageChunk,
      BaseMessage,
      HumanMessage,
      SystemMessage,
      ToolMessage,
      convert_to_openai_messages,
  )
  ```

  同时在文件顶部 import 块中新增（如未存在）：
  ```python
  import time
  ```
  以及：
  ```python
  from langchain_openai import ChatOpenAI
  ```

### Step 2: 在 `__init__` 新增 `_plain_llm`

- [ ] **Step 2.1: 在 `LangGraphAgent.__init__` 末尾新增 plain LLM**

  找到 `__init__` 方法（约第 66-79 行），在 `logger.info(...)` 调用之前新增：

  ```python
  # Tool-free LLM for the analyze node.
  # Must NOT use self.llm_service which has bind_tools() applied —
  # a tool-bound model would emit tool calls instead of plain text, breaking "direct" detection.
  self._plain_llm = ChatOpenAI(
      model=settings.DEFAULT_LLM_MODEL,
      tiktoken_model_name="gpt-4o",
      api_key=settings.OPENAI_API_KEY,
      temperature=0.0,
      max_tokens=256,
      **({"base_url": settings.LLM_BASE_URL} if settings.LLM_BASE_URL else {}),
  )
  ```

### Step 3: 新增 `_analyze` 方法

- [ ] **Step 3.1: 在 `_chat` 方法前新增 `_analyze` 方法**

  找到 `async def _chat(self, state: GraphState, ...` 这一行（约第 183 行），在其上方插入：

  ```python
  async def _analyze(self, state: GraphState, config: RunnableConfig) -> Command:
      """Analyze node: produces a brief reasoning plan before the chat node.

      Calls the plain (tool-free) LLM to decide whether planning is needed.
      Outputs "direct" for simple conversation (no reasoning displayed),
      or a 1-2 sentence plan that gets streamed to the frontend as reasoning_chunk events.

      Args:
          state: Current graph state.
          config: LangGraph runnable config (passed through to ainvoke for Langfuse tracing).

      Returns:
          Command updating reasoning field and routing to "chat".
      """
      last_user_msg = next(
          (m for m in reversed(state.messages) if isinstance(m, HumanMessage)), None
      )
      if not last_user_msg:
          return Command(update={"reasoning": ""}, goto="chat")

      prompt = SystemMessage(content=(
          "In 1-2 sentences, describe what you need to do to answer the user. "
          "If it is simple conversation with no tool use needed, output exactly the word: direct (lowercase only)"
      ))
      response = await self._plain_llm.ainvoke([prompt, last_user_msg], config=config)
      text = response.content.strip()
      # Case-sensitive check: prompt instructs lowercase "direct"; same check on frontend
      reasoning = "" if text.lower().startswith("direct") else text
      logger.debug("analyze_node_completed", has_reasoning=bool(reasoning), session_id=config.get("configurable", {}).get("thread_id"))
      return Command(update={"reasoning": reasoning}, goto="chat")
  ```

### Step 4: 更新图连线

- [ ] **Step 4.1: 在 `create_graph` 中插入 analyze 节点**

  找到 `create_graph` 方法中的图构建代码（约第 299-303 行）：

  ```python
  graph_builder = StateGraph(GraphState)
  graph_builder.add_node("chat", self._chat, ends=["tool_call", END])
  graph_builder.add_node("tool_call", self._tool_call, ends=["chat"])
  graph_builder.set_entry_point("chat")
  graph_builder.set_finish_point("chat")
  ```

  替换为：

  ```python
  graph_builder = StateGraph(GraphState)
  graph_builder.add_node("analyze", self._analyze, ends=["chat"])
  graph_builder.add_node("chat", self._chat, ends=["tool_call", END])
  graph_builder.add_node("tool_call", self._tool_call, ends=["chat"])
  graph_builder.set_entry_point("analyze")   # was: "chat"
  graph_builder.set_finish_point("chat")     # unchanged
  ```

### Step 5: 更新 `get_stream_response()`

- [ ] **Step 5.1: 在 `get_stream_response` 中添加节点追踪变量**

  找到 `get_stream_response` 方法中的 `# Accumulate tool call args...` 注释（约第 431 行）之后，在其下方新增：

  ```python
  # Track current LangGraph node for node_enter / node_exit events
  _current_node: str | None = None
  _node_start_ms: dict[str, float] = {}
  ```

- [ ] **Step 5.2: 修改 `async for` 循环，捕获 metadata**

  找到：
  ```python
  async for token, _ in self._graph.astream(
  ```

  替换为：
  ```python
  async for token, _metadata in self._graph.astream(
  ```

- [ ] **Step 5.3: 在循环 `try:` 块的最顶部插入节点切换逻辑**

  找到：
  ```python
              try:
                  if isinstance(token, AIMessageChunk):
  ```

  替换为：

  ```python
              try:
                  _node = _metadata.get("langgraph_node") if _metadata else None

                  # Emit node_enter / node_exit on node transitions
                  if _node != _current_node:
                      if _current_node and _current_node in _node_start_ms:
                          _elapsed = int((time.time() - _node_start_ms[_current_node]) * 1000)
                          yield _json.dumps({
                              "type": "node_exit",
                              "content": "",
                              "node_name": _current_node,
                              "duration_ms": _elapsed,
                              "done": False,
                          })
                      if _node:
                          yield _json.dumps({
                              "type": "node_enter",
                              "content": "",
                              "node_name": _node,
                              "done": False,
                          })
                          _node_start_ms[_node] = time.time()
                      _current_node = _node

                  # Emit reasoning_chunk for analyze node text output
                  if _node == "analyze" and isinstance(token, AIMessageChunk) and token.content:
                      yield _json.dumps({
                          "type": "reasoning_chunk",
                          "content": token.content,
                          "done": False,
                      })

                  if isinstance(token, AIMessageChunk):
  ```

- [ ] **Step 5.4: 在 `async for` 循环结束后补发最后节点的 `node_exit`**

  找到循环结束后的注释（约在 `except Exception as stream_error:` 之前）：
  ```python
          # After streaming completes, get final state and update memory in background
  ```

  在这行注释**之前**插入：

  ```python
          # Emit node_exit for the last node (loop ends without a final node transition)
          if _current_node and _current_node in _node_start_ms:
              _elapsed = int((time.time() - _node_start_ms[_current_node]) * 1000)
              yield _json.dumps({
                  "type": "node_exit",
                  "content": "",
                  "node_name": _current_node,
                  "duration_ms": _elapsed,
                  "done": False,
              })

  ```

- [ ] **Step 5.5: 验证后端无语法错误**

  ```bash
  cd /Users/young/Downloads/repos/Job-Hunter-Agent
  uv run python -c "from app.core.langgraph.graph import LangGraphAgent; print('OK')"
  ```

  Expected: `OK`

- [ ] **Step 5.6: 用 ruff 检查代码质量**

  ```bash
  make lint
  ```

  Expected: 无错误（warning 可以忽略）

- [ ] **Step 5.7: Commit**

  ```bash
  git add app/core/langgraph/graph.py
  git commit -m "feat: add analyze node and node transition events to LangGraph stream"
  ```

---

## Task 3: 更新前端类型

**Files:**
- Modify: `frontend/lib/types.ts`

- [ ] **Step 1: 新增 `ThinkingEntry` 接口**

  在 `ToolCallEntry` 接口定义前新增：

  ```typescript
  export interface ThinkingEntry {
    /** Ordered list of node names seen so far (e.g. ["analyze", "chat"]) */
    nodeSequence: string[]
    /** Accumulated reasoning text streamed from the analyze node */
    reasoningText: string
    /** Currently active node, null when no node is executing */
    currentNode: string | null
    /** node_name → duration_ms for completed nodes */
    doneNodes: Record<string, number>
  }
  ```

- [ ] **Step 2: 在 `ChatMessage` 新增 `thinking` 字段**

  找到：
  ```typescript
  export interface ChatMessage {
    id: string
    role: MessageRole
    textContent: string
    toolCalls: ToolCallEntry[]
    timestamp?: Date
  }
  ```

  替换为：
  ```typescript
  export interface ChatMessage {
    id: string
    role: MessageRole
    textContent: string
    toolCalls: ToolCallEntry[]
    thinking?: ThinkingEntry
    timestamp?: Date
  }
  ```

- [ ] **Step 3: 扩展 `StreamChunk`**

  找到：
  ```typescript
  export interface StreamChunk {
    type: "text" | "tool_call" | "tool_result" | "done"
    content: string
    tool_name?: string
    tool_call_id?: string
    calling_args?: string
    done: boolean
  }
  ```

  替换为：
  ```typescript
  export interface StreamChunk {
    type: "text" | "tool_call" | "tool_result" | "reasoning_chunk" | "node_enter" | "node_exit" | "done"
    content: string
    tool_name?: string
    tool_call_id?: string
    calling_args?: string
    node_name?: string
    duration_ms?: number
    done: boolean
  }
  ```

- [ ] **Step 4: 验证 TypeScript 无类型错误**

  ```bash
  cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend
  pnpm tsc --noEmit 2>&1 | head -30
  ```

  Expected: 无输出或仅 existing 警告

- [ ] **Step 5: Commit**

  ```bash
  cd /Users/young/Downloads/repos/Job-Hunter-Agent
  git add frontend/lib/types.ts
  git commit -m "feat: add ThinkingEntry type and extend StreamChunk for reasoning events"
  ```

---

## Task 4: 更新 `useChat.ts` 处理新事件

**Files:**
- Modify: `frontend/hooks/useChat.ts`

先阅读文件了解现有事件处理结构：
```bash
grep -n "chunk.type\|case\|tool_call\|tool_result" /Users/young/Downloads/repos/Job-Hunter-Agent/frontend/hooks/useChat.ts | head -30
```

- [ ] **Step 1: 定位事件处理分支**

  找到现有处理 `tool_call` / `tool_result` / `text` 的 if-else 或 switch 分支位置。

- [ ] **Step 2: 新增三个新事件的处理逻辑**

  在现有事件处理逻辑中，新增以下三个分支（与 `tool_call` 等并列）：

  ```typescript
  // Helper: initialize ThinkingEntry if absent
  const emptyThinking = (): ThinkingEntry => ({
    nodeSequence: [],
    reasoningText: "",
    currentNode: null,
    doneNodes: {},
  })

  // ... inside the event loop:

  } else if (chunk.type === "node_enter" && chunk.node_name) {
    setMessages(prev => prev.map(m => {
      if (m.id !== assistantId) return m
      const thinking = m.thinking ?? emptyThinking()
      return {
        ...m,
        thinking: {
          ...thinking,
          currentNode: chunk.node_name!,
          nodeSequence: thinking.nodeSequence.includes(chunk.node_name!)
            ? thinking.nodeSequence
            : [...thinking.nodeSequence, chunk.node_name!],
        },
      }
    }))

  } else if (chunk.type === "reasoning_chunk" && chunk.content) {
    setMessages(prev => prev.map(m => {
      if (m.id !== assistantId) return m
      const thinking = m.thinking ?? emptyThinking()
      return {
        ...m,
        thinking: {
          ...thinking,
          reasoningText: thinking.reasoningText + chunk.content,
        },
      }
    }))

  } else if (chunk.type === "node_exit" && chunk.node_name) {
    setMessages(prev => prev.map(m => {
      if (m.id !== assistantId) return m
      const thinking = m.thinking ?? emptyThinking()
      return {
        ...m,
        thinking: {
          ...thinking,
          currentNode: null,
          doneNodes: {
            ...thinking.doneNodes,
            [chunk.node_name!]: chunk.duration_ms ?? 0,
          },
        },
      }
    }))
  }
  ```

  确保 `ThinkingEntry` 已从 `@/lib/types` 导入。

- [ ] **Step 3: 验证 TypeScript 类型无报错**

  ```bash
  cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend
  pnpm tsc --noEmit 2>&1 | head -30
  ```

  Expected: 无新增错误

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/young/Downloads/repos/Job-Hunter-Agent
  git add frontend/hooks/useChat.ts
  git commit -m "feat: handle node_enter, reasoning_chunk, node_exit events in useChat"
  ```

---

## Task 5: 新建 `ThinkingCard.tsx`

**Files:**
- Create: `frontend/components/chat/ThinkingCard.tsx`

参考 `ToolCallCard.tsx` 的完整实现（折叠逻辑、`useRef`、`useEffect` 自动折叠行为），新建组件：

- [ ] **Step 1: 创建 `ThinkingCard.tsx`**

  ```tsx
  "use client"

  import { useState, useRef, useEffect } from "react"
  import type { ThinkingEntry } from "@/lib/types"
  import { useLanguage } from "@/contexts/LanguageContext"

  interface Props {
    entry: ThinkingEntry
    isStreaming?: boolean
  }

  /** Human-readable label for node names. */
  const NODE_LABELS: Record<string, string> = {
    analyze: "Analyze",
    chat: "Chat",
    tool_call: "Tool",
  }

  export function ThinkingCard({ entry, isStreaming }: Props) {
    const { t } = useLanguage()

    // Don't render if reasoning is empty (simple conversation / "direct")
    if (!entry.reasoningText || entry.reasoningText.toLowerCase().startsWith("direct")) {
      return null
    }

    const isActive = entry.currentNode !== null

    // Start expanded during streaming, auto-collapse when streaming ends
    const [expanded, setExpanded] = useState(isStreaming === true)
    const wasStreamingRef = useRef(isStreaming === true)
    useEffect(() => {
      if (wasStreamingRef.current && !isStreaming) {
        setExpanded(false)
      }
      if (isStreaming) wasStreamingRef.current = true
    }, [isStreaming])

    return (
      <div className="glass rounded-xl my-1">
        <div className="overflow-hidden rounded-xl">

          {/* Header */}
          <button
            onClick={() => !isActive && setExpanded((e) => !e)}
            disabled={isActive}
            aria-expanded={expanded}
            className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
              !isActive ? "hover:bg-white/20 cursor-pointer" : "cursor-default"
            } ${expanded ? "border-b border-[var(--border)]" : ""}`}
          >
            {/* Status dot */}
            <span
              className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${
                isActive
                  ? "bg-indigo-400 animate-pulse"
                  : "bg-indigo-500 shadow-[0_0_5px_rgba(99,102,241,0.4)]"
              }`}
            />

            {/* Label */}
            <span className="font-body font-semibold text-sm text-[var(--text-2)] flex-shrink-0">
              🧠 Thinking
            </span>

            {/* Node badge sequence */}
            <span className="flex items-center gap-1 flex-shrink-0">
              {entry.nodeSequence.map((node, i) => {
                const isDone = node in entry.doneNodes
                const isCurrent = node === entry.currentNode
                return (
                  <span key={node} className="flex items-center gap-1">
                    {i > 0 && <span className="text-[var(--text-3)] text-[10px]">→</span>}
                    <span
                      className={`text-[9px] font-mono px-1.5 py-0.5 rounded font-semibold ${
                        isDone
                          ? "bg-indigo-500/20 text-indigo-300"
                          : isCurrent
                          ? "bg-amber-500/20 text-amber-300 animate-pulse"
                          : "bg-white/5 text-[var(--text-3)]"
                      }`}
                    >
                      {NODE_LABELS[node] ?? node}
                    </span>
                  </span>
                )
              })}
            </span>

            {/* Right: running or expand/collapse */}
            {isActive ? (
              <span className="ml-auto font-body font-light text-xs text-[var(--text-3)] animate-pulse flex-shrink-0">
                Running…
              </span>
            ) : (
              <span className="ml-auto font-body text-xs text-[var(--text-3)] flex-shrink-0">
                {expanded ? "Collapse ∧" : "Expand ∨"}
              </span>
            )}
          </button>

          {/* Expanded body */}
          {expanded && (
            <div className="px-3 py-2.5">
              {/* Reasoning text */}
              <p className="font-body text-xs text-[var(--text-3)] italic leading-relaxed mb-2">
                {entry.reasoningText}
                {isActive && (
                  <span className="inline-block w-1 h-3 bg-current ml-0.5 animate-pulse rounded-sm align-middle" />
                )}
              </p>

              {/* Node timing list */}
              {entry.nodeSequence.length > 0 && (
                <div className="flex flex-col gap-1 border-t border-[var(--border)] pt-2">
                  {entry.nodeSequence.map((node) => {
                    const ms = entry.doneNodes[node]
                    const isCurrent = node === entry.currentNode
                    return (
                      <div key={node} className="flex items-center gap-2">
                        <span
                          className={`text-[10px] ${
                            ms !== undefined ? "text-indigo-400" : isCurrent ? "text-amber-400 animate-pulse" : "text-[var(--text-3)]"
                          }`}
                        >
                          {ms !== undefined ? "✓" : isCurrent ? "⟳" : "○"}
                        </span>
                        <span className="font-mono text-[10px] text-[var(--text-2)]">
                          {NODE_LABELS[node] ?? node}
                        </span>
                        {ms !== undefined ? (
                          <span className="ml-auto font-mono text-[9px] text-[var(--text-3)]">
                            {ms}ms
                          </span>
                        ) : isCurrent ? (
                          <span className="ml-auto font-mono text-[9px] text-amber-400 animate-pulse">
                            running
                          </span>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )}

        </div>
      </div>
    )
  }
  ```

- [ ] **Step 2: 验证 TypeScript 无错误**

  ```bash
  cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend
  pnpm tsc --noEmit 2>&1 | head -30
  ```

  Expected: 无新增错误

- [ ] **Step 3: Commit**

  ```bash
  cd /Users/young/Downloads/repos/Job-Hunter-Agent
  git add frontend/components/chat/ThinkingCard.tsx
  git commit -m "feat: add ThinkingCard component with collapsible reasoning and node badges"
  ```

---

## Task 6: 更新 `MessageBubble.tsx`

**Files:**
- Modify: `frontend/components/chat/MessageBubble.tsx`

- [ ] **Step 1: 导入 `ThinkingCard`**

  在文件顶部，在 `import { ToolCallCard }` 行后新增：

  ```tsx
  import { ThinkingCard } from "./ThinkingCard"
  ```

- [ ] **Step 2: 在 ToolCallCard 列表上方渲染 ThinkingCard**

  找到：
  ```tsx
        {/* Tool call cards (assistant only) */}
        {message.toolCalls.length > 0 && (
  ```

  在其上方插入：

  ```tsx
        {/* Thinking card (assistant only — hidden for simple conversation) */}
        {!isUser && message.thinking && (
          <ThinkingCard entry={message.thinking} isStreaming={isStreaming} />
        )}

  ```

- [ ] **Step 3: 验证 TypeScript 无错误**

  ```bash
  cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend
  pnpm tsc --noEmit 2>&1 | head -30
  ```

  Expected: 无新增错误

- [ ] **Step 4: Commit**

  ```bash
  cd /Users/young/Downloads/repos/Job-Hunter-Agent
  git add frontend/components/chat/MessageBubble.tsx
  git commit -m "feat: render ThinkingCard in MessageBubble above tool call cards"
  ```

---

## Task 7: 端到端验证

- [ ] **Step 1: 启动开发服务器**

  ```bash
  cd /Users/young/Downloads/repos/Job-Hunter-Agent
  make dev
  ```

  等待服务器就绪（日志显示 `Application startup complete`）。

- [ ] **Step 2: 验证「有推理」场景**

  打开聊天界面，发送：`帮我搜索上海的 Python 后端工程师职位`

  预期：
  - 消息出现前先显示 ThinkingCard（展开状态）
  - 卡片头部有 `[Analyze] → [Chat]` badge
  - 展开内容有 1-2 句推理文字
  - ToolCallCard 在 ThinkingCard 之后出现
  - 流式结束后 ThinkingCard 自动折叠

- [ ] **Step 3: 验证「无推理」场景**

  发送：`你好`

  预期：
  - 不显示 ThinkingCard
  - assistant 直接回复文字气泡
  - 无额外 UI 元素

- [ ] **Step 4: 验证历史消息**

  刷新页面，重新打开有工具调用的历史会话。

  预期：
  - 历史消息中不显示 ThinkingCard（reasoningText 在刷新后为空，属已知限制）
  - ToolCallCard 正常展示

- [ ] **Step 5: 最终 lint 检查**

  ```bash
  make lint
  ```

  Expected: 无错误

- [ ] **Step 6: 最终 commit（如有未提交改动）**

  ```bash
  git status
  # 若无未提交文件则跳过
  git add -p
  git commit -m "chore: final cleanup"
  ```

---

## 已知限制

- 历史消息中 ThinkingCard 刷新后不显示（ThinkingEntry 不持久化到聊天记录）
- 如果 Gemini 模型输出 `"Direct"` 而非 `"direct"`，卡片不会被过滤（概率低，prompt 已加 "lowercase only" 说明）
- `analyze` 节点增加约 200-600ms 延迟（独立 LLM 调用）
