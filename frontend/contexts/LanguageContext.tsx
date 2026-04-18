'use client'

import { createContext, useContext, useEffect, useState } from 'react'
import { t as translate, type Locale } from '@/lib/i18n'
import { apiTutorialSeed } from '@/lib/api-tutorial'
import { getAccessToken } from '@/lib/auth'

export const RESUME_INVALIDATED_EVENT = 'jh:resume-invalidated'

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
    // Re-seed the default resume + mock kanban card to match the new locale.
    // Backend only overwrites when `resume_is_default=true`, so real user
    // resumes stay untouched. Fire-and-forget; broadcast on success so open
    // Settings modals re-fetch the resume textarea.
    const token = getAccessToken()
    if (token) {
      apiTutorialSeed(token, l)
        .then(() => window.dispatchEvent(new Event(RESUME_INVALIDATED_EVENT)))
        .catch(() => {})
    }
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
