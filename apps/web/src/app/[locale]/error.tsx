'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-screen-md flex-col items-center px-4 py-24 text-center">
      <h1 className="text-2xl font-semibold tracking-tight text-fg">
        Something went wrong
      </h1>
      <p className="mt-2 max-w-md text-sm text-fg-muted">
        {error.message || 'An unexpected error occurred.'}
      </p>
      <button
        type="button"
        onClick={reset}
        className="focus-ring mt-6 inline-flex items-center rounded-md border border-border bg-bg-elevated px-4 py-2 text-sm font-medium text-fg transition-colors hover:bg-bg-muted"
      >
        Try again
      </button>
    </div>
  );
}
