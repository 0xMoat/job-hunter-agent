"use client"

import { ListingCard } from "./ListingCard"
import { useListings } from "@/hooks/useListings"

export function ListingsPanel() {
  const { listings, loading, error, reload } = useListings()

  return (
    <div className="h-full flex flex-col bg-slate-900">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700 flex-shrink-0">
        <div>
          <h2 className="text-lg font-semibold text-white">Today's Picks</h2>
          <p className="text-sm text-slate-500">
            {listings.length > 0
              ? `${listings.length} listings from daily search`
              : "Daily search results — updated every morning at 08:00"}
          </p>
        </div>
        <button
          onClick={reload}
          className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {loading && (
          <p className="text-slate-500 text-sm text-center mt-12">
            Loading listings…
          </p>
        )}
        {error && (
          <p className="text-red-400 text-sm text-center mt-12">{error}</p>
        )}
        {!loading && !error && listings.length === 0 && (
          <div className="text-center mt-20">
            <p className="text-4xl mb-4">📋</p>
            <p className="text-slate-400 text-sm font-medium">No listings yet</p>
            <p className="text-slate-600 text-xs mt-2 max-w-xs mx-auto leading-relaxed">
              Tell the agent your daily search preferences:
              <br />
              <span className="font-mono text-slate-500">
                "设置每日搜索：agent engineer，上海，fulltime"
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
  )
}
