/**
 * Loading UI for /screener. Rendered as a Suspense fallback by Next.js
 * whenever the page's server components are still streaming — cold
 * navigation, slow RSC fetches, and any client-side route change that
 * hits the segment. The screener queries Supabase for both the sector
 * options list and the filtered/sorted result set, so the initial load
 * can take several seconds on cold cache.
 *
 * Mirrors the structure used in `app/[locale]/stocks/[symbol]/loading.tsx`
 * so the two slow-loading routes give consistent feedback: header +
 * footer stay visible (they come from the locale layout), and the main
 * content area shows a centered spinner + label.
 */
export default function Loading() {
  return (
    <div className="mx-auto flex min-h-[60vh] max-w-screen-2xl items-center justify-center px-4 py-10 sm:px-6 lg:py-8">
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
        <p className="text-sm">Loading screener…</p>
      </div>
    </div>
  );
}