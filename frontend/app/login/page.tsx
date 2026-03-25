"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { apiRegister, apiLogin, apiCreateSession } from "@/lib/api"
import { setAccessToken, setSessionToken, setSessionId } from "@/lib/auth"
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
      setSessionId(session.session_id)
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
