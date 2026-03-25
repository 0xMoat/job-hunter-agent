# Tool Call Streaming UI — Design Spec

**Date:** 2026-03-25
**Status:** Approved
**Scope:** Frontend only — `ToolCallCard` upgrade + `MessageBubble` micro-change

---

## Problem

The existing `ToolCallCard` shows tool name and result as plain text, but:
- `callingContent` (request arguments) is stored in state and never displayed
- There is no expandable detail view — all content is always visible regardless of length
- The card cannot be collapsed, making long conversations hard to scan
- No differentiation between "currently running" and "done" beyond a color dot

The target user is a developer/power user who wants to observe agent internal execution in real time during streaming.

---

## Goal

Upgrade `ToolCallCard` to display full request/response details with:
- Auto-expand during streaming so execution details are visible as they arrive
- Auto-collapse when the assistant message finishes streaming, keeping the chat clean
- Manual re-expand available for any card via header click
- Syntax-highlighted JSON for both request and response, with plain-text fallback
- Glass aesthetic matching the existing project design language

---

## Design

### Behavior: Expand / Collapse Lifecycle

```
tool_call chunk arrives   →  card created, expanded = true  (isStreaming is true at this point)
tool_result chunk arrives →  card updated with result, expanded unchanged
streaming ends            →  all cards auto-collapse (expanded → false)
user clicks header        →  toggle expanded state manually
```

**State management:**

- `expanded` is **local state** in `ToolCallCard`, initialized from the `isStreaming` prop:
  ```ts
  const [expanded, setExpanded] = useState(isStreaming === true)
  ```
  This means:
  - Cards created during an active stream initialize as `expanded = true`
  - Historical cards loaded with `isStreaming = false` initialize as `expanded = false`

- A `useEffect` watching `isStreaming` fires and sets `expanded = false` whenever `isStreaming` is falsy.
  Use a ref to guard against the redundant fire on initial mount for historical cards:
  ```ts
  const wasStreamingRef = useRef(isStreaming === true)
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      setExpanded(false)
    }
    if (isStreaming) wasStreamingRef.current = true
  }, [isStreaming])
  ```
  This ensures historical cards (which mount with `isStreaming = false`) are never affected by the effect,
  and only cards that have seen a `true → false` transition are auto-collapsed.

**Clarification — two separate signals:**

| Rule | Signal used |
|---|---|
| Auto-collapse on stream end | `isStreaming` prop (`true → false`) |
| Hide toggle button | `entry.status === "calling"` |
| Show bounce-dot animation instead of result | `entry.status === "calling"` |

`isStreaming` controls the lifecycle; `entry.status` controls per-card running state. They are independent: a card can be `status: "done"` while `isStreaming` is still `true` (subsequent tools are still running).

**Error path:** When the stream fails, `useChat.ts` removes the assistant message entirely (`filter`). The `ToolCallCard` components are unmounted and their effects cleaned up — no visible state problem.

### ToolCallCard Structure

```
┌──────────────────────────────────────────────────────┐
│ [●] duckduckgo_search   query: "SWE jobs..."  [收起∧] │  ← Header (always visible)
├──────────────────────────────────────────────────────│
│ 请求参数                                              │  ← shown when expanded AND callingContent non-empty
│   { "query": "software engineer", "max_results": 5 } │
├──────────────────────────────────────────────────────│
│ 响应结果                                              │  ← shown when expanded (always, see below)
│   [{ "title": "...", "url": "..." }]                 │    running: bounce dots; done: result content
└──────────────────────────────────────────────────────┘
```

**Header elements:**

| Element | Description |
|---|---|
| Status dot | Amber pulse = `status === "calling"`; green glow = `status === "done"` |
| Tool name | `font-weight: 600`, `color: var(--text-2)` |
| Key param preview | See "Key Param Preview" section below |
| Toggle button | `t('tool_expand')` / `t('tool_collapse')`; **hidden** when `entry.status === "calling"` |

**Body sections visibility rules:**

- **请求参数 section**: show when `expanded && callingContent.length > 0`
- **响应结果 section**: show when `expanded`, always present in expanded state:
  - If `entry.status === "calling"`: show bounce-dot animation + italic placeholder text
  - If `entry.status === "done"`: show result content (highlighted or plain)
  - If `resultContent` is `undefined` or empty string and `status === "done"`: show a muted "（无内容）" placeholder

**Result section overflow:** `max-h-48 overflow-y-auto` — scrollable, never truncated.

### Key Param Preview

Extracted from `callingContent`. Rules in order:

1. Try `JSON.parse(callingContent)`
2. If successful, find the first key whose value is a string or number
3. Render as `key: "value"` (string) or `key: value` (number)
4. If the first string/number value is not found (e.g. all values are arrays/objects), render nothing
5. If `JSON.parse` fails or `callingContent` is empty, render nothing
6. Truncation: CSS `max-w-[180px] truncate` (single line, ellipsis via Tailwind)

### JSON Syntax Highlighting

A standalone utility `frontend/lib/highlightJson.ts` exports:

```ts
export function highlightJson(input: string): string
// Returns HTML string with <span> tags for syntax coloring.
// Returns HTML-escaped raw input if JSON.parse fails (plain-text fallback).
```

Rendered via `dangerouslySetInnerHTML` inside a `<pre>` tag.

**Security requirement:** All text content (keys and string values) must be HTML-escaped before being wrapped in `<span>` tags. This prevents XSS from tool outputs that contain HTML/script content from external sources (e.g. DuckDuckGo search results).

Escaping function required inside `highlightJson`:
```ts
function escapeHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}
```

**Color tokens (warm palette matching project):**

| Token | Color |
|---|---|
| Key | `#9b1c3a` (dark red) |
| String value | `#1a6b3c` (deep green) |
| Number | `#7c4d00` (brown) |
| Boolean / null | `rgba(20,18,16,0.55)` (muted) |
| Punctuation | `var(--text-strong-2)` |

The regex processes one JSON token at a time in a single pass; no external dependency.

### Glass Styling

Matches existing `ToolCallCard` base (`.glass`, `.rounded-xl`) with these additions:

- **Header**: `border-b border-[var(--border)]` when expanded; `hover:bg-white/20` on cursor hover
- **Section label**: `9px uppercase tracking-widest text-[var(--text-3)] bg-black/[0.02]`
- **Code area**: `font-mono text-[11px] leading-relaxed text-[var(--text-strong-2)]`
- **Running state**: reuse the existing bounce-dot pattern from `ChatPanel.tsx` — three `w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce` spans with `[animation-delay:0ms]`, `[animation-delay:150ms]`, `[animation-delay:300ms]`, followed by italic `t('tool_fetching')` text in `text-[var(--text-3)]`
- **Result area**: `max-h-48 overflow-y-auto`

### i18n

All user-visible strings use `t()` via `useLanguage()`. New keys to add to `frontend/lib/i18n.ts`:

| Key | zh-CN | en |
|---|---|---|
| `tool_expand` | `展开` | `Show` |
| `tool_collapse` | `收起` | `Hide` |
| `tool_request` | `请求参数` | `Request` |
| `tool_response` | `响应结果` | `Response` |
| `tool_no_content` | `（无内容）` | `(empty)` |
| `tool_fetching` | `获取中...` | `Fetching...` |

---

## Files Changed

| File | Change |
|---|---|
| `frontend/lib/highlightJson.ts` | **New** — JSON syntax highlighter with XSS-safe HTML escaping |
| `frontend/lib/i18n.ts` | **Add** — 6 new i18n keys |
| `frontend/components/chat/ToolCallCard.tsx` | **Rewrite** — new Props interface (`isStreaming?: boolean`), expand/collapse logic, JSON sections |
| `frontend/components/chat/MessageBubble.tsx` | **1-prop addition** — add `isStreaming={isStreaming}` to the `<ToolCallCard>` call site |

`lib/types.ts`, `hooks/useChat.ts`, `app/chat/page.tsx`, and `ChatPanel.tsx` are **not modified**.
`ChatPanel.tsx` already passes `isStreaming` correctly to `MessageBubble` — no change needed there.

---

## Edge Cases

| Scenario | Handling |
|---|---|
| `callingContent` is empty string | Hide 请求参数 section entirely |
| `callingContent` is invalid JSON | Plain-text fallback (HTML-escaped), no highlighting |
| `resultContent` is `undefined` or `""` and status is `"done"` | Show muted `t('tool_no_content')` placeholder |
| `resultContent` is very long | `max-h-48 overflow-y-auto`, never truncated |
| Historical messages on load | `isStreaming = false` at mount → `useState(false)` → all cards start collapsed |
| Multiple tool calls in one message | Each `ToolCallCard` manages its own `expanded` state independently |
| User manually expands a card after auto-collapse | Toggle works normally via header click |
| Stream errors mid-way | Assistant message removed entirely; cards unmounted; no visible state issue |
| First JSON value is array/object (no string/number key) | Key param preview is hidden |
| Tool result contains HTML or `<script>` | Escaped by `escapeHtml()` in `highlightJson`, XSS neutralized |

---

## Out of Scope

- Backend / SSE stream changes
- Adding new chunk types to `useChat.ts`
- Timeline view or sidebar panel layout
- Tool call grouping header ("N 个工具调用")
- Copy-to-clipboard button on JSON sections
