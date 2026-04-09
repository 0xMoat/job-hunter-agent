"use client"

import { useState } from "react"
import type { ToolCallEntry } from "@/lib/types"

interface Props {
  entry: ToolCallEntry
}

function parseDownloadUrl(entry: ToolCallEntry): string | null {
  const text = entry.resultContent ?? ""
  const match = text.match(/\/api\/v1\/resume\/download\/[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+\.[A-Za-z0-9\-_]+/)
  return match ? match[0] : null
}

export function ResumeDownloadCard({ entry }: Props) {
  const downloadUrl = parseDownloadUrl(entry)
  const [status, setStatus] = useState<"idle" | "downloading" | "done" | "error">("idle")

  if (!downloadUrl) {
    return (
      <div className="glass rounded-xl my-1 px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-[var(--text-2)]">
          <span className="w-[7px] h-[7px] rounded-full bg-red-500 flex-shrink-0" />
          <span className="font-body font-semibold">Resume PDF</span>
        </div>
        <p className="mt-2 text-xs font-body text-[var(--text-3)] italic">生成失败，请重试</p>
      </div>
    )
  }

  const handleDownload = async () => {
    setStatus("downloading")
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
      const res = await fetch(`${baseUrl}${downloadUrl}`)
      if (!res.ok) throw new Error("Download failed")
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "resume.pdf"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      setStatus("done")
    } catch {
      setStatus("error")
    }
  }

  return (
    <div className="glass rounded-xl my-1 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="w-[7px] h-[7px] rounded-full bg-green-500 flex-shrink-0" />
          <span className="font-body font-semibold text-sm text-[var(--text-2)]">Resume PDF</span>
          <span className="font-mono text-xs text-[var(--text-3)]">10 分钟内有效</span>
        </div>
        {status === "done" ? (
          <span className="font-body text-xs font-semibold text-green-600">已下载 ✓</span>
        ) : status === "error" ? (
          <span className="font-body text-xs font-semibold text-red-500">链接已失效</span>
        ) : (
          <button
            onClick={handleDownload}
            disabled={status === "downloading"}
            className={`font-body text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors ${
              status === "downloading"
                ? "text-[var(--text-3)] bg-black/[0.03] cursor-not-allowed"
                : "text-[var(--accent-fg)] bg-[var(--accent)] hover:opacity-90 cursor-pointer"
            }`}
          >
            {status === "downloading" ? "下载中..." : "下载 PDF"}
          </button>
        )}
      </div>
    </div>
  )
}
