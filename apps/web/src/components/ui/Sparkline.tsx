'use client';

import { direction } from '@/lib/format/quote';

interface SparklinePoint {
  time: string;
  value: number;
}

interface SparklineProps {
  data: SparklinePoint[];
  /** Pixel width of the rendered SVG. */
  width?: number;
  /** Pixel height of the rendered SVG. */
  height?: number;
  /** Required for screen readers — describe what the line represents. */
  ariaLabel: string;
  /**
   * Optional horizontal baseline (rendered as a faint dashed line). Use for
   * zero-axis on oscillator-style indicators.
   */
  baseline?: number;
  /** Tailwind stroke colour override (otherwise chosen from direction). */
  strokeClassName?: string;
}

/**
 * Tiny inline-SVG sparkline. Sub-1KB per instance, zero hydration cost. Renders
 * one `<polyline>` scaled into a `viewBox` so the chart resizes with its
 * container. Colour follows the existing `direction()` helper used elsewhere
 * in the app (emerald for up, rose for down, neutral for flat) so it matches
 * `<SignedNumber>` visually.
 */
export function Sparkline({
  data,
  width = 120,
  height = 32,
  ariaLabel,
  baseline,
  strokeClassName,
}: SparklineProps) {
  if (data.length === 0) {
    return (
      <svg
        role="img"
        aria-label={ariaLabel}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      />
    );
  }

  if (data.length === 1) {
    return (
      <svg
        role="img"
        aria-label={ariaLabel}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
      >
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          className="stroke-border"
          strokeWidth={1}
        />
      </svg>
    );
  }

  const values = data.map((d) => d.value);
  const min = Math.min(...values, baseline ?? Infinity);
  const max = Math.max(...values, baseline ?? -Infinity);
  const range = max - min || 1;

  const points = data.map((d, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((d.value - min) / range) * height;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const first = data[0]?.value ?? 0;
  const last = data[data.length - 1]?.value ?? 0;
  const dir = direction(last - first);
  const stroke =
    strokeClassName ??
    (dir === 'up'
      ? 'stroke-emerald-500'
      : dir === 'down'
        ? 'stroke-rose-500'
        : 'stroke-fg-muted');

  const baselineY =
    baseline != null && baseline >= min && baseline <= max
      ? height - ((baseline - min) / range) * height
      : null;

  return (
    <svg
      role="img"
      aria-label={ariaLabel}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
    >
      {baselineY != null && (
        <line
          x1={0}
          y1={baselineY}
          x2={width}
          y2={baselineY}
          className="stroke-border"
          strokeWidth={1}
          strokeDasharray="2 2"
        />
      )}
      <polyline
        fill="none"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={stroke}
        points={points.join(' ')}
      />
    </svg>
  );
}