# Save-to-PE Suggestion Bubble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户在 JobSearchResultCard 点"保存到看板"成功后，自动在对话流插入一条 assistant 气泡"已保存 N 个职位...要自动处理吗？[立即处理]"；点击后移除气泡并触发 P&E。同时删除 chat header 的永久 P&E pill。

**Architecture:** 纯前端改动。ChatMessage 增加 `planExecuteSuggestion` 字段作为 discriminator。useChat 新增 `insertPlanExecuteSuggestion` / `acceptPlanExecuteSuggestion` 两个回调。JobSearchResultCard 暴露 `onSaved(count)` prop，经由 MessageBubble → ChatPanel 链路到达 useChat。PlanExecuteSuggestionCard 负责渲染。localStorage 缓存规则扩展覆盖非 dismissed suggestion。

**Tech Stack:** Next.js 16、React 19、既有 useChat / MessageBubble / ChatPanel。

**仓库约定：** 无 pytest。验证：`pnpm exec tsc --noEmit`、手动 E2E checklist。

---

## 文件结构

```
frontend/
├── lib/types.ts                                       # [改] PlanExecuteSuggestion 接口 + ChatMessage 字段
├── hooks/useChat.ts                                   # [改] 2 新方法 + cache 过滤扩展
├── components/plan/PlanExecuteSuggestionCard.tsx      # [新]
├── components/chat/JobSearchResultCard.tsx            # [改] onSaved 回调
├── components/chat/MessageBubble.tsx                  # [改] suggestion 渲染分支 + 回调透传
└── components/chat/ChatPanel.tsx                      # [改] 删 header pill + save 回调串联
```

---

## Task 1 · 扩展前端类型

**Files:**
- Modify: `frontend/lib/types.ts`

- [ ] **Step 1: 在 ChatMessage 接口附近新增 PlanExecuteSuggestion 接口**

找到 `PlanExecuteView` 接口定义（约 44 行）。在它**下方**（但在 `ChatMessage` 接口之前）新增：

```typescript
export interface PlanExecuteSuggestion {
  savedCount: number
  pendingCount: number
  dismissed: boolean
}
```

- [ ] **Step 2: 给 ChatMessage 加一个可选字段**

找到 `ChatMessage` 接口：

```typescript
export interface ChatMessage {
  id: string
  role: MessageRole
  textContent: string
  toolCalls: ToolCallEntry[]
  thinking?: ThinkingEntry
  timestamp?: Date
  planExecute?: PlanExecuteView
}
```

追加 `planExecuteSuggestion` 字段：

```typescript
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
```

- [ ] **Step 3: TS check**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && git add frontend/lib/types.ts
git commit -m "feat(suggest): add PlanExecuteSuggestion type + ChatMessage field"
```

---

## Task 2 · useChat 新方法 + cache 扩展

**Files:**
- Modify: `frontend/hooks/useChat.ts`

- [ ] **Step 1: 扩展 savePlanExecuteCache 过滤规则**

找到文件顶部的 `savePlanExecuteCache` 函数（大约在 `PE_CACHE_PREFIX` 常量下方）。当前过滤仅保留 `planExecute && !running` 的消息。

把过滤条件替换为：

```typescript
function savePlanExecuteCache(sessionId: string, messages: ChatMessage[]): void {
  if (typeof window === "undefined") return
  const toCache = messages.filter((m) => {
    // Completed / awaiting P&E bubbles
    if (m.planExecute && !m.planExecute.running) return true
    // Non-dismissed suggestion bubbles (dismissed ones shouldn't survive refresh)
    if (m.planExecuteSuggestion && !m.planExecuteSuggestion.dismissed) return true
    return false
  })
  try {
    if (toCache.length === 0) {
      localStorage.removeItem(PE_CACHE_PREFIX + sessionId)
    } else {
      localStorage.setItem(PE_CACHE_PREFIX + sessionId, JSON.stringify(toCache))
    }
  } catch {
    // silent: localStorage quota / JSON cycles etc
  }
}
```

(Existing `loadPlanExecuteCache` already revives `Date` from JSON string — no change.)

- [ ] **Step 2: 在 useChat 里新增 insertPlanExecuteSuggestion**

在 `startPlanExecute` 的 `useCallback` **之后**（`resumePlanExecute` 之前）插入：

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
          timestamp: new Date(),
          planExecuteSuggestion: {
            savedCount,
            pendingCount,
            dismissed: false,
          },
        },
      ])
    },
    [],
  )
```

- [ ] **Step 3: 新增 acceptPlanExecuteSuggestion**

紧接在 `insertPlanExecuteSuggestion` 下方：

```typescript
  const acceptPlanExecuteSuggestion = useCallback(
    async (suggestionMsgId: string) => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === suggestionMsgId && m.planExecuteSuggestion
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
      await startPlanExecute()
    },
    [startPlanExecute],
  )
```

- [ ] **Step 4: 导出两个新方法**

找到 hook 末尾的 return 对象，追加两个新方法：

```typescript
  return {
    messages,
    streaming,
    error,
    historyLoading,
    sendMessage,
    startPlanExecute,
    resumePlanExecute,
    insertPlanExecuteSuggestion,
    acceptPlanExecuteSuggestion,
    clearMessages,
  }
```

- [ ] **Step 5: TS check**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && git add frontend/hooks/useChat.ts
git commit -m "feat(suggest): useChat exposes insert/accept PlanExecuteSuggestion"
```

---

## Task 3 · 新组件 PlanExecuteSuggestionCard

**Files:**
- Create: `frontend/components/plan/PlanExecuteSuggestionCard.tsx`

- [ ] **Step 1: 创建组件文件**

写入 EXACTLY：

```tsx
"use client"

import type { PlanExecuteSuggestion } from "@/lib/types"

interface PlanExecuteSuggestionCardProps {
  suggestion: PlanExecuteSuggestion
  onAccept: () => void
  disabled?: boolean
}

export function PlanExecuteSuggestionCard({
  suggestion,
  onAccept,
  disabled = false,
}: PlanExecuteSuggestionCardProps) {
  if (suggestion.dismissed) return null

  const { savedCount, pendingCount } = suggestion
  const countSummary =
    pendingCount > savedCount
      ? `已保存 ${savedCount} 个职位到看板，共 ${pendingCount} 条待处理`
      : `已保存 ${savedCount} 个职位到看板`

  return (
    <div className="rounded-lg border border-indigo-300 bg-indigo-50 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm text-indigo-900">
        <span className="text-base leading-none">💼</span>
        <span>{countSummary}，要我现在帮你自动处理吗？</span>
      </div>
      <div className="flex justify-end">
        <button
          type="button"
          onClick={onAccept}
          disabled={disabled}
          className="rounded-full bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          ✓ 立即处理
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TS check**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 3: Commit**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && git add frontend/components/plan/PlanExecuteSuggestionCard.tsx
git commit -m "feat(suggest): add PlanExecuteSuggestionCard component"
```

---

## Task 4 · JobSearchResultCard 暴露 onSaved 回调

**Files:**
- Modify: `frontend/components/chat/JobSearchResultCard.tsx`

- [ ] **Step 1: 扩展 Props 接口**

找到：

```typescript
interface Props {
  entry: ToolCallEntry
}

export function JobSearchResultCard({ entry }: Props) {
```

改成：

```typescript
interface Props {
  entry: ToolCallEntry
  onSaved?: (savedCount: number) => void
}

export function JobSearchResultCard({ entry, onSaved }: Props) {
```

- [ ] **Step 2: 在 handleSave 成功路径里调用 onSaved**

找到 `handleSave` 函数里 `setStatus("saved")` 的下一行（紧接着设置 feedback 的 if/else 块）。在 **feedback 设置之后、catch 之前**插入 `onSaved` 调用：

```typescript
      setStatus("saved")
      if (res.skipped > 0) {
        setFeedback(`已保存 ${res.inserted} 条，${res.skipped} 条已存在`)
      } else {
        setFeedback(`已保存 ${res.inserted} 条到看板`)
      }
      if (onSaved && res.inserted > 0) {
        onSaved(res.inserted)
      }
```

只有当**实际新插入**（`res.inserted > 0`）时才触发。如果全部是重复导致 inserted=0，不打扰用户。

- [ ] **Step 3: TS check**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 4: Commit**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && git add frontend/components/chat/JobSearchResultCard.tsx
git commit -m "feat(suggest): JobSearchResultCard exposes onSaved(count) callback"
```

---

## Task 5 · MessageBubble 渲染 suggestion + 透传 onSaved

**Files:**
- Modify: `frontend/components/chat/MessageBubble.tsx`

- [ ] **Step 1: 在顶部 imports 新增 PlanExecuteSuggestionCard**

在 `import { PlanTimelineView } from "@/components/plan/PlanTimeline"` 附近，新增一行：

```tsx
import { PlanExecuteSuggestionCard } from "@/components/plan/PlanExecuteSuggestionCard"
```

- [ ] **Step 2: 扩展 Props 接口**

找到现有的 Props interface（有 `message`, `isStreaming`, `onResume` 三个字段），追加：

```tsx
interface Props {
  message: ChatMessage
  isStreaming?: boolean
  onResume?: (
    messageId: string,
    args: { action: "approve" | "revise" | "cancel"; feedback?: string },
  ) => void
  onSuggestionTrigger?: (savedCount: number) => void
  onSuggestionAccept?: (suggestionMsgId: string) => void
}
```

解构签名里也加上：

```tsx
export function MessageBubble({
  message,
  isStreaming,
  onResume,
  onSuggestionTrigger,
  onSuggestionAccept,
}: Props) {
```

- [ ] **Step 3: 把 onSaved 传给 JobSearchResultCard**

找到：

```tsx
tc.toolName === "job_search_tool" && tc.status === "done" ? (
  <JobSearchResultCard key={tc.toolCallId} entry={tc} />
)
```

改成：

```tsx
tc.toolName === "job_search_tool" && tc.status === "done" ? (
  <JobSearchResultCard
    key={tc.toolCallId}
    entry={tc}
    onSaved={onSuggestionTrigger}
  />
)
```

- [ ] **Step 4: 新增 suggestion 渲染分支**

在现有 `{!isUser && message.planExecute && (...)}` 块**之前**插入一个 suggestion 渲染分支（确保 suggestion bubble 在 planExecute bubble 之上、与普通 tool_call 同层）：

```tsx
        {/* Plan-Execute suggestion bubble (assistant only) */}
        {!isUser && message.planExecuteSuggestion && (
          <div className="mb-2">
            <PlanExecuteSuggestionCard
              suggestion={message.planExecuteSuggestion}
              onAccept={
                onSuggestionAccept
                  ? () => onSuggestionAccept(message.id)
                  : () => undefined
              }
              disabled={isStreaming}
            />
          </div>
        )}
```

- [ ] **Step 5: 让 text bubble 不要在 suggestion 存在时还渲染空白区**

找到：

```tsx
{!message.planExecute && (message.textContent || isStreaming) && (
```

改成：

```tsx
{!message.planExecute && !message.planExecuteSuggestion && (message.textContent || isStreaming) && (
```

这避免 suggestion-only 消息下方多出一个空 text 气泡。

- [ ] **Step 6: TS check**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 7: Commit**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && git add frontend/components/chat/MessageBubble.tsx
git commit -m "feat(suggest): MessageBubble renders PlanExecuteSuggestionCard + forwards onSaved"
```

---

## Task 6 · ChatPanel 串联 + 删 header pill

**Files:**
- Modify: `frontend/components/chat/ChatPanel.tsx`

- [ ] **Step 1: 从 useChat 解构新方法**

找到：

```tsx
const {
  messages,
  streaming,
  error,
  historyLoading,
  sendMessage,
  startPlanExecute,
  resumePlanExecute,
} = useChat({...})
```

扩展为：

```tsx
const {
  messages,
  streaming,
  error,
  historyLoading,
  sendMessage,
  startPlanExecute,
  resumePlanExecute,
  insertPlanExecuteSuggestion,
  acceptPlanExecuteSuggestion,
} = useChat({...})
```

- [ ] **Step 2: 添加 handleSaved 工具函数**

在 `useEffect` 块与 JSX return 之间，新增一个 useCallback：

```tsx
const handleSaved = useCallback(
  async (savedCount: number) => {
    if (savedCount <= 0) return
    // Refresh pending count to get the authoritative total after inserts.
    const token = getSessionToken()
    let latestPending = pendingCount + savedCount
    if (token) {
      try {
        const { applications } = await apiListApplications(token)
        latestPending = applications.filter((a) => a.status === "pending").length
        setPendingCount(latestPending)
      } catch {
        // fall through with optimistic count
      }
    }
    insertPlanExecuteSuggestion(savedCount, latestPending)
  },
  [insertPlanExecuteSuggestion, pendingCount],
)
```

顶部 imports 中确认已有 `useCallback`（大部分情况已有）；如无则从 react import。

- [ ] **Step 3: 删除 header 的 P&E pill**

找到 ChatPanel 顶部 header 区域里类似如下的 pill 按钮（文本 `自动处理看板 · {pendingCount} 个`）：

```tsx
{pendingCount > 0 && (
  <button
    onClick={() => startPlanExecute()}
    disabled={streaming}
    className="..."
  >
    自动处理看板 · {pendingCount} 个
  </button>
)}
```

**整段删除**。（空状态 quick-prompt 区里的同类按钮保留，不要动。）

- [ ] **Step 4: 把 onSuggestionTrigger / onSuggestionAccept 传给 MessageBubble**

找到 `messages.map(...)` 渲染 `<MessageBubble ... />` 的地方，扩展 props：

```tsx
{messages.map((msg, i) => (
  <MessageBubble
    key={msg.id}
    message={msg}
    isStreaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
    onResume={(mid, args) => {
      const threadId = msg.planExecute?.threadId
      if (!threadId) return
      resumePlanExecute(mid, {
        threadId,
        action: args.action,
        feedback: args.feedback,
      })
    }}
    onSuggestionTrigger={handleSaved}
    onSuggestionAccept={acceptPlanExecuteSuggestion}
  />
))}
```

- [ ] **Step 5: TS check**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent/frontend && pnpm exec tsc --noEmit
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```
cd /Users/young/Downloads/repos/Job-Hunter-Agent && git add frontend/components/chat/ChatPanel.tsx
git commit -m "feat(suggest): ChatPanel wires save→suggestion flow, drops header PE pill"
```

---

## Task 7 · 手动 E2E

**Files:** 无代码。验证走查。

- [ ] **Step 1: 环境就绪**

确认后端在 8000 且前端 HMR 正常；准备一个能搜出几条职位的账号；在 devtools console 清一次旧缓存：

```
Object.keys(localStorage).filter(k => k.startsWith("pe_session_")).forEach(k => localStorage.removeItem(k));
location.reload();
```

- [ ] **Step 2: 依次勾选**

- [ ] 进入对话页，**chat header 没有** "自动处理看板 · N 个" pill
- [ ] **空状态**（新对话）的 quick prompt 区仍保留"自动处理看板 · N 个"按钮
- [ ] 输入"帮我搜上海 Agent 工程师" → 返回 JobSearchResultCard → 勾选 2 条 → 点"保存到看板"
- [ ] save 成功后 → **对话流底部出现 suggestion 气泡**："已保存 2 个职位到看板...要我现在帮你自动处理吗？[✓ 立即处理]"
- [ ] 点击"立即处理" → **suggestion 气泡消失** → **P&E 气泡出现**（"等你确认 · 第 1 轮" 或直接开始执行，取决于 HITL 路径）
- [ ] 再搜一次 + 保存一条 → 出现**新的一条** suggestion 气泡（和之前独立）
- [ ] 刷新页面 → 未点击过的 suggestion 气泡仍在对话流里；已点击过的（已 dismissed）不再显示
- [ ] 故意断网 → 点保存 → 失败提示出现，**无 suggestion 气泡插入**

- [ ] **Step 3: 记录结果**

全部 checklist 过 → 空提交收尾：

```
git commit --allow-empty -m "chore(suggest): e2e verification passed"
```

---

## Self-Review

**1. Spec coverage** (对照 spec §1–§12)：
- §2 架构（删 pill、新增 save→suggestion→P&E 路径）→ Task 6（删 pill）+ Task 4 (onSaved) + Task 5 (render) + Task 6 (wire)
- §3 ChatMessage 新字段 → Task 1
- §4 触发链：onSaved → onSuggestionTrigger → insertPlanExecuteSuggestion → Task 4/5/6
- §5 useChat 两方法 → Task 2
- §6 组件 → Task 3（card）+ Task 5（integration）
- §7 时序图 → 由 Task 4-6 共同实现
- §8 持久化规则扩展 → Task 2 Step 1
- §9 错误处理 → Task 4 Step 2（inserted=0 跳过）+ Task 6 Step 2 降级分支
- §10 文件规划 → 1:1 映射
- §11 E2E checklist → Task 7
- §12 简历价值 → 实施完可引用

**2. Placeholder scan:** 无 TBD/TODO，所有步骤含完整代码。

**3. Type consistency:**
- `PlanExecuteSuggestion` 三字段 Task 1 定义，Task 2/3/5/6 引用一致
- `onSaved(savedCount: number)` 签名 Task 4 定义，Task 5 Props `onSuggestionTrigger?: (savedCount: number) => void` 匹配
- `acceptPlanExecuteSuggestion(suggestionMsgId: string)` Task 2 定义，Task 5 传入 `message.id`，Task 6 直接转发，签名贯通
- `insertPlanExecuteSuggestion(savedCount, pendingCount)` Task 2 定义，Task 6 handleSaved 调用签名一致

无需修补。
