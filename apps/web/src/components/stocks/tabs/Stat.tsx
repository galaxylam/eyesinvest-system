/**
 * Shared `<Stat>` tile used by every tab panel. Mirrors the pattern in
 * `AnalyticsPanel.tsx` so all stock-detail surfaces feel like one product.
 */
export function Stat({
  label,
  value,
  sub,
  subTone,
  valueTone,
}: {
  label: string;
  value: string;
  sub?: string;
  subTone?: 'positive' | 'negative';
  valueTone?: 'positive' | 'negative' | 'warning' | 'neutral';
}) {
  const valueClass =
    valueTone === 'positive'
      ? 'text-emerald-500'
      : valueTone === 'negative'
        ? 'text-rose-500'
        : valueTone === 'warning'
          ? 'text-amber-500'
          : 'text-fg';
  return (
    <div className="px-5 py-3">
      <dt className="text-xs uppercase tracking-wide text-fg-subtle">{label}</dt>
      <dd className={`tabular mt-1 text-sm font-medium ${valueClass}`}>{value}</dd>
      {sub && (
        <dd
          className={
            'tabular mt-0.5 text-2xs ' +
            (subTone === 'positive'
              ? 'text-emerald-500'
              : subTone === 'negative'
                ? 'text-rose-500'
                : 'text-fg-subtle')
          }
        >
          {sub}
        </dd>
      )}
    </div>
  );
}