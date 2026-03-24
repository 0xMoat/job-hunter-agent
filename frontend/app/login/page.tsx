"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { apiRegister, apiLogin, apiCreateSession } from "@/lib/api"
import { setAccessToken, setSessionToken } from "@/lib/auth"

type Mode = "login" | "register"

export default function LoginPage() {
  const router = useRouter()
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

      // Create a chat session. The session token is used for all agent API calls.
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
    <div className="min-h-screen flex items-center justify-center bg-slate-900">
      <div className="w-full max-w-md p-8 bg-slate-800 rounded-xl shadow-2xl">
        <h1 className="text-2xl font-bold text-white mb-1">Job Hunter Agent</h1>
        <p className="text-slate-400 mb-6 text-sm">AI-powered job hunting assistant</p>

        <div className="flex gap-2 mb-6">
          {(["login", "register"] as Mode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === m
                  ? "bg-blue-600 text-white"
                  : "bg-slate-700 text-slate-300 hover:bg-slate-600"
              }`}
            >
              {m === "login" ? "Login" : "Register"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="w-full px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:outline-none focus:border-blue-500 text-sm"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="w-full px-3 py-2 bg-slate-700 text-white rounded-lg border border-slate-600 focus:outline-none focus:border-blue-500 text-sm"
              placeholder={
                mode === "register"
                  ? "≥8 chars, A-Z, a-z, 0-9, special (!@#…)"
                  : "Your password"
              }
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-900/20 border border-red-800 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors text-sm"
          >
            {loading
              ? "Please wait…"
              : mode === "login"
              ? "Login"
              : "Create Account"}
          </button>
        </form>
      </div>
    </div>
  )
}
