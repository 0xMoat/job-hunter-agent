import type { JobListing } from "@/lib/types"

interface Props {
  listing: JobListing
}

export function ListingCard({ listing }: Props) {
  return (
    <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 hover:border-slate-500 transition-colors flex flex-col gap-2">
      <div className="flex items-start justify-between gap-2">
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-semibold text-blue-400 hover:text-blue-300 transition-colors line-clamp-2 leading-snug"
        >
          {listing.title || "Untitled listing"}
        </a>
        <span className="flex-shrink-0 text-xs text-slate-600 mt-0.5">
          {listing.found_date}
        </span>
      </div>
      {(listing.company || listing.location) && (
        <p className="text-xs text-slate-400">
          {[listing.company, listing.location].filter(Boolean).join(" · ")}
        </p>
      )}
      {listing.snippet && (
        <p className="text-xs text-slate-500 line-clamp-3 leading-relaxed">
          {listing.snippet}
        </p>
      )}
    </div>
  )
}
