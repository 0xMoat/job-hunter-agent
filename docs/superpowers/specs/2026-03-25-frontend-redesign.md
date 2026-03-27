# Frontend Redesign Spec — Job Hunter Agent

**Date**: 2026-03-25
**Status**: Approved for implementation
**Scope**: Full visual redesign of the Next.js frontend — light theme, liquid glass design system, Chinese UI copy

---

## Background

The current frontend uses a generic dark slate + blue-600 palette with system fonts — a classic AI-slop aesthetic with no brand identity. This redesign replaces it with a premium light-mode design system inspired by the Instrument Serif / Barlow / liquid-glass stack, giving the product a distinctive, trustworthy, and approachable character suited to an anxiety-prone job-search context.

---

## Design System

### Typography

| Role | Font | Style | Weight |
|---|---|---|---|
| Headings | `Instrument Serif` | italic | regular |
| Body / UI | `Barlow` | normal | 300 / 400 / 500 / 600 |

Import via Google Fonts `<link>` in `app/layout.tsx`:
```
https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Barlow:wght@300;400;500;600&display=swap
```

**This project uses Tailwind v4.** Font tokens are registered in `globals.css` via `@theme`, not via a JS config file (`tailwind.config.ts` does not exist and must not be created):

```css
@theme {
  --font-heading: 'Instrument Serif', serif;
  --font-body: 'Barlow', sans-serif;
}
```

This generates `font-heading` and `font-body` utility classes automatically.

Heading defaults: `font-heading italic tracking-tight leading-none`
Body defaults: `font-body font-light`

### Color Palette

All CSS variables are defined in `globals.css` under `:root`. When referenced inside Tailwind arbitrary-value classes, always use `var()` syntax (e.g., `bg-[var(--accent)]`, not `bg-[--accent]`):

```css
:root {
  --bg:             #EFECE6;   /* warm off-white base background */
  --surface:        rgba(255,255,255,0.65);   /* glass subtle */
  --surface-strong: rgba(255,255,255,0.88);   /* glass strong */
  --border:         rgba(0,0,0,0.07);
  --border-strong:  rgba(0,0,0,0.11);
  --text:           #141210;                  /* near-black primary */
  --text-2:         rgba(20,18,16,0.55);      /* secondary */
  --text-3:         rgba(20,18,16,0.38);      /* tertiary / disabled */
  --accent:         #141210;                  /* monochromatic CTA */
  --accent-fg:      #EFECE6;
}
```

Semantic status colors (used on pill badges only, not as card backgrounds):
- Applied:      `text-blue-600 bg-blue-50`
- Interviewing: `text-amber-600 bg-amber-50`
- Offer:        `text-green-600 bg-green-50`
- Rejected:     `text-red-600 bg-red-50`

### Background

Applied on `<body>` in `globals.css`:

```css
body {
  background-color: #EFECE6;
  background-image:
    radial-gradient(ellipse 80% 50% at 20% 10%, rgba(255,255,255,0.5) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 90%, rgba(210,200,185,0.4) 0%, transparent 60%);
}
```

### Liquid Glass Effect

Two utility classes in `globals.css` via `@layer components`.

> **Important**: do NOT set `overflow: hidden` on `.glass` or `.glass-strong`. The `::before` gradient border mask technique relies on the pseudo-element painting over the border edge of the element. Setting `overflow: hidden` clips the pseudo-element to the content box, making the gradient border invisible on rounded elements. Instead, use `overflow: hidden` only on child wrappers inside glass elements when content clipping is needed.

**`.glass`** (subtle — cards, tool cards, chips, input rows):
```css
.glass {
  background: rgba(255,255,255,0.65);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-shadow: 0 1px 0 rgba(255,255,255,0.9) inset, 0 2px 12px rgba(0,0,0,0.05);
  position: relative;
}
.glass::before {
  content: '';
  position: absolute; inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(170deg,
    rgba(255,255,255,0.9) 0%, rgba(255,255,255,0.3) 25%,
    rgba(0,0,0,0.04) 50%, rgba(255,255,255,0.7) 100%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}
```

**`.glass-strong`** (main panels — chat, tracker, listings):
```css
.glass-strong {
  background: rgba(255,255,255,0.88);
  backdrop-filter: blur(40px);
  -webkit-backdrop-filter: blur(40px);
  box-shadow: 0 1px 0 rgba(255,255,255,1) inset, 0 4px 24px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.05);
  position: relative;
}
.glass-strong::before {
  /* same ::before as .glass */
  content: '';
  position: absolute; inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(170deg,
    rgba(255,255,255,1) 0%, rgba(255,255,255,0.4) 25%,
    rgba(0,0,0,0.05) 50%, rgba(255,255,255,0.85) 100%);
  -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
}
```

### Shape Language

- Navigation pills, buttons, badges: `rounded-full`
- Panels: `rounded-3xl`
- Cards: `rounded-2xl`
- Input fields: `rounded-xl`
- Tool call cards: `rounded-xl`

---

## Page Layout Structure

### Chat page (`app/chat/page.tsx`)

Root wrapper replaces `h-screen flex flex-col bg-slate-900 overflow-hidden` with:

```
<div className="h-screen flex flex-col overflow-hidden">
  {/* background is on body via globals.css */}

  {/* Navbar — floated pill with padding from top */}
  <div className="px-4 pt-3 pb-2 flex-shrink-0">
    <nav className="glass rounded-full px-5 py-2.5 flex items-center justify-between">
      ...
    </nav>
  </div>

  {/* Content area */}
  <div className="flex-1 overflow-hidden px-4 pb-4">
    {/* tab panels fill this area */}
  </div>
</div>
```

The `px-4 pt-3` wrapper gives the pill navbar breathing room from the viewport edge. The content area has matching horizontal padding so panels are flush with the navbar edges.

### Login page (`app/login/page.tsx`)

```
<div className="min-h-screen flex items-center justify-center">
  <div className="glass-strong rounded-3xl p-10 w-full max-w-md">
    <h1 className="font-heading italic text-3xl tracking-tight text-[var(--text)] mb-1">Job Hunter</h1>
    <p className="font-body font-light text-sm text-[var(--text-3)] mb-8">求职专属 AI 助手</p>

    {/* mode toggle: two rounded-full buttons in a glass pill row */}
    {/* form fields: with htmlFor/id labels, focus-visible:ring-2 */}
    {/* error: role="alert" */}
    {/* submit: bg-[var(--accent)] text-[var(--accent-fg)] rounded-full font-body font-medium */}
  </div>
</div>
```

Mode-toggle buttons: `glass rounded-full px-6 py-2 text-sm font-medium`. Active: `bg-[var(--accent)] text-[var(--accent-fg)]`. Inactive: `text-[var(--text-2)]`.

---

## Component Specs

### Navbar

```
[Brand: "Job Hunter ✦" — font-heading italic]    [tablist pill]    [退出 text button]
```

- Outer nav: `glass rounded-full px-5 py-2.5 flex items-center justify-between`
- Brand: `font-heading italic text-lg tracking-tight text-[var(--text)]`
- `role="tablist"` wrapper: `flex items-center gap-1`
- Tab buttons: `role="tab"` + `aria-selected`
  - Active: `bg-[var(--accent)] text-[var(--accent-fg)] rounded-full px-4 py-1.5 text-sm font-medium`
  - Inactive: `text-[var(--text-2)] hover:bg-black/5 rounded-full px-4 py-1.5 text-sm`
- Logout: `text-xs text-[var(--text-3)] hover:text-[var(--text-2)] px-3 py-1.5 rounded-full hover:bg-black/5`
- Active tab synced to URL query param `?tab=chat` or `?tab=picks`

### Chat Panel

**Panel container**: two-element structure (same pattern as Application Tracker):
```jsx
{/* outer: glass-strong, NO overflow-hidden — preserves ::before gradient border */}
<div className="glass-strong rounded-3xl flex flex-col h-full">
  {/* inner: overflow-hidden clips scroll content without clipping the border */}
  <div className="flex flex-col h-full overflow-hidden">
    ...
  </div>
</div>
```

**Header** (inside panel, `overflow: hidden` is fine here):
- Badge: `glass rounded-full inline-flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-[var(--text-2)] mb-3`
  - Status dot: `w-1.5 h-1.5 rounded-full bg-green-500`
  - Text: "AI Agent · 求职助手"
- Title: `font-heading italic text-xl tracking-tight text-[var(--text)]` → "与 Agent 对话"
- Subtitle: `font-body font-light text-xs text-[var(--text-3)]` → "求职专属助手 · 工具调用实时可见"

**Message Bubbles**:
- User: `bg-[var(--accent)] text-[var(--accent-fg)] rounded-[18px_18px_4px_18px] px-4 py-2.5 font-body text-sm`
- Assistant: `glass rounded-[4px_18px_18px_18px] px-4 py-2.5 font-body font-light text-sm text-[var(--text)]`
- Timestamps: `font-body font-light text-xs text-[var(--text-3)] mt-1`

**Tool Call Card** (`glass rounded-xl`):

Header row (inside the card, with its own border-bottom):
- Status dot: 7px circle, `bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.4)]` when done; `bg-amber-400 animate-pulse` when running
- Tool name: `font-body font-medium text-sm text-[var(--text-2)]`
- "running…" label (when running): `font-body font-light text-xs text-[var(--text-3)] ml-auto animate-pulse`

Result body (flex row, `gap-2.5 px-3 py-2`):
- Left accent bar: `w-[2.5px] self-stretch rounded-full bg-gradient-to-b from-[#141210] to-[#141210]/20 flex-shrink-0`
- Result text: `font-body font-normal text-sm leading-relaxed` with color `rgba(20,18,16,0.72)` (use inline style or a custom Tailwind arbitrary value `text-[rgba(20,18,16,0.72)]`)

**Empty State** (shown when `messages.length === 0`):

```
centered column, gap-5, max-w-xs mx-auto, mt-12

  <h2 className="font-heading italic text-2xl tracking-tight text-[var(--text)] text-center">
    你好，有什么可以帮你？
  </h2>
  <p className="font-body font-light text-sm text-[var(--text-3)] text-center">
    告诉我你的目标职位、城市和经验，<br/>我来帮你找机会。
  </p>

  {/* Chips */}
  <div className="flex flex-col gap-2 w-full">
    {QUICK_PROMPTS.map(text => (
      <button
        key={text}
        onClick={() => sendMessage(text)}   /* calls sendMessage directly, no visual textarea fill */
        className="glass rounded-full flex items-center justify-between px-4 py-2.5
                   text-sm font-normal text-[var(--text-2)] hover:bg-white/80 transition-colors"
      >
        <span>{text}</span>
        <span className="text-[var(--text-3)]" aria-hidden="true">↗</span>
      </button>
    ))}
  </div>
```

`QUICK_PROMPTS` constant (define at top of `ChatPanel.tsx`):
```ts
const QUICK_PROMPTS = [
  '帮我找上海的 Agent Engineer 岗位',
  '分析这份 JD 和我的简历是否匹配',
  '帮我制定本周的投递计划',
]
```

Chip click behavior: calls `sendMessage(text)` **directly** — no visual population of the textarea. This avoids the need to lift `ChatInput` state.

**Streaming indicator**:
- `<div aria-live="polite" aria-atomic="true">` wrapper
- Three bouncing dots: `aria-hidden="true"` on the dots container
- "Agent is thinking…" text visible for screen readers

**Input area** (`glass` on the row wrapper):
- Textarea: `bg-black/[0.04] border border-[var(--border-strong)] rounded-xl font-body font-light text-sm text-[var(--text)] placeholder:text-[var(--text-3)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141210]/30`
- Send button: `bg-[var(--accent)] text-[var(--accent-fg)] rounded-xl font-body font-medium text-sm min-h-[42px]`
- Disabled send: `bg-[var(--border-strong)] text-[var(--text-3)] cursor-not-allowed`

### Application Tracker (Sidebar)

- Panel: `glass-strong rounded-3xl flex flex-col h-full` with an inner `overflow-hidden` child wrapper
- Header: title `font-heading italic text-xl text-[var(--text)]` / subtitle `font-body font-light text-xs text-[var(--text-3)]`
- "+ 添加" button: `bg-[var(--accent)] text-[var(--accent-fg)] rounded-full px-4 py-2 text-xs font-medium` (min tap target 32px height)
- Add form: visually-hidden `<label>` per input via `className="sr-only"`, `focus-visible:ring-2 focus-visible:ring-[#141210]/30`
- Status column labels: `font-body font-semibold text-[10px] uppercase tracking-widest text-[var(--text-3)]`

**Application card** (`bg-white/50 rounded-2xl border border-[var(--border)] p-3`):
- Company: `font-body font-medium text-sm text-[var(--text)]`
- Job title: `font-body font-light text-xs text-[var(--text-2)]`
- URL link: `font-body font-light text-xs text-blue-600 hover:text-blue-500 truncate` (if present)
- Status `<select>`: retained for inline status change. Styled: `rounded-full text-xs font-medium px-3 py-1 border appearance-none cursor-pointer bg-transparent` + semantic color classes per status (same as pill). The `<option>` elements use `bg-white text-[var(--text)]`.
- Delete button: `aria-label="删除"` (no `title`); `text-[var(--text-3)] hover:text-red-500 transition-colors`
- Applied date: `font-body font-light text-[10px] text-[var(--text-3)] mt-1.5`

**Empty sub-column** ("None yet"): `font-body font-light text-xs text-[var(--text-3)] italic pl-1`

**Listings empty state** (`!loading && !error && listings.length === 0`):
```
centered column, mt-16 gap-3

  <div className="w-12 h-12 rounded-full glass flex items-center justify-center text-2xl">📋</div>
  <p className="font-heading italic text-xl text-[var(--text)]">暂无推荐职位</p>
  <p className="font-body font-light text-sm text-[var(--text-3)] text-center max-w-xs leading-relaxed">
    告诉 Agent 你的每日搜索偏好：<br/>
    <span className="font-body font-normal text-[var(--text-2)]">
      "设置每日搜索：agent engineer，上海，fulltime"
    </span>
  </p>
```

### Listings Panel (Today's Picks)

- Panel: `glass-strong rounded-3xl flex flex-col h-full`
- Header title: `font-heading italic text-2xl text-[var(--text)]` → "今日推荐"
- Header subtitle (dynamic):
  - Has listings: `font-body font-light text-sm text-[var(--text-2)]` → `{listings.length} 个职位 · 每日自动更新`
  - No listings yet: `font-body font-light text-sm text-[var(--text-3)]` → `每日 08:00 自动搜索并更新`
- Refresh button: `glass rounded-full text-sm px-4 py-1.5 text-[var(--text-2)]` → "刷新"
- Listing cards: `glass rounded-2xl p-4 flex flex-col gap-1.5 hover:bg-white/80 transition-colors`
  - Title link: `font-heading italic text-base text-[var(--text)] hover:text-[var(--text-2)] leading-snug line-clamp-2`
  - Date: `font-body font-light text-[10px] text-[var(--text-3)] flex-shrink-0 mt-0.5`
  - Company + location: `font-body font-light text-xs text-[var(--text-2)]`
  - Snippet: `font-body font-light text-xs text-[var(--text-3)] line-clamp-3 leading-relaxed`

---

## UI Copy Changes (English → Chinese)

| Component | Old (EN) | New (ZH) |
|---|---|---|
| Tab: Chat | "Chat" | "对话" |
| Tab: Picks | "Today's Picks" | "今日推荐" |
| Sidebar title | "Applications" | "投递记录" |
| Sidebar sub | "{n} tracked" | "{n} 个进行中" |
| Add button | "+ Add" | "+ 添加" |
| Status: Applied | "Applied" | "已投递" |
| Status: Interviewing | "Interviewing" | "面试中" |
| Status: Offer | "Offer 🎉" | "Offer 🎉" (keep) |
| Status: Rejected | "Rejected" | "已拒绝" |
| Column: Applied | "Applied" | "已投递" |
| Column: Interviewing | "Interviewing" | "面试中" |
| Column: Offer | "Offer" | "已获 Offer" |
| Column: Rejected | "Rejected" | "已拒绝" |
| Empty col | "None yet" | "暂无" |
| Listings title | "Today's Picks" | "今日推荐" |
| Listings sub (has) | "{n} listings from daily search" | "{n} 个职位 · 每日自动更新" |
| Listings sub (empty) | "Daily search results — updated every morning at 08:00" | "每日 08:00 自动搜索并更新" |
| Refresh button | "Refresh" | "刷新" |
| Loading listings | "Loading listings…" | "加载中…" |
| Logout | "Logout" | "退出" |
| Form save | "Save" | "保存" |
| Form cancel | "Cancel" | "取消" |
| Chat header | "Agent Chat" | "与 Agent 对话" |
| Chat sub | "Job-hunting specialist · tool calls shown inline" | "求职专属助手 · 工具调用实时可见" |
| Chat empty heading | (emoji + text) | "你好，有什么可以帮你？" |
| Login title | "Job Hunter Agent" | "Job Hunter" |
| Login sub | "AI-powered job hunting assistant" | "求职专属 AI 助手" |
| Login mode: login | "Login" | "登录" |
| Login mode: register | "Register" | "注册" |
| Submit login | "Login" / "Create Account" | "登录" / "创建账号" |
| Loading | "Please wait…" | "请稍候…" |

---

## i18n — Language Switching

### Supported Locales

```ts
type Locale = 'zh-CN' | 'en'
```

Supported: Simplified Chinese (`zh-CN`) and English (`en`). Fallback: `en`.

### New Files

**`frontend/lib/i18n.ts`**

Defines the translation dictionary and a typed `t()` helper. All UI strings are keyed here — no hardcoded strings in components.

```ts
export type Locale = 'zh-CN' | 'en'

export const translations = {
  'zh-CN': {
    // Navbar
    tab_chat: '对话',
    tab_picks: '今日推荐',
    logout: '退出',
    // Chat panel
    chat_badge: 'AI Agent · 求职助手',
    chat_title: '与 Agent 对话',
    chat_subtitle: '求职专属助手 · 工具调用实时可见',
    chat_empty_heading: '你好，有什么可以帮你？',
    chat_empty_sub: '告诉我你的目标职位、城市和经验，\n我来帮你找机会。',
    chat_placeholder: '输入消息… (Enter 发送，Shift+Enter 换行)',
    chat_send: '发送',
    chat_sending: '…',
    chat_thinking: '正在思考…',
    quick_prompt_1: '帮我找上海的 Agent Engineer 岗位',
    quick_prompt_2: '分析这份 JD 和我的简历是否匹配',
    quick_prompt_3: '帮我制定本周的投递计划',
    // Tool call card
    tool_running: '运行中…',
    // Tracker
    tracker_title: '投递记录',
    tracker_sub_n: (n: number) => `${n} 个进行中`,
    tracker_add: '+ 添加',
    tracker_save: '保存',
    tracker_cancel: '取消',
    tracker_empty_col: '暂无',
    col_applied: '已投递',
    col_interviewing: '面试中',
    col_offer: '已获 Offer',
    col_rejected: '已拒绝',
    status_applied: '已投递',
    status_interviewing: '面试中',
    status_offer: 'Offer 🎉',
    status_rejected: '已拒绝',
    form_company: '公司名称 *',
    form_title: '职位名称 *',
    form_url: '职位链接（可选）',
    delete: '删除',
    // Listings
    listings_title: '今日推荐',
    listings_sub_n: (n: number) => `${n} 个职位 · 每日自动更新`,
    listings_sub_empty: '每日 08:00 自动搜索并更新',
    listings_refresh: '刷新',
    listings_loading: '加载中…',
    listings_empty_title: '暂无推荐职位',
    listings_empty_sub: '告诉 Agent 你的每日搜索偏好：',
    listings_empty_hint: '"设置每日搜索：agent engineer，上海，fulltime"',
    // Login
    login_title: 'Job Hunter',
    login_sub: '求职专属 AI 助手',
    login_mode_login: '登录',
    login_mode_register: '注册',
    login_email: '邮箱',
    login_password: '密码',
    login_pw_placeholder_new: '≥8 位，含大小写字母、数字、特殊符号',
    login_pw_placeholder_existing: '请输入密码',
    login_submit_login: '登录',
    login_submit_register: '创建账号',
    login_loading: '请稍候…',
  },
  en: {
    // Navbar
    tab_chat: 'Chat',
    tab_picks: "Today's Picks",
    logout: 'Logout',
    // Chat panel
    chat_badge: 'AI Agent · Job Hunter',
    chat_title: 'Agent Chat',
    chat_subtitle: 'Job-hunting specialist · tool calls shown inline',
    chat_empty_heading: 'How can I help you?',
    chat_empty_sub: 'Tell me your target role, city, and experience.\nI\'ll find the right opportunities.',
    chat_placeholder: 'Type a message… (Enter to send, Shift+Enter for newline)',
    chat_send: 'Send',
    chat_sending: '…',
    chat_thinking: 'Thinking…',
    quick_prompt_1: 'Find Agent Engineer roles in Shanghai',
    quick_prompt_2: 'Does this JD match my resume?',
    quick_prompt_3: 'Help me plan my applications this week',
    // Tool call card
    tool_running: 'running…',
    // Tracker
    tracker_title: 'Applications',
    tracker_sub_n: (n: number) => `${n} tracked`,
    tracker_add: '+ Add',
    tracker_save: 'Save',
    tracker_cancel: 'Cancel',
    tracker_empty_col: 'None yet',
    col_applied: 'Applied',
    col_interviewing: 'Interviewing',
    col_offer: 'Offer',
    col_rejected: 'Rejected',
    status_applied: 'Applied',
    status_interviewing: 'Interviewing',
    status_offer: 'Offer 🎉',
    status_rejected: 'Rejected',
    form_company: 'Company name *',
    form_title: 'Job title *',
    form_url: 'URL (optional)',
    delete: 'Delete',
    // Listings
    listings_title: "Today's Picks",
    listings_sub_n: (n: number) => `${n} listings from daily search`,
    listings_sub_empty: 'Daily search results — updated every morning at 08:00',
    listings_refresh: 'Refresh',
    listings_loading: 'Loading listings…',
    listings_empty_title: 'No listings yet',
    listings_empty_sub: 'Tell the agent your daily search preferences:',
    listings_empty_hint: '"Set daily search: agent engineer, Shanghai, fulltime"',
    // Login
    login_title: 'Job Hunter',
    login_sub: 'AI-powered job hunting assistant',
    login_mode_login: 'Login',
    login_mode_register: 'Register',
    login_email: 'Email',
    login_password: 'Password',
    login_pw_placeholder_new: '≥8 chars, A-Z, a-z, 0-9, special (!@#…)',
    login_pw_placeholder_existing: 'Your password',
    login_submit_login: 'Login',
    login_submit_register: 'Create Account',
    login_loading: 'Please wait…',
  },
} satisfies Record<Locale, Record<string, string | ((...args: never[]) => string)>>

export function t<K extends keyof typeof translations['en']>(
  locale: Locale,
  key: K,
  ...args: Parameters<typeof translations['en'][K] extends (...a: infer A) => string ? typeof translations['en'][K] : never>
): string {
  const entry = translations[locale][key] ?? translations['en'][key]
  return typeof entry === 'function' ? (entry as (...a: unknown[]) => string)(...args) : entry
}
```

**`frontend/contexts/LanguageContext.tsx`**

```tsx
'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import type { Locale } from '@/lib/i18n'
import { t as translate } from '@/lib/i18n'

const STORAGE_KEY = 'jh_locale'

function detectLocale(): Locale {
  if (typeof window === 'undefined') return 'en'
  const stored = localStorage.getItem(STORAGE_KEY) as Locale | null
  if (stored === 'zh-CN' || stored === 'en') return stored
  const browser = navigator.language
  return browser.startsWith('zh') ? 'zh-CN' : 'en'
}

interface LanguageContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: <K extends Parameters<typeof translate>[1]>(key: K, ...args: Parameters<typeof translate<K>>[2]) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('en') // SSR-safe default

  useEffect(() => {
    setLocaleState(detectLocale())
  }, [])

  function setLocale(l: Locale) {
    setLocaleState(l)
    localStorage.setItem(STORAGE_KEY, l)
  }

  const tBound = <K extends Parameters<typeof translate>[1]>(
    key: K,
    ...args: Parameters<typeof translate<K>>[2]
  ) => translate(locale, key, ...args)

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t: tBound }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within LanguageProvider')
  return ctx
}
```

SSR safety: `useState('en')` on the server, `useEffect` switches to detected locale on the client. This prevents hydration mismatch.

### Integration Points

**`app/layout.tsx`**: Wrap `{children}` with `<LanguageProvider>`. The `<html lang>` attribute cannot be dynamically updated from client context (it's a server component); instead, leave `lang="zh"` as a static default and note that dynamic `lang` updates require a separate `useEffect` in a client boundary.

**Navbar language toggle** (inside `app/chat/page.tsx`): Add a compact toggle button next to the logout button:

```tsx
const { locale, setLocale } = useLanguage()

<button
  onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
  className="text-xs text-[var(--text-3)] hover:text-[var(--text-2)] px-3 py-1.5
             rounded-full hover:bg-black/5 transition-colors font-body font-medium
             tracking-wide"
  aria-label="Switch language"
>
  {locale === 'zh-CN' ? 'EN' : '中文'}
</button>
```

Placement: between the tablist and the logout button in the navbar.

**All components**: Replace hardcoded strings with `const { t } = useLanguage()` and `t('key')`. The `QUICK_PROMPTS` constant in `ChatPanel.tsx` becomes:

```ts
const QUICK_PROMPTS = [t('quick_prompt_1'), t('quick_prompt_2'), t('quick_prompt_3')]
```

(computed inside the component body, not at module level)

**`toLocaleTimeString` locale**: Use `locale` from `useLanguage()` instead of hardcoded `'zh-CN'`:
```ts
message.timestamp.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
```

**`aria-label` on delete button**: Use `t('delete')` so it reads correctly in both languages.

---

## Accessibility (carry forward from previous pass)

- All `<label>` elements use `htmlFor` linked to input `id`
- All focus states use `focus-visible:ring-2 focus-visible:ring-[#141210]/30`
- Login inputs: `autocomplete="email"` / `"current-password"` / `"new-password"`
- Error messages: `role="alert"`
- Streaming indicator: `aria-live="polite" aria-atomic="true"`; dot container is `aria-hidden="true"`
- Delete button: `aria-label={t('delete')}`
- Tab buttons: `role="tablist"` + `role="tab"` + `aria-selected`
- URL reflects active tab: `?tab=chat` or `?tab=picks`
- `toLocaleTimeString` uses `locale` from `useLanguage()`

---

## Files to Change

| File | Changes |
|---|---|
| `frontend/lib/i18n.ts` | **New** — translation dictionary + `t()` helper |
| `frontend/contexts/LanguageContext.tsx` | **New** — `LanguageProvider`, `useLanguage()` hook |
| `frontend/app/globals.css` | Add `@theme` font tokens; add `.glass` / `.glass-strong`; set body background |
| `frontend/app/layout.tsx` | Add Google Fonts `<link>`; wrap children in `<LanguageProvider>` |
| `frontend/app/chat/page.tsx` | Page layout restructure, glass pill navbar, language toggle button, i18n strings |
| `frontend/app/login/page.tsx` | Light theme, glass-strong card, i18n strings |
| `frontend/components/chat/ChatPanel.tsx` | Glass panel, new empty state + QUICK_PROMPTS, i18n strings |
| `frontend/components/chat/ChatInput.tsx` | Light input + button styles, i18n placeholder + button label |
| `frontend/components/chat/MessageBubble.tsx` | Light bubbles, `toLocaleTimeString` uses `locale` |
| `frontend/components/chat/ToolCallCard.tsx` | Left bar + readable result text, i18n "running" label |
| `frontend/components/tracker/ApplicationTracker.tsx` | Glass panel, i18n strings throughout |
| `frontend/components/tracker/ApplicationCard.tsx` | Glass card, i18n status labels, `aria-label={t('delete')}` |
| `frontend/components/listings/ListingsPanel.tsx` | Glass panel, i18n strings, empty state redesign |
| `frontend/components/listings/ListingCard.tsx` | Glass card, heading font for title |

---

## Out of Scope

- Backend / API changes
- Mobile responsive breakpoints (not yet prioritized)
- Animation / motion (separate pass)
- Dark mode toggle
- Additional languages beyond `zh-CN` and `en`
