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
tool_call chunk arrives   →  card created, expanded = true
tool_result chunk arrives →  card updated with result, still expanded = true
streaming ends            →  all cards auto-collapse (expanded = false)
user clicks header        →  toggle expanded state manually
```

- `expanded` is **local state** in `ToolCallCard` (`useState(true)`)
- A `useEffect` watching `isStreaming` fires when `true → false` and sets `expanded = false`
- The toggle button is **hidden while running** (no manual collapse mid-execution)
- Historical messages loaded from API start with `expanded = false` because `isStreaming` is `false` at mount time

### ToolCallCard Structure

```
┌──────────────────────────────────────────────────────┐
│ [●] duckduckgo_search   query: "SWE jobs..."  [收起∧] │  ← Header (always visible)
├──────────────────────────────────────────────────────│
│ 请求参数                                              │  ← shown when expanded
│   { "query": "software engineer", "max_results": 5 } │
├──────────────────────────────────────────────────────│
│ 响应结果                                              │  ← shown when expanded AND done
│   [{ "title": "...", "url": "..." }]                 │
└──────────────────────────────────────────────────────┘
```

**Header elements:**

| Element | Description |
|---|---|
| Status dot | Amber pulse = running; green glow = done |
| Tool name | `font-weight: 600`, `color: var(--text-2)` |
| Key param preview | First key-value from parsed `callingContent` JSON, format: `key: "value"`, truncated with ellipsis; hidden if `callingContent` is empty or unparseable |
| Toggle button | `展开 ∨` / `收起 ∧`; hidden while `status === "calling"` |

**Body sections (expanded only):**

- **请求参数**: renders `callingContent`. Hidden entirely if empty string.
- **响应结果**: renders `resultContent`. While `status === "calling"`, shows bounce-dot animation with italic placeholder text instead. `max-h-48 overflow-y-auto` to handle long output.

### JSON Syntax Highlighting

A standalone utility `frontend/lib/highlightJson.ts` exports:

```ts
function highlightJson(input: string): string
// Returns HTML string with <span> tags for syntax coloring.
// Returns the raw input unchanged if JSON.parse fails (plain-text fallback).
```

Rendered via `dangerouslySetInnerHTML` inside a `<pre>` tag. Input is the raw string from `callingContent` / `resultContent`.

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
- **Running state**: bounce dots + italic `text-[var(--text-3)]`, no result section shown
- **Result area**: `max-h-48 overflow-y-auto`

---

## Files Changed

| File | Change |
|---|---|
| `frontend/lib/highlightJson.ts` | **New** — JSON syntax highlighter utility |
| `frontend/components/chat/ToolCallCard.tsx` | **Rewrite** — new structure, expand/collapse, JSON sections |
| `frontend/components/chat/MessageBubble.tsx` | **1-line change** — pass `isStreaming` prop to `ToolCallCard` |

`lib/types.ts`, `hooks/useChat.ts`, and `app/chat/page.tsx` are **not modified**.

---

## Edge Cases

| Scenario | Handling |
|---|---|
| `callingContent` is empty string | Hide 请求参数 section entirely |
| `callingContent` is invalid JSON | Plain-text fallback, no highlighting |
| `resultContent` is very long | `max-h-48 overflow-y-auto`, never truncated |
| Historical messages on load | `isStreaming = false` at mount → `expanded` initializes to `false` |
| Multiple tool calls in one message | Each `ToolCallCard` manages its own `expanded` state independently |
| User manually expands a card after auto-collapse | Toggle works normally via header click |

---

## Out of Scope

- Backend / SSE stream changes
- Adding new chunk types to `useChat.ts`
- Timeline view or sidebar panel layout
- Tool call grouping header ("N 个工具调用")
- Copy-to-clipboard button on JSON sections
