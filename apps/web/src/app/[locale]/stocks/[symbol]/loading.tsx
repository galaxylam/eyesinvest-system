/**
 * Loading UI for /stocks/[symbol]. Rendered as a Suspense fallback by
 * Next.js whenever the page's server components are still streaming —
 * cold navigation, slow RSC fetches, client-side route changes that
 * trigger a re-render of the segment's server children.
 *
 * Renders inside the locale layout (so the header / footer stay visible).
 * The spinner + label is centered in the content area so the user has a
 * clear "page is loading" signal without losing their context.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-screen-xl items-center justify-center px-4 py-10 sm:px-6">
      <div className="flex flex-col items-center gap-3 text-fg-muted">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="h-8 w-8 animate-spin text-accent"
          aria-hidden="true"
        >
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeOpacity="0.25"
            strokeWidth="3"
          />
          <path
            d="M21 12a9 9 0 0 0-9-9"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        <p className="text-sm">Loading stock…</p>
      </div>
    </div>
  );
}