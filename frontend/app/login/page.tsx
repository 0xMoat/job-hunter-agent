"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { apiGoogleLogin, apiCreateSession } from "@/lib/api"
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

  const handleCredential = useCallback(
    async (credential: string) => {
      setError("")
      setLoading(true)
      try {
        const data = await apiGoogleLogin(credential)
        setAccessToken(data.token.access_token)
        setUser(data.user)

        const session = await apiCreateSession(data.token.access_token)
        setSessionToken(session.token.access_token)
        setSessionId(session.session_id)
        router.push("/chat")
      } catch (err) {
        setError(err instanceof Error ? err.message : String(t("login_error")))
      } finally {
        setLoading(false)
      }
    },
    [router, t],
  )

  useEffect(() => {
    const script = document.createElement("script")
    script.src = "https://accounts.google.com/gsi/client"
    script.async = true
    script.onload = () => {
      const google = (window as any).google
      if (!google) return

      google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response: any) => {
          handleCredential(response.credential)
        },
      })

      // Render the button
      if (googleBtnRef.current) {
        google.accounts.id.renderButton(googleBtnRef.current, {
          theme: "outline",
          size: "large",
          width: "100%",
          text: "signin_with",
          shape: "pill",
        })
      }

      // Trigger One Tap
      google.accounts.id.prompt()
    }
    document.head.appendChild(script)

    return () => {
      script.remove()
    }
  }, [handleCredential])

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
