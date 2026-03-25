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
