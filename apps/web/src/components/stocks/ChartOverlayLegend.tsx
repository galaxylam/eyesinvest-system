'use client';

import clsx from 'clsx';

export type MaKey = 'ma5' | 'ma20' | 'ma50' | 'ma200';

interface ChartOverlayLegendProps {
  visible: Record<MaKey, boolean>;
  onToggle: (key: MaKey) => void;
  labels: Record<MaKey, string>;
}

const COLOR: Record<MaKey, string> = {
  ma5: '#f472b6',   // pink-400 — fast line, lightest hue
  ma20: '#fbbf24',  // amber-400
  ma50: '#60a5fa',  // blue-400
  ma200: '#a78bfa', // violet-400
};

const ORDER: MaKey[] = ['ma5', 'ma20', 'ma50', 'ma200'];

/**
 * Renders three pill buttons above the price chart. Clicking a pill toggles
 * its MA overlay on/off. State is owned by the parent (PriceChart).
 */
export function ChartOverlayLegend({ visible, onToggle, labels }: ChartOverlayLegendProps) {
  return (
    <div
      role="toolbar"
      aria-label="Chart overlays"
      className="flex items-center gap-2 px-1 pb-2 pt-1"
    >
      {ORDER.map((key) => {
        const isOn = visible[key];
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            aria-pressed={isOn}
            className={clsx(
              'focus-ring inline-flex items-center gap-2 rounded-md border border-border px-2.5 py-1 font-mono text-2xs uppercase tracking-wide transition-opacity',
              isOn
                ? 'bg-bg-elevated text-fg opacity-100'
                : 'bg-bg-elevated text-fg-muted opacity-50 hover:opacity-100',
            )}
          >
            <span
              aria-hidden="true"
              className="inline-block h-2 w-2 rounded-full"
              style={{
                backgroundColor: COLOR[key],
                opacity: isOn ? 1 : 0.4,
              }}
            />
            {labels[key]}
          </button>
        );
      })}
    </div>
  );
}