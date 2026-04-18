"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { apiGoogleLogin, apiCreateSession, apiGetSessions } from "@/lib/api"
import {
  setAccessToken,
  setSessionToken,
  setSessionId,
  setUser,
  isAuthenticated,
} from "@/lib/auth"
import { useLanguage } from "@/contexts/LanguageContext"

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? ""

export default function LoginPage() {
  const router = useRouter()
  const { t, locale, setLocale } = useLanguage()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const googleBtnRef = useRef<HTMLDivElement>(null)

  // If already authenticated, redirect to chat
  useEffect(() => {
    if (isAuthenticated()) {
      router.replace("/chat")
    }
  }, [router])

  // Use a ref so the GSI callback always calls the latest version
  // without re-triggering the effect that loads the script.
  const handleCredentialRef = useRef<(c: string) => Promise<void>>(null!)

  handleCredentialRef.current = async (credential: string) => {
    setError("")
    setLoading(true)
    try {
      const data = await apiGoogleLogin(credential)
      setAccessToken(data.token.access_token)
      setUser(data.user)

      // Fetch existing sessions — this triggers the backend auto-seed for
      // brand-new users (adds a tutorial session). Use the first session if
      // any exist; only create an empty one as a last-resort fallback.
      const sessions = await apiGetSessions(data.token.access_token)
      const primary = sessions[0] ?? (await apiCreateSession(data.token.access_token))
      setSessionToken(primary.token.access_token)
      setSessionId(primary.session_id)
      router.push("/chat")
    } catch (err) {
      setError(err instanceof Error ? err.message : String(t("login_error")))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    const g = (window as any).google
    if (g?.accounts) {
      initGsi(g)
      return () => { g.accounts.id.cancel() }
    }

    const script = document.createElement("script")
    script.src = "https://accounts.google.com/gsi/client"
    script.async = true
    script.onload = () => {
      const google = (window as any).google
      if (google) initGsi(google)
    }
    document.head.appendChild(script)

    function initGsi(google: any) {
      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response: any) => {
          handleCredentialRef.current(response.credential)
        },
        cancel_on_tap_outside: true,
      })

      if (googleBtnRef.current) {
        googleBtnRef.current.innerHTML = ""
        google.accounts.id.renderButton(googleBtnRef.current, {
          theme: "outline",
          size: "large",
          width: "100%",
          text: "signin_with",
          shape: "pill",
        })
      }

      google.accounts.id.prompt()
    }

    return () => {
      (window as any).google?.accounts?.id?.cancel()
      script.remove()
    }
  }, [])

  return (
    <div className="min-h-screen flex items-center justify-center">
      {/* Language toggle */}
      <button
        onClick={() => setLocale(locale === "zh-CN" ? "en" : "zh-CN")}
        className="fixed top-4 right-4 text-xs font-body font-medium
                   text-[var(--text-3)] hover:text-[var(--text-2)]
                   px-3 py-1.5 rounded-full hover:bg-black/5 transition-colors"
        aria-label="Switch language"
      >
        {t("lang_toggle")}
      </button>

      <div className="glass-strong rounded-3xl p-10 w-full max-w-md">
        <h1 className="font-heading italic text-3xl tracking-tight text-[var(--text)] mb-1">
          {t("login_title")}
        </h1>
        <p className="font-body font-light text-sm text-[var(--text-3)] mb-8">
          {t("login_sub")}
        </p>

        {error && (
          <p
            role="alert"
            className="text-red-600 text-sm bg-red-50 border border-red-200
                       rounded-xl px-4 py-2.5 font-body font-light mb-4"
          >
            {error}
          </p>
        )}

        {loading ? (
          <p className="text-center text-sm font-body text-[var(--text-2)]">
            {t("login_loading")}
          </p>
        ) : (
          <div ref={googleBtnRef} className="flex justify-center" />
        )}
      </div>
    </div>
  )
}
