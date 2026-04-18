"use client"

import { useState } from "react"
import { useLanguage } from "@/contexts/LanguageContext"

interface Props {
  onOpenSettings: () => void
}

export function DefaultResumeBanner({ onOpenSettings }: Props) {
  const { t } = useLanguage()
  const [dismissed, setDismissed] = useState(false)
  if (dismissed) return null

  return (
    <div className="mx-5 mt-3 mb-0 rounded-xl border border-amber-300/60 bg-amber-50 px-4 py-2.5 flex items-center gap-3">
      <span className="text-xs font-body text-amber-900 flex-1">{t("tutorial_default_resume_banner")}</span>
      <button
        onClick={onOpenSettings}
        className="text-xs font-body font-medium text-amber-900 underline underline-offset-2 hover:text-amber-950"
      >
        {t("tutorial_banner_cta")}
      </button>
      <button
        onClick={() => setDismissed(true)}
        aria-label={t("tutorial_banner_dismiss") as string}
        className="text-amber-700 hover:text-amber-900 px-1"
      >
        ✕
      </button>
    </div>
  )
}
