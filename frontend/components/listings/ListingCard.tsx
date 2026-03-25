import type { JobListing } from "@/lib/types"

interface Props {
  listing: JobListing
}

export function ListingCard({ listing }: Props) {
  return (
    <div className="glass rounded-2xl p-4 flex flex-col gap-1.5 hover:bg-white/80 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <a
          href={listing.url}
          target="_blank"
          rel="noopener noreferrer"
          className="font-heading italic text-base text-[var(--text)]
                     hover:text-[var(--text-2)] transition-colors
                     line-clamp-2 leading-snug"
        >
          {listing.title || "Untitled listing"}
        </a>
        <span className="flex-shrink-0 font-body font-light text-[10px] text-[var(--text-3)] mt-0.5">
          {listing.found_date}
        </span>
      </div>
      {(listing.company || listing.location) && (
        <p className="font-body font-light text-xs text-[var(--text-2)]">
          {[listing.company, listing.location].filter(Boolean).join(" · ")}
        </p>
      )}
      {listing.snippet && (
        <p className="font-body font-light text-xs text-[var(--text-3)] line-clamp-3 leading-relaxed">
          {listing.snippet}
        </p>
      )}
    </div>
  )
}
