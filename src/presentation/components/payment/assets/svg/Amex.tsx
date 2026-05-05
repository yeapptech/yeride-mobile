import Svg, { G, Path, Rect } from 'react-native-svg';

/**
 * American Express card-brand glyph, hand-authored for Phase 9
 * Turn 13.
 *
 * Trace target: legacy yeride's `assets/amex.png`. Captures the
 * canonical Amex blue card with the white "AMEX" wordmark — the
 * "American Express" full text doesn't render legibly at receipt-
 * row sizes, so the abbreviation is the standard small-render
 * representation across fintech UIs.
 *
 * viewBox 0 0 60 40 matches the 3:2 aspect of the badge size
 * records.
 */
export default function Amex({
  width,
  height,
}: {
  readonly width: number;
  readonly height: number;
}) {
  return (
    <Svg width={width} height={height} viewBox="0 0 60 40">
      {/* Amex blue card body (#016FD0 — Amex's primary brand blue) */}
      <Rect x="0" y="0" width="60" height="40" rx="4" fill="#016FD0" />
      {/* Stylized AMEX wordmark in white. Each letter is a
       * simplified Path; the spacing places the wordmark roughly
       * centered horizontally and slightly above center vertically. */}
      <G>
        {/* A */}
        <Path
          d="M 10 26 L 12 14 L 15 14 L 17 26 L 14.5 26 L 14 24 L 13 24 L 12.5 26 Z M 13.3 22 L 13.7 19 L 14 22 Z"
          fill="#FFFFFF"
        />
        {/* M */}
        <Path
          d="M 19 26 L 19 14 L 22 14 L 23.5 20 L 25 14 L 28 14 L 28 26 L 26 26 L 26 18 L 24.5 24 L 22.5 24 L 21 18 L 21 26 Z"
          fill="#FFFFFF"
        />
        {/* E */}
        <Path
          d="M 31 14 L 38 14 L 38 16.5 L 33 16.5 L 33 19 L 37 19 L 37 21 L 33 21 L 33 23.5 L 38 23.5 L 38 26 L 31 26 Z"
          fill="#FFFFFF"
        />
        {/* X */}
        <Path
          d="M 41 14 L 43.5 14 L 45 17 L 46.5 14 L 49 14 L 46.5 20 L 49 26 L 46.5 26 L 45 23 L 43.5 26 L 41 26 L 43.5 20 Z"
          fill="#FFFFFF"
        />
      </G>
    </Svg>
  );
}
