"use client"

import { useState } from "react"
import type { ReactNode } from "react"

interface Props {
  href: string
  children: ReactNode
}

export function ResumeDownloadLink({ href, children }: Props) {
  const [status, setStatus] = useState<"idle" | "downloading" | "done" | "error">("idle")

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    if (status === "downloading") return
    setStatus("downloading")
    try {
      const baseUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"
      const res = await fetch(`${baseUrl}${href}`)
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

  const label = status === "downloading"
    ? "下载中..."
    : status === "done"
      ? "已下载 ✓"
      : status === "error"
        ? "链接已失效"
        : children

  return (
    <a
      href={href}
      onClick={handleClick}
      className={`underline underline-offset-2 break-all cursor-pointer ${
        status === "error"
          ? "text-red-500 opacity-100"
          : status === "done"
            ? "text-green-600 opacity-100"
            : "opacity-80 hover:opacity-100"
      }`}
    >
      {label}
    </a>
  )
}
