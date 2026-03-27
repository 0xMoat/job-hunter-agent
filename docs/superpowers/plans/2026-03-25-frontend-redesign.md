# Frontend Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the dark slate UI with a premium light-mode design system (Instrument Serif + Barlow + liquid glass), add a two-language i18n system (zh-CN / en), and unify all UI copy.

**Architecture:** Build bottom-up — design tokens first, then the i18n layer, then leaf components, then container components. Every component consumes both the glass CSS classes and `useLanguage()`. No new runtime dependencies needed.

**Tech Stack:** Next.js 15+ (App Router), Tailwind CSS v4, React Context for i18n, Google Fonts via `<link>`. No new packages required.

**Note on testing:** This repo has no automated test suite (per `CLAUDE.md`). Verification is visual — run `pnpm dev` from the `frontend/` directory and inspect in the browser after each task.

---

## File Map

| File | Status | Responsibility |
|---|---|---|
| `frontend/app/globals.css` | Modify | Design tokens (`@theme`, `:root`), `.glass` / `.glass-strong`, body background |
| `frontend/app/layout.tsx` | Modify | Google Fonts `<link>`, `<LanguageProvider>` wrapper |
| `frontend/lib/i18n.ts` | **Create** | `Locale` type, translation dictionaries, `t()` helper |
| `frontend/contexts/LanguageContext.tsx` | **Create** | `LanguageProvider`, `useLanguage()` hook, locale detection |
| `frontend/app/login/page.tsx` | Modify | Light theme, glass card, i18n strings |
| `frontend/app/chat/page.tsx` | Modify | Page layout restructure, glass pill navbar, language toggle |
| `frontend/components/chat/ChatInput.tsx` | Modify | Light input styles, i18n |
| `frontend/components/chat/MessageBubble.tsx` | Modify | Light bubbles, i18n locale for timestamps |
| `frontend/components/chat/ToolCallCard.tsx` | Modify | Glass card, left accent bar (Option C), i18n |
| `frontend/components/chat/ChatPanel.tsx` | Modify | Glass panel, quick-chip empty state, i18n |
| `frontend/components/tracker/ApplicationCard.tsx` | Modify | Glass card, styled select, i18n |
| `frontend/components/tracker/ApplicationTracker.tsx` | Modify | Glass panel, i18n throughout |
| `frontend/components/listings/ListingCard.tsx` | Modify | Glass card, heading font for title |
| `frontend/components/listings/ListingsPanel.tsx` | Modify | Glass panel, redesigned empty state, i18n |

---

## Task 1: Design System — globals.css

**Files:**
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Replace globals.css entirely**

```css
@import "tailwindcss";

/* ── Font tokens (Tailwind v4 @theme — generates font-heading / font-body utilities) ── */
@theme {
  --font-heading: 'Instrument Serif', serif;
  --font-body: 'Barlow', sans-serif;
}

/* ── Color palette ── */
:root {
  --bg:             #EFECE6;
  --surface:        rgba(255,255,255,0.65);
  --surface-strong: rgba(255,255,255,0.88);
  --border:         rgba(0,0,0,0.07);
  --border-strong:  rgba(0,0,0,0.11);
  --text:           #141210;
  --text-2:         rgba(20,18,16,0.55);
  --text-3:         rgba(20,18,16,0.38);
  --accent:         #141210;
  --accent-fg:      #EFECE6;
}

/* ── Body background ── */
body {
  background-color: var(--bg);
  background-image:
    radial-gradient(ellipse 80% 50% at 20% 10%, rgba(255,255,255,0.5) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 90%, rgba(210,200,185,0.4) 0%, transparent 60%);
  color: var(--text);
}

/* ── Liquid Glass ── */
/* IMPORTANT: never add overflow-hidden to .glass or .glass-strong directly —
   it clips the ::before gradient border. Use an inner wrapper for content clipping. */
@layer components {
  .glass {
    background: var(--surface);
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

  .glass-strong {
    background: var(--surface-strong);
    backdrop-filter: blur(40px);
    -webkit-backdrop-filter: blur(40px);
    box-shadow: 0 1px 0 rgba(255,255,255,1) inset, 0 4px 24px rgba(0,0,0,0.07), 0 1px 3px rgba(0,0,0,0.05);
    position: relative;
  }
  .glass-strong::before {
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
}
```

- [ ] **Step 2: Start dev server and verify background**

```bash
cd frontend && pnpm dev
```

Open http://localhost:3000. The page background should be warm off-white (`#EFECE6`) with a subtle light gradient in the top-left. No dark backgrounds anywhere.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/globals.css
git commit -m "feat: add light glass design system tokens and utilities"
```

---

## Task 2: Font Loading — layout.tsx (part 1)

**Files:**
- Modify: `frontend/app/layout.tsx`

- [ ] **Step 1: Add Google Fonts preconnect + stylesheet links**

Replace the file content:

```tsx
import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "Job Hunter Agent",
  description: "AI-powered job hunting assistant",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Barlow:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 2: Verify fonts load**

With dev server running, open DevTools → Network → filter "fonts.googleapis". Confirm Instrument Serif and Barlow requests are made. On the login page, headings should render in Instrument Serif italic.

- [ ] **Step 3: Commit**

```bash
git add frontend/app/layout.tsx
git commit -m "feat: add Instrument Serif and Barlow via Google Fonts"
```

---

## Task 3: i18n Dictionary — lib/i18n.ts

**Files:**
- Create: `frontend/lib/i18n.ts`

- [ ] **Step 1: Create the file**

```ts
export type Locale = 'zh-CN' | 'en'

type StringValue = string
type FnValue = (...args: never[]) => string

type Dict = Record<string, StringValue | FnValue>

const zh: Dict = {
  // Navbar
  tab_chat: '对话',
  tab_picks: '今日推荐',
  logout: '退出',
  lang_toggle: 'EN',
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
  form_title_field: '职位名称 *',
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
}

const en: Dict = {
  // Navbar
  tab_chat: 'Chat',
  tab_picks: "Today's Picks",
  logout: 'Logout',
  lang_toggle: '中文',
  // Chat panel
  chat_badge: 'AI Agent · Job Hunter',
  chat_title: 'Agent Chat',
  chat_subtitle: 'Job-hunting specialist · tool calls shown inline',
  chat_empty_heading: 'How can I help you?',
  chat_empty_sub: "Tell me your target role, city, and experience.\nI'll find the right opportunities.",
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
  form_title_field: 'Job title *',
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
}

const dicts: Record<Locale, Dict> = { 'zh-CN': zh, en }

export function t(locale: Locale, key: string, ...args: unknown[]): string {
  const entry = dicts[locale]?.[key] ?? dicts['en'][key] ?? key
  if (typeof entry === 'function') return entry(...args)
  return entry
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && pnpm tsc --noEmit
```

Expected: no errors for this file.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/i18n.ts
git commit -m "feat: add i18n dictionary and t() helper (zh-CN + en)"
```

---

## Task 4: Language Context — contexts/LanguageContext.tsx

**Files:**
- Create: `frontend/contexts/LanguageContext.tsx`

- [ ] **Step 1: Create the file**

```tsx
'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { t as translate, type Locale } from '@/lib/i18n'

const STORAGE_KEY = 'jh_locale'

function detectLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY) as Locale | null
  if (stored === 'zh-CN' || stored === 'en') return stored
  return navigator.language.startsWith('zh') ? 'zh-CN' : 'en'
}

interface LanguageContextValue {
  locale: Locale
  setLocale: (l: Locale) => void
  t: (key: string, ...args: unknown[]) => string
}

const LanguageContext = createContext<LanguageContextValue | null>(null)

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // SSR-safe: start with 'en', switch to detected locale after hydration
  const [locale, setLocaleState] = useState<Locale>('en')

  useEffect(() => {
    setLocaleState(detectLocale())
  }, [])

  function setLocale(l: Locale) {
    setLocaleState(l)
    localStorage.setItem(STORAGE_KEY, l)
  }

  function t(key: string, ...args: unknown[]): string {
    return translate(locale, key, ...args)
  }

  return (
    <LanguageContext.Provider value={{ locale, setLocale, t }}>
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

- [ ] **Step 2: Wire LanguageProvider into layout.tsx**

Update `frontend/app/layout.tsx`:

```tsx
import type { Metadata } from "next"
import "./globals.css"
import { LanguageProvider } from "@/contexts/LanguageContext"

export const metadata: Metadata = {
  title: "Job Hunter Agent",
  description: "AI-powered job hunting assistant",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Barlow:wght@300;400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/contexts/LanguageContext.tsx frontend/app/layout.tsx
git commit -m "feat: add LanguageProvider and useLanguage hook with browser detection"
```

---

## Task 5: Login Page

**Files:**
- Modify: `frontend/app/login/page.tsx`

- [ ] **Step 1: Replace file**

```tsx
"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { apiRegister, apiLogin, apiCreateSession } from "@/lib/api"
import { setAccessToken, setSessionToken } from "@/lib/auth"
import { useLanguage } from "@/contexts/LanguageContext"

type Mode = "login" | "register"

export default function LoginPage() {
  const router = useRouter()
  const { t, locale, setLocale } = useLanguage()
  const [mode, setMode] = useState<Mode>("login")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)
    try {
      let accessToken: string
      if (mode === "register") {
        const data = await apiRegister(email, password)
        accessToken = data.token.access_token
      } else {
        const data = await apiLogin(email, password)
        accessToken = data.access_token
      }
      setAccessToken(accessToken)
      const session = await apiCreateSession(accessToken)
      setSessionToken(session.token.access_token)
      router.push("/chat")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to authenticate")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      {/* Language toggle — top-right */}
      <button
        onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
        className="fixed top-4 right-4 text-xs font-body font-medium
                   text-[var(--text-3)] hover:text-[var(--text-2)]
                   px-3 py-1.5 rounded-full hover:bg-black/5 transition-colors"
        aria-label="Switch language"
      >
        {t('lang_toggle')}
      </button>

      <div className="glass-strong rounded-3xl p-10 w-full max-w-md">
        <h1 className="font-heading italic text-3xl tracking-tight text-[var(--text)] mb-1">
          {t('login_title')}
        </h1>
        <p className="font-body font-light text-sm text-[var(--text-3)] mb-8">
          {t('login_sub')}
        </p>

        {/* Mode toggle */}
        <div className="flex gap-2 mb-8">
          {(["login", "register"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 py-2 rounded-full text-sm font-body font-medium transition-colors ${
                mode === m
                  ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                  : "glass text-[var(--text-2)] hover:text-[var(--text)]"
              }`}
            >
              {m === "login" ? t('login_mode_login') : t('login_mode_register')}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block font-body text-sm text-[var(--text-2)] mb-1.5"
            >
              {t('login_email')}
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              placeholder="you@example.com"
              className="w-full px-4 py-2.5 bg-black/[0.04] text-[var(--text)] rounded-xl
                         border border-[var(--border-strong)]
                         font-body font-light text-sm placeholder:text-[var(--text-3)]
                         focus-visible:outline-none focus-visible:ring-2
                         focus-visible:ring-[#141210]/30"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block font-body text-sm text-[var(--text-2)] mb-1.5"
            >
              {t('login_password')}
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={mode === "register" ? "new-password" : "current-password"}
              placeholder={
                mode === "register"
                  ? t('login_pw_placeholder_new')
                  : t('login_pw_placeholder_existing')
              }
              className="w-full px-4 py-2.5 bg-black/[0.04] text-[var(--text)] rounded-xl
                         border border-[var(--border-strong)]
                         font-body font-light text-sm placeholder:text-[var(--text-3)]
                         focus-visible:outline-none focus-visible:ring-2
                         focus-visible:ring-[#141210]/30"
            />
          </div>

          {error && (
            <p
              role="alert"
              className="text-red-600 text-sm bg-red-50 border border-red-200
                         rounded-xl px-4 py-2.5 font-body font-light"
            >
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-[var(--accent)] hover:opacity-90
                       disabled:opacity-40 disabled:cursor-not-allowed
                       text-[var(--accent-fg)] rounded-full font-body font-medium
                       text-sm transition-opacity mt-2"
          >
            {loading
              ? t('login_loading')
              : mode === "login"
              ? t('login_submit_login')
              : t('login_submit_register')}
          </button>
        </form>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Visual check — login page**

Navigate to http://localhost:3000/login. Verify:
- Warm off-white background visible
- Glass card with subtle border shimmer
- Instrument Serif italic heading "Job Hunter"
- Mode toggle uses rounded-full pill buttons
- Language toggle button top-right (shows "EN" by default if browser is zh, "中文" if browser is en)
- Error state: add wrong credentials, verify red styling (no dark backgrounds)

- [ ] **Step 3: Commit**

```bash
git add frontend/app/login/page.tsx
git commit -m "feat: redesign login page — light glass theme + i18n"
```

---

## Task 6: Chat Page — Navbar & Layout

**Files:**
- Modify: `frontend/app/chat/page.tsx`

- [ ] **Step 1: Replace file**

```tsx
"use client"

import { useState, useEffect } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { isAuthenticated, clearAuth } from "@/lib/auth"
import { ChatPanel } from "@/components/chat/ChatPanel"
import { ApplicationTracker } from "@/components/tracker/ApplicationTracker"
import { ListingsPanel } from "@/components/listings/ListingsPanel"
import { useLanguage } from "@/contexts/LanguageContext"

type Tab = "chat" | "picks"

export default function ChatPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { t, locale, setLocale } = useLanguage()

  const [tab, setTab] = useState<Tab>(() => {
    const p = searchParams.get("tab")
    return p === "picks" ? "picks" : "chat"
  })
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login")
    } else {
      setReady(true)
    }
  }, [router])

  function handleTabChange(key: Tab) {
    setTab(key)
    router.replace(`?tab=${key}`, { scroll: false })
  }

  function handleLogout() {
    clearAuth()
    router.replace("/login")
  }

  if (!ready) return null

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Navbar wrapper — floating pill with page padding */}
      <div className="px-4 pt-3 pb-2 flex-shrink-0">
        <nav className="glass rounded-full px-5 py-2.5 flex items-center justify-between">
          {/* Brand */}
          <span className="font-heading italic text-lg tracking-tight text-[var(--text)]">
            Job Hunter ✦
          </span>

          {/* Tab list */}
          <div role="tablist" className="flex items-center gap-1">
            {([
              { key: "chat" as Tab, label: t('tab_chat') },
              { key: "picks" as Tab, label: t('tab_picks') },
            ]).map(({ key, label }) => (
              <button
                key={key}
                role="tab"
                aria-selected={tab === key}
                onClick={() => handleTabChange(key)}
                className={`rounded-full px-4 py-1.5 text-sm font-body font-medium transition-colors ${
                  tab === key
                    ? "bg-[var(--accent)] text-[var(--accent-fg)]"
                    : "text-[var(--text-2)] hover:bg-black/5 hover:text-[var(--text)]"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Right controls */}
          <div className="flex items-center gap-1">
            <button
              onClick={() => setLocale(locale === 'zh-CN' ? 'en' : 'zh-CN')}
              aria-label="Switch language"
              className="text-xs font-body font-medium text-[var(--text-3)]
                         hover:text-[var(--text-2)] px-3 py-1.5 rounded-full
                         hover:bg-black/5 transition-colors tracking-wide"
            >
              {t('lang_toggle')}
            </button>
            <button
              onClick={handleLogout}
              className="text-xs font-body text-[var(--text-3)] hover:text-[var(--text-2)]
                         px-3 py-1.5 rounded-full hover:bg-black/5 transition-colors"
            >
              {t('logout')}
            </button>
          </div>
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden px-4 pb-4">
        {tab === "chat" ? (
          <div className="h-full flex gap-4">
            <div className="flex-1 min-w-0 overflow-hidden">
              <ChatPanel />
            </div>
            <div className="w-72 xl:w-80 flex-shrink-0 overflow-hidden">
              <ApplicationTracker />
            </div>
          </div>
        ) : (
          <ListingsPanel />
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Visual check — navbar**

Navigate to http://localhost:3000/chat. Verify:
- Floating pill navbar with glass effect and subtle border shimmer
- "Job Hunter ✦" in Instrument Serif italic
- Active tab has black pill style, inactive is text only
- Language toggle and Logout buttons on right
- Page background shows through under the navbar (no solid bar)
- URL updates to `?tab=picks` when switching tabs

- [ ] **Step 3: Commit**

```bash
git add frontend/app/chat/page.tsx
git commit -m "feat: redesign chat page — glass pill navbar, layout structure, i18n + lang toggle"
```

---

## Task 7: ChatInput

**Files:**
- Modify: `frontend/components/chat/ChatInput.tsx`

- [ ] **Step 1: Replace file**

```tsx
"use client"

import { useState, useRef } from "react"
import { useLanguage } from "@/contexts/LanguageContext"

interface Props {
  onSend: (text: string) => void
  disabled: boolean
}

export function ChatInput({ onSend, disabled }: Props) {
  const { t } = useLanguage()
  const [text, setText] = useState("")
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim() || disabled) return
    onSend(text)
    setText("")
    if (textareaRef.current) textareaRef.current.style.height = "auto"
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit(e)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setText(e.target.value)
    const el = e.target
    el.style.height = "auto"
    el.style.height = Math.min(el.scrollHeight, 120) + "px"
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="glass flex items-end gap-2 p-3 rounded-b-3xl"
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={1}
        placeholder={t('chat_placeholder')}
        className="flex-1 resize-none rounded-xl bg-black/[0.04] px-4 py-2.5
                   font-body font-light text-sm text-[var(--text)]
                   placeholder:text-[var(--text-3)]
                   border border-[var(--border-strong)]
                   focus-visible:outline-none focus-visible:ring-2
                   focus-visible:ring-[#141210]/30
                   disabled:opacity-50 min-h-[44px] max-h-[120px] leading-relaxed"
      />
      <button
        type="submit"
        disabled={disabled || !text.trim()}
        className="px-4 py-2.5 bg-[var(--accent)] hover:opacity-90
                   disabled:bg-[var(--border-strong)] disabled:text-[var(--text-3)]
                   disabled:cursor-not-allowed
                   text-[var(--accent-fg)] rounded-xl
                   font-body font-medium text-sm transition-opacity min-h-[44px]"
      >
        {disabled ? t('chat_sending') : t('chat_send')}
      </button>
    </form>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/chat/ChatInput.tsx
git commit -m "feat: redesign ChatInput — light glass styles + i18n"
```

---

## Task 8: MessageBubble

**Files:**
- Modify: `frontend/components/chat/MessageBubble.tsx`

- [ ] **Step 1: Replace file**

```tsx
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ToolCallCard } from "./ToolCallCard"
import type { ChatMessage } from "@/lib/types"
import { useLanguage } from "@/contexts/LanguageContext"

interface Props {
  message: ChatMessage
  isStreaming?: boolean
}

export function MessageBubble({ message, isStreaming }: Props) {
  const { locale } = useLanguage()
  const isUser = message.role === "user"

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div className="max-w-[85%]">
        {/* Tool call cards (assistant only) */}
        {message.toolCalls.length > 0 && (
          <div className="mb-2 space-y-1">
            {message.toolCalls.map((tc) => (
              <ToolCallCard key={tc.toolCallId} entry={tc} />
            ))}
          </div>
        )}

        {/* Text bubble */}
        {(message.textContent || isStreaming) && (
          <div
            className={`rounded-[18px] px-4 py-2.5 text-sm leading-relaxed font-body ${
              isUser
                ? "bg-[var(--accent)] text-[var(--accent-fg)] rounded-br-[4px]"
                : "glass text-[var(--text)] font-light rounded-bl-[4px]"
            }`}
          >
            <div className="[&_li>p]:my-0 [&_li>p]:inline">
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  a: ({ href, children }) => (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline underline-offset-2 opacity-80 hover:opacity-100 break-all"
                    >
                      {children}
                    </a>
                  ),
                  p: ({ children }) => <p className="mb-1 last:mb-0">{children}</p>,
                  ul: ({ children }) => <ul className="list-disc pl-4 mb-1 space-y-0.5">{children}</ul>,
                  ol: ({ children }) => <ol className="list-decimal pl-4 mb-1 space-y-0.5">{children}</ol>,
                  li: ({ children }) => <li className="leading-snug">{children}</li>,
                  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
                  code: ({ children }) => (
                    <code className="px-1 py-0.5 rounded text-xs font-mono bg-black/10">{children}</code>
                  ),
                }}
              >
                {message.textContent}
              </ReactMarkdown>
            </div>
            {isStreaming && (
              <span className="inline-block w-1 h-4 bg-current ml-0.5 animate-pulse rounded-sm align-middle" />
            )}
          </div>
        )}

        {/* Timestamp */}
        {message.timestamp && (
          <div className={`mt-1 text-[10px] font-body font-light text-[var(--text-3)] ${
            isUser ? "text-right" : "text-left"
          }`}>
            {message.timestamp.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/chat/MessageBubble.tsx
git commit -m "feat: redesign MessageBubble — light bubbles, glass AI bubble, i18n locale"
```

---

## Task 9: ToolCallCard

**Files:**
- Modify: `frontend/components/chat/ToolCallCard.tsx`

- [ ] **Step 1: Replace file**

```tsx
import type { ToolCallEntry } from "@/lib/types"
import { useLanguage } from "@/contexts/LanguageContext"

const TOOL_LABELS: Record<string, string> = {
  job_search_tool: "Job Search",
  company_research_tool: "Company Research",
  cover_letter_tool: "Cover Letter",
  application_tracker_tool: "Application Tracker",
  job_preferences_tool: "Preferences",
  duckduckgo_search: "Web Search",
}

interface Props {
  entry: ToolCallEntry
}

export function ToolCallCard({ entry }: Props) {
  const { t } = useLanguage()
  const label = TOOL_LABELS[entry.toolName] ?? entry.toolName
  const isDone = entry.status === "done"

  return (
    <div className="glass rounded-xl overflow-hidden my-1">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)]">
        <span
          className={`w-[7px] h-[7px] rounded-full flex-shrink-0 ${
            isDone
              ? "bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.4)]"
              : "bg-amber-400 animate-pulse"
          }`}
        />
        <span className="font-body font-medium text-sm text-[var(--text-2)]">
          {label}{isDone ? "" : ""}
        </span>
        {!isDone && (
          <span className="ml-auto font-body font-light text-xs text-[var(--text-3)] animate-pulse">
            {t('tool_running')}
          </span>
        )}
      </div>

      {/* Result body — Option C: left accent bar */}
      {entry.resultContent && (
        <div className="flex gap-2.5 px-3 py-2">
          <div className="w-[2.5px] self-stretch rounded-full bg-gradient-to-b from-[#141210] to-[#141210]/20 flex-shrink-0" />
          <p
            className="font-body font-normal text-sm leading-relaxed max-h-32 overflow-y-auto"
            style={{ color: "rgba(20,18,16,0.72)" }}
          >
            {entry.resultContent}
          </p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/chat/ToolCallCard.tsx
git commit -m "feat: redesign ToolCallCard — glass, left accent bar, readable result text"
```

---

## Task 10: ChatPanel

**Files:**
- Modify: `frontend/components/chat/ChatPanel.tsx`

- [ ] **Step 1: Replace file**

```tsx
"use client"

import { useEffect, useRef } from "react"
import { MessageBubble } from "./MessageBubble"
import { ChatInput } from "./ChatInput"
import { useChat } from "@/hooks/useChat"
import { useLanguage } from "@/contexts/LanguageContext"

export function ChatPanel() {
  const { messages, streaming, error, sendMessage } = useChat()
  const { t } = useLanguage()
  const bottomRef = useRef<HTMLDivElement>(null)

  const QUICK_PROMPTS = [
    t('quick_prompt_1'),
    t('quick_prompt_2'),
    t('quick_prompt_3'),
  ]

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  return (
    /* Outer: glass-strong, NO overflow-hidden — preserves ::before gradient border */
    <div className="glass-strong rounded-3xl flex flex-col h-full">
      {/* Inner: overflow-hidden clips scroll without clipping the border */}
      <div className="flex flex-col h-full overflow-hidden">

        {/* Header */}
        <div className="px-5 pt-4 pb-3 border-b border-[var(--border)] flex-shrink-0">
          <div className="glass rounded-full inline-flex items-center gap-1.5 px-3 py-1 text-xs font-body font-medium text-[var(--text-2)] mb-3">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
            {t('chat_badge')}
          </div>
          <h2 className="font-heading italic text-xl tracking-tight text-[var(--text)] leading-none mb-0.5">
            {t('chat_title')}
          </h2>
          <p className="font-body font-light text-xs text-[var(--text-3)]">
            {t('chat_subtitle')}
          </p>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {messages.length === 0 && (
            <div className="flex flex-col items-center gap-5 max-w-xs mx-auto mt-12">
              <h3 className="font-heading italic text-2xl tracking-tight text-[var(--text)] text-center">
                {t('chat_empty_heading')}
              </h3>
              <p className="font-body font-light text-sm text-[var(--text-3)] text-center whitespace-pre-line">
                {t('chat_empty_sub')}
              </p>
              <div className="flex flex-col gap-2 w-full">
                {QUICK_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    onClick={() => sendMessage(prompt)}
                    className="glass rounded-full flex items-center justify-between
                               px-4 py-2.5 text-sm font-body font-normal
                               text-[var(--text-2)] hover:bg-white/80 transition-colors text-left"
                  >
                    <span>{prompt}</span>
                    <span className="text-[var(--text-3)] flex-shrink-0 ml-2" aria-hidden="true">↗</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <MessageBubble
              key={msg.id}
              message={msg}
              isStreaming={streaming && i === messages.length - 1 && msg.role === "assistant"}
            />
          ))}

          <div aria-live="polite" aria-atomic="true">
            {streaming &&
              messages[messages.length - 1]?.role === "assistant" &&
              !messages[messages.length - 1]?.textContent && (
                <div className="flex items-center gap-2 px-3 py-2 text-[var(--text-3)] text-sm">
                  <span className="flex gap-1" aria-hidden="true">
                    <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:0ms]" />
                    <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="w-1.5 h-1.5 bg-[var(--text-3)] rounded-full animate-bounce [animation-delay:300ms]" />
                  </span>
                  <span className="text-xs">{t('chat_thinking')}</span>
                </div>
              )}
          </div>

          {error && (
            <div
              role="alert"
              className="text-red-600 text-sm bg-red-50 border border-red-200
                         rounded-xl px-4 py-2.5 mx-2 mt-2 font-body font-light"
            >
              ⚠ {error}
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="flex-shrink-0">
          <ChatInput onSend={sendMessage} disabled={streaming} />
        </div>

      </div>
    </div>
  )
}
```

- [ ] **Step 2: Visual check — chat panel**

Navigate to http://localhost:3000/chat. Verify:
- Glass panel with visible border shimmer on rounded corners
- Header: green status dot badge, italic heading, light subtitle
- Empty state: italic greeting, subtitle, 3 chip buttons (click one and verify message is sent)
- Chat messages: user bubble is black/cream, AI bubble is glass
- Tool card shows left accent bar for results

- [ ] **Step 3: Commit**

```bash
git add frontend/components/chat/ChatPanel.tsx
git commit -m "feat: redesign ChatPanel — glass panel, quick-chip empty state, i18n"
```

---

## Task 11: ApplicationCard

**Files:**
- Modify: `frontend/components/tracker/ApplicationCard.tsx`

- [ ] **Step 1: Replace file**

```tsx
import type { Application, ApplicationStatus } from "@/lib/types"
import { useLanguage } from "@/contexts/LanguageContext"

const STATUS_CLASSES: Record<ApplicationStatus, string> = {
  applied:      "text-blue-600 bg-blue-50 border-blue-100",
  interviewing: "text-amber-600 bg-amber-50 border-amber-100",
  rejected:     "text-red-600 bg-red-50 border-red-100",
  offer:        "text-green-600 bg-green-50 border-green-100",
}

const ALL_STATUSES: ApplicationStatus[] = ["applied", "interviewing", "offer", "rejected"]

interface Props {
  app: Application
  onStatusChange: (id: number, status: ApplicationStatus) => void
  onDelete: (id: number) => void
}

export function ApplicationCard({ app, onStatusChange, onDelete }: Props) {
  const { t } = useLanguage()

  const statusLabelKey: Record<ApplicationStatus, string> = {
    applied:      'status_applied',
    interviewing: 'status_interviewing',
    offer:        'status_offer',
    rejected:     'status_rejected',
  }

  return (
    <div className="bg-white/50 rounded-2xl p-3 border border-[var(--border)] hover:border-[var(--border-strong)] transition-colors">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          <p className="font-body font-medium text-sm text-[var(--text)] truncate">{app.company}</p>
          <p className="font-body font-light text-xs text-[var(--text-2)] truncate">{app.title}</p>
        </div>
        <button
          onClick={() => onDelete(app.id)}
          aria-label={t('delete')}
          className="text-[var(--text-3)] hover:text-red-500 transition-colors
                     flex-shrink-0 text-xl leading-none pb-0.5"
        >
          ×
        </button>
      </div>

      {app.url && (
        <a
          href={app.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-body font-light text-xs text-blue-600 hover:text-blue-500 truncate block mb-1.5"
        >
          {app.url}
        </a>
      )}

      <select
        value={app.status}
        onChange={(e) => onStatusChange(app.id, e.target.value as ApplicationStatus)}
        className={`w-full text-xs rounded-full px-3 py-1 border font-body font-medium
                    bg-transparent cursor-pointer appearance-none ${STATUS_CLASSES[app.status]}`}
      >
        {ALL_STATUSES.map((s) => (
          <option key={s} value={s} className="bg-white text-[var(--text)]">
            {t(statusLabelKey[s])}
          </option>
        ))}
      </select>

      <p className="font-body font-light text-[10px] text-[var(--text-3)] mt-1.5">
        {app.applied_date}
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/tracker/ApplicationCard.tsx
git commit -m "feat: redesign ApplicationCard — glass card, semantic status pills, i18n"
```

---

## Task 12: ApplicationTracker

**Files:**
- Modify: `frontend/components/tracker/ApplicationTracker.tsx`

- [ ] **Step 1: Replace file**

```tsx
"use client"

import { useState } from "react"
import { ApplicationCard } from "./ApplicationCard"
import { useApplications } from "@/hooks/useApplications"
import { useLanguage } from "@/contexts/LanguageContext"
import type { ApplicationStatus } from "@/lib/types"

const COLUMNS: { key: ApplicationStatus; labelKey: string }[] = [
  { key: "applied",      labelKey: "col_applied" },
  { key: "interviewing", labelKey: "col_interviewing" },
  { key: "offer",        labelKey: "col_offer" },
  { key: "rejected",     labelKey: "col_rejected" },
]

export function ApplicationTracker() {
  const { applications, loading, addApplication, updateStatus, deleteApplication } = useApplications()
  const { t } = useLanguage()

  const [showAdd, setShowAdd] = useState(false)
  const [company, setCompany] = useState("")
  const [title, setTitle] = useState("")
  const [url, setUrl] = useState("")

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!company.trim() || !title.trim()) return
    await addApplication(company.trim(), title.trim(), url.trim() || undefined)
    setCompany(""); setTitle(""); setUrl(""); setShowAdd(false)
  }

  return (
    /* Outer: glass-strong, NO overflow-hidden */
    <div className="glass-strong rounded-3xl flex flex-col h-full">
      {/* Inner: clips scroll content */}
      <div className="flex flex-col h-full overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] flex-shrink-0">
          <div>
            <h2 className="font-heading italic text-xl tracking-tight text-[var(--text)] leading-none mb-0.5">
              {t('tracker_title')}
            </h2>
            <p className="font-body font-light text-xs text-[var(--text-3)]">
              {t('tracker_sub_n', applications.length)}
            </p>
          </div>
          <button
            onClick={() => setShowAdd(!showAdd)}
            aria-label={t('tracker_add')}
            className="bg-[var(--accent)] text-[var(--accent-fg)] rounded-full
                       px-4 py-2 text-xs font-body font-medium min-h-[32px]"
          >
            {t('tracker_add')}
          </button>
        </div>

        {/* Add form */}
        {showAdd && (
          <form
            onSubmit={handleAdd}
            className="px-4 py-3 border-b border-[var(--border)] space-y-2 flex-shrink-0"
          >
            <label htmlFor="app-company" className="sr-only">{t('form_company')}</label>
            <input
              id="app-company"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder={t('form_company')}
              required
              className="w-full px-3 py-2 text-xs font-body bg-black/[0.04] text-[var(--text)]
                         rounded-xl border border-[var(--border-strong)]
                         placeholder:text-[var(--text-3)]
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141210]/30"
            />
            <label htmlFor="app-title" className="sr-only">{t('form_title_field')}</label>
            <input
              id="app-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('form_title_field')}
              required
              className="w-full px-3 py-2 text-xs font-body bg-black/[0.04] text-[var(--text)]
                         rounded-xl border border-[var(--border-strong)]
                         placeholder:text-[var(--text-3)]
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141210]/30"
            />
            <label htmlFor="app-url" className="sr-only">{t('form_url')}</label>
            <input
              id="app-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={t('form_url')}
              type="url"
              className="w-full px-3 py-2 text-xs font-body bg-black/[0.04] text-[var(--text)]
                         rounded-xl border border-[var(--border-strong)]
                         placeholder:text-[var(--text-3)]
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#141210]/30"
            />
            <div className="flex gap-2">
              <button type="submit"
                className="flex-1 py-1.5 text-xs font-body font-medium
                           bg-[var(--accent)] text-[var(--accent-fg)] rounded-full">
                {t('tracker_save')}
              </button>
              <button type="button" onClick={() => setShowAdd(false)}
                className="flex-1 py-1.5 text-xs font-body
                           glass text-[var(--text-2)] rounded-full">
                {t('tracker_cancel')}
              </button>
            </div>
          </form>
        )}

        {/* Columns */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {loading ? (
            <p className="font-body font-light text-xs text-[var(--text-3)] text-center mt-6">
              {t('listings_loading')}
            </p>
          ) : (
            <div className="space-y-5">
              {COLUMNS.map(({ key, labelKey }) => {
                const colApps = applications.filter((a) => a.status === key)
                return (
                  <div key={key}>
                    <p className="font-body font-semibold text-[10px] uppercase tracking-widest
                                  text-[var(--text-3)] mb-2">
                      {t(labelKey)}{" "}
                      <span className="font-normal">({colApps.length})</span>
                    </p>
                    <div className="space-y-2">
                      {colApps.length === 0 ? (
                        <p className="font-body font-light text-xs text-[var(--text-3)] italic pl-1">
                          {t('tracker_empty_col')}
                        </p>
                      ) : (
                        colApps.map((app) => (
                          <ApplicationCard
                            key={app.id}
                            app={app}
                            onStatusChange={updateStatus}
                            onDelete={deleteApplication}
                          />
                        ))
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/tracker/ApplicationTracker.tsx
git commit -m "feat: redesign ApplicationTracker — glass panel, two-element structure, i18n"
```

---

## Task 13: ListingCard

**Files:**
- Modify: `frontend/components/listings/ListingCard.tsx`

- [ ] **Step 1: Replace file**

```tsx
import type { JobListing } from "@/lib/types"

interface Props {
  listing: JobListing
}

export function ListingCard({ listing }: Props) {
  return (
    <div className="glass rounded-2xl p-4 flex flex-col gap-1.5 hover:bg-white/80 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-heading italic text-base text-[var(--text)]
                     hover:text-[var(--text-2)] transition-colors
                     line-clamp-2 leading-snug"
        >
          {listing.title || "Untitled listing"}
        </a>
        <span className="flex-shrink-0 font-body font-light text-[10px] text-[var(--text-3)] mt-0.5">
          {listing.found_date}
        </span>
      </div>
      {(listing.company || listing.location) && (
        <p className="font-body font-light text-xs text-[var(--text-2)]">
          {[listing.company, listing.location].filter(Boolean).join(" · ")}
        </p>
      )}
      {listing.snippet && (
        <p className="font-body font-light text-xs text-[var(--text-3)] line-clamp-3 leading-relaxed">
          {listing.snippet}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/components/listings/ListingCard.tsx
git commit -m "feat: redesign ListingCard — glass card, heading font for title"
```

---

## Task 14: ListingsPanel

**Files:**
- Modify: `frontend/components/listings/ListingsPanel.tsx`

- [ ] **Step 1: Replace file**

```tsx
"use client"

import { ListingCard } from "./ListingCard"
import { useListings } from "@/hooks/useListings"
import { useLanguage } from "@/contexts/LanguageContext"

export function ListingsPanel() {
  const { listings, loading, error, reload } = useListings()
  const { t } = useLanguage()

  return (
    /* Outer: glass-strong, NO overflow-hidden */
    <div className="glass-strong rounded-3xl flex flex-col h-full">
      {/* Inner: clips scroll */}
      <div className="flex flex-col h-full overflow-hidden">

        <div className="flex items-center justify-between px-6 py-5
                        border-b border-[var(--border)] flex-shrink-0">
          <div>
            <h2 className="font-heading italic text-2xl tracking-tight text-[var(--text)] leading-none mb-1">
              {t('listings_title')}
            </h2>
            <p className="font-body font-light text-sm text-[var(--text-2)]">
              {listings.length > 0
                ? t('listings_sub_n', listings.length)
                : t('listings_sub_empty')}
            </p>
          </div>
          <button
            onClick={reload}
            className="glass rounded-full text-sm font-body px-4 py-1.5
                       text-[var(--text-2)] hover:bg-white/80 transition-colors"
          >
            {t('listings_refresh')}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {loading && (
            <p className="font-body font-light text-sm text-[var(--text-3)] text-center mt-12">
              {t('listings_loading')}
            </p>
          )}
          {error && (
            <p className="text-red-600 font-body font-light text-sm text-center mt-12">{error}</p>
          )}
          {!loading && !error && listings.length === 0 && (
            <div className="flex flex-col items-center gap-3 mt-20 text-center">
              <div className="w-12 h-12 rounded-full glass flex items-center justify-center text-2xl">
                📋
              </div>
              <p className="font-heading italic text-xl text-[var(--text)]">
                {t('listings_empty_title')}
              </p>
              <p className="font-body font-light text-sm text-[var(--text-3)] max-w-xs leading-relaxed">
                {t('listings_empty_sub')}<br />
                <span className="font-body font-normal text-[var(--text-2)]">
                  {t('listings_empty_hint')}
                </span>
              </p>
            </div>
          )}
          {!loading && listings.length > 0 && (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {listings.map((l) => (
                <ListingCard key={l.id} listing={l} />
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
```

- [ ] **Step 2: Final visual check**

Navigate through all views. Verify:
- Login: glass card, light theme, mode toggle, language switcher
- Chat: glass pill navbar, language toggle switches EN↔中文 and all strings update immediately, quick chips in empty state, glass message bubbles, left-bar tool cards
- Tracker sidebar: glass panel, status columns in chosen language, add form works
- Today's Picks: glass panel, listing cards with italic headings

- [ ] **Step 3: TypeScript final check**

```bash
cd frontend && pnpm tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Final commit**

```bash
git add frontend/components/listings/ListingsPanel.tsx
git commit -m "feat: redesign ListingsPanel — glass panel, i18n, redesigned empty state"
```
