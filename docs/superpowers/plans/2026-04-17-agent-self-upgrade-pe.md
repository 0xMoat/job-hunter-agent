# Agent Self-Upgrade to Plan-Execute + Followup Chips Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Plan-Execute 的触发从 "UI 按钮副作用" 重构成 "agent 自升级 + 用户自然语言"。Chatbot 主 ReAct agent 新增 `start_plan_execute` 元工具；检测到多步复杂任务时自己调用，后端返回 handoff marker，前端接力启动 PE 流。保存 JD 后的气泡从"立即处理"CTA 改为 3 条 followup chip（模板问句 + ↗ 箭头），点 chip = 发送自然语言消息走 agent 自升级路径。同时下线 `cover_letter_tool`（国内招聘用处小），把 PE 默认三步闭环从 "研究+写信+看板" 改为 "研究+简历润色+看板"。

**Architecture:**
- **Handoff 协议**：`start_plan_execute` 声明 `return_direct=True` + 返回 JSON marker `{__handoff__: true, goal, reason}`。Tool 执行后 ReAct 图直接终止（不再过 LLM），marker 通过现有 `tool_result` SSE 事件出到前端。前端 `useChat` 在 chat stream 里识别该事件 → 解析 goal → 关闭 chat SSE → 调 `apiStartPlanExecute(goal)` 接入同一条 assistant message。
- **Chips 模型**：复用现有 `planExecuteSuggestion` 气泡位，但 payload 改成 `{ prompts: string[], savedCount, dismissed }`。点 chip 不再调 `startPlanExecute`，而是调 `sendMessage(chipText)`；由 agent 自己判断是否升级。
- **下线 cover letter**：仅从 `tools/__init__.py` 的 `tools` 列表移除；源文件保留，无破坏性删除。System prompt 和 replanner prompt 配套更新。

**Tech Stack:** Python（LangGraph、LangChain tool `return_direct`）、FastAPI SSE、Next.js 16 + React 19、既有 `useChat` / `PlanExecuteSuggestionCard`。

**仓库约定：** 无 pytest。验证：`pnpm exec tsc --noEmit`（前端）+ `make lint`（后端）+ 手动 E2E checklist。

---

## 文件结构

```
app/
├── core/
│   ├── langgraph/tools/start_plan_execute.py    # [新] 元工具：return_direct + marker
│   ├── langgraph/tools/__init__.py              # [改] 注册 start_plan_execute；移除 cover_letter_tool
│   └── prompts/
│       ├── system.md                            # [改] 加"何时升级"规则；去 cover letter
│       └── plan_execute_replanner.md            # [改] 典型三步：研究+简历润色+看板

frontend/
├── lib/
│   ├── types.ts                                 # [改] PlanExecuteSuggestion 加 prompts 字段
│   └── i18n.ts                                  # [改] 3 条 chip 文本（zh/en）
├── hooks/useChat.ts                             # [改] handoff 识别 + chip 点击走 sendMessage
└── components/plan/PlanExecuteSuggestionCard.tsx # [改] 渲染 chip 列表
```

---

## Task 1 · 新建 `start_plan_execute` 元工具

**Files:**
- Create: `app/core/langgraph/tools/start_plan_execute.py`
- Modify: `app/core/langgraph/tools/__init__.py`

- [ ] **Step 1: 创建元工具**

Create `app/core/langgraph/tools/start_plan_execute.py`:

```python
"""Meta-tool: hand the conversation off to the Plan-Execute agent.

The ReAct chat agent calls this tool when the user's request is obviously
multi-step (e.g. "研究这 5 家公司并为每家针对性润色简历"). We set
`return_direct=True` so the ReAct loop terminates as soon as this tool
returns — the returned JSON marker is streamed out via the existing
`tool_result` SSE event, and the frontend detects it to start a PE run.
"""

import json

from langchain_core.tools import tool

from app.core.logging import logger

HANDOFF_MARKER_KEY = "__plan_execute_handoff__"


@tool(return_direct=True)
async def start_plan_execute(goal: str, reason: str) -> str:
    """Hand the current turn off to the Plan-and-Execute agent.

    Call this tool ONLY when the user's request clearly requires multiple
    sequential sub-tasks that depend on each other (e.g. research several
    companies AND tailor a resume per company AND update the kanban).

    DO NOT call for single-step tool work (one job search, one company
    research, one resume tailor). Those run faster directly via the chat
    agent without the planning overhead.

    Args:
        goal: A self-contained one-sentence restatement of the user's
            intent, in the user's language. The PE planner will use this
            as its top-level objective.
        reason: Short Chinese justification for why PE is needed (logged
            only; not shown to user).

    Returns:
        JSON string carrying a handoff marker + goal; the frontend
        reroutes to the PE stream on receipt.
    """
    logger.info("start_plan_execute_handoff", goal=goal, reason=reason)
    return json.dumps(
        {HANDOFF_MARKER_KEY: True, "goal": goal, "reason": reason},
        ensure_ascii=False,
    )
```

- [ ] **Step 2: 注册元工具并下线 cover_letter**

Edit `app/core/langgraph/tools/__init__.py`:

```python
"""LangGraph tools for the job-hunting agent."""

from langchain_core.tools.base import BaseTool

from .application_tracker import application_tracker_tool
from .company_research import company_research_tool
from .duckduckgo_search import duckduckgo_search_tool
from .job_preferences import job_preferences_tool
from .job_search import job_search_tool
from .resume_pdf import generate_resume_pdf
from .resume_studio import trigger_resume_studio_skill
from .start_plan_execute import start_plan_execute

tools: list[BaseTool] = [
    job_search_tool,
    company_research_tool,
    application_tracker_tool,
    job_preferences_tool,
    duckduckgo_search_tool,
    trigger_resume_studio_skill,
    generate_resume_pdf,
    start_plan_execute,
]
```

Note: `cover_letter` import + registration are removed; the source file stays.

- [ ] **Step 3: Lint 验证**

Run: `make lint`
Expected: No new errors from the two edited files.

- [ ] **Step 4: Commit**

```bash
git add app/core/langgraph/tools/start_plan_execute.py app/core/langgraph/tools/__init__.py
git commit -m "$(cat <<'EOF'
feat(pe-handoff): add start_plan_execute meta-tool; retire cover_letter

The chat ReAct agent now has a return_direct meta-tool it can call when
the user's request is obviously multi-step. The tool returns a JSON
marker carrying the distilled goal; the frontend detects the marker in
the existing tool_result SSE event and switches to the PE stream.

Also drop cover_letter_tool from the tools registry (国内招聘场景下
求职信价值低)。Source file retained for now; no behavioral change for
callers that never invoked it.
EOF
)"
```

---

## Task 2 · Chatbot system prompt：加升级规则 + 去 cover letter

**Files:**
- Modify: `app/core/prompts/system.md`

- [ ] **Step 1: 读取当前内容定位**

Read `app/core/prompts/system.md` head (first ~80 lines). Two edits needed:
- Top paragraph mentions "write personalized cover letters" → drop.
- Workflow section 4 is a whole block about cover letters → replace with resume tailoring guidance + multi-step escalation block.

- [ ] **Step 2: 改顶部角色描述**

Replace:

```
You are an expert job-hunting assistant. Help users find relevant jobs, research
target companies, write personalized cover letters, and track their applications.
```

With:

```
You are an expert job-hunting assistant. Help users find relevant jobs, research
target companies, tailor the user's resume for specific JDs, and track their
applications.
```

- [ ] **Step 3: 替换 Workflow 第 4 节（cover letter → multi-step escalation）**

Replace the entire `4. **Cover letter**: ...` bullet with two new items. The block to remove:

```
4. **Cover letter**: When writing outreach or application emails, call `cover_letter_tool`.
   The tool automatically uses the user's stored profile — you do not need to re-ask for it.
```

Replacement (becomes step 4; existing steps 5/6/7 renumber themselves naturally):

```
4. **Resume tailoring**: When the user wants to tailor their resume for a specific
   JD, call `trigger_resume_studio_skill`. That tool activates a dedicated Resume
   Expert persona. Follow up with `generate_resume_pdf` once the tailored JSON is
   ready, so the user gets a downloadable file.

5. **Multi-step escalation (HARD RULE)**: If the user's request clearly requires
   multiple sequential sub-tasks with dependencies (e.g. "研究这 N 家公司，并为每家
   针对性润色简历"), you MUST call `start_plan_execute(goal, reason)` instead of
   doing the work yourself. Extract a one-sentence `goal` in the user's language.
   Examples:
   - "研究这 3 家公司并为每家润色简历" → call start_plan_execute.
   - "帮我制定本周投递计划" → call start_plan_execute.
   - "帮我搜 Python 工程师职位" → DO NOT escalate; single-step job search.
   - "你好" / "你是谁" → never escalate; plain reply.
```

- [ ] **Step 4: Commit**

```bash
git add app/core/prompts/system.md
git commit -m "$(cat <<'EOF'
feat(prompt): teach chat agent to self-upgrade to PE; drop cover letter

- Top-of-role: replace "write cover letters" with "tailor resume".
- Workflow #4: replace cover-letter instructions with resume-studio flow
  (trigger_resume_studio_skill → generate_resume_pdf).
- Workflow #5: new HARD RULE on when to call start_plan_execute, with
  escalation / non-escalation examples in user's language.
EOF
)"
```

---

## Task 3 · Replanner prompt：典型三步换为「研究 + 简历润色 + 看板」

**Files:**
- Modify: `app/core/prompts/plan_execute_replanner.md`

- [ ] **Step 1: 找到提到 "写信" 的那段**

Within the "判断流程" block the current text reads:

```
- 所有可执行的职位都已完成"研究 + 写信 + 更新看板"三步闭环；
```

- [ ] **Step 2: 替换为简历润色版本**

Change it to:

```
- 所有可执行的职位都已完成"研究 + 简历润色 + 更新看板"三步闭环；
```

- [ ] **Step 3: 改上方示例里的 cover-letter 引用**

Earlier in the same file:

```
  just happened (e.g., a company research revealed a red flag → drop its
  cover-letter step and add an "标记为 not_a_match" step).
```

Change to:

```
  just happened (e.g., a company research revealed a red flag → drop its
  resume-tailor step and add an "标记为 not_a_match" step).
```

- [ ] **Step 4: Commit**

```bash
git add app/core/prompts/plan_execute_replanner.md
git commit -m "$(cat <<'EOF'
fix(replanner): swap default 3-step loop from cover-letter to resume-tailor

Matches the new workflow where the chat agent and PE graph both drive the
user toward per-JD resume tailoring (via trigger_resume_studio_skill +
generate_resume_pdf) instead of cover-letter drafting.
EOF
)"
```

---

## Task 4 · 前端类型：PlanExecuteSuggestion 新增 `prompts` 字段

**Files:**
- Modify: `frontend/lib/types.ts`

- [ ] **Step 1: 扩展 `PlanExecuteSuggestion` 接口**

Current (lines 57–61):

```typescript
export interface PlanExecuteSuggestion {
  savedCount: number
  pendingCount: number
  dismissed: boolean
}
```

Replace with:

```typescript
export interface PlanExecuteSuggestion {
  /** Chip prompts shown in the bubble, in display order. */
  prompts: string[]
  /** Inserted-jobs count; still surfaced in the header for context. */
  savedCount: number
  pendingCount: number
  dismissed: boolean
}
```

- [ ] **Step 2: TS check**

Run: `cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm exec tsc --noEmit`
Expected: fails at `PlanExecuteSuggestionCard.tsx` (missing `prompts`) and `useChat.ts` (`insertPlanExecuteSuggestion` payload). Those are fixed in later tasks — note the error count for comparison later.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/types.ts
git commit -m "feat(suggest): PlanExecuteSuggestion carries chip prompts"
```

---

## Task 5 · i18n：3 条 chip 文本 + 头部摘要文案

**Files:**
- Modify: `frontend/lib/i18n.ts`

- [ ] **Step 1: 在 zh block 的 "Plan-and-Execute suggestion bubble" 区追加 chip key**

Find the zh block `pe_suggestion_*` section. After `pe_suggestion_cta`, insert:

```typescript
  pe_chip_research_and_tailor: ((n: number) =>
    `帮我研究这 ${n} 家公司，并为每家针对性润色简历`) as unknown as FnValue,
  pe_chip_analyze_match: '分析这些 JD 和我的简历匹配度，按优先级排序',
  pe_chip_prioritize_by_prefs: '按我的偏好筛一遍这些 JD，哪些值得优先投递',
  pe_suggestion_header: ((saved: number) =>
    `已保存 ${saved} 个职位到看板 · 想做什么？`) as unknown as FnValue,
```

- [ ] **Step 2: 对应英文 block 追加相同 key**

After the en block's `pe_suggestion_cta`, insert:

```typescript
  pe_chip_research_and_tailor: ((n: number) =>
    `Research these ${n} companies and tailor my resume for each`) as unknown as FnValue,
  pe_chip_analyze_match: 'Analyze JD-to-resume fit and rank by priority',
  pe_chip_prioritize_by_prefs: 'Filter these JDs by my preferences — which to apply first?',
  pe_suggestion_header: ((saved: number) =>
    `Saved ${saved} job${saved === 1 ? '' : 's'} to the kanban · what's next?`) as unknown as FnValue,
```

- [ ] **Step 3: TS check**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: same error count as Task 4 (i18n additions don't introduce new errors).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/i18n.ts
git commit -m "feat(i18n): add 3 followup chip prompts + suggestion header (zh/en)"
```

---

## Task 6 · `PlanExecuteSuggestionCard` 渲染 chip 列表

**Files:**
- Modify: `frontend/components/plan/PlanExecuteSuggestionCard.tsx`

- [ ] **Step 1: 改 props 接口**

At the top of the file, `PlanExecuteSuggestionCardProps` currently has `onAccept: () => void`. Replace with:

```typescript
interface PlanExecuteSuggestionCardProps {
  suggestion: PlanExecuteSuggestion
  onPick: (promptText: string) => void
  disabled?: boolean
}
```

- [ ] **Step 2: 重写组件 body 为 chips 布局**

Replace the entire component body (everything from `export function PlanExecuteSuggestionCard(...) {` down to its closing `}`). Full replacement:

```typescript
export function PlanExecuteSuggestionCard({
  suggestion,
  onPick,
  disabled = false,
}: PlanExecuteSuggestionCardProps) {
  const { t } = useLanguage()
  if (suggestion.dismissed) return null

  const { prompts, savedCount } = suggestion
  if (prompts.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-[var(--text-3)]">
        {t("pe_suggestion_header", savedCount)}
      </div>
      <div className="flex flex-col gap-2">
        {prompts.map((prompt) => (
          <button
            key={prompt}
            type="button"
            onClick={() => onPick(prompt)}
            disabled={disabled}
            className="group flex items-center justify-between gap-3 rounded-full border border-[var(--border-1)] bg-white px-4 py-2 text-left text-sm text-[var(--text-1)] shadow-sm transition hover:border-[var(--accent)] hover:bg-[var(--accent-soft,#f5f6ff)] disabled:opacity-50 disabled:hover:border-[var(--border-1)] disabled:hover:bg-white"
          >
            <span className="truncate">{prompt}</span>
            <span className="shrink-0 text-[var(--text-3)] transition group-hover:text-[var(--accent)]">
              ↗
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: TS check**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: `MessageBubble.tsx` / `ChatPanel.tsx` still fail because they pass `onAccept`. Fixed in Task 7.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/plan/PlanExecuteSuggestionCard.tsx
git commit -m "feat(suggest): render followup chips instead of single CTA"
```

---

## Task 7 · `useChat` — handoff 识别 + chip 点击走 sendMessage

**Files:**
- Modify: `frontend/hooks/useChat.ts`
- Modify: `frontend/components/chat/MessageBubble.tsx` (single-line prop rename)
- Modify: `frontend/components/chat/ChatPanel.tsx` (single-line prop rename)

- [ ] **Step 1: 改 `insertPlanExecuteSuggestion` 以生成 chips**

Locate `insertPlanExecuteSuggestion` inside `useChat.ts` (it currently takes `savedCount, pendingCount` and builds a `planExecuteSuggestion: { savedCount, pendingCount, dismissed: false }`).

Replace the body of the `useCallback` (keep the outer signature) so it builds `prompts` from i18n. The block to change:

```typescript
const insertPlanExecuteSuggestion = useCallback(
  (savedCount: number, pendingCount: number) => {
    if (savedCount <= 0) return
    setMessages((prev) => [
      ...prev,
      {
        id: makeId(),
        role: "assistant" as const,
        textContent: "",
        toolCalls: [],
        planExecuteSuggestion: {
          savedCount,
          pendingCount,
          dismissed: false,
        },
        timestamp: new Date(),
      },
    ])
  },
  [],
)
```

Becomes:

```typescript
const insertPlanExecuteSuggestion = useCallback(
  (savedCount: number, pendingCount: number) => {
    if (savedCount <= 0) return
    const prompts: string[] = [
      t("pe_chip_research_and_tailor", savedCount),
      t("pe_chip_analyze_match"),
      t("pe_chip_prioritize_by_prefs"),
    ]
    setMessages((prev) => [
      ...prev,
      {
        id: makeId(),
        role: "assistant" as const,
        textContent: "",
        toolCalls: [],
        planExecuteSuggestion: {
          prompts,
          savedCount,
          pendingCount,
          dismissed: false,
        },
        timestamp: new Date(),
      },
    ])
  },
  [t],
)
```

At the top of `useChat.ts`, add the i18n import if absent:

```typescript
import { useLanguage } from "@/contexts/LanguageContext"
```

And inside the hook body, before the callbacks, add:

```typescript
const { t } = useLanguage()
```

- [ ] **Step 2: 把 `acceptPlanExecuteSuggestion` 改成 `pickPlanExecuteSuggestionPrompt`**

Locate `acceptPlanExecuteSuggestion` (it currently dismisses the bubble + calls `startPlanExecute(...)`). Rename and rewrite:

```typescript
const pickPlanExecuteSuggestionPrompt = useCallback(
  (assistantId: string, promptText: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId && m.planExecuteSuggestion
          ? {
              ...m,
              planExecuteSuggestion: {
                ...m.planExecuteSuggestion,
                dismissed: true,
              },
            }
          : m,
      ),
    )
    void sendMessage(promptText)
  },
  [sendMessage],
)
```

Update the `return { ... }` object of the hook: replace `acceptPlanExecuteSuggestion` with `pickPlanExecuteSuggestionPrompt`.

- [ ] **Step 3: `MessageBubble` 转发新回调**

In `frontend/components/chat/MessageBubble.tsx`, find the existing `onAccept` prop plumbed to `PlanExecuteSuggestionCard`. Replace with an `onPick: (prompt: string) => void` prop that wires through. The JSX:

```tsx
<PlanExecuteSuggestionCard
  suggestion={message.planExecuteSuggestion}
  onAccept={() => onAcceptPlanExecuteSuggestion?.(message.id)}
/>
```

Becomes:

```tsx
<PlanExecuteSuggestionCard
  suggestion={message.planExecuteSuggestion}
  onPick={(prompt) => onPickPlanExecuteSuggestionPrompt?.(message.id, prompt)}
/>
```

Update the component's TypeScript props accordingly: rename `onAcceptPlanExecuteSuggestion?: (id: string) => void` to `onPickPlanExecuteSuggestionPrompt?: (id: string, prompt: string) => void`.

- [ ] **Step 4: `ChatPanel` 传新回调**

In `frontend/components/chat/ChatPanel.tsx`, find where `acceptPlanExecuteSuggestion` is destructured from `useChat` and passed into `MessageBubble`. Rename both sites:

```tsx
const { ..., acceptPlanExecuteSuggestion } = useChat(...)
// ...
<MessageBubble ... onAcceptPlanExecuteSuggestion={acceptPlanExecuteSuggestion} />
```

Becomes:

```tsx
const { ..., pickPlanExecuteSuggestionPrompt } = useChat(...)
// ...
<MessageBubble ... onPickPlanExecuteSuggestionPrompt={pickPlanExecuteSuggestionPrompt} />
```

- [ ] **Step 5: 添加 handoff 检测**

Still in `useChat.ts`, find where chat SSE chunks are dispatched. The existing stream loop for `/chat/stream` parses chunks into `StreamChunk` and handles `tool_call` / `tool_result` by updating `toolCalls[]`. Add handoff detection right after successful JSON parse and before the normal tool_result application:

```typescript
// Inside the chat-stream reader loop, where `chunk: StreamChunk` is
// parsed from an SSE data line:

if (
  chunk.type === "tool_result" &&
  chunk.tool_name === "start_plan_execute"
) {
  // Handoff: parse marker, switch to PE stream. Swallow this event
  // (don't render as a regular tool_result card).
  try {
    const parsed = JSON.parse(chunk.content || "{}") as {
      __plan_execute_handoff__?: boolean
      goal?: string
    }
    if (parsed.__plan_execute_handoff__ && parsed.goal) {
      // Close the chat reader early; the assistant placeholder
      // is about to be re-used for the PE view.
      try {
        await reader.cancel()
      } catch {
        /* noop */
      }
      await runPlanExecuteOnAssistant(assistantId, parsed.goal)
      return
    }
  } catch {
    // fall through — treat as a normal tool_result
  }
}
```

Introduce a new helper `runPlanExecuteOnAssistant(assistantId, goal)` inside the hook. It mirrors the existing `startPlanExecute` but **re-uses** the current assistant message id instead of creating a new one. **Placement:** declare this `useCallback` *before* `sendMessage`'s `useCallback` so the closure inside `sendMessage`'s handoff branch can reference it by name.

```typescript
const runPlanExecuteOnAssistant = useCallback(
  async (assistantId: string, goal: string) => {
    // Convert the placeholder into a PE view in-place.
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId
          ? {
              ...m,
              textContent: "",
              toolCalls: [],
              planExecute: {
                steps: [],
                finalResponse: null,
                errorMsg: null,
                running: true,
                threadId: null,
                awaitingApproval: false,
                approvalRound: 0,
                revisionReason: null,
                cancelled: false,
              },
            }
          : m,
      ),
    )
    const response = await apiStartPlanExecute(sessionToken, goal)
    if (!response.ok || !response.body) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId && m.planExecute
            ? {
                ...m,
                planExecute: {
                  ...m.planExecute,
                  errorMsg: `HTTP ${response.status}`,
                  running: false,
                },
              }
            : m,
        ),
      )
      return
    }
    const r = response.body.getReader()
    const dec = new TextDecoder()
    let buf = ""
    for (;;) {
      const { value, done } = await r.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const blocks = buf.split("\n\n")
      buf = blocks.pop() ?? ""
      for (const block of blocks) {
        const line = block.split("\n").find((l) => l.startsWith("data: "))
        if (!line) continue
        const payload = line.slice(6).trim()
        if (!payload) continue
        let pc: PlanStreamChunk
        try {
          pc = JSON.parse(payload) as PlanStreamChunk
        } catch {
          continue
        }
        applyPlanChunkToMessage(setMessages, assistantId, pc)
      }
    }
    setMessages((prev) =>
      prev.map((m) =>
        m.id === assistantId && m.planExecute && m.planExecute.running
          ? { ...m, planExecute: { ...m.planExecute, running: false } }
          : m,
      ),
    )
  },
  [sessionToken],
)
```

- [ ] **Step 6: TS check**

Run: `cd frontend && pnpm exec tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add frontend/hooks/useChat.ts frontend/components/chat/MessageBubble.tsx frontend/components/chat/ChatPanel.tsx
git commit -m "$(cat <<'EOF'
feat(pe-handoff): chat stream hands off to PE on start_plan_execute marker

- useChat: detect tool_result with tool_name=start_plan_execute, parse the
  JSON marker, cancel the chat reader, and switch the same assistant
  message into a PE view — fed by a fresh /plan-execute SSE stream.
- insertPlanExecuteSuggestion now builds 3 localized chip prompts.
- pickPlanExecuteSuggestionPrompt (replaces acceptPlanExecuteSuggestion)
  dismisses the bubble and sendMessage()s the chip text as if the user
  typed it — the main agent then self-upgrades via start_plan_execute
  when the prompt warrants it.
- MessageBubble + ChatPanel: prop rename from onAccept... to onPick...
EOF
)"
```

---

## Task 8 · 端到端手动 E2E 验证

**Files:**
- No code changes.

- [ ] **Step 1: 启动后端 + 前端**

```bash
make dev &
cd frontend && pnpm dev &
```

Wait for `http://localhost:3000` and `http://localhost:8000/health` to respond 200.

- [ ] **Step 2: E2E Case A — 自然语言触发 PE**

In browser: log in, open a fresh session, send:

```
研究字节跳动和 Shein 这两家公司，并为每家针对性润色我的简历
```

Expected SSE events (inspect Network tab `/chat/stream` then `/chatbot/plan-execute`):
1. `/chat/stream` → `tool_call` with `tool_name: "start_plan_execute"`
2. `/chat/stream` → `tool_result` with `tool_name: "start_plan_execute"` and `content` containing `__plan_execute_handoff__`
3. `/chat/stream` closes
4. `/chatbot/plan-execute` opens; `plan_created` with 3–6 steps
5. Steps stream live (tool pills + text), approval gate fires
6. Approve → executor runs, final_response on completion

Expected UI:
- Single assistant bubble, no orphan tool-card rendered for `start_plan_execute`
- Bubble transforms from empty → PE view with plan timeline
- Approval card appears; approve; stream finishes

- [ ] **Step 3: E2E Case B — Chips 入口**

Still logged in, new session. Send: `找 5 个上海的 Agent Engineer 岗位`. Wait for `JobSearchResultCard`. Select 3, click `保存到看板`.

Expected:
- `JobSearchResultCard` shows `已保存 3 条` badge
- New assistant bubble below with header "已保存 3 个职位到看板 · 想做什么？" and 3 chip buttons with ↗ arrows
- Click the first chip (`帮我研究这 3 家公司...`)
- Chip bubble disappears
- A new user bubble with exactly the chip text appears
- Flow proceeds as Case A (handoff → PE stream → approval → execution)

- [ ] **Step 4: E2E Case C — 非升级路径**

New session. Send: `找 Python 工程师职位`.

Expected:
- NO `start_plan_execute` tool call in `/chat/stream`
- Single `job_search_tool` call → result card → done
- No PE stream initiated

This verifies the HARD RULE examples prevent over-escalation.

- [ ] **Step 5: E2E Case D — Cover letter tool 不再被调用**

New session. Send: `帮我写一封求职信投字节跳动`.

Expected:
- Agent does NOT call `cover_letter_tool` (it is no longer registered)
- Agent either (a) asks if the user wants resume tailoring instead, or
  (b) falls back to plain-text drafting. Either behavior is acceptable;
  the only hard check is that `cover_letter_tool` never appears in the
  SSE stream.

- [ ] **Step 6: Commit E2E checklist results**

If all 4 cases pass, no code change is needed. If any case fails:
- Case A/B handoff breakage → revisit Task 7 Step 5
- Case C over-escalation → tighten examples in Task 2 Step 3
- Case D still calls cover_letter → verify Task 1 Step 2 unregistered it

No commit in this task unless a follow-up fix is needed.

---

## Out-of-scope (explicitly not in this plan)

- **删除 `cover_letter.py` 源文件**：保留作为历史参考，避免 migration 风险；若未来确认无引用可在后续 PR 删除。
- **Chip 文本动态化**（用 LLM 生成）：静态模板够用且零额外延迟；动态化值不抵复杂度。
- **保存以外的 chip 入口**（空会话、看板超时）：scope creep；先验证保存路径是否工作再扩展。
- **Kanban 页的 PE 按钮**：当前 PR 不动；用户要求的范围集中在聊天流。
