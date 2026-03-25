# Tool Call Streaming UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `ToolCallCard` to show request/response JSON details with auto-expand during streaming and auto-collapse when done, in the project's glass aesthetic.

**Architecture:** A new `highlightJson` utility handles XSS-safe JSON syntax coloring. `ToolCallCard` is rewritten with local `expanded` state that initializes from `isStreaming` and auto-collapses via a `useEffect` guard. `MessageBubble` passes the existing `isStreaming` prop one level deeper to `ToolCallCard`.

**Tech Stack:** Next.js (App Router), React, Tailwind CSS v4, TypeScript. No new dependencies.

> **Note:** This repository has no automated test framework. Each task uses visual/runtime verification instead of unit tests.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `frontend/lib/highlightJson.ts` | **Create** | XSS-safe JSON syntax highlighter — pure function, no React |
| `frontend/lib/i18n.ts` | **Modify** | Add 6 new i18n keys to `zh` and `en` dicts |
| `frontend/components/chat/ToolCallCard.tsx` | **Rewrite** | New Props interface, expand/collapse logic, JSON sections |
| `frontend/components/chat/MessageBubble.tsx` | **Modify** | Pass `isStreaming` prop to `<ToolCallCard>` call site |

`lib/types.ts`, `hooks/useChat.ts`, `app/chat/page.tsx`, and `ChatPanel.tsx` are **not touched**.

---

## Task 1: Create `highlightJson` utility

**Files:**
- Create: `frontend/lib/highlightJson.ts`

- [ ] **Step 1: Create the file**

```typescript
// frontend/lib/highlightJson.ts

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Returns an HTML string with syntax-colored <span> tags for JSON display.
 * All text content is HTML-escaped to prevent XSS.
 * Falls back to HTML-escaped plain text if input is not valid JSON.
 */
export function highlightJson(input: string): string {
  let pretty: string
  try {
    pretty = JSON.stringify(JSON.parse(input), null, 2)
  } catch {
    return escapeHtml(input)
  }

  // Classic single-pass JSON token regex
  const tokenRegex =
    /("(?:\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(?:true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g

  let result = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenRegex.exec(pretty)) !== null) {
    // Escape and append the non-token segment before this match
    result += escapeHtml(pretty.slice(lastIndex, match.index))

    const token = match[0]
    let color: string

    if (token.startsWith('"')) {
      // Key: ends with optional whitespace + colon
      color = token.trimEnd().endsWith(':') ? '#9b1c3a' : '#1a6b3c'
    } else if (token === 'true' || token === 'false' || token === 'null') {
      color = 'rgba(20,18,16,0.55)'
    } else {
      color = '#7c4d00' // number
    }

    result += `<span style="color:${color}">${escapeHtml(token)}</span>`
    lastIndex = match.index + token.length
  }

  result += escapeHtml(pretty.slice(lastIndex))
  return result
}
```

- [ ] **Step 2: Verify the file compiles**

Run the dev server and check for TypeScript errors:
```bash
cd frontend && pnpm dev
```
Expected: no TypeScript error referencing `highlightJson.ts`. The file exports a function but nothing imports it yet — that's fine.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/highlightJson.ts
git commit -m "feat: add highlightJson utility with XSS-safe JSON syntax coloring"
```

---

## Task 2: Add i18n keys

**Files:**
- Modify: `frontend/lib/i18n.ts`

The existing pattern: `zh` dict and `en` dict both live in the same file. Add under the `// Tool call card` comment block.

- [ ] **Step 1: Add keys to the `zh` dict**

In `frontend/lib/i18n.ts`, find the existing `tool_running: '运行中…',` line under `// Tool call card` in the `zh` dict.
Leave `tool_running` in place and **add the following 6 lines directly after it**:

```typescript
  tool_expand: '展开',
  tool_collapse: '收起',
  tool_request: '请求参数',
  tool_response: '响应结果',
  tool_no_content: '（无内容）',
  tool_fetching: '获取中…',
```

- [ ] **Step 2: Add keys to the `en` dict**

Find `tool_running: 'running…',` under `// Tool call card` in the `en` dict.
Leave `tool_running` in place and **add the following 6 lines directly after it**:

```typescript
  tool_expand: 'Show',
  tool_collapse: 'Hide',
  tool_request: 'Request',
  tool_response: 'Response',
  tool_no_content: '(empty)',
  tool_fetching: 'Fetching…',
```

- [ ] **Step 3: Verify TypeScript compiles**

Check the dev server — no type errors expected since the `Dict` type is `Record<string, StringValue | FnValue>`.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/i18n.ts
git commit -m "feat: add tool call i18n keys for request/response sections"
```

---

## Task 3: Rewrite `ToolCallCard`

**Files:**
- Rewrite: `frontend/components/chat/ToolCallCard.tsx`

**Context to understand first:**
- `ToolCallEntry` type (`frontend/lib/types.ts`): `{ toolCallId, toolName, callingContent: string, resultContent?: string, status: "calling" | "done" }`
- Current card: static, no toggle, only shows `resultContent` as plain text
- `useLanguage()` returns `{ t }` where `t(key)` resolves via `frontend/contexts/LanguageContext.tsx`

- [ ] **Step 1: Write the new component**

Replace the entire contents of `frontend/components/chat/ToolCallCard.tsx`:

```typescript
"use client"

import { useState, useRef, useEffect } from "react"
import type { ToolCallEntry } from "@/lib/types"
import { useLanguage } from "@/contexts/LanguageContext"
import { highlightJson } from "@/lib/highlightJson"

const TOOL_LABELS: Record<string, string> = {
  job_search_tool: "Job Search",
  company_research_tool: "Company Research",
  cover_letter_tool: "Cover Letter",
  application_tracker_tool: "Application Tracker",
  job_preferences_tool: "Preferences",
  duckduckgo_search: "Web Search",
}

/** Extracts the first string/number key-value from a JSON string for the header preview. */
function extractKeyParamPreview(callingContent: string): string {
  if (!callingContent) return ""
  try {
    const parsed = JSON.parse(callingContent)
    if (typeof parsed !== "object" || parsed === null) return ""
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") return `${key}: "${value}"`
      if (typeof value === "number") return `${key}: ${value}`
    }
    return ""
  } catch {
    return ""
  }
}

interface Props {
  entry: ToolCallEntry
  isStreaming?: boolean
}

export function ToolCallCard({ entry, isStreaming }: Props) {
  const { t } = useLanguage()
  const label = TOOL_LABELS[entry.toolName] ?? entry.toolName
  const isRunning = entry.status === "calling"
  const isDone = entry.status === "done"

  // Initialize expanded based on whether streaming is active at mount time.
  // Cards created during streaming start expanded; historical cards start collapsed.
  const [expanded, setExpanded] = useState(isStreaming === true)

  // Auto-collapse when streaming ends, but only for cards that were streaming.
  // The ref guards against the effect firing redundantly on historical card mounts.
  const wasStreamingRef = useRef(isStreaming === true)
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setExpanded(false)
    }
    if (isStreaming) wasStreamingRef.current = true
  }, [isStreaming])

  const preview = extractKeyParamPreview(entry.callingContent)

  return (
    <div className="glass rounded-xl my-1">
      <div className="overflow-hidden rounded-xl">

        {/* Header */}
        <button
          onClick={() => !isRunning && setExpanded((e) => !e)}
          disabled={isRunning}
          className={`w-full flex items-center gap-2 px-3 py-2 text-left transition-colors ${
            !isRunning ? "hover:bg-white/20 cursor-pointer" : "cursor-default"
          } ${expanded ? "border-b border-[var(--border)]" : ""}`}
        >
          {/* Status dot */}
          <span
            className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${
              isDone
                ? "bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.4)]"
                : "bg-amber-400 animate-pulse"
            }`}
          />

          {/* Tool name */}
          <span className="font-body font-semibold text-sm text-[var(--text-2)] flex-shrink-0">
            {label}
          </span>

          {/* Key param preview */}
          {preview && (
            <span className="font-mono text-xs text-[var(--text-3)] max-w-[180px] truncate flex-shrink min-w-0">
              {preview}
            </span>
          )}

          {/* Right side: running label OR expand/collapse toggle */}
          {isRunning ? (
            <span className="ml-auto font-body font-light text-xs text-[var(--text-3)] animate-pulse flex-shrink-0">
              {t("tool_running")}
            </span>
          ) : (
            <span className="ml-auto font-body text-xs text-[var(--text-3)] flex-shrink-0">
              {expanded ? `${t("tool_collapse")} ∧` : `${t("tool_expand")} ∨`}
            </span>
          )}
        </button>

        {/* Expanded body */}
        {expanded && (
          <>
            {/* Request section — hidden if callingContent is empty */}
            {entry.callingContent.length > 0 && (
              <div className="border-b border-[var(--border)]">
                <div className="px-3 py-1 text-[9px] font-body font-bold tracking-widest uppercase text-[var(--text-3)] bg-black/[0.02]">
                  {t("tool_request")}
                </div>
                <pre
                  className="px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--text-strong-2)] overflow-x-auto"
                  dangerouslySetInnerHTML={{ __html: highlightJson(entry.callingContent) }}
                />
              </div>
            )}

            {/* Response section — always shown when expanded */}
            <div>
              <div className="px-3 py-1 text-[9px] font-body font-bold tracking-widest uppercase text-[var(--text-3)] bg-black/[0.02] border-b border-[var(--border)]">
                {t("tool_response")}
              </div>
              {isRunning ? (
                /* Bounce-dot animation (same pattern as ChatPanel.tsx) */
                <div className="flex items-center gap-2 px-3 py-2">
                  <span className="flex gap-1" aria-hidden="true">
                    <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:300ms]" />
                  </span>
                  <span className="font-body text-xs italic text-[var(--text-3)]">
                    {t("tool_fetching")}
                  </span>
                </div>
              ) : entry.resultContent ? (
                <pre
                  className="px-3 py-2 font-mono text-[11px] leading-relaxed text-[var(--text-strong-2)] max-h-48 overflow-y-auto overflow-x-auto"
                  dangerouslySetInnerHTML={{ __html: highlightJson(entry.resultContent) }}
                />
              ) : (
                <p className="px-3 py-2 font-body text-xs italic text-[var(--text-3)]">
                  {t("tool_no_content")}
                </p>
              )}
            </div>
          </>
        )}

      </div>
    </div>
  )
}
```

- [ ] **Step 2: Check for TypeScript errors in the dev server**

```bash
cd frontend && pnpm dev
```

Expected: no type errors. The component now imports `highlightJson` and uses all 6 new i18n keys.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/chat/ToolCallCard.tsx
git commit -m "feat: rewrite ToolCallCard with expandable JSON request/response sections"
```

---

## Task 4: Update `MessageBubble` to pass `isStreaming`

**Files:**
- Modify: `frontend/components/chat/MessageBubble.tsx:20-26`

- [ ] **Step 1: Pass `isStreaming` to each `ToolCallCard`**

In `frontend/components/chat/MessageBubble.tsx`, find the `ToolCallCard` render:

```typescript
// Before (line ~23)
{message.toolCalls.map((tc) => (
  <ToolCallCard key={tc.toolCallId} entry={tc} />
))}
```

Replace with:

```typescript
{message.toolCalls.map((tc) => (
  <ToolCallCard key={tc.toolCallId} entry={tc} isStreaming={isStreaming} />
))}
```

`isStreaming` is already in scope — it's a prop of `MessageBubble` (`interface Props` line 9).

- [ ] **Step 2: Verify no TypeScript errors**

```bash
cd frontend && pnpm dev
```

Expected: clean compile.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/chat/MessageBubble.tsx
git commit -m "feat: pass isStreaming to ToolCallCard for auto-expand/collapse behavior"
```

---

## Task 5: Integration verification

No automated tests exist in this project. Verify visually via `make dev`.

- [ ] **Step 1: Start the full stack**

```bash
make dev
```

Open `http://localhost:3000`, log in, navigate to the chat tab.

- [ ] **Step 2: Verify streaming behavior**

Send a message that triggers at least one tool call (e.g. *"帮我找上海的 Agent Engineer 岗位"*).

Expected during streaming:
- Tool card(s) appear expanded automatically
- Header shows: amber pulse dot + tool name + key param preview (e.g. `query: "Agent Engineer..."`) + `运行中…`
- Expanded body shows **请求参数** section with syntax-highlighted JSON
- **响应结果** section shows bounce dots animation

Expected after streaming ends:
- All tool cards auto-collapse to header-only
- Header now shows green dot + tool name + preview + `展开 ∨` toggle
- Clicking `展开 ∨` re-opens the card showing both sections with highlighted JSON
- Clicking `收起 ∧` collapses it again

- [ ] **Step 3: Verify historical messages**

Refresh the page. Navigate back to a session with previous tool calls.

Expected:
- All historical tool cards start collapsed (no auto-expand flash)
- Manual toggle works correctly

- [ ] **Step 4: Verify language toggle**

Click the `EN` / `中文` button in the navbar.

Expected:
- Card labels switch: `展开/收起` ↔ `Show/Hide`, `请求参数/响应结果` ↔ `Request/Response`, `获取中…` ↔ `Fetching…`

- [ ] **Step 5: Verify edge cases**

Send a message that triggers `duckduckgo_search` (which returns large JSON results).

Expected:
- Response section scrolls internally (max height ~192px), does not overflow the card
- JSON with URLs, special characters, or nested objects renders safely (no HTML injection)

- [ ] **Step 6: Final commit**

```bash
git add frontend/lib/highlightJson.ts frontend/lib/i18n.ts \
         frontend/components/chat/ToolCallCard.tsx \
         frontend/components/chat/MessageBubble.tsx
git commit -m "feat: tool call streaming UI — expandable JSON detail cards complete"
```

---

## Lint check

Run before opening PR:

```bash
make lint
make format
```

Fix any issues flagged by ruff (backend) — frontend has no lint command configured.
